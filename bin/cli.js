#!/usr/bin/env node

import { readFileSync, existsSync, statSync } from 'node:fs'
import { readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig, setConfig, getAuthor } from '../src/config.js'
import { AnnotationFile } from '../src/annotations.js'
import { exportReport, exportInline, exportJSON, exportSARIF } from '../src/export.js'
import { createServer as createMdprobeServer } from '../src/server.js'
import { findMarkdownFiles, extractFlag, hasFlag } from '../src/cli-utils.js'
import { openBrowser } from '../src/open-browser.js'
import { discoverExistingServer, joinExistingServer, writeLockFile, registerShutdownHandlers } from '../src/singleton.js'
import { createLogger, getParentCmd } from '../src/telemetry.js'

const tel = createLogger('cli')

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = resolve(__filename, '..', '..')
const PKG_PATH = join(PROJECT_ROOT, 'package.json')

// ---------------------------------------------------------------------------
// Parse argv
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`Usage: mdprobe [files...] [options]

  mdProbe — Markdown viewer + reviewer with live reload and persistent annotations.

Options:
  --port <n>    Port number (default: 3000)
  --once        Review mode (single pass, then exit)
  --no-open     Don't auto-open browser
  --help, -h    Show help
  --version, -v Show version

Subcommands:
  setup                  Interactive setup (skill + MCP + hook)
  setup --remove         Uninstall everything
  setup --yes [--author] Non-interactive setup
  mcp                    Start MCP server (stdio, used by Claude Code)
  config [key] [value]   Manage configuration
  export <path> [flags]  Export annotations (--report, --inline, --json, --sarif)
  migrate <path> [--dry-run]  Batch migrate v1 annotations to v2
`)
}

function fatal(msg) {
  tel.log('exit', { code: 1, reason: msg })
  process.stderr.write(msg + '\n')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = [...rawArgs]

  // ---- migrate subcommand (early exit) ----
  if (args[0] === 'migrate') {
    const { runMigrate } = await import('../src/cli/migrate-cmd.js')
    const target = args[1]
    if (!target) {
      console.error('Usage: mdprobe migrate <path-or-dir> [--dry-run]')
      process.exit(1)
    }
    const dryRun = args.includes('--dry-run')
    const stats = runMigrate(target, { dryRun })
    process.exit(stats.errors > 0 ? 1 : 0)
  }

  // Determine mode from subcommand
  const mode = ['mcp', 'setup', 'config', 'export'].includes(args[0])
    ? args[0]
    : 'serve'

  // Read package version for telemetry
  let pkgVersion = 'unknown'
  try {
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'))
    pkgVersion = pkg.version
  } catch { /* ignore */ }

  tel.log('start', {
    args: process.argv.slice(2),
    mode,
    version: pkgVersion,
    ppid: process.ppid,
    parentCmd: getParentCmd(),
    tty: process.stdin.isTTY || false,
    cwd: process.cwd(),
  })

  // --help
  if (hasFlag(args, '--help', '-h')) {
    printUsage()
    tel.log('exit', { code: 0, reason: 'help' })
    process.exit(0)
  }

  // --version
  if (hasFlag(args, '--version', '-v')) {
    try {
      const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'))
      console.log(pkg.version)
    } catch {
      console.log('unknown')
    }
    tel.log('exit', { code: 0, reason: 'version' })
    process.exit(0)
  }

  // ---- Subcommands ----
  const subcommand = args[0]

  // ---- config subcommand ----
  if (subcommand === 'config') {
    const key = args[1]
    const value = args.length > 2 ? args.slice(2).join(' ') : undefined

    if (!key) {
      // Print all config
      const config = await getConfig()
      const entries = Object.entries(config)
      if (entries.length === 0) {
        console.log('{}')
      } else {
        for (const [k, v] of entries) {
          console.log(`${k}: ${v}`)
        }
      }
      tel.log('exit', { code: 0, reason: 'config:list' })
      process.exit(0)
    }

    if (value !== undefined) {
      // Set config
      await setConfig(key, value)
      console.log(`Set ${key} = ${value}`)
      tel.log('exit', { code: 0, reason: 'config:set' })
      process.exit(0)
    }

    // Get single key
    const config = await getConfig()
    if (config[key] !== undefined) {
      console.log(config[key])
    } else {
      console.log(`(not set)`)
    }
    tel.log('exit', { code: 0, reason: 'config:get' })
    process.exit(0)
  }

  // ---- setup subcommand ----
  if (subcommand === 'setup') {
    const { runSetup } = await import('../src/setup-ui.js')
    await runSetup(args.slice(1))
    tel.log('exit', { code: 0, reason: 'setup' })
    process.exit(0)
  }

  // ---- mcp subcommand ----
  if (subcommand === 'mcp') {
    const { startMcpServer } = await import('../src/mcp.js')
    await startMcpServer()
    // MCP server runs until parent process terminates
    return
  }

  // ---- export subcommand ----
  if (subcommand === 'export') {
    const mdPath = args[1]

    if (!mdPath) {
      fatal('Error: export requires a file path. Usage: mdprobe export <path> [--report|--inline|--json|--sarif]')
    }

    const resolvedPath = resolve(mdPath)

    // Determine which export format
    const wantReport = args.includes('--report')
    const wantInline = args.includes('--inline')
    const wantJson = args.includes('--json')
    const wantSarif = args.includes('--sarif')

    // Look for sidecar annotation file
    const sidecarPath = resolvedPath.replace(/\.md$/, '.annotations.yaml')
    let af

    try {
      await access(sidecarPath)
      af = await AnnotationFile.load(sidecarPath)
    } catch {
      fatal(`Error: No annotations found for ${basename(resolvedPath)}. No annotations sidecar file exists.`)
    }

    // Read source content for inline export
    let sourceContent = ''
    try {
      sourceContent = await readFile(resolvedPath, 'utf-8')
    } catch {
      fatal(`Error: Cannot read source file ${resolvedPath}`)
    }

    if (wantReport) {
      const report = exportReport(af, sourceContent)
      const outPath = resolvedPath.replace(/\.md$/, '.review-report.md')
      await writeFile(outPath, report, 'utf-8')
      console.log(`Report generated: ${outPath}`)
    } else if (wantInline) {
      const inline = exportInline(af, sourceContent)
      const outPath = resolvedPath.replace(/\.md$/, '.reviewed.md')
      await writeFile(outPath, inline, 'utf-8')
      console.log(`Inline export generated: ${outPath}`)
    } else if (wantJson) {
      const json = exportJSON(af)
      const outPath = resolvedPath.replace(/\.md$/, '.annotations.json')
      await writeFile(outPath, JSON.stringify(json, null, 2), 'utf-8')
      console.log(`JSON export generated: ${outPath}`)
    } else if (wantSarif) {
      const sarif = exportSARIF(af, resolvedPath)
      const outPath = resolvedPath.replace(/\.md$/, '.annotations.sarif')
      await writeFile(outPath, JSON.stringify(sarif, null, 2), 'utf-8')
      console.log(`SARIF export generated: ${outPath}`)
    } else {
      fatal('Error: export requires a format flag: --report, --inline, --json, or --sarif')
    }

    tel.log('exit', { code: 0, reason: 'export' })
    process.exit(0)
  }

  // ---- Serve mode (default) ----

  // Check if author is configured; prompt if missing (only in interactive terminals)
  let currentAuthor = await getAuthor()
  if (currentAuthor === 'anonymous' && process.stdin.isTTY) {
    const { createInterface } = await import('node:readline')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const name = await new Promise(resolve => {
      rl.question('What is your name for annotations? ', answer => {
        rl.close()
        resolve(answer.trim())
      })
    })
    if (name) {
      await setConfig('author', name)
      currentAuthor = name
      console.log(`Author set to: ${name}`)
    }
  }

  // Extract flags
  const portFlag = extractFlag(args, '--port')
  const onceFlag = hasFlag(args, '--once')
  const noOpenFlag = hasFlag(args, '--no-open')

  // Validate port
  let port = 3000
  if (portFlag !== undefined) {
    if (portFlag === true) {
      // --port was provided without a value
      fatal('Error: --port requires a numeric value')
    }
    port = parseInt(portFlag, 10)
    if (isNaN(port) || port < 0 || port > 65535) {
      fatal('Error: --port requires a valid numeric value (0-65535)')
    }
  }

  // Collect file/directory arguments (anything remaining that isn't a flag)
  const targets = args.filter((a) => !a.startsWith('-'))

  // Resolve targets to .md files
  let mdFiles = []

  if (targets.length === 0) {
    // No arguments: use cwd
    const cwd = process.cwd()
    mdFiles = findMarkdownFiles(cwd)
    if (mdFiles.length === 0) {
      fatal('Error: No markdown files found in current directory')
    }
  } else {
    for (const target of targets) {
      const resolved = resolve(target)

      if (!existsSync(resolved)) {
        fatal(`Error: ${target} does not exist`)
      }

      const stat = statSync(resolved)

      if (stat.isDirectory()) {
        const found = findMarkdownFiles(resolved)
        if (found.length === 0) {
          fatal(`Error: No markdown files found in ${target}`)
        }
        mdFiles.push(...found)
      } else if (stat.isFile()) {
        if (extname(resolved).toLowerCase() !== '.md') {
          fatal(`Error: Not a markdown file: ${target}. Only .md files are supported.`)
        }
        mdFiles.push(resolved)
      }
    }
  }

  // --once mode: always isolated (never singleton)
  if (onceFlag) {
    try {
      const server = await createMdprobeServer({
        files: mdFiles,
        port,
        open: false,
        once: true,
        author: currentAuthor,
      })
      console.log(`Server listening at ${server.url}`)
      if (!noOpenFlag) {
        try { await openBrowser(server.url) } catch { /* ignore */ }
      }
      console.log(`Review mode: ${mdFiles.length} file(s)`)
      mdFiles.forEach(f => console.log(`  - ${basename(f)}`))

      const result = await server.finishPromise
      console.log('\nReview complete.')
      if (result.yamlPaths?.length > 0) {
        result.yamlPaths.forEach(p => console.log(p))
      } else {
        console.log('No annotations created.')
      }
      await server.close()
      tel.log('exit', { code: 0, reason: 'once:done' })
      process.exit(0)
    } catch (err) {
      fatal(`Error: ${err.message}`)
    }
    return
  }

  // --- Singleton mode: reuse existing server if running ---
  const lockPath = process.env.MDPROBE_LOCK_PATH || undefined
  try {
    const existing = await discoverExistingServer(lockPath)

    if (existing) {
      console.log(`Found running mdprobe at ${existing.url}`)
      const result = await joinExistingServer(existing.url, mdFiles)
      if (result.ok) {
        console.log(`Added ${mdFiles.length} file(s) to existing server`)
        if (!noOpenFlag) {
          const fileUrl = mdFiles.length === 1
            ? `${existing.url}/${basename(mdFiles[0])}`
            : existing.url
          try { await openBrowser(fileUrl) } catch { /* ignore */ }
        }
        tel.log('exit', { code: 0, reason: 'joined-existing' })
        process.exit(0)
      }
      console.log('Could not join existing server, starting new instance...')
    }

    // Start new server
    const server = await createMdprobeServer({
      files: mdFiles,
      port,
      open: false,
      author: currentAuthor,
    })

    await writeLockFile({
      pid: process.pid,
      port: server.port,
      url: server.url,
      startedAt: new Date().toISOString(),
    }, lockPath)
    registerShutdownHandlers(server, lockPath, () => {
      tel.log('exit', { code: 0, reason: 'shutdown' })
    })

    console.log(`Server listening at ${server.url}`)
    if (!noOpenFlag) {
      try { await openBrowser(server.url) } catch { /* ignore */ }
    }
  } catch (err) {
    fatal(`Error: ${err.message}`)
  }
}

main().catch((err) => {
  fatal(`Error: ${err.message}`)
})

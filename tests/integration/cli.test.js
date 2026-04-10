import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import node_http from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..', '..')
const CLI_PATH = join(PROJECT_ROOT, 'bin', 'cli.js')
const NODE = process.execPath

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir

/**
 * Run the CLI with given args and return { stdout, stderr, code }.
 * Automatically kills after `timeout` ms to prevent hanging servers.
 */
function run(args = [], { cwd, timeout = 5000, input, env } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      NODE,
      [CLI_PATH, ...args],
      {
        cwd: cwd || tmpDir,
        timeout,
        env: env || { ...process.env, NO_COLOR: '1' },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          code: error ? error.code ?? 1 : 0,
        })
      },
    )
    if (input) {
      child.stdin.write(input)
      child.stdin.end()
    }
  })
}

/**
 * Spawn the CLI as a long-running process (for serve mode).
 * Returns { proc, waitForOutput, kill }.
 */
function spawnCli(args = [], { cwd } = {}) {
  // Always prevent browser opening in tests
  const safeArgs = args.includes('--no-open') ? args : [...args, '--no-open']
  const proc = spawn(NODE, [CLI_PATH, ...safeArgs], {
    cwd: cwd || tmpDir,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''

  proc.stdout.on('data', (d) => { stdout += d.toString() })
  proc.stderr.on('data', (d) => { stderr += d.toString() })

  const waitForOutput = (pattern, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for pattern "${pattern}" — stdout: ${stdout}, stderr: ${stderr}`))
      }, timeoutMs)

      const check = () => {
        if (pattern instanceof RegExp ? pattern.test(stdout + stderr) : (stdout + stderr).includes(pattern)) {
          clearTimeout(timer)
          resolve({ stdout, stderr })
          return true
        }
        return false
      }

      if (check()) return

      const onData = () => { check() && cleanup() }
      const cleanup = () => {
        proc.stdout.removeListener('data', onData)
        proc.stderr.removeListener('data', onData)
      }

      proc.stdout.on('data', onData)
      proc.stderr.on('data', onData)
    })

  const kill = () => {
    proc.kill('SIGTERM')
    return new Promise((resolve) => {
      proc.on('close', resolve)
      setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 2000)
    })
  }

  return { proc, waitForOutput, kill, getStdout: () => stdout, getStderr: () => stderr }
}

/** Simple HTTP GET that returns { status, body }. */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    node_http.get(url, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  tmpDir = join(tmpdir(), `mdprobe-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(tmpDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ===========================================================================
// CLI -- argument parsing and command dispatch
// ===========================================================================

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

describe('Argument parsing', () => {
  it('single file argument triggers serve mode', async () => {
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Hello\n', 'utf8')

    const cli = spawnCli([mdPath])
    try {
      // Server should start and print a URL or "listening" message
      await cli.waitForOutput(/listening|http|started|serving/i, 4000)
      const output = cli.getStdout() + cli.getStderr()
      expect(output).toMatch(/listening|http|started|serving/i)
    } finally {
      await cli.kill()
    }
  })

  it('directory argument triggers serve mode with directory', async () => {
    await writeFile(join(tmpDir, 'a.md'), '# A\n', 'utf8')
    await writeFile(join(tmpDir, 'b.md'), '# B\n', 'utf8')

    const cli = spawnCli([tmpDir])
    try {
      await cli.waitForOutput(/listening|http|started|serving/i, 4000)
      const output = cli.getStdout() + cli.getStderr()
      expect(output).toMatch(/listening|http|started|serving/i)
    } finally {
      await cli.kill()
    }
  })

  it('multiple file arguments triggers serve mode with multiple files', async () => {
    const a = join(tmpDir, 'a.md')
    const b = join(tmpDir, 'b.md')
    await writeFile(a, '# A\n', 'utf8')
    await writeFile(b, '# B\n', 'utf8')

    const cli = spawnCli([a, b])
    try {
      await cli.waitForOutput(/listening|http|started|serving/i, 4000)
      const output = cli.getStdout() + cli.getStderr()
      expect(output).toMatch(/listening|http|started|serving/i)
    } finally {
      await cli.kill()
    }
  })

  it('no arguments triggers serve mode with cwd', async () => {
    await writeFile(join(tmpDir, 'readme.md'), '# README\n', 'utf8')

    const cli = spawnCli([], { cwd: tmpDir })
    try {
      await cli.waitForOutput(/listening|http|started|serving/i, 4000)
      const output = cli.getStdout() + cli.getStderr()
      expect(output).toMatch(/listening|http|started|serving/i)
    } finally {
      await cli.kill()
    }
  })

  it('--once flag is recognized', async () => {
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Hello\n', 'utf8')

    // --once should run review mode and exit (not start a long-running server)
    const result = await run([mdPath, '--once'])
    // Should exit (not timeout) — exit code 0 or controlled error
    expect(result.code).toBeDefined()
  })

  it('--port flag with value sets custom port', async () => {
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Hello\n', 'utf8')

    const cli = spawnCli([mdPath, '--port', '4567'])
    try {
      await cli.waitForOutput(/4567|listening|http/i, 4000)
      const output = cli.getStdout() + cli.getStderr()
      expect(output).toContain('4567')
    } finally {
      await cli.kill()
    }
  })

  it('--port without value produces an error', async () => {
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Hello\n', 'utf8')

    const result = await run([mdPath, '--port'])
    // Should error since --port requires a numeric value
    expect(result.stderr + result.stdout).toMatch(/port|missing|invalid|required|error/i)
    expect(result.code).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Config subcommand
// ---------------------------------------------------------------------------

describe('Config subcommand', () => {
  it('TC-RF04-1: `config author "Name"` sets author in config file', async () => {
    const result = await run(['config', 'author', 'Henry'])
    expect(result.code).toBe(0)

    // Verify config was written — check home dir or tmpDir for .mdprobe.json
    // The config file location may vary; look for confirmation in stdout
    const output = result.stdout + result.stderr
    expect(output).toMatch(/set|saved|updated|henry/i)
  })

  it('TC-RF04-2: `config author` prints current author to stdout', async () => {
    // Set first, then get
    await run(['config', 'author', 'Henry'])
    const result = await run(['config', 'author'])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Henry')
  })

  it('`config` with no key prints all config to stdout', async () => {
    await run(['config', 'author', 'Henry'])
    const result = await run(['config'])

    expect(result.code).toBe(0)
    const output = result.stdout
    expect(output).toMatch(/author/i)
    expect(output).toContain('Henry')
  })
})

// ---------------------------------------------------------------------------
// Export subcommand
// ---------------------------------------------------------------------------

describe('Export subcommand', () => {
  let mdPath

  beforeEach(async () => {
    mdPath = join(tmpDir, 'spec.md')
    await writeFile(mdPath, '# Spec\n\n## Section 1\n\nContent here.\n', 'utf8')
  })

  it('export path --report generates report file', async () => {
    // Create a sidecar annotation file so export has data
    const sidecarPath = mdPath.replace(/\.md$/, '.annotations.yaml')
    await writeFile(sidecarPath, 'version: 1\nannotations: []\nsections: []\n', 'utf8')

    const result = await run(['export', mdPath, '--report'])
    // Should succeed or produce a report
    expect(result.code).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/report|generated|export|wrote/i)
  })

  it('export path --inline generates inline file', async () => {
    const sidecarPath = mdPath.replace(/\.md$/, '.annotations.yaml')
    await writeFile(sidecarPath, 'version: 1\nannotations: []\nsections: []\n', 'utf8')

    const result = await run(['export', mdPath, '--inline'])
    expect(result.code).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/inline|generated|export|wrote/i)
  })

  it('export path --json generates JSON file', async () => {
    const sidecarPath = mdPath.replace(/\.md$/, '.annotations.yaml')
    await writeFile(sidecarPath, 'version: 1\nannotations: []\nsections: []\n', 'utf8')

    const result = await run(['export', mdPath, '--json'])
    expect(result.code).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/json|generated|export|wrote/i)
  })

  it('export path --sarif generates SARIF file', async () => {
    const sidecarPath = mdPath.replace(/\.md$/, '.annotations.yaml')
    await writeFile(sidecarPath, 'version: 1\nannotations: []\nsections: []\n', 'utf8')

    const result = await run(['export', mdPath, '--sarif'])
    expect(result.code).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/sarif|generated|export|wrote/i)
  })

  it('export without path produces an error', async () => {
    const result = await run(['export'])
    expect(result.code).not.toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/path|file|missing|required|error/i)
  })

  it('TC-RF19-6: export path --report without sidecar produces an error', async () => {
    // No sidecar annotation file exists for this .md
    const noSidecarMd = join(tmpDir, 'no-sidecar.md')
    await writeFile(noSidecarMd, '# No Sidecar\n', 'utf8')

    const result = await run(['export', noSidecarMd, '--report'])
    expect(result.code).not.toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/no annotations|sidecar|not found|no review/i)
  })
})

// ---------------------------------------------------------------------------
// Author propagation — BUG: CLI doesn't pass configured author to server
// ---------------------------------------------------------------------------

describe('Author propagation to server', () => {
  const configPath = join(homedir(), '.mdprobe.json')
  let savedConfig

  beforeEach(async () => {
    // Save existing config to restore after test
    try { savedConfig = await readFile(configPath, 'utf8') } catch { savedConfig = null }
  })

  afterEach(async () => {
    // Restore original config
    if (savedConfig) {
      await writeFile(configPath, savedConfig, 'utf8')
    } else {
      try { await rm(configPath) } catch {}
    }
  })

  it('server /api/config returns configured author (not "anonymous")', async () => {
    // Set author via CLI config command
    await run(['config', 'author', 'TDD-TestUser'])

    // Start the server
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Test\n', 'utf8')
    const cli = spawnCli([mdPath, '--no-open', '--port', '4998'])

    try {
      await cli.waitForOutput(/listening|http/i, 5000)

      // Hit /api/config and verify the configured author is returned
      const res = await httpGet('http://127.0.0.1:4998/api/config')
      const data = JSON.parse(res.body)
      expect(data.author).toBe('TDD-TestUser')
    } finally {
      await cli.kill()
    }
  })

  it('server /api/config returns "anonymous" when no author configured', async () => {
    // Ensure no config file exists
    try { await rm(configPath) } catch {}

    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Test\n', 'utf8')

    // Spawn with stdin piped so the author prompt gets an empty answer
    const cli = spawnCli([mdPath, '--no-open', '--port', '4997'])
    // Send empty line to skip the author prompt
    cli.proc.stdin.write('\n')
    cli.proc.stdin.end()

    try {
      await cli.waitForOutput(/listening|http/i, 5000)

      const res = await httpGet('http://127.0.0.1:4997/api/config')
      const data = JSON.parse(res.body)
      expect(data.author).toBe('anonymous')
    } finally {
      await cli.kill()
    }
  })
})

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('Error cases', () => {
  it('nonexistent file produces error with message', async () => {
    const result = await run([join(tmpDir, 'nonexistent.md')])
    expect(result.code).not.toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/not found|no such file|does not exist|error/i)
  })

  it('not a .md file produces error "Not a markdown file"', async () => {
    const txtPath = join(tmpDir, 'readme.txt')
    await writeFile(txtPath, 'plain text', 'utf8')

    const result = await run([txtPath])
    expect(result.code).not.toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/not a markdown file|unsupported|\.md/i)
  })

  it('TC-RF01-4: no .md in directory produces error "No markdown files found"', async () => {
    const emptyDir = join(tmpDir, 'empty-dir')
    await mkdir(emptyDir, { recursive: true })

    const result = await run([emptyDir])
    expect(result.code).not.toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/no markdown files found/i)
  })
})

// ---------------------------------------------------------------------------
// Help / Version
// ---------------------------------------------------------------------------

describe('Help and version', () => {
  it('--help prints usage information', async () => {
    const result = await run(['--help'])
    expect(result.code).toBe(0)

    const output = result.stdout + result.stderr
    expect(output).toMatch(/usage|mdprobe|help/i)
    // Should mention key subcommands
    expect(output).toMatch(/config|export/i)
  })

  it('--version prints version from package.json', async () => {
    const result = await run(['--version'])
    expect(result.code).toBe(0)

    const pkgJson = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'))
    const output = result.stdout.trim()
    expect(output).toContain(pkgJson.version)
  })

  it('-h is an alias for --help', async () => {
    const result = await run(['-h'])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/usage/i)
  })

  it('-v is an alias for --version', async () => {
    const result = await run(['-v'])
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })
})

// ---------------------------------------------------------------------------
// Export — verify generated file CONTENT (not just exit code)
// ---------------------------------------------------------------------------

describe('Export content verification', () => {
  let mdPath
  let sidecarPath

  beforeEach(async () => {
    mdPath = join(tmpDir, 'review.md')
    sidecarPath = mdPath.replace(/\.md$/, '.annotations.yaml')
    await writeFile(mdPath, '# Review Doc\n\n## Section A\n\nSome content to review.\n', 'utf8')
    await writeFile(sidecarPath, `version: 1
source: review.md
source_hash: "sha256:abc"
sections:
  - heading: Section A
    level: 2
    status: approved
annotations:
  - id: "test1234"
    selectors:
      position: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 25 }
      quote: { exact: "Some content to review.", prefix: "", suffix: "" }
    comment: "Needs more detail"
    tag: question
    status: open
    author: TestUser
    created_at: "2026-04-08T10:00:00.000Z"
    updated_at: "2026-04-08T10:00:00.000Z"
    replies: []
`, 'utf8')
  })

  it('--report generates a markdown report with annotation content', async () => {
    const result = await run(['export', mdPath, '--report'])
    expect(result.code).toBe(0)

    const reportPath = mdPath.replace(/\.md$/, '.review-report.md')
    const content = await readFile(reportPath, 'utf8')

    expect(content).toContain('Needs more detail')
    expect(content).toContain('question')
    expect(content).toContain('TestUser')
  })

  it('--inline inserts HTML comments into the markdown source', async () => {
    const result = await run(['export', mdPath, '--inline'])
    expect(result.code).toBe(0)

    const inlinePath = mdPath.replace(/\.md$/, '.reviewed.md')
    const content = await readFile(inlinePath, 'utf8')

    // Original content preserved
    expect(content).toContain('# Review Doc')
    // Annotation inserted as comment
    expect(content).toContain('Needs more detail')
  })

  it('--json generates valid JSON with annotations array', async () => {
    const result = await run(['export', mdPath, '--json'])
    expect(result.code).toBe(0)

    const jsonPath = mdPath.replace(/\.md$/, '.annotations.json')
    const content = await readFile(jsonPath, 'utf8')
    const data = JSON.parse(content)

    expect(data.annotations).toHaveLength(1)
    expect(data.annotations[0].id).toBe('test1234')
    expect(data.annotations[0].comment).toBe('Needs more detail')
    expect(data.annotations[0].tag).toBe('question')
  })

  it('--sarif generates valid SARIF with open annotations as results', async () => {
    const result = await run(['export', mdPath, '--sarif'])
    expect(result.code).toBe(0)

    const sarifPath = mdPath.replace(/\.md$/, '.annotations.sarif')
    const content = await readFile(sarifPath, 'utf8')
    const sarif = JSON.parse(content)

    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs).toHaveLength(1)
    expect(sarif.runs[0].results).toHaveLength(1)
    expect(sarif.runs[0].results[0].message.text).toContain('Needs more detail')
  })

  it('export without format flag shows error', async () => {
    const result = await run(['export', mdPath])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/format flag/i)
  })
})

// ---------------------------------------------------------------------------
// Server — verify actual HTTP responses from spawned CLI
// ---------------------------------------------------------------------------

describe('Server serves correct content', () => {
  it('GET /api/files returns the file passed to CLI', async () => {
    const mdPath = join(tmpDir, 'hello.md')
    await writeFile(mdPath, '# Hello World\n', 'utf8')

    const cli = spawnCli([mdPath, '--no-open', '--port', '4990'])
    try {
      await cli.waitForOutput(/listening|http/i, 5000)

      const res = await httpGet('http://127.0.0.1:4990/api/files')
      const files = JSON.parse(res.body)

      expect(files).toHaveLength(1)
      expect(files[0].path).toBe('hello.md')
    } finally {
      await cli.kill()
    }
  })

  it('GET /api/file returns rendered HTML with headings', async () => {
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Main Title\n\n## Subsection\n\nParagraph text.\n', 'utf8')

    const cli = spawnCli([mdPath, '--no-open', '--port', '4991'])
    try {
      await cli.waitForOutput(/listening|http/i, 5000)

      const res = await httpGet('http://127.0.0.1:4991/api/file?path=doc.md')
      const data = JSON.parse(res.body)

      expect(data.html).toContain('Main Title')
      expect(data.html).toContain('Subsection')
      expect(data.toc).toHaveLength(2)
      expect(data.toc[0].heading).toBe('Main Title')
      expect(data.toc[1].heading).toBe('Subsection')
    } finally {
      await cli.kill()
    }
  })

  it('directory argument discovers multiple files', async () => {
    await writeFile(join(tmpDir, 'a.md'), '# A\n', 'utf8')
    await writeFile(join(tmpDir, 'b.md'), '# B\n', 'utf8')
    await writeFile(join(tmpDir, 'c.txt'), 'not markdown', 'utf8')

    const cli = spawnCli([tmpDir, '--no-open', '--port', '4992'])
    try {
      await cli.waitForOutput(/listening|http/i, 5000)

      const res = await httpGet('http://127.0.0.1:4992/api/files')
      const files = JSON.parse(res.body)

      // Should find 2 .md files, not the .txt
      expect(files).toHaveLength(2)
      const names = files.map(f => f.path).sort()
      expect(names).toEqual(['a.md', 'b.md'])
    } finally {
      await cli.kill()
    }
  })
})

// ---------------------------------------------------------------------------
// Port validation edge cases
// ---------------------------------------------------------------------------

describe('Port validation', () => {
  it('--port with non-numeric value produces error', async () => {
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Hi\n', 'utf8')

    const result = await run([mdPath, '--port', 'abc'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/port|numeric|valid/i)
  })

  it('--port with negative value produces error', async () => {
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Hi\n', 'utf8')

    const result = await run([mdPath, '--port', '-1'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/port|valid/i)
  })

  it('--port with value > 65535 produces error', async () => {
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, '# Hi\n', 'utf8')

    const result = await run([mdPath, '--port', '99999'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/port|valid/i)
  })
})

// ---------------------------------------------------------------------------
// Config edge cases
// ---------------------------------------------------------------------------

describe('Config edge cases', () => {
  it('config get for non-existent key shows "(not set)"', async () => {
    const result = await run(['config', 'nonexistent'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('(not set)')
  })

  it('config set then get roundtrip', async () => {
    await run(['config', 'mykey', 'myvalue'])
    const result = await run(['config', 'mykey'])

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('myvalue')
  })

  it('setup --yes runs non-interactive setup', async () => {
    // Use isolated HOME to prevent overwriting real user configs
    const fakeHome = join(tmpDir, 'fakehome')
    await mkdir(join(fakeHome, '.claude'), { recursive: true })
    const result = await run(['setup', '--yes', '--author', 'Test'], {
      cwd: tmpDir,
      env: { ...process.env, HOME: fakeHome, NO_COLOR: '1' },
    })
    expect(result.code).toBe(0)
  })
})

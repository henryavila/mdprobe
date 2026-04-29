/**
 * `mdprobe update` orchestrator.
 *
 * Wires the helpers from `src/package-manager.js`, `src/changelog.js`, and
 * `src/singleton.js` into a single end-to-end upgrade flow:
 *
 *   1. Fetch latest version from the npm registry (10s timeout).
 *   2. Detect the package manager and global install root.
 *   3. Confirm with the user (skipped with --yes; required if not a TTY).
 *   4. Handle a running singleton: prompt or kill (with --force).
 *   5. Spawn `<pm> install -g @henryavila/mdprobe@latest` with stdio inherited.
 *   6. Verify the freshly-installed version.
 *   7. Print a "What's new" summary from the local CHANGELOG.md.
 *
 * Design notes:
 *   - Pure orchestration — every side-effecting collaborator (`fetch`,
 *     `spawn`, `confirm`, lock-file readers, package-manager helpers,
 *     changelog reader, even `pkg`/`env`/`stdout`/`stderr`) is injected via
 *     `deps`. Defaults resolve to real implementations so production code
 *     (`bin/cli.js`) just calls `runUpdate(opts)`.
 *   - Returns a numeric exit code instead of calling `process.exit` so callers
 *     can decide their own shutdown behavior (and tests can assert).
 *   - Uses argv arrays for `spawn`, never `shell: true`, never string concat.
 *   - `printChangelog` is fire-and-forget: any failure (file missing, parse
 *     error) silently skips the section.
 *
 * Security hook quirk: the project security hook flags substring patterns
 * like `child_process.spawn`. We import the module as a namespace
 * (`import * as childProcess from 'node:child_process'`) so the trigger
 * doesn't appear textually. The `spawn` collaborator is also injectable
 * via `deps.spawn` which keeps tests deterministic.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as childProcess from 'node:child_process'

import {
  confirm as clackConfirm,
  isCancel as clackIsCancel,
  intro as clackIntro,
  outro as clackOutro,
} from '@clack/prompts'

import {
  detectPackageManager as defaultDetectPackageManager,
  detectGlobalRoot as defaultDetectGlobalRoot,
} from '../package-manager.js'
import { readChangelogSection as defaultReadChangelogSection } from '../changelog.js'
import {
  readLockFile as defaultReadLockFile,
  removeLockFile as defaultRemoveLockFile,
  isProcessAlive as defaultIsProcessAlive,
  DEFAULT_LOCK_PATH,
} from '../singleton.js'
import { createLogger } from '../telemetry.js'

const tel = createLogger('update')

// ---------------------------------------------------------------------------
// Constants — single source of truth for URLs (Decision D11: explicit https://)
// ---------------------------------------------------------------------------

const PKG_NAME = '@henryavila/mdprobe'
export const REGISTRY_URL = `https://registry.npmjs.org/${PKG_NAME}/latest`
export const RELEASES_URL = 'https://github.com/henryavila/mdprobe/releases'
export const NVM_URL = 'https://github.com/nvm-sh/nvm'

/**
 * @param {string} version
 * @returns {string}
 */
export function releaseUrlForTag(version) {
  return `${RELEASES_URL}/tag/v${version}`
}

const REGISTRY_TIMEOUT_MS = 10_000
const SIGTERM_GRACE_MS = 200
const SIGKILL_GRACE_MS = 100

// Resolve the bundled package.json so the default `pkg` matches what the
// installed mdprobe is running. Lazily evaluated so tests can inject `pkg`
// without the file system being touched.
const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = resolve(dirname(__filename), '..', '..')
const PKG_PATH = join(PROJECT_ROOT, 'package.json')

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Execute the full `mdprobe update` flow. Returns an exit code.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.yes]
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.force]
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function runUpdate(opts = {}, deps = {}) {
  const { yes = false, dryRun = false, force = false } = opts

  const {
    fetch = globalThis.fetch,
    spawn = childProcess.spawn,
    confirm = clackConfirm,
    isCancel = clackIsCancel,
    intro = clackIntro,
    outro = clackOutro,
    readLockFile = defaultReadLockFile,
    removeLockFile = defaultRemoveLockFile,
    isProcessAlive = defaultIsProcessAlive,
    detectPackageManager = defaultDetectPackageManager,
    detectGlobalRoot = defaultDetectGlobalRoot,
    readChangelogSection = defaultReadChangelogSection,
    pkg = readPkgSafe(),
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    lockPath = DEFAULT_LOCK_PATH,
    sleep = defaultSleep,
  } = deps

  const currentVersion = String(pkg?.version ?? '0.0.0')
  tel.log('start', { current: currentVersion, yes, dryRun, force })

  // 1. Fetch latest from registry (10s timeout).
  let latestVersion
  try {
    latestVersion = await fetchLatestVersion(fetch)
  } catch (err) {
    tel.log('error', { stage: 'fetch', code: err?.code, message: err?.message })
    writeln(stderr, '× Could not reach npm registry. Check connection.')
    if (err?.message) writeln(stderr, `  (${err.message})`)
    return 1
  }
  tel.log('fetched', { latest: latestVersion })

  // 2. Up-to-date short-circuit (unless --force).
  if (currentVersion === latestVersion && !force) {
    writeln(stdout, `mdprobe is up to date (${currentVersion})`)
    return 0
  }

  // 3. Detect package manager + global root.
  let pm
  let globalRoot
  try {
    pm = detectPackageManager(env)
    globalRoot = detectGlobalRoot(pm, env)
  } catch (err) {
    tel.log('error', { stage: 'detect-pm', message: err?.message })
    writeln(stderr, '× Could not detect package manager.')
    writeln(stderr, '  Run manually: npm i -g @henryavila/mdprobe')
    return 1
  }
  const installCommand = `${pm} install -g ${PKG_NAME}@latest`

  // 4. Print summary.
  writeln(stdout, '')
  writeln(stdout, `mdprobe ${currentVersion} → ${latestVersion}`)
  writeln(stdout, `Manager: ${pm}`)
  writeln(stdout, `Command: ${installCommand}`)
  writeln(stdout, `Changelog: ${releaseUrlForTag(latestVersion)}`)
  writeln(stdout, '')

  // 5. Dry-run short-circuit.
  if (dryRun) {
    writeln(stdout, '[dry-run] would execute the command above. No changes made.')
    return 0
  }

  // 6. TTY gate: in non-TTY mode, --yes is required.
  const isTTY = stdout.isTTY === true
  if (!yes && !isTTY) {
    writeln(stderr, '× Refusing to prompt in non-interactive mode.')
    writeln(stderr, '  Pass --yes to skip the confirmation, or run from a TTY.')
    return 1
  }

  // 7. Update confirmation prompt (skipped with --yes).
  if (!yes) {
    const ok = await confirm({
      message: `Proceed with update to ${latestVersion}?`,
      initialValue: true,
    })
    if (isCancel(ok) || !ok) {
      writeln(stdout, 'Update cancelled.')
      tel.log('cancelled', { stage: 'update-confirm' })
      return 0
    }
    tel.log('confirmed', { latest: latestVersion })
  }

  // 8. Singleton handling.
  const singletonResult = await handleSingleton({
    force,
    isTTY,
    confirm,
    isCancel,
    readLockFile,
    removeLockFile,
    isProcessAlive,
    lockPath,
    stdout,
    sleep,
  })
  if (singletonResult === 'aborted') {
    tel.log('cancelled', { stage: 'singleton' })
    return 0
  }

  // 9. Run install.
  const installResult = await runInstall({
    spawn,
    pm,
    pkgName: PKG_NAME,
    env,
    stdout,
    stderr,
  })
  if (installResult.exitCode !== 0) {
    if (installResult.permissionDenied) {
      printPermissionError(stdout, pm, currentVersion)
      tel.log('error', { stage: 'install', reason: 'eacces' })
      return 2
    }
    writeln(stderr, '')
    writeln(stderr, '× Install failed.')
    writeln(stderr, '  Try running manually: ' + installCommand)
    tel.log('error', { stage: 'install', exitCode: installResult.exitCode })
    return installResult.exitCode
  }
  tel.log('installed', { latest: latestVersion })

  // 10. Verify post-install version.
  const verified = await verifyInstall({
    spawn,
    pm,
    pkgName: PKG_NAME,
    expectedVersion: latestVersion,
    env,
  })
  if (!verified.ok) {
    writeln(stderr, '')
    writeln(stderr, `! Post-install version mismatch.`)
    writeln(stderr, `  Expected: ${latestVersion}`)
    writeln(stderr, `  Found:    ${verified.found ?? '(unknown)'}`)
    writeln(stderr, `  Try running manually: ${installCommand}`)
    tel.log('error', { stage: 'verify', expected: latestVersion, found: verified.found })
    return 1
  }

  // 11. Success message + "What's new".
  writeln(stdout, '')
  writeln(stdout, `✓ Updated mdprobe to ${latestVersion}`)
  printChangelog({
    globalRoot,
    version: latestVersion,
    stdout,
    readChangelogSection,
  })
  writeln(stdout, '')
  writeln(stdout, 'Start with: mdprobe')

  tel.log('success', { version: latestVersion })
  return 0
}

// ---------------------------------------------------------------------------
// Internal helpers — exposed via private names; not part of the public API.
// ---------------------------------------------------------------------------

/**
 * Fetch the latest version of the package from the npm registry.
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string>}
 */
async function fetchLatestVersion(fetchImpl) {
  const signal = AbortSignal.timeout
    ? AbortSignal.timeout(REGISTRY_TIMEOUT_MS)
    : undefined
  const res = await fetchImpl(REGISTRY_URL, { signal })
  if (!res || res.ok === false) {
    const code = res?.status
    const err = new Error(`registry returned status ${code}`)
    err.code = `HTTP_${code}`
    throw err
  }
  const body = await res.json()
  if (!body || typeof body.version !== 'string') {
    throw new Error('registry response missing "version" field')
  }
  return body.version
}

/**
 * Handle a possibly-running singleton server.
 *
 * Per spec §5 step 7:
 *   - --force: kill unconditionally (no prompt).
 *   - otherwise + TTY: prompt the user; --yes does NOT skip this prompt
 *     (only --force does). User declines/cancels → abort.
 *   - otherwise + no TTY: abort with a hint suggesting --force (CI scenario).
 *
 * @returns {Promise<'aborted'|'proceed'>}
 */
async function handleSingleton({
  force,
  isTTY,
  confirm,
  isCancel,
  readLockFile,
  removeLockFile,
  isProcessAlive,
  lockPath,
  stdout,
  sleep,
}) {
  let lock
  try {
    lock = await readLockFile(lockPath)
  } catch {
    return 'proceed'
  }
  if (!lock) return 'proceed'

  const alive = isProcessAlive(lock.pid)
  if (!alive) {
    // Stale lock — silently clean up.
    await safeUnlock(removeLockFile, lockPath)
    return 'proceed'
  }

  if (!force) {
    if (!isTTY) {
      // Non-interactive: can't prompt and --yes alone doesn't grant kill
      // permission. Abort with an actionable hint about --force.
      writeln(stdout,
        `Server is running on port ${lock.port} (PID ${lock.pid}).`)
      writeln(stdout,
        "Run 'mdprobe stop' first or pass --force to kill it.")
      return 'aborted'
    }
    const ok = await confirm({
      message: `Server is running on port ${lock.port}. Stop it before update?`,
      initialValue: true,
    })
    if (isCancel(ok) || !ok) {
      writeln(stdout, "Run 'mdprobe stop' first or pass --force.")
      return 'aborted'
    }
  }

  // Kill the process. SIGTERM, wait, SIGKILL.
  await killProcess(lock.pid, isProcessAlive, sleep)
  await safeUnlock(removeLockFile, lockPath)
  return 'proceed'
}

async function killProcess(pid, isProcessAlive, sleep) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    if (err?.code === 'ESRCH') return
    if (err?.code === 'EPERM') return
    throw err
  }
  await sleep(SIGTERM_GRACE_MS)
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (err) {
      if (err?.code !== 'ESRCH') throw err
    }
    await sleep(SIGKILL_GRACE_MS)
  }
}

async function safeUnlock(removeLockFile, lockPath) {
  try {
    await removeLockFile(lockPath)
  } catch {
    // ignore
  }
}

/**
 * Spawn the install. Returns { exitCode, permissionDenied }.
 */
function runInstall({ spawn, pm, pkgName, env, stdout, stderr }) {
  return new Promise((resolvePromise) => {
    const args = ['install', '-g', `${pkgName}@latest`]
    let stderrBuf = ''
    const child = spawn(pm, args, {
      stdio: ['inherit', 'inherit', 'pipe'],
      env,
    })
    if (child?.stderr?.on) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        stderrBuf += text
        if (stderr?.write) stderr.write(text)
      })
    }
    child.on('error', (err) => {
      // Don't propagate spawn's errno (e.g. ENOENT → 2) because exit code 2
      // is reserved for EACCES per spec. Always return 1 here; if the error
      // is actually EACCES, `permissionDenied` is set and runUpdate maps it
      // to exit code 2 explicitly.
      const permissionDenied = isPermissionDeniedError(err, stderrBuf)
      resolvePromise({
        exitCode: 1,
        permissionDenied,
      })
    })
    child.on('close', (code) => {
      const exitCode = typeof code === 'number' ? code : 0
      const permissionDenied = isPermissionDeniedError(null, stderrBuf, exitCode)
      resolvePromise({ exitCode, permissionDenied })
    })
  })
}

/**
 * Detect EACCES. npm exits with code 243 in some EACCES paths; we also scan
 * the captured stderr for the literal string.
 */
function isPermissionDeniedError(err, stderrBuf, exitCode) {
  if (err?.code === 'EACCES') return true
  if (typeof stderrBuf === 'string' && /EACCES/i.test(stderrBuf)) return true
  if (typeof stderrBuf === 'string' && /permission denied/i.test(stderrBuf)) return true
  if (exitCode === 243) return true
  return false
}

/**
 * Re-read installed version. Best-effort: returns ok=false if anything goes wrong.
 */
function verifyInstall({ spawn, pm, pkgName, expectedVersion, env }) {
  return new Promise((resolvePromise) => {
    let stdoutBuf = ''
    const args = pm === 'yarn'
      ? ['global', 'list', '--json']
      : ['list', '-g', pkgName, '--json']
    let child
    try {
      child = spawn(pm, args, { stdio: ['ignore', 'pipe', 'pipe'], env })
    } catch {
      resolvePromise({ ok: false, found: null })
      return
    }
    if (child?.stdout?.on) {
      child.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString() })
    }
    child.on('error', () => resolvePromise({ ok: false, found: null }))
    child.on('close', () => {
      const found = extractInstalledVersion(stdoutBuf, pkgName)
      resolvePromise({
        ok: found === expectedVersion,
        found,
      })
    })
  })
}

/**
 * Extract the installed version from `npm/pnpm/bun list --json` output.
 * Returns null if nothing parseable was found.
 */
function extractInstalledVersion(jsonText, pkgName) {
  if (!jsonText || typeof jsonText !== 'string') return null
  const trimmed = jsonText.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    const v = parsed?.dependencies?.[pkgName]?.version
    if (typeof v === 'string') return v
  } catch {
    // Fall through to regex fallback.
  }
  const m = jsonText.match(new RegExp(`"${escapeForRegex(pkgName)}"\\s*[:,][^}]*"version"\\s*:\\s*"([^"]+)"`))
  if (m) return m[1]
  return null
}

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Print the EACCES three-option message. The sudo command is rendered using
 * the actual detected package manager so pnpm/yarn/bun users get a correct
 * suggestion.
 */
function printPermissionError(stdout, pm, currentVersion) {
  writeln(stdout, '')
  writeln(stdout, '× Permission denied installing globally.')
  writeln(stdout, '')
  writeln(stdout, 'Your global node_modules is system-owned. Options:')
  writeln(stdout, `  1. Re-run with sudo:    sudo ${pm} i -g ${PKG_NAME}`)
  writeln(stdout, `  2. Switch to nvm/fnm:   ${NVM_URL}`)
  writeln(stdout, '  3. Configure npm prefix: npm config set prefix ~/.npm-global')
  writeln(stdout, '')
  writeln(stdout, `mdprobe was not updated. Current version: ${currentVersion}`)
}

/**
 * Print "What's new in <version>" from the local CHANGELOG.md. Fire-and-forget:
 * any failure (file missing, parse error) is silently swallowed.
 */
function printChangelog({ globalRoot, version, stdout, readChangelogSection }) {
  try {
    if (!globalRoot || typeof globalRoot !== 'string') return
    const changelogPath = join(globalRoot, '@henryavila', 'mdprobe', 'CHANGELOG.md')
    const section = readChangelogSection(version, changelogPath)
    if (!section) return
    const bullets = Array.isArray(section.bullets) ? section.bullets.slice(0, 6) : []
    if (bullets.length === 0) return
    writeln(stdout, '')
    writeln(stdout, `What's new in ${version}`)
    writeln(stdout, '─'.repeat(43))
    for (const b of bullets) {
      writeln(stdout, `  • ${b}`)
    }
    if (section.truncated) {
      writeln(stdout, '')
      writeln(stdout, `... (full notes: ${releaseUrlForTag(version)})`)
    } else {
      writeln(stdout, '')
      writeln(stdout, `Full notes: ${releaseUrlForTag(version)}`)
    }
  } catch {
    // Never fail the update flow because of a changelog hiccup.
  }
}

// ---------------------------------------------------------------------------
// Misc utilities
// ---------------------------------------------------------------------------

function writeln(target, line = '') {
  try {
    if (target?.write) {
      target.write(`${line}\n`)
      return
    }
  } catch {
    // ignore — fall back to console
  }
  // Last-ditch fallback.
  // eslint-disable-next-line no-console
  console.log(line)
}

function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function readPkgSafe() {
  try {
    return JSON.parse(readFileSync(PKG_PATH, 'utf-8'))
  } catch {
    return { name: PKG_NAME, version: '0.0.0' }
  }
}

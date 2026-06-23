/**
 * Unit tests for `runUpdate(opts, deps)` — the orchestrator behind `mdprobe update`.
 *
 * Strategy: every side-effecting collaborator is injected via `deps`. Tests
 * never hit the network, never spawn real processes, never read real files
 * outside the test's own temp scratch (which we don't actually need here —
 * tests inject the changelog reader too).
 *
 * Test groups follow the four step buckets from the implementation plan:
 *   - Step 5.1: happy path
 *   - Step 5.2: singleton handling
 *   - Step 5.3: error mapping
 *   - Step 5.4: output formatting
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

import { runUpdate } from '../../src/cli/update-cmd.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PKG = { name: '@henryavila/mdprobe', version: '0.5.0' }

/**
 * Create a fake fetch returning the given JSON body. Pass an Error to make
 * the call reject (network failure).
 */
function makeFakeFetch(result) {
  return vi.fn(() => {
    if (result instanceof Error) return Promise.reject(result)
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(result),
    })
  })
}

/**
 * Create a fake `spawn` whose returned ChildProcess emits the given exit
 * code (and optionally stderr text) asynchronously after one tick.
 *
 * By default the mock auto-detects "install" vs "list" calls: install gets
 * `installExit` (0) and an empty stream; list gets `listExit` (0) plus the
 * provided `installedVersion` rendered as JSON. Override individual fields
 * to test failure paths.
 *
 * The factory captures invocations on `.calls` for inspection.
 */
function makeFakeSpawn(opts = {}) {
  const {
    exitCode,                       // legacy: applied to the install call
    installExit,
    listExit = 0,
    stderr = '',
    stdout = '',
    installedVersion = '0.5.1',
  } = opts
  const calls = []
  const factory = vi.fn((cmd, args, runOpts) => {
    calls.push({ cmd, args, opts: runOpts })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.killed = false
    child.kill = () => {}
    const isList = Array.isArray(args) && args.includes('list')
    setImmediate(() => {
      if (isList) {
        const body = JSON.stringify({
          dependencies: {
            '@henryavila/mdprobe': { version: installedVersion },
          },
        })
        child.stdout.emit('data', Buffer.from(body))
        child.emit('close', listExit)
        child.emit('exit', listExit)
      } else {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout))
        if (stderr) child.stderr.emit('data', Buffer.from(stderr))
        const code = installExit ?? exitCode ?? 0
        child.emit('close', code)
        child.emit('exit', code)
      }
    })
    return child
  })
  factory.calls = calls
  return factory
}

/**
 * Capture stdout/stderr writes into an in-memory string. Returns a writer
 * with the same shape `process.stdout` exposes (only `.write` matters here).
 */
function makeWriter() {
  let buf = ''
  return {
    write: (chunk) => { buf += chunk; return true },
    get text() { return buf },
  }
}

/**
 * Build a default `deps` object. Tests override individual fields.
 */
function makeDeps(overrides = {}) {
  return {
    fetch: makeFakeFetch({ version: '0.5.1' }),
    spawn: makeFakeSpawn({ exitCode: 0 }),
    confirm: vi.fn(async () => true),
    isCancel: () => false,
    intro: vi.fn(),
    outro: vi.fn(),
    readLockFile: vi.fn(async () => null),
    isProcessAlive: vi.fn(() => false),
    removeLockFile: vi.fn(async () => {}),
    detectPackageManager: vi.fn(() => 'npm'),
    detectGlobalRoot: vi.fn(() => '/fake/global/node_modules'),
    readChangelogSection: vi.fn(() => null),
    // Default: no duplicate installs (keeps existing tests off the real disk).
    scanInstalls: vi.fn(() => []),
    pkg: PKG,
    env: { NODE_ENV: 'test' },
    stdout: makeWriter(),
    stderr: makeWriter(),
    sleep: vi.fn(async () => {}),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Step 5.1 — Happy path
// ---------------------------------------------------------------------------

describe('runUpdate — happy path', () => {
  it('exits 0 with "up to date" when current === latest and !force', async () => {
    const deps = makeDeps({
      fetch: makeFakeFetch({ version: '0.5.0' }),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(0)
    expect(deps.stdout.text).toMatch(/up to date/i)
    expect(deps.stdout.text).toMatch(/0\.5\.0/)
    // No spawn should occur on the up-to-date path.
    expect(deps.spawn.calls.length).toBe(0)
  })

  it('proceeds to install with --force even if up to date', async () => {
    const deps = makeDeps({
      fetch: makeFakeFetch({ version: '0.5.0' }),
      // verify will compare against 0.5.0 (the "latest" in this scenario).
      spawn: makeFakeSpawn({ installedVersion: '0.5.0' }),
    })
    const code = await runUpdate({ yes: true, force: true }, deps)
    expect(code).toBe(0)
    expect(deps.spawn.calls.length).toBeGreaterThanOrEqual(1)
    const installCall = deps.spawn.calls[0]
    expect(installCall.cmd).toBe('npm')
    expect(installCall.args).toEqual([
      'install', '-g', '@henryavila/mdprobe@latest',
    ])
  })

  it('newer remote + --yes spawns install, verifies, exits 0', async () => {
    const deps = makeDeps()
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(0)
    // No confirm should fire when --yes is passed.
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.stdout.text).toMatch(/Updated mdprobe to 0\.5\.1/)
    // Two spawn calls: install + verify list.
    expect(deps.spawn.calls.length).toBe(2)
    expect(deps.spawn.calls[0]).toMatchObject({
      cmd: 'npm',
      args: ['install', '-g', '@henryavila/mdprobe@latest'],
    })
  })

  it('user confirms (Y) → proceeds', async () => {
    const deps = makeDeps({
      confirm: vi.fn(async () => true),
      env: { NODE_ENV: 'test', FAKE_TTY: '1' },
    })
    deps.stdout.isTTY = true
    const code = await runUpdate({}, { ...deps, stdout: deps.stdout })
    expect(code).toBe(0)
    expect(deps.confirm).toHaveBeenCalled()
  })

  it('user declines (n) → "Update cancelled.", exit 0', async () => {
    const deps = makeDeps({
      confirm: vi.fn(async () => false),
    })
    deps.stdout.isTTY = true
    const code = await runUpdate({}, deps)
    expect(code).toBe(0)
    expect(deps.stdout.text).toMatch(/cancelled/i)
    expect(deps.spawn.calls.length).toBe(0)
  })

  it('--dry-run prints would-be command and exits 0 without spawning', async () => {
    const deps = makeDeps()
    const code = await runUpdate({ yes: true, dryRun: true }, deps)
    expect(code).toBe(0)
    expect(deps.stdout.text).toMatch(/dry-run/i)
    expect(deps.stdout.text).toMatch(/npm install -g @henryavila\/mdprobe@latest/)
    expect(deps.spawn.calls.length).toBe(0)
  })

  it('non-TTY without --yes fails with hint', async () => {
    const deps = makeDeps()
    deps.stdout.isTTY = false
    const code = await runUpdate({}, deps)
    expect(code).toBe(1)
    expect(deps.stderr.text + deps.stdout.text).toMatch(/--yes|non-TTY|non-interactive/i)
  })
})

// ---------------------------------------------------------------------------
// Step 5.2 — Singleton handling
// ---------------------------------------------------------------------------

describe('runUpdate — singleton handling', () => {
  it('lock file with live PID + user accepts → kill + remove lock + proceed', async () => {
    const deps = makeDeps({
      readLockFile: vi.fn(async () => ({
        pid: 9999,
        port: 3000,
        url: 'http://localhost:3000',
        startedAt: new Date().toISOString(),
      })),
      isProcessAlive: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      confirm: vi.fn(async () => true),
    })
    deps.stdout.isTTY = true
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      const code = await runUpdate({ yes: false }, deps)
      expect(code).toBe(0)
      expect(killSpy).toHaveBeenCalledWith(9999, 'SIGTERM')
      expect(deps.removeLockFile).toHaveBeenCalled()
      // Install must have happened post-kill.
      expect(deps.spawn.calls.length).toBeGreaterThanOrEqual(1)
    } finally {
      killSpy.mockRestore()
    }
  })

  it('lock file with live PID + user declines → abort with hint, exit 0', async () => {
    const deps = makeDeps({
      readLockFile: vi.fn(async () => ({
        pid: 9999,
        port: 3000,
        url: 'http://localhost:3000',
        startedAt: new Date().toISOString(),
      })),
      isProcessAlive: vi.fn(() => true),
      // First confirm = update OK, second = stop server? -> false
      confirm: vi.fn()
        .mockResolvedValueOnce(true) // proceed with update
        .mockResolvedValueOnce(false), // do not stop server
    })
    deps.stdout.isTTY = true
    const code = await runUpdate({}, deps)
    expect(code).toBe(0)
    expect(deps.stdout.text + deps.stderr.text).toMatch(/mdprobe stop|--force/)
    expect(deps.spawn.calls.length).toBe(0)
  })

  it('lock file with dead PID → silent cleanup, proceed', async () => {
    const deps = makeDeps({
      readLockFile: vi.fn(async () => ({
        pid: 9999,
        port: 3000,
        url: 'http://localhost:3000',
        startedAt: new Date().toISOString(),
      })),
      isProcessAlive: vi.fn(() => false),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(0)
    expect(deps.removeLockFile).toHaveBeenCalled()
    // No prompt about server should have appeared.
    const out = deps.stdout.text + deps.stderr.text
    expect(out).not.toMatch(/Stop it before update/i)
    expect(deps.spawn.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('--force skips singleton prompt and kills unconditionally', async () => {
    const deps = makeDeps({
      readLockFile: vi.fn(async () => ({
        pid: 9999,
        port: 3000,
        url: 'http://localhost:3000',
        startedAt: new Date().toISOString(),
      })),
      isProcessAlive: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      confirm: vi.fn(async () => true),
    })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      const code = await runUpdate({ yes: true, force: true }, deps)
      expect(code).toBe(0)
      // confirm should not be called for the singleton prompt
      // (yes skips update prompt; force skips singleton prompt)
      expect(deps.confirm).not.toHaveBeenCalled()
      expect(killSpy).toHaveBeenCalledWith(9999, 'SIGTERM')
    } finally {
      killSpy.mockRestore()
    }
  })

  it('--yes + live singleton + TTY → singleton prompt fires (spec §5 step 7)', async () => {
    // Per spec, --yes only skips the update confirmation; the singleton prompt
    // still fires when a TTY is available. Only --force skips the singleton
    // prompt.
    const singletonConfirm = vi.fn(async () => true)
    const deps = makeDeps({
      readLockFile: vi.fn(async () => ({
        pid: 9999,
        port: 3000,
        url: 'http://localhost:3000',
        startedAt: new Date().toISOString(),
      })),
      isProcessAlive: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      confirm: singletonConfirm,
    })
    deps.stdout.isTTY = true
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      const code = await runUpdate({ yes: true }, deps)
      expect(code).toBe(0)
      // --yes skips update prompt, but singleton prompt must still fire.
      expect(singletonConfirm).toHaveBeenCalledTimes(1)
      // Confirm message references the running server.
      const arg = singletonConfirm.mock.calls[0][0]
      expect(arg.message).toMatch(/Server is running/i)
      expect(killSpy).toHaveBeenCalledWith(9999, 'SIGTERM')
    } finally {
      killSpy.mockRestore()
    }
  })

  it('--yes + live singleton + NO TTY → abort with --force hint, exit 0', async () => {
    // CI/non-interactive scenario: no TTY means we can't prompt and --yes
    // alone is not enough to silently kill the singleton. Abort with a clear
    // hint suggesting --force.
    const deps = makeDeps({
      readLockFile: vi.fn(async () => ({
        pid: 9999,
        port: 3000,
        url: 'http://localhost:3000',
        startedAt: new Date().toISOString(),
      })),
      isProcessAlive: vi.fn(() => true),
      confirm: vi.fn(),
    })
    deps.stdout.isTTY = false
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(0)
    // Confirm should NOT be called (no TTY).
    expect(deps.confirm).not.toHaveBeenCalled()
    const out = deps.stdout.text + deps.stderr.text
    expect(out).toMatch(/--force/)
    // Should not have spawned install.
    expect(deps.spawn.calls.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Step 5.3 — Error mapping
// ---------------------------------------------------------------------------

describe('runUpdate — error mapping', () => {
  it('fetch rejects → exit 1, "Could not reach npm registry"', async () => {
    const err = new Error('ENOTFOUND registry.npmjs.org')
    err.code = 'ENOTFOUND'
    const deps = makeDeps({
      fetch: makeFakeFetch(err),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(1)
    expect(deps.stderr.text).toMatch(/Could not reach npm registry/i)
  })

  it('detectPackageManager throws → exit 1, fallback message', async () => {
    const deps = makeDeps({
      detectPackageManager: vi.fn(() => {
        throw new Error('boom')
      }),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(1)
    expect(deps.stderr.text).toMatch(/Could not detect package manager/i)
    expect(deps.stderr.text).toMatch(/npm i -g @henryavila\/mdprobe/)
  })

  it('spawn EACCES → exit 2, 3-option permission message with nvm URL', async () => {
    const deps = makeDeps({
      spawn: makeFakeSpawn({ exitCode: 243, stderr: 'EACCES: permission denied' }),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(2)
    const out = deps.stdout.text + deps.stderr.text
    expect(out).toMatch(/Permission denied/i)
    // Default detected PM in makeDeps is npm.
    expect(out).toMatch(/sudo npm i -g @henryavila\/mdprobe/)
    expect(out).toMatch(/https:\/\/github\.com\/nvm-sh\/nvm/)
    expect(out).toMatch(/npm config set prefix/)
    expect(out).toMatch(/Current version: 0\.5\.0/)
  })

  it.each([
    ['pnpm'],
    ['yarn'],
    ['bun'],
  ])('spawn EACCES with %s → sudo command uses the detected PM', async (pm) => {
    const deps = makeDeps({
      detectPackageManager: vi.fn(() => pm),
      spawn: makeFakeSpawn({ exitCode: 243, stderr: 'EACCES: permission denied' }),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(2)
    const out = deps.stdout.text + deps.stderr.text
    expect(out).toMatch(new RegExp(`sudo ${pm} i -g @henryavila/mdprobe`))
  })

  it('spawn ENOENT (PM binary missing) → exit code 1, not 2 (avoid EACCES collision)', async () => {
    // Issue 4: when spawn emits an ENOENT error, exit code must NOT be 2
    // because callers can't distinguish from EACCES.
    const failingSpawn = vi.fn(() => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      const err = Object.assign(new Error('spawn npm ENOENT'), {
        code: 'ENOENT',
        errno: -2,
      })
      setImmediate(() => child.emit('error', err))
      return child
    })
    failingSpawn.calls = []
    const deps = makeDeps({ spawn: failingSpawn })
    const code = await runUpdate({ yes: true }, deps)
    // Anything except 2 is acceptable for non-permission spawn failures; the
    // important contract is that 2 is reserved for EACCES.
    expect(code).not.toBe(2)
    expect(code).toBe(1)
  })

  it('spawn non-zero exit → propagate exit code', async () => {
    const deps = makeDeps({
      spawn: makeFakeSpawn({ exitCode: 7, stderr: 'oh no' }),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(7)
    expect(deps.stderr.text).toMatch(/manual install|install failed/i)
  })

  it('bun verify: tree-format `list` output is parsed (no false mismatch)', async () => {
    // Regression: `bun list -g <pkg> --json` ignores --json and prints a tree
    // ("└── @henryavila/mdprobe@0.5.1"). The verify step must parse that and
    // NOT report a "(unknown)" version mismatch when the install succeeded.
    const calls = []
    const treeSpawn = vi.fn((cmd, args, runOpts) => {
      calls.push({ cmd, args, opts: runOpts })
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      const isList = Array.isArray(args) && args.includes('list')
      setImmediate(() => {
        if (isList) {
          const tree = '/home/user/.bun/install/global node_modules (267)\n'
            + '└── @henryavila/mdprobe@0.5.1\n'
          child.stdout.emit('data', Buffer.from(tree))
          child.emit('close', 0)
        } else {
          child.emit('close', 0)
        }
      })
      return child
    })
    treeSpawn.calls = calls
    const deps = makeDeps({
      detectPackageManager: vi.fn(() => 'bun'),
      spawn: treeSpawn,
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(0)
    const out = deps.stdout.text + deps.stderr.text
    expect(out).toMatch(/Updated mdprobe to 0\.5\.1/)
    expect(out).not.toMatch(/mismatch|unknown/i)
  })

  it('post-install version mismatch → warn, exit 1', async () => {
    const deps = makeDeps({
      spawn: makeFakeSpawn({ installedVersion: '0.4.9' }),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(1)
    const out = deps.stdout.text + deps.stderr.text
    expect(out).toMatch(/0\.4\.9/)
    expect(out).toMatch(/0\.5\.1/)
    expect(out).toMatch(/mismatch|expected/i)
  })
})

// ---------------------------------------------------------------------------
// Step 5.4 — Output formatting
// ---------------------------------------------------------------------------

describe('runUpdate — output formatting', () => {
  it('"What\'s new" appears only when readChangelogSection returns non-null', async () => {
    const depsNoChangelog = makeDeps({
      readChangelogSection: vi.fn(() => null),
    })
    await runUpdate({ yes: true }, depsNoChangelog)
    expect(depsNoChangelog.stdout.text).not.toMatch(/What's new/)

    const depsWithChangelog = makeDeps({
      readChangelogSection: vi.fn(() => ({
        bullets: ['fix highlight drift', 'add update command'],
        truncated: false,
      })),
    })
    await runUpdate({ yes: true }, depsWithChangelog)
    expect(depsWithChangelog.stdout.text).toMatch(/What's new in 0\.5\.1/)
    expect(depsWithChangelog.stdout.text).toMatch(/fix highlight drift/)
    expect(depsWithChangelog.stdout.text).toMatch(/add update command/)
  })

  it('all output URLs start with https://', async () => {
    const deps = makeDeps({
      readChangelogSection: vi.fn(() => ({
        bullets: ['one'],
        truncated: false,
      })),
    })
    await runUpdate({ yes: true }, deps)
    const out = deps.stdout.text
    // Every github.com mention must be prefixed with https://.
    const ghMatches = out.match(/[^/](github\.com)/g) || []
    expect(ghMatches).toEqual([])
    expect(out).toMatch(/https:\/\/github\.com\/henryavila\/mdprobe\/releases\/tag\/v0\.5\.1/)
  })

  it('truncated changelog shows "... (full notes: https://...)"', async () => {
    const deps = makeDeps({
      readChangelogSection: vi.fn(() => ({
        bullets: ['a', 'b', 'c', 'd', 'e', 'f'],
        truncated: true,
      })),
    })
    await runUpdate({ yes: true }, deps)
    const out = deps.stdout.text
    expect(out).toMatch(/full notes:\s*https:\/\/github\.com\/henryavila\/mdprobe\/releases\/tag\/v0\.5\.1/)
    // Should still cap at 6 bullets
    expect(out.match(/^\s*•/gm)?.length ?? 0).toBeLessThanOrEqual(6)
  })

  it('dry-run output includes registry version arrow + changelog URL', async () => {
    const deps = makeDeps()
    await runUpdate({ yes: true, dryRun: true }, deps)
    const out = deps.stdout.text
    expect(out).toMatch(/0\.5\.0\s*→\s*0\.5\.1/)
    expect(out).toMatch(/Manager:\s*npm/)
    expect(out).toMatch(/https:\/\/github\.com\/henryavila\/mdprobe\/releases\/tag\/v0\.5\.1/)
  })
})

// ---------------------------------------------------------------------------
// Step 5.5 — Duplicate-install pruning
// ---------------------------------------------------------------------------

/** Build a fake install record (the shape scanInstalls returns). */
function inst({ pm, version, prefix = '/x', binDir = '/x/bin', pkgDir, binPath }) {
  return {
    pm,
    version,
    prefix,
    binDir,
    pkgDir: pkgDir ?? `/pkg/${pm}-${version}`,
    binPath: binPath ?? `${binDir}/mdprobe`,
  }
}

const CANONICAL = inst({ pm: 'npm', version: '0.5.1', prefix: '/home/u/.npm-global', binDir: '/home/u/.npm-global/bin' })
const STALE_BUN = inst({ pm: 'bun', version: '0.5.0', binDir: '/home/u/.bun/bin' })
const STALE_USR = inst({ pm: 'npm', version: '0.4.0', prefix: '/usr', binDir: '/usr/bin' })

const rmCalls = (spawn) => spawn.calls.filter((c) => Array.isArray(c.args) && c.args.includes('rm'))

describe('runUpdate — duplicate-install pruning', () => {
  it('removes stale installs after a successful update (--yes auto-confirms)', async () => {
    const deps = makeDeps({
      scanInstalls: vi.fn(() => [CANONICAL, STALE_BUN, STALE_USR]),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(0)
    const out = deps.stdout.text + deps.stderr.text
    expect(out).toMatch(/Found 2 other mdprobe installation/)
    expect(out).toMatch(/removed 0\.5\.0 \[bun\]/)
    expect(out).toMatch(/removed 0\.4\.0 \[npm\]/)
    // Keeping line names the canonical install only.
    expect(out).toMatch(/Keeping 0\.5\.1 \[npm\]/)
    // Two uninstall spawns (not the canonical).
    expect(rmCalls(deps.spawn)).toHaveLength(2)
    // The npm uninstall is prefix-scoped to the stale install.
    const npmRm = rmCalls(deps.spawn).find((c) => c.cmd === 'npm')
    expect(npmRm.opts.env.npm_config_prefix).toBe('/usr')
    // The bun uninstall carries the derived BUN_INSTALL.
    const bunRm = rmCalls(deps.spawn).find((c) => c.cmd === 'bun')
    expect(bunRm.opts.env.BUN_INSTALL).toBe('/home/u/.bun')
  })

  it('--no-prune leaves duplicates untouched', async () => {
    const deps = makeDeps({
      scanInstalls: vi.fn(() => [CANONICAL, STALE_BUN, STALE_USR]),
    })
    const code = await runUpdate({ yes: true, prune: false }, deps)
    expect(code).toBe(0)
    const out = deps.stdout.text + deps.stderr.text
    expect(out).not.toMatch(/other mdprobe installation/)
    expect(rmCalls(deps.spawn)).toHaveLength(0)
  })

  it('does nothing when only one install exists', async () => {
    const deps = makeDeps({
      scanInstalls: vi.fn(() => [CANONICAL]),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(0)
    expect(deps.stdout.text).not.toMatch(/other mdprobe installation/)
    expect(rmCalls(deps.spawn)).toHaveLength(0)
  })

  it('user declines the prune prompt → keeps all installs', async () => {
    const deps = makeDeps({
      scanInstalls: vi.fn(() => [CANONICAL, STALE_BUN]),
      // 1st confirm = proceed with update; 2nd confirm = decline prune.
      confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    })
    deps.stdout.isTTY = true
    const code = await runUpdate({}, deps)
    expect(code).toBe(0)
    expect(deps.stdout.text).toMatch(/Kept all installations/)
    expect(rmCalls(deps.spawn)).toHaveLength(0)
  })

  it('never prunes when the canonical (latest) install cannot be identified', async () => {
    // No install is at the latest version → we cannot tell what to keep.
    const deps = makeDeps({
      scanInstalls: vi.fn(() => [
        inst({ pm: 'npm', version: '0.5.0', binDir: '/a/bin' }),
        inst({ pm: 'bun', version: '0.4.0', binDir: '/b/bin' }),
      ]),
    })
    const code = await runUpdate({ yes: true }, deps)
    expect(code).toBe(0)
    expect(deps.stdout.text).not.toMatch(/other mdprobe installation/)
    expect(rmCalls(deps.spawn)).toHaveLength(0)
  })

  it('permission error on one install prints the sudo hint and continues', async () => {
    // install + verify succeed; the /usr npm uninstall hits EACCES; bun succeeds.
    const calls = []
    const spawn = vi.fn((cmd, args, runOpts) => {
      calls.push({ cmd, args, opts: runOpts })
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {}
      setImmediate(() => {
        if (Array.isArray(args) && args.includes('list')) {
          child.stdout.emit('data', Buffer.from(JSON.stringify({
            dependencies: { '@henryavila/mdprobe': { version: '0.5.1' } },
          })))
          child.emit('close', 0)
        } else if (cmd === 'npm' && args.includes('rm')) {
          child.stderr.emit('data', Buffer.from('npm error code EACCES\nEACCES: permission denied'))
          child.emit('close', 243)
        } else {
          child.emit('close', 0) // install + bun rm
        }
      })
      return child
    })
    spawn.calls = calls
    const deps = makeDeps({
      spawn,
      scanInstalls: vi.fn(() => [CANONICAL, STALE_USR, STALE_BUN]),
    })
    const code = await runUpdate({ yes: true }, deps)
    // Update itself still succeeds — a prune permission error is not fatal.
    expect(code).toBe(0)
    const out = deps.stdout.text + deps.stderr.text
    expect(out).toMatch(/needs elevated permissions/)
    expect(out).toMatch(/sudo npm rm -g @henryavila\/mdprobe --prefix \/usr/)
    // The bun copy was still removed despite the npm failure.
    expect(out).toMatch(/removed 0\.5\.0 \[bun\]/)
  })
})

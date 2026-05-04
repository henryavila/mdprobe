import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join as pathJoin } from 'node:path'

import {
  detectPackageManager,
  detectGlobalRoot,
} from '../../src/package-manager.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake exec helper. The recipe maps `cmd argv.join(' ')` strings to
 * either a return value (string) or an Error (to simulate the binary not
 * being found). Unmatched calls throw a generic ENOENT-style error so any
 * unexpected `which` call counts as "not found".
 */
function makeFakeExec(recipe = {}) {
  const calls = []
  const exec = (cmd, args = []) => {
    const key = `${cmd} ${args.join(' ')}`.trim()
    calls.push({ cmd, args, key })
    if (key in recipe) {
      const value = recipe[key]
      if (value instanceof Error) throw value
      return value
    }
    const err = new Error(`ENOENT: ${key}`)
    err.code = 'ENOENT'
    throw err
  }
  exec.calls = calls
  return exec
}

// ---------------------------------------------------------------------------
// detectPackageManager: npm_config_user_agent path
// ---------------------------------------------------------------------------

describe('detectPackageManager — npm_config_user_agent', () => {
  it('detects npm from user agent like "npm/10.2.4 node/v20.10.0 linux x64"', () => {
    const env = { npm_config_user_agent: 'npm/10.2.4 node/v20.10.0 linux x64' }
    const exec = makeFakeExec()
    expect(detectPackageManager(env, exec)).toBe('npm')
    // No which fallback should be executed when UA is conclusive.
    expect(exec.calls.length).toBe(0)
  })

  it('detects pnpm from user agent like "pnpm/8.15.0 npm/? node/v20.10.0 linux x64"', () => {
    const env = {
      npm_config_user_agent: 'pnpm/8.15.0 npm/? node/v20.10.0 linux x64',
    }
    const exec = makeFakeExec()
    expect(detectPackageManager(env, exec)).toBe('pnpm')
    expect(exec.calls.length).toBe(0)
  })

  it('detects yarn from user agent like "yarn/1.22.22 npm/? node/v20.10.0 linux x64"', () => {
    const env = {
      npm_config_user_agent: 'yarn/1.22.22 npm/? node/v20.10.0 linux x64',
    }
    const exec = makeFakeExec()
    expect(detectPackageManager(env, exec)).toBe('yarn')
    expect(exec.calls.length).toBe(0)
  })

  it('detects bun from user agent like "bun/1.1.0 node/v22.0.0 linux x64"', () => {
    const env = { npm_config_user_agent: 'bun/1.1.0 node/v22.0.0 linux x64' }
    const exec = makeFakeExec()
    expect(detectPackageManager(env, exec)).toBe('bun')
    expect(exec.calls.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// detectPackageManager: which fallback path
// ---------------------------------------------------------------------------

describe('detectPackageManager — which fallback', () => {
  it('falls through to which chain when npm_config_user_agent is unset', () => {
    const env = {}
    // Simulate pnpm being on PATH first match wins.
    const exec = makeFakeExec({
      'which pnpm': '/usr/local/bin/pnpm',
    })
    expect(detectPackageManager(env, exec)).toBe('pnpm')
    // Should have run at least the `which pnpm` call.
    const ranWhichPnpm = exec.calls.some((c) => c.cmd === 'which' && c.args[0] === 'pnpm')
    expect(ranWhichPnpm).toBe(true)
  })

  it('falls through to which chain when npm_config_user_agent is empty string', () => {
    const env = { npm_config_user_agent: '' }
    const exec = makeFakeExec({
      'which yarn': '/usr/local/bin/yarn',
    })
    expect(detectPackageManager(env, exec)).toBe('yarn')
  })

  it('detects bun via which when only bun is installed', () => {
    const env = {}
    const exec = makeFakeExec({
      'which bun': '/home/user/.bun/bin/bun',
    })
    expect(detectPackageManager(env, exec)).toBe('bun')
  })

  it('returns "npm" as ultimate fallback when all which lookups fail', () => {
    const env = {}
    // No recipe entries → every which call throws ENOENT.
    const exec = makeFakeExec()
    expect(detectPackageManager(env, exec)).toBe('npm')
  })

  it('uses execFileSync via the injected exec helper (argv passed as array)', () => {
    const env = {}
    const exec = makeFakeExec({
      'which npm': '/usr/bin/npm',
    })
    detectPackageManager(env, exec)
    // Verify all which calls used array-form argv (no shell strings).
    for (const call of exec.calls) {
      expect(Array.isArray(call.args)).toBe(true)
      // The cmd itself should never embed spaces or shell metacharacters.
      expect(call.cmd).not.toMatch(/[\s;&|`$<>]/)
    }
  })

  it('ignores unrecognized user agent strings and falls through to which', () => {
    const env = { npm_config_user_agent: 'someweirdtool/1.0 node/v20' }
    const exec = makeFakeExec({
      'which npm': '/usr/bin/npm',
    })
    expect(detectPackageManager(env, exec)).toBe('npm')
    expect(exec.calls.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// detectPackageManager: which/where portability across platforms
// ---------------------------------------------------------------------------

describe('detectPackageManager — which/where portability', () => {
  it('uses "which" on linux to probe binaries', () => {
    const env = { PROCESS_PLATFORM: 'linux' }
    const exec = makeFakeExec({
      'which pnpm': '/usr/local/bin/pnpm',
    })
    expect(detectPackageManager(env, exec)).toBe('pnpm')
    // Every probe must be `which`, never `where`.
    for (const call of exec.calls) {
      expect(call.cmd).toBe('which')
    }
  })

  it('uses "where" on win32 to probe binaries (Windows portability)', () => {
    const env = { PROCESS_PLATFORM: 'win32' }
    const exec = makeFakeExec({
      'where pnpm': 'C:\\Program Files\\nodejs\\pnpm.cmd',
    })
    expect(detectPackageManager(env, exec)).toBe('pnpm')
    // No `which` calls allowed on win32.
    for (const call of exec.calls) {
      expect(call.cmd).toBe('where')
    }
  })

  it('on win32 falls through "where" chain to npm when nothing is on PATH', () => {
    const env = { PROCESS_PLATFORM: 'win32' }
    const exec = makeFakeExec()
    expect(detectPackageManager(env, exec)).toBe('npm')
    // All probes used `where`.
    for (const call of exec.calls) {
      expect(call.cmd).toBe('where')
    }
    // And we tried at least one probe.
    expect(exec.calls.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// detectGlobalRoot
// ---------------------------------------------------------------------------

describe('detectGlobalRoot', () => {
  it('runs "npm root -g" for npm', () => {
    const exec = makeFakeExec({
      'npm root -g': '/usr/local/lib/node_modules',
    })
    expect(detectGlobalRoot('npm', {}, exec)).toBe('/usr/local/lib/node_modules')
    expect(exec.calls).toEqual([
      { cmd: 'npm', args: ['root', '-g'], key: 'npm root -g' },
    ])
  })

  it('runs "pnpm root -g" for pnpm', () => {
    const exec = makeFakeExec({
      'pnpm root -g': '/home/user/.local/share/pnpm/global/5/node_modules',
    })
    expect(detectGlobalRoot('pnpm', {}, exec)).toBe(
      '/home/user/.local/share/pnpm/global/5/node_modules'
    )
    expect(exec.calls).toEqual([
      { cmd: 'pnpm', args: ['root', '-g'], key: 'pnpm root -g' },
    ])
  })

  it('runs "yarn global dir" for yarn', () => {
    const exec = makeFakeExec({
      'yarn global dir': '/home/user/.config/yarn/global',
    })
    expect(detectGlobalRoot('yarn', {}, exec)).toBe('/home/user/.config/yarn/global')
    expect(exec.calls).toEqual([
      { cmd: 'yarn', args: ['global', 'dir'], key: 'yarn global dir' },
    ])
  })

  it('derives bun global root from BUN_INSTALL env var (no runner call)', () => {
    const exec = makeFakeExec()
    const result = detectGlobalRoot('bun', { BUN_INSTALL: '/custom/bun' }, exec)
    expect(result).toBe(pathJoin('/custom/bun', 'install', 'global', 'node_modules'))
    // bun must NOT shell out — the path is computed from env + os.homedir().
    expect(exec.calls.length).toBe(0)
  })

  it('falls back to <homedir>/.bun when BUN_INSTALL is unset', () => {
    const exec = makeFakeExec()
    const result = detectGlobalRoot('bun', {}, exec)
    expect(result).toBe(
      pathJoin(homedir(), '.bun', 'install', 'global', 'node_modules')
    )
    expect(exec.calls.length).toBe(0)
  })

  it('throws on unknown package manager', () => {
    const exec = makeFakeExec()
    expect(() => detectGlobalRoot('cargo', {}, exec)).toThrow()
    expect(() => detectGlobalRoot('', {}, exec)).toThrow()
    expect(() => detectGlobalRoot(undefined, {}, exec)).toThrow()
  })

  it('always passes argv as an array (never a shell string)', () => {
    const exec = makeFakeExec({
      'npm root -g': '/x',
      'pnpm root -g': '/x',
      'yarn global dir': '/x',
    })
    for (const pm of ['npm', 'pnpm', 'yarn']) {
      detectGlobalRoot(pm, {}, exec)
    }
    // bun uses no runner — covered by separate tests above.
    detectGlobalRoot('bun', { BUN_INSTALL: '/x' }, exec)
    for (const call of exec.calls) {
      expect(Array.isArray(call.args)).toBe(true)
      expect(call.cmd).not.toMatch(/\s/)
    }
  })
})

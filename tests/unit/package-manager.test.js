import { describe, it, expect } from 'vitest'

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
// detectGlobalRoot
// ---------------------------------------------------------------------------

describe('detectGlobalRoot', () => {
  it('runs "npm root -g" for npm', () => {
    const exec = makeFakeExec({
      'npm root -g': '/usr/local/lib/node_modules',
    })
    expect(detectGlobalRoot('npm', exec)).toBe('/usr/local/lib/node_modules')
    expect(exec.calls).toEqual([
      { cmd: 'npm', args: ['root', '-g'], key: 'npm root -g' },
    ])
  })

  it('runs "pnpm root -g" for pnpm', () => {
    const exec = makeFakeExec({
      'pnpm root -g': '/home/user/.local/share/pnpm/global/5/node_modules',
    })
    expect(detectGlobalRoot('pnpm', exec)).toBe(
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
    expect(detectGlobalRoot('yarn', exec)).toBe('/home/user/.config/yarn/global')
    expect(exec.calls).toEqual([
      { cmd: 'yarn', args: ['global', 'dir'], key: 'yarn global dir' },
    ])
  })

  it('runs "bun pm -g bin" for bun', () => {
    const exec = makeFakeExec({
      'bun pm -g bin': '/home/user/.bun/bin',
    })
    expect(detectGlobalRoot('bun', exec)).toBe('/home/user/.bun/bin')
    expect(exec.calls).toEqual([
      { cmd: 'bun', args: ['pm', '-g', 'bin'], key: 'bun pm -g bin' },
    ])
  })

  it('throws on unknown package manager', () => {
    const exec = makeFakeExec()
    expect(() => detectGlobalRoot('cargo', exec)).toThrow()
    expect(() => detectGlobalRoot('', exec)).toThrow()
    expect(() => detectGlobalRoot(undefined, exec)).toThrow()
  })

  it('always passes argv as an array (never a shell string)', () => {
    const exec = makeFakeExec({
      'npm root -g': '/x',
      'pnpm root -g': '/x',
      'yarn global dir': '/x',
      'bun pm -g bin': '/x',
    })
    for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) {
      detectGlobalRoot(pm, exec)
    }
    for (const call of exec.calls) {
      expect(Array.isArray(call.args)).toBe(true)
      expect(call.cmd).not.toMatch(/\s/)
    }
  })
})

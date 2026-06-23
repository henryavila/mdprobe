/**
 * Unit tests for the install scanner used by `mdprobe update` to detect and
 * remove duplicate global installs. The filesystem and PATH are fully injected
 * so these tests never touch the real disk.
 */

import { describe, it, expect } from 'vitest'

import { scanInstalls, buildUninstallCommand } from '../../src/install-scan.js'

const PKG = '@henryavila/mdprobe'

/**
 * Build a fake `fs` facade from declarative maps:
 *   - realpath: bin symlink path → resolved cli.js path
 *   - manifests: package.json path → { name, version }
 * Any other path is treated as non-existent.
 */
function makeFakeFs({ realpath = {}, manifests = {} }) {
  const binPaths = new Set(Object.keys(realpath))
  const manifestPaths = new Set(Object.keys(manifests))
  return {
    existsSync: (p) => binPaths.has(p) || manifestPaths.has(p),
    realpathSync: (p) => {
      if (p in realpath) return realpath[p]
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
    },
    readFileSync: (p) => {
      if (p in manifests) return JSON.stringify(manifests[p])
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' })
    },
  }
}

// A realistic three-install layout: bun (newest), npm prefix, system /usr.
const BUN_CLI = '/home/user/.bun/install/global/node_modules/@henryavila/mdprobe/bin/cli.js'
const BUN_PKG = '/home/user/.bun/install/global/node_modules/@henryavila/mdprobe'
const NPM_CLI = '/home/user/.npm-global/lib/node_modules/@henryavila/mdprobe/bin/cli.js'
const NPM_PKG = '/home/user/.npm-global/lib/node_modules/@henryavila/mdprobe'
const USR_CLI = '/usr/lib/node_modules/@henryavila/mdprobe/bin/cli.js'
const USR_PKG = '/usr/lib/node_modules/@henryavila/mdprobe'

function threeInstallFs() {
  return makeFakeFs({
    realpath: {
      '/home/user/.bun/bin/mdprobe': BUN_CLI,
      '/home/user/.npm-global/bin/mdprobe': NPM_CLI,
      '/usr/bin/mdprobe': USR_CLI,
      '/bin/mdprobe': USR_CLI, // same install linked twice → must dedupe
    },
    manifests: {
      [`${BUN_PKG}/package.json`]: { name: PKG, version: '0.6.0' },
      [`${NPM_PKG}/package.json`]: { name: PKG, version: '0.5.2' },
      [`${USR_PKG}/package.json`]: { name: PKG, version: '0.4.3' },
    },
  })
}

describe('scanInstalls', () => {
  it('finds every distinct install across PATH with version + pm', () => {
    const env = {
      PATH: '/home/user/.bun/bin:/home/user/.npm-global/bin:/usr/bin:/bin',
    }
    const result = scanInstalls({ env, fs: threeInstallFs() })

    expect(result).toHaveLength(3)
    expect(result.map((r) => r.version)).toEqual(['0.6.0', '0.5.2', '0.4.3'])
    expect(result.map((r) => r.pm)).toEqual(['bun', 'npm', 'npm'])
    expect(result[0]).toMatchObject({
      binPath: '/home/user/.bun/bin/mdprobe',
      pkgDir: BUN_PKG,
      pm: 'bun',
    })
    // npm system prefix is the parent of the bin dir.
    expect(result[2]).toMatchObject({
      binPath: '/usr/bin/mdprobe',
      prefix: '/usr',
      pkgDir: USR_PKG,
    })
  })

  it('dedupes the same install reached via two PATH entries', () => {
    const env = { PATH: '/usr/bin:/bin' }
    const result = scanInstalls({ env, fs: threeInstallFs() })
    expect(result).toHaveLength(1)
    expect(result[0].pkgDir).toBe(USR_PKG)
  })

  it('returns [] when PATH is empty or unset', () => {
    expect(scanInstalls({ env: {}, fs: threeInstallFs() })).toEqual([])
    expect(scanInstalls({ env: { PATH: '' }, fs: threeInstallFs() })).toEqual([])
  })

  it('skips dangling symlinks and foreign packages without throwing', () => {
    const fs = makeFakeFs({
      realpath: {
        '/a/bin/mdprobe': '/broken/cli.js', // manifest missing → skipped
        '/b/bin/mdprobe': '/some/other/pkg/bin/cli.js',
      },
      manifests: {
        '/some/other/pkg/package.json': { name: 'not-mdprobe', version: '9.9.9' },
      },
    })
    const env = { PATH: '/a/bin:/b/bin' }
    expect(scanInstalls({ env, fs })).toEqual([])
  })
})

describe('buildUninstallCommand', () => {
  it('npm → `npm rm -g` scoped to the install prefix', () => {
    const cmd = buildUninstallCommand(
      { pm: 'npm', prefix: '/usr', binDir: '/usr/bin', pkgDir: USR_PKG, binPath: '/usr/bin/mdprobe' },
      { HOME: '/home/user' }
    )
    expect(cmd.cmd).toBe('npm')
    expect(cmd.args).toEqual(['rm', '-g', PKG])
    expect(cmd.env.npm_config_prefix).toBe('/usr')
    expect(cmd.env.HOME).toBe('/home/user')
    expect(cmd.sudoHint).toMatch(/sudo npm rm -g .* --prefix \/usr/)
  })

  it('bun → `bun rm -g` with BUN_INSTALL derived from the bin dir', () => {
    const cmd = buildUninstallCommand(
      { pm: 'bun', binDir: '/home/user/.bun/bin', pkgDir: BUN_PKG, binPath: '/home/user/.bun/bin/mdprobe' },
      {}
    )
    expect(cmd.cmd).toBe('bun')
    expect(cmd.args).toEqual(['rm', '-g', PKG])
    expect(cmd.env.BUN_INSTALL).toBe('/home/user/.bun')
  })

  it('yarn → `yarn global remove`', () => {
    const cmd = buildUninstallCommand({ pm: 'yarn', binDir: '/y/bin' }, {})
    expect(cmd.cmd).toBe('yarn')
    expect(cmd.args).toEqual(['global', 'remove', PKG])
  })

  it('pnpm → `pnpm rm -g`', () => {
    const cmd = buildUninstallCommand({ pm: 'pnpm', binDir: '/p/bin' }, {})
    expect(cmd.cmd).toBe('pnpm')
    expect(cmd.args).toEqual(['rm', '-g', PKG])
  })

  it('unknown pm → manual removal with a sudo rm hint', () => {
    const cmd = buildUninstallCommand(
      { pm: null, pkgDir: '/weird/pkg', binPath: '/weird/bin/mdprobe' },
      {}
    )
    expect(cmd.manual).toBe(true)
    expect(cmd.cmd).toBeUndefined()
    expect(cmd.sudoHint).toBe('sudo rm -rf /weird/pkg /weird/bin/mdprobe')
  })

  it('never embeds paths into a shell command (argv arrays only)', () => {
    const cmd = buildUninstallCommand(
      { pm: 'npm', prefix: '/usr', binDir: '/usr/bin', pkgDir: USR_PKG, binPath: '/usr/bin/mdprobe' },
      {}
    )
    expect(Array.isArray(cmd.args)).toBe(true)
    expect(cmd.cmd).not.toMatch(/[\s;&|`$<>]/)
  })
})

/**
 * Discover every mdprobe installation reachable on the user's PATH and build
 * the commands needed to uninstall the stale ones.
 *
 * Why this exists: a user can accumulate several global mdprobe installs across
 * package managers (npm prefix, a system `/usr` prefix, bun's global, …). Only
 * one is actually on the front of PATH, so the others silently rot at old
 * versions. `mdprobe update` uses this module to detect the duplicates and
 * offer to remove all but the freshly-installed one.
 *
 * Design:
 *   - Every side effect (`fs`, `env`) is injected so the scanner is fully unit
 *     testable without touching the real disk or PATH.
 *   - Removal never shells out from here; it returns a declarative command
 *     (argv array + scoped env) that the caller spawns with stdio control.
 *   - Removal commands are argv arrays — never shell strings, never string
 *     concatenation of paths into a command line.
 */

import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  realpathSync as nodeRealpathSync,
} from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

import { pmFromInstallPath } from './package-manager.js'

const PKG_NAME = '@henryavila/mdprobe'
const BIN_NAME = 'mdprobe'

/** Default filesystem facade. Overridable in tests. */
const defaultFs = Object.freeze({
  existsSync: nodeExistsSync,
  readFileSync: nodeReadFileSync,
  realpathSync: nodeRealpathSync,
})

/**
 * @typedef {object} InstallRecord
 * @property {string} binPath   The `mdprobe` entry found on PATH (the symlink).
 * @property {string} binDir    Directory the bin lives in (e.g. `~/.bun/bin`).
 * @property {string} prefix    Install prefix (parent of binDir, e.g. `/usr`).
 * @property {string} pkgDir    Resolved package root (`…/@henryavila/mdprobe`).
 * @property {string} version   Version read from the package's package.json.
 * @property {'npm'|'pnpm'|'yarn'|'bun'|null} pm  Owning package manager.
 */

/**
 * Scan PATH for every distinct mdprobe install. Deduplicated by resolved
 * package directory (a single install is often linked from several PATH dirs,
 * e.g. `/usr/bin` and `/bin`).
 *
 * @param {{ env?: NodeJS.ProcessEnv, fs?: typeof defaultFs }} [deps]
 * @returns {InstallRecord[]}
 */
export function scanInstalls({ env = process.env, fs = defaultFs } = {}) {
  const pathValue = typeof env?.PATH === 'string' ? env.PATH : ''
  const dirs = pathValue.split(delimiter).filter((d) => d && d.length > 0)

  const byPkgDir = new Map()
  for (const dir of dirs) {
    const binPath = join(dir, BIN_NAME)
    if (!safe(() => fs.existsSync(binPath), false)) continue

    const realPath = safe(() => fs.realpathSync(binPath), null)
    if (!realPath) continue

    const found = findPackage(realPath, fs)
    if (!found) continue

    if (byPkgDir.has(found.pkgDir)) continue

    byPkgDir.set(found.pkgDir, {
      binPath,
      binDir: dir,
      prefix: dirname(dir),
      pkgDir: found.pkgDir,
      version: found.version,
      pm: pmFromInstallPath(found.pkgDir, env),
    })
  }

  return [...byPkgDir.values()]
}

/**
 * Build the declarative uninstall command for one install. The caller spawns
 * `{ cmd, args, env }`. `manual: true` means no package manager could be
 * resolved and the user must remove the files by hand (`sudoHint`).
 *
 * @param {InstallRecord} install
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {{ cmd?: string, args?: string[], env?: object, manual?: boolean, sudoHint: string }}
 */
export function buildUninstallCommand(install, baseEnv = {}) {
  const { pm, prefix, binDir, pkgDir, binPath } = install
  switch (pm) {
    case 'npm':
      return {
        cmd: 'npm',
        args: ['rm', '-g', PKG_NAME],
        env: { ...baseEnv, npm_config_prefix: prefix },
        sudoHint: `sudo npm rm -g ${PKG_NAME} --prefix ${prefix}`,
      }
    case 'pnpm':
      return {
        cmd: 'pnpm',
        args: ['rm', '-g', PKG_NAME],
        env: { ...baseEnv },
        sudoHint: `sudo pnpm rm -g ${PKG_NAME}`,
      }
    case 'yarn':
      return {
        cmd: 'yarn',
        args: ['global', 'remove', PKG_NAME],
        env: { ...baseEnv },
        sudoHint: `sudo yarn global remove ${PKG_NAME}`,
      }
    case 'bun': {
      const bunInstall = dirname(binDir)
      return {
        cmd: 'bun',
        args: ['rm', '-g', PKG_NAME],
        env: { ...baseEnv, BUN_INSTALL: bunInstall },
        sudoHint: `sudo BUN_INSTALL=${bunInstall} bun rm -g ${PKG_NAME}`,
      }
    }
    default:
      return {
        manual: true,
        sudoHint: `sudo rm -rf ${pkgDir} ${binPath}`,
      }
  }
}

/**
 * Walk up from a resolved bin entry to the owning package directory, reading
 * its version. Returns null if no matching `@henryavila/mdprobe` package.json
 * is found within a few levels.
 *
 * @param {string} startFile
 * @param {typeof defaultFs} fs
 * @returns {{ pkgDir: string, version: string }|null}
 */
function findPackage(startFile, fs) {
  let dir = dirname(startFile)
  for (let depth = 0; depth < 5; depth++) {
    const manifest = join(dir, 'package.json')
    if (safe(() => fs.existsSync(manifest), false)) {
      const data = safe(() => JSON.parse(fs.readFileSync(manifest, 'utf-8')), null)
      if (data && data.name === PKG_NAME) {
        return { pkgDir: dir, version: String(data.version ?? '') }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Run a thunk, returning `fallback` if it throws. Keeps the scanner resilient
 * to dangling symlinks, permission errors, and malformed manifests.
 */
function safe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

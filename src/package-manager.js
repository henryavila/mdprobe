/**
 * Package manager detection helpers.
 *
 * These helpers exist so the `mdprobe update` flow can suggest the install
 * command that matches the user's actual workflow (npm/pnpm/yarn/bun).
 *
 * Detection is best-effort:
 *   1. Inspect `process.env.npm_config_user_agent` — set by every PM when it
 *      invokes a lifecycle script. Conclusive when present.
 *   2. Otherwise fall through to a `which`/`where`-based lookup of each PM
 *      binary (`where` on Windows, `which` everywhere else).
 *   3. As a last resort, return `'npm'` — npm ships with every Node install.
 *
 * Security: We always shell out via `execFileSync` from `node:child_process`
 * with argv passed as a fixed array of literal strings. Never the shell
 * variant. Never string concatenation of user input into argv.
 *
 * Both functions accept an injected runner so tests can drive them
 * deterministically without spawning real processes. The runner has the
 * shape `(cmd, args) => string` and is expected to throw on non-zero exits
 * or missing binaries.
 */

import * as childProcess from 'node:child_process'
import { homedir } from 'node:os'
import { join as pathJoin } from 'node:path'

/** Recognized package managers, in `which` fallback priority order. */
const KNOWN_PMS = Object.freeze(['pnpm', 'yarn', 'bun', 'npm'])

/**
 * Argv recipes for `detectGlobalRoot`. Each entry is a complete argv array.
 *
 * Note: bun is intentionally NOT listed here. `bun pm -g bin` returns the
 * binary directory (e.g. `~/.bun/bin`), not the package root we need to
 * resolve `<root>/<package>/CHANGELOG.md`. bun's package root is always
 * `$BUN_INSTALL/install/global/node_modules` and we compute it directly.
 */
const GLOBAL_ROOT_RECIPES = Object.freeze({
  npm: ['npm', ['root', '-g']],
  pnpm: ['pnpm', ['root', '-g']],
  yarn: ['yarn', ['global', 'dir']],
})

/**
 * Default runner. Thin wrapper around the synchronous file-form spawner
 * that returns trimmed stdout. Throws (with `code` populated) on failure.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string}
 */
function defaultRunner(cmd, args) {
  const buf = childProcess.execFileSync(cmd, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return String(buf).trim()
}

/**
 * Parse the leading `tool/version` token of an npm-style user agent string.
 * Returns the matching PM name or `null` if unrecognized.
 *
 * @param {string} ua
 * @returns {'npm'|'pnpm'|'yarn'|'bun'|null}
 */
function pmFromUserAgent(ua) {
  if (typeof ua !== 'string' || ua.length === 0) return null
  // User agents look like: "<tool>/<version> node/<version> <os> <arch>".
  const match = ua.match(/^([a-z]+)\//i)
  if (!match) return null
  const tool = match[1].toLowerCase()
  if (KNOWN_PMS.includes(tool)) return /** @type {'npm'|'pnpm'|'yarn'|'bun'} */ (tool)
  return null
}

/**
 * Pick the platform-appropriate "binary on PATH" probe.
 *
 * Unix-like systems ship `which`; Windows ships `where` and has no `which`
 * by default. Although mdprobe runs on WSL2/Linux today, the npm package
 * has no `os` field restricting it, so we branch defensively.
 *
 * The platform can be overridden via `env.PROCESS_PLATFORM` so tests can
 * exercise both branches without mocking `process.platform` globally.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {'which'|'where'}
 */
function pickWhichBinary(env) {
  const platform = env?.PROCESS_PLATFORM ?? process.platform
  return platform === 'win32' ? 'where' : 'which'
}

/**
 * Probe whether a binary exists on PATH. Returns true if the runner
 * produces any non-empty output, false on any error.
 *
 * @param {string} binary
 * @param {string} whichBin  Either 'which' (Unix) or 'where' (Windows).
 * @param {(cmd: string, args: string[]) => string} runner
 * @returns {boolean}
 */
function whichExists(binary, whichBin, runner) {
  try {
    const out = runner(whichBin, [binary])
    return typeof out === 'string' && out.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Detect the package manager the user is running under. See module docstring.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(cmd: string, args: string[]) => string} [runner]
 * @returns {'npm'|'pnpm'|'yarn'|'bun'}
 */
export function detectPackageManager(env = process.env, runner = defaultRunner) {
  const fromUa = pmFromUserAgent(env?.npm_config_user_agent ?? '')
  if (fromUa) return fromUa

  const whichBin = pickWhichBinary(env)
  for (const pm of KNOWN_PMS) {
    if (whichExists(pm, whichBin, runner)) return pm
  }

  // Ultimate fallback: npm is universal — every Node install ships it.
  return 'npm'
}

/**
 * Detect the global install root for the given package manager.
 *
 * For npm/pnpm/yarn this shells out to the PM's own "root" command. For
 * bun we compute the path directly from `BUN_INSTALL` (default: `~/.bun`)
 * because `bun pm -g bin` returns the **binary** dir, not the package
 * root we need to resolve `<root>/<package>/CHANGELOG.md`.
 *
 * @param {'npm'|'pnpm'|'yarn'|'bun'} pm
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(cmd: string, args: string[]) => string} [runner]
 * @returns {string} Absolute path to the global node_modules / package root.
 * @throws {Error} If `pm` is not a recognized package manager.
 */
export function detectGlobalRoot(pm, env = process.env, runner = defaultRunner) {
  if (pm === 'bun') {
    // bun's global layout: $BUN_INSTALL/install/global/node_modules/<pkg>.
    // `bun pm -g bin` would return $BUN_INSTALL/bin, which is the wrong tree
    // for resolving package files like CHANGELOG.md.
    const bunInstall = env?.BUN_INSTALL ?? pathJoin(homedir(), '.bun')
    return pathJoin(bunInstall, 'install', 'global', 'node_modules')
  }

  const recipe = GLOBAL_ROOT_RECIPES[pm]
  if (!recipe) {
    throw new Error(`Unknown package manager: ${JSON.stringify(pm)}`)
  }
  const [cmd, args] = recipe
  return runner(cmd, args)
}

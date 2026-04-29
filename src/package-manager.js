/**
 * Package manager detection helpers.
 *
 * These helpers exist so the `mdprobe update` flow can suggest the install
 * command that matches the user's actual workflow (npm/pnpm/yarn/bun).
 *
 * Detection is best-effort:
 *   1. Inspect `process.env.npm_config_user_agent` — set by every PM when it
 *      invokes a lifecycle script. Conclusive when present.
 *   2. Otherwise fall through to a `which`-based lookup of each PM binary.
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

/** Recognized package managers, in `which` fallback priority order. */
const KNOWN_PMS = Object.freeze(['pnpm', 'yarn', 'bun', 'npm'])

/** Argv recipes for `detectGlobalRoot`. Each entry is a complete argv array. */
const GLOBAL_ROOT_RECIPES = Object.freeze({
  npm: ['npm', ['root', '-g']],
  pnpm: ['pnpm', ['root', '-g']],
  yarn: ['yarn', ['global', 'dir']],
  bun: ['bun', ['pm', '-g', 'bin']],
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
 * Probe whether a binary exists on PATH using `which`. Returns true if the
 * runner produces any non-empty output, false on any error.
 *
 * @param {string} binary
 * @param {(cmd: string, args: string[]) => string} runner
 * @returns {boolean}
 */
function whichExists(binary, runner) {
  try {
    const out = runner('which', [binary])
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

  for (const pm of KNOWN_PMS) {
    if (whichExists(pm, runner)) return pm
  }

  // Ultimate fallback: npm is universal — every Node install ships it.
  return 'npm'
}

/**
 * Detect the global install root for the given package manager.
 *
 * @param {'npm'|'pnpm'|'yarn'|'bun'} pm
 * @param {(cmd: string, args: string[]) => string} [runner]
 * @returns {string} Trimmed stdout from the PM-specific command.
 * @throws {Error} If `pm` is not a recognized package manager.
 */
export function detectGlobalRoot(pm, runner = defaultRunner) {
  const recipe = GLOBAL_ROOT_RECIPES[pm]
  if (!recipe) {
    throw new Error(`Unknown package manager: ${JSON.stringify(pm)}`)
  }
  const [cmd, args] = recipe
  return runner(cmd, args)
}

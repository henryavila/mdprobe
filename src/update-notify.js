// update-notify.js — wires `update-notifier` for mdprobe.
//
// The suppression decision (whether to show the banner at all) is a pure
// function of inputs (`pkg`, `args`, `env`, `tty`). The actual call to
// `update-notifier` happens after the gate, so tests can exercise the
// decision logic without any real network I/O. See spec §4 for the full
// matrix and §5 for banner literal wording.

import updateNotifier from 'update-notifier'

const SUBCOMMANDS_WITHOUT_BANNER = new Set(['update', 'stop', 'migrate'])

/**
 * Pure suppression decision. Exported for test debuggability; the public API
 * is `setupNotifier`, which composes this with the side-effecting call.
 *
 * @returns {boolean} true → suppress (do NOT show banner)
 */
export function shouldSuppressBanner(args, env, tty) {
  // Both stdout and stderr must be TTYs. If either is piped/redirected,
  // showing the banner risks polluting machine-readable output.
  if (!tty || tty.stdout !== true || tty.stderr !== true) return true

  // CI environments are non-interactive by definition.
  if (env.CI) return true

  // Universal opt-out, respected by ecosystem convention.
  if (env.NO_UPDATE_NOTIFIER) return true

  // Don't pollute test output.
  if (env.NODE_ENV === 'test') return true

  if (Array.isArray(args)) {
    // Review-mode (--once) and JSON-only modes are noise-sensitive.
    if (args.includes('--once')) return true
    if (args.includes('--json')) return true

    // Lifecycle subcommands: showing "run mdprobe update" while the user
    // is already running update/stop/migrate would be redundant or confusing.
    const subcommand = args[0]
    if (subcommand && SUBCOMMANDS_WITHOUT_BANNER.has(subcommand)) return true
  }

  return false
}

/**
 * Build the banner message. Kept separate so the literal is unit-testable
 * via the public `notify` invocation. English-only by design (see spec §4).
 */
function buildBannerMessage() {
  return [
    '📦 mdProbe {latestVersion} available  ({currentVersion} → {latestVersion})',
    '',
    'Run: mdprobe update',
    '',
    'Changelog:',
    '  https://github.com/henryavila/mdprobe/releases',
    '',
    'Silence: NO_UPDATE_NOTIFIER=1',
  ].join('\n')
}

/**
 * Configure `update-notifier` for mdprobe.
 *
 * @param {object} pkg            The host package.json (name + version).
 * @param {string[]} args         Process arguments (typically `process.argv.slice(2)`).
 * @param {object} [env]          Environment object (defaults to `process.env`).
 * @param {{stdout: boolean, stderr: boolean}} [tty]
 *                                TTY state (defaults to live `process.std{out,err}.isTTY`).
 * @returns {void}
 */
export function setupNotifier(
  pkg,
  args,
  env = process.env,
  tty = { stdout: process.stdout.isTTY, stderr: process.stderr.isTTY },
) {
  if (shouldSuppressBanner(args, env, tty)) return

  const notifier = updateNotifier({
    pkg,
    updateCheckInterval: 1000 * 60 * 60 * 24, // 24h
    shouldNotifyInNpmScript: false,
  })

  notifier.notify({
    message: buildBannerMessage(),
    defer: false,
    isGlobal: true,
  })
}

# `mdprobe update` + update notifier — design

**Date:** 2026-04-29
**Status:** Draft for review
**Authors:** @henry, Claude
**Scope:** Single bundled feature for v0.5.1. Adds (a) startup notifier banner pointing at (b) a new `mdprobe update` subcommand. No release/publish without explicit approval per `feedback_no_auto_release.md`.
**Predecessor:** None. New feature.

---

## 1. Problem statement

mdProbe ships as an npm-installed CLI (`@henryavila/mdprobe`). Once installed globally, users have no in-product signal that newer versions exist. They must remember to run `npm i -g @henryavila/mdprobe` periodically, or read GitHub releases manually. Two observed pain points:

1. **Stale installs go unnoticed.** Bug-fix releases (e.g., browser freeze on annotation save shipped in v0.5.0) reach users only when they happen to upgrade for unrelated reasons.
2. **Upgrade itself is unsafe today.** Running `npm i -g @henryavila/mdprobe` while a singleton server is alive leaves a stale lock file pointing at the killed process; new processes see the lock, fail health check, and the user must manually `mdprobe stop` before the install completes cleanly.

The fix is two coordinated additions: a passive banner that surfaces new versions, and a single command that performs a safe upgrade end-to-end.

## 2. Goals and non-goals

### Goals

- **Notify, never install silently.** Detect new versions in background and show a discreet terminal banner. Aligned with industry standard (yarn, vue-cli, gatsby-cli, vercel CLI all use this pattern).
- **One-command upgrade** via `mdprobe update`: detects the package manager the user installed with, stops the singleton if running, runs the install, reports success or failure with actionable next steps.
- **Respect non-interactive environments.** Banner suppressed in CI, in pipes, in `--once` mode, and when `NO_UPDATE_NOTIFIER=1` is set. `mdprobe update` works in non-TTY mode by accepting `--yes`.
- **Zero overhead in steady state.** Banner uses `update-notifier`'s background fork + 24h cache; startup latency unchanged for cached check.
- **No silent state loss.** If a singleton is alive, `mdprobe update` always asks before stopping it.

### Non-goals (explicit)

- Auto-install on startup (rejected — see `2026-04-29` research conversation: violates user agency, breaks singleton server, supply-chain risk).
- Postinstall hook asking "do you want auto-update?" (rejected — npm scripts unreliable, blocked by `--ignore-scripts`).
- Self-updating binary (not applicable — mdProbe is npm-distributed, not a standalone binary).
- Pre-release / canary channel notifications. v0.5.1 only notifies for stable releases (`type !== 'prerelease'`).
- Changelog rendering inline. Banner shows URL only.
- Locale detection. Banner is English-only for v0.5.1; locale support deferred.
- Rollback command (`mdprobe rollback` to previous version). Out of scope; users can pin via `npm i -g @henryavila/mdprobe@0.5.0`.

## 3. High-level architecture

Two independent units, integrated at one point in `bin/cli.js`:

```
                  ┌─────────────────────────────┐
                  │   bin/cli.js                │
                  │   (early in process)        │
                  └────┬────────────────┬───────┘
                       │                │
                       ▼                ▼
        ┌──────────────────────┐   ┌──────────────────────┐
        │  src/update-notify.js│   │  src/update-cmd.js   │
        │  setupNotifier(pkg)  │   │  runUpdate(opts)     │
        │  - background check  │   │  - detect PM         │
        │  - 24h cache         │   │  - confirm prompt    │
        │  - banner formatter  │   │  - mdprobe stop?     │
        │  - suppression rules │   │  - spawn install     │
        └──────────────────────┘   │  - verify + report   │
                                   └──────────────────────┘
```

**Key separation:** notifier is non-blocking and idempotent (just a side-effect call early in `cli.js`). Update command is a fully isolated subcommand handler with its own flag parsing. They share only the package metadata read via `package.json`.

## 4. Banner specification

Source of truth: the literal string below is what users see. Width is 51 characters internal (53 including borders), fits all standard terminals (80 cols min) and respects narrow tmux panes (60 cols min):

```
   ╭──────────────────────────────────────────────────────╮
   │                                                      │
   │   📦 mdProbe 0.5.1 available  (0.5.0 → 0.5.1)        │
   │                                                      │
   │   Run: mdprobe update                                │
   │                                                      │
   │   Changelog:                                         │
   │     https://github.com/henryavila/mdprobe/releases   │
   │                                                      │
   │   Silence: NO_UPDATE_NOTIFIER=1                      │
   │                                                      │
   ╰──────────────────────────────────────────────────────╯
```

**Why explicit `https://`:** modern terminals (iTerm2, Windows Terminal, Kitty, WezTerm, GNOME Terminal, VS Code integrated terminal) make URLs clickable via OSC 8 or pattern matching, but only when the scheme is explicit. Bare `github.com/...` renders as plain text and forces manual copy. Box width grows by 4 chars (`http`) but stays well within standard 80-col terminals.

### Banner suppression matrix

The banner is **shown** only when ALL of the following hold:

| Condition | Source | Why |
|---|---|---|
| `update-notifier` reports a newer stable | `notifier.update?.type !== 'prerelease'` | Don't push betas onto stable users |
| `process.stdout.isTTY === true` | Node | Pipes (`mdprobe ... \| jq`) must not get banner in stdout (banner goes to stderr but suppressed in pipe is cleaner) |
| `process.stderr.isTTY === true` | Node | Banner goes to stderr; if stderr is piped/redirected, suppress |
| `process.env.CI` is unset | Node | CI runs are non-interactive |
| `process.env.NO_UPDATE_NOTIFIER` is unset | Convention | Universal opt-out |
| `process.env.NODE_ENV !== 'test'` | Node | Don't pollute test output |
| `args` does **not** include `--once` | mdprobe | Review mode is one-shot; banner is noise |
| `args` does **not** include `--json` | mdprobe (future-proof) | JSON-only output channel |
| Subcommand is **not** `update`, `stop`, `migrate`, `setup --remove` | mdprobe | Don't show banner during the very command that fixes it / lifecycle commands |
| Build is not running from the source repo (dev mode) | `existsSync('.git')` heuristic OR `pkg.version` matches dev pattern | Avoid noise during local development |

### Banner placement

- Written to **stderr**, not stdout. Preserves piping/scripting.
- Shown **after** the main command output completes. `update-notifier`'s default `defer: true` behavior — uses `process.on('exit')` for one-shot commands. For long-running server mode, shown immediately at startup.

## 5. `mdprobe update` command specification

### Synopsis

```
mdprobe update [--yes] [--dry-run] [--force]
```

| Flag | Semantics |
|---|---|
| `--yes` / `-y` | Skip the confirmation prompt. Required in non-TTY environments or fails. |
| `--dry-run` | Print what would be done without executing. Always shows package manager detection, target version, and the install command. Exits 0. |
| `--force` | Run install even if already on latest version. Useful for reinstall after corruption. |

### Execution flow

```
1. Read local package.json → currentVersion
2. Fetch registry latest → latestVersion (10s timeout)
   - Source: https://registry.npmjs.org/@henryavila/mdprobe/latest
   - On network failure: error with hint, exit 1
3. If currentVersion === latestVersion AND !flags.force:
   "mdprobe is up to date (0.5.1)"
   exit 0
4. Detect package manager:
   - Read process.env.npm_config_user_agent → pnpm/yarn/bun/npm
   - Fallback: which pnpm → which yarn → which bun → npm
5. Detect global install path:
   - npm: `npm root -g`
   - pnpm: `pnpm root -g`
   - yarn: `yarn global dir`
   - bun: `bun pm -g bin` (path to global bin)
   - If detected path !== where mdprobe is installed: warn user
6. Show summary + ask confirmation (skip if --yes):

     mdprobe 0.5.0 → 0.5.1
     Manager: npm
     Command: npm install -g @henryavila/mdprobe@latest
     Changelog: https://github.com/henryavila/mdprobe/releases/tag/v0.5.1

     Proceed? [Y/n]
7. Check for running singleton:
   - readLockFile() returns active PID + port?
   - If yes: ask
       "Server is running on port {port}. Stop it before update? [Y/n]"
       Y → run `mdprobe stop` flow inline (kill PID + remove lock)
       n → abort with hint: "Run 'mdprobe stop' first or pass --force"
   - --force skips the question and stops the server unconditionally.
8. Execute install:
   - spawn(packageManager, ['install', '-g', '@henryavila/mdprobe@latest'], { stdio: 'inherit' })
   - Stream stdout/stderr live (don't buffer)
9. Verify post-install:
   - Re-read installed version via spawn(packageManager, ['list', '-g', '@henryavila/mdprobe', '--json'])
   - If version === latestVersion: success
   - Else: warn, show manual command
10. Print success message:
     "✓ Updated mdprobe to 0.5.1"
11. Print "What's new" inline from CHANGELOG.md of the freshly-installed version:
     - Resolve installed package path via the package manager's `root -g`.
     - Read `<global-root>/@henryavila/mdprobe/CHANGELOG.md`.
     - Parse the section matching `## [0.5.1]` (Keep a Changelog format).
     - Print first 6 bullets verbatim. Truncate if more, append `... (full notes: <url>)`.
     - On any failure (file missing, parse error): silently skip — don't fail the update flow.
     Output:

     What's new in 0.5.1
     ───────────────────────────────────────────
       • Fix browser freeze on annotation save
       • Fix duplicate highlights on code blocks
       • Add mdprobe update command
       • Add update notifier banner

     Full notes: https://github.com/henryavila/mdprobe/releases/tag/v0.5.1
     Start with: mdprobe
```

**Why inline post-update and not in banner:** banner is interruption (every invocation in the 24h window); post-update is a moment the user already chose to spend attention on the upgrade process. CHANGELOG.md from the local install eliminates extra HTTP fetch and rate limits, and is guaranteed to match the version actually installed (no version skew vs. GitHub release body).

### Error handling

| Failure | Exit code | Message |
|---|---|---|
| Network fetch fails | 1 | `Could not reach npm registry. Check connection.` |
| Package manager detection fails | 1 | `Could not detect package manager. Run manually: npm i -g @henryavila/mdprobe` |
| EACCES during install (sudo needed) | 2 | `Permission denied. Try: sudo {detected} install -g @henryavila/mdprobe` (or hint to use nvm) |
| Install spawn exits non-zero | spawn's exit code | Forward stderr; suggest manual install |
| Lock file points to dead PID | — | Auto-cleanup (existing `mdprobe stop` semantics) |
| User declines confirmation | 0 | `Update cancelled.` |

### Permissions edge case

If global install path is in `/usr/local/lib/node_modules` (system-wide install), `npm install -g` fails with EACCES on Linux/macOS without sudo. We **do not** auto-prompt for sudo — instead detect EACCES in the spawn output and print:

```
× Permission denied installing globally.

Your global node_modules is system-owned. Options:
  1. Re-run with sudo:    sudo npm i -g @henryavila/mdprobe
  2. Switch to nvm/fnm:   https://github.com/nvm-sh/nvm
  3. Configure npm prefix: npm config set prefix ~/.npm-global

mdprobe was not updated. Current version: 0.5.0
```

Rationale: silent sudo invocation is a security smell. Surface the choice.

## 6. File map

| File | Status | Purpose |
|---|---|---|
| `package.json` | edit | Add `update-notifier` to dependencies (^7.x, current major as of 2026) |
| `bin/cli.js` | edit | Wire notifier early; add `update` subcommand to dispatch table; update `printUsage()` |
| `src/update-notify.js` | new | `setupNotifier(pkg, args)`: applies suppression rules, configures `update-notifier`, sets banner format |
| `src/update-cmd.js` | new | `runUpdate(opts)`: full flow per §5 |
| `src/package-manager.js` | new | `detectPackageManager()` + `detectGlobalRoot()` helpers — isolated for testability |
| `tests/unit/update-notify.test.js` | new | Suppression matrix tests (TTY, CI, env vars, args) |
| `tests/unit/update-cmd.test.js` | new | Mock spawn, test version compare, prompt flow, error mapping |
| `tests/unit/package-manager.test.js` | new | Test PM detection from various `npm_config_user_agent` strings |
| `tests/integration/update-cmd.test.js` | new | Integration test with mocked registry endpoint and mocked spawn |
| `README.md` | edit | One-line mention of `mdprobe update` and `NO_UPDATE_NOTIFIER` opt-out |
| `CHANGELOG.md` | new | Keep a Changelog format. Seed with retroactive `[0.5.0]` section + new `[0.5.1]`. Shipped in the npm tarball (already covered by `package.json#files["./"]` for root files; verify or add explicit entry). |
| `src/changelog.js` | new | `readChangelogSection(version)`: pure parser. Reads installed CHANGELOG.md, returns array of bullets for the section. Failure-tolerant — returns `null` on any error. |
| `tests/unit/changelog.test.js` | new | Section parsing tests: well-formed, missing version, malformed bullets, version with metadata (`[0.5.1] - 2026-04-30`). |

No changes to: `src/server.js`, `src/handler.js`, the renderer, the annotation system, anything UI.

## 7. Dependencies

**New runtime dependency:** `update-notifier` (^7.x).
- Maintainer: Sindre Sorhus.
- Weekly downloads: ~25M.
- Risk: low. Battle-tested. Used by yarn, gatsby, vue-cli.
- Transitive cost: ~12 deps (`boxen`, `chalk`, `is-installed-globally`, `latest-version`, etc.). All from `sindresorhus/*`. Acceptable.

**Alternative considered:** `simple-update-notifier` (~3 deps).
- Pro: lighter dep tree.
- Con: less battle-tested, no built-in `boxen` styling.
- Decision: stay with `update-notifier`. Trading 9 transitive deps for proven UX is fair for a banner that runs on every invocation.

## 8. Test plan

### Unit (Vitest, happy-dom not relevant — pure Node)

1. **Suppression matrix.** Table-driven test asserting `setupNotifier()` calls into `update-notifier` only when expected:
   - All combinations of: TTY/non-TTY, CI set/unset, NO_UPDATE_NOTIFIER set/unset, --once present/absent, subcommand is/isn't `update`/`stop`.
2. **Package manager detection.**
   - `npm_config_user_agent="npm/10.2.0 ..."` → `npm`
   - `npm_config_user_agent="pnpm/8.15.0 ..."` → `pnpm`
   - `npm_config_user_agent="yarn/1.22.0 ..."` → `yarn`
   - `npm_config_user_agent="bun/1.0.25 ..."` → `bun`
   - Empty/unset → falls back to `which` chain (mocked)
3. **Version compare.**
   - Equal versions, force=false → "up to date" exit 0
   - Equal versions, force=true → proceed
   - Newer remote → proceed
   - Older remote (downgrade scenario) → warn, proceed only with `--force`
4. **Confirmation prompt.**
   - Mock readline. Y / y / "" (default) / Enter all → proceed.
   - n / N → cancel exit 0.
   - Non-TTY without --yes → exit 1 with hint.
5. **Singleton handling.**
   - No lock file → skip prompt, proceed.
   - Lock file with dead PID → auto-cleanup, proceed (consistent with `mdprobe stop`).
   - Lock file with live PID, user accepts → kill + cleanup + proceed.
   - Lock file with live PID, user declines → abort.
6. **Error mapping.**
   - Spawn EACCES → permission-denied message with 3 options.
   - Spawn ENOTFOUND → network message.
   - Spawn non-zero exit → forward stderr, exit code propagated.
7. **Changelog parser.**
   - Well-formed `## [0.5.1]` section → returns array of bullets.
   - Section with date suffix `## [0.5.1] - 2026-04-30` → still matches.
   - Missing version section → returns `null` (graceful, post-update flow continues).
   - Malformed CHANGELOG.md (no `##` headers) → returns `null`.
   - More than 6 bullets → returns first 6 with truncation flag.
   - URL detection: `https://` prefix preserved verbatim in bullet text.

### Integration

1. **Dry-run end-to-end.** `mdprobe update --dry-run` with mocked registry + no spawn → asserts the would-be command and exits 0.
2. **Banner suppression in `--once`.** Spawn `node bin/cli.js test.md --once` with `update-notifier` cache poisoned to claim 99.9.9 available → assert no banner in stderr.
3. **Banner shown in normal mode.** Same setup without `--once` → assert banner in stderr (regex match on "available").

### Manual verification (pre-release checklist)

- [ ] Install v0.5.0 globally on a clean machine.
- [ ] Publish v0.5.1-alpha.0 to a verdaccio local registry.
- [ ] Point npm config at verdaccio.
- [ ] Run `mdprobe`. Confirm banner appears within 24h.
- [ ] Run `mdprobe update --dry-run`. Confirm command preview.
- [ ] Run `mdprobe update`. Confirm success **and** "What's new" bullets render from local CHANGELOG.md.
- [ ] In a terminal that supports OSC 8 (iTerm2 / WezTerm / Windows Terminal), confirm changelog URL is clickable.
- [ ] Run `mdprobe update` again. Confirm "up to date".
- [ ] Run `mdprobe update --force`. Confirm reinstall.
- [ ] Start server, run `mdprobe update` in another terminal. Confirm singleton prompt fires.
- [ ] Set `NO_UPDATE_NOTIFIER=1`. Confirm banner suppressed.
- [ ] Pipe output: `mdprobe --help | cat`. Confirm no banner pollution.

## 9. Rollout

1. Land code on `feat/mdprobe-update` branch (separate from current `feat/annotations-v2` which is already merged).
2. PR review, run full test suite + manual checklist.
3. Merge to `main`.
4. **Tag v0.5.1 and publish to npm** — only after explicit user approval per `feedback_no_auto_release.md`. No automated step takes us past `main`.
5. Verify on a real install in the wild after publish (notifier banner + update command).

## 10. Decisions log

All decisions for v0.5.1 are closed. This section is the audit trail — it records *what* was chosen and *why*, so future readers don't have to reconstruct the rationale from chat history.

| # | Decision | Rationale |
|---|---|---|
| D1 | Banner copy is English-only | Keeps surface small; alignment with `update-notifier` defaults; locale detection deferred |
| D2 | Command name is `update`, not `upgrade` | Aligns with `npm update`/`apt update`/`rustup update`; `upgrade` connotes major-version jump (`bun upgrade`/`deno upgrade` are runtime self-replace, not the same paradigm) |
| D3 | Subcommand, not flag | Project already uses subcommand pattern (`stop`, `migrate`, `setup`); `--update` flag would break internal consistency |
| D4 | Notifier + `mdprobe update` ship together in v0.5.1 | Banner promises a command — that command must exist on the same release. Splitting causes a window where banner points to non-existent command |
| D5 | Confirmation prompt by default | Respect user agency. `--yes` for non-TTY/scripts; non-TTY without `--yes` fails fast |
| D6 | Singleton prompt before stop | Never destroy state silently. `--force` is the explicit override |
| D7 | `--force` semantics: skip singleton prompt + allow reinstall on same version | Single flag for the "I know what I'm doing" use case. Used in scripts, in recovery from corrupted install |
| D8 | EACCES never auto-elevates to sudo | Silent privilege escalation is a security smell. Surface 3 options (sudo / nvm / npm prefix) and let user choose |
| D9 | Banner shows changelog URL only, not inline notes | Banner is interruption tax on every invocation in the 24h window. Industry convention (npm/yarn/pnpm/gh/vercel/bun/deno banners are URL-only). Inline notes go in `mdprobe update` post-success step (D10) where attention is already committed |
| D10 | Post-update output reads from local `CHANGELOG.md`, not GitHub API | Zero network cost, zero rate limits, zero version skew (CHANGELOG.md of the installed tarball *is* that version's notes). Requires CHANGELOG.md discipline — adopt [Keep a Changelog](https://keepachangelog.com) |
| D11 | URLs in all output start with `https://` | Required by terminal URL detection (OSC 8 + pattern matching in iTerm2, Windows Terminal, Kitty, WezTerm, GNOME Terminal, VS Code). Bare `github.com/...` is plain text |
| D12 | `update-notifier` ^7.x as runtime dep, not `simple-update-notifier` | Battle-tested (~25M weekly dl, used by yarn/gatsby/vue-cli); UX (`boxen` styling) matters more than 9 transitive deps |
| D13 | Banner suppressed in `--once` and during `update`/`stop`/`migrate` subcommands | Avoids self-noise: don't suggest update during the very command that performs it; `--once` is one-shot scripted use |
| D14 | English-only banner; pt-BR deferred | Locale routing adds complexity. Revisit when there's signal that pt-BR speakers find banner unclear |

### Deferred (revisit in v0.6+)

These are intentionally **not** in v0.5.1. Listed so they aren't re-debated.

- Locale support (banner respecting `LANG=pt_BR.UTF-8`).
- Pre-release channel opt-in (`mdprobe update --pre`).
- Banner display in the web UI panel (current scope: terminal only).
- Telemetry on update success/failure rates (would require explicit opt-in policy and privacy doc).
- `mdprobe update --notes` (preview changelog before installing — middle-ground between banner and post-update).
- `mdprobe rollback` (downgrade to previous version).

---

**Next step after approval of this spec:** write implementation plan in `docs/superpowers/plans/2026-04-29-mdprobe-update.md` with task breakdown + TDD ordering (tests-first per `feedback_test_with_real_browser.md` and project TDD pattern). No code changes until plan is also approved.

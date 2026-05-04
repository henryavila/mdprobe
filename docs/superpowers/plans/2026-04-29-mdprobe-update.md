# `mdprobe update` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two coordinated additions in v0.5.1: (1) startup banner via `update-notifier` with strict suppression rules, (2) new `mdprobe update` subcommand that detects the package manager, asks before stopping a running singleton, runs the install, and prints "What's new" from local CHANGELOG.md.

**Architecture:** Two independent units integrated at one point in `bin/cli.js`. `src/update-notify.js` (notifier setup + suppression rules) is non-blocking and idempotent. `src/update-cmd.js` (subcommand handler) is fully isolated. Pure helpers (`src/package-manager.js`, `src/changelog.js`) are testable without spawning processes.

**Tech Stack:** Plain JavaScript ESM (no TypeScript — project convention), Vitest for unit/integration tests (existing), `update-notifier` ^7.x (new dep), `node:child_process` (`spawn` for install, `execFileSync` for read-only PM probes — never the shell variant), `node:readline` for prompts.

**Spec:** `docs/superpowers/specs/2026-04-29-mdprobe-update-design.md`

**Project rules:**
- HARD GATE: no tag/release/publish without explicit user approval (`feedback_no_auto_release.md`).
- TDD: write failing test first, then implementation (`feedback_test_with_real_browser.md` applies to UI; pure-Node tests use Vitest as in `test_architecture.md`).
- All output URLs use `https://` prefix (Decision D11 in spec).
- Use `execFileSync`/`spawn` only — never the shell variant. Project convention guards against shell injection.

**Branch:** Create new branch `feat/mdprobe-update` from `main` (current `feat/annotations-v2` is already merged to main per session context). This isolates v0.5.1 work from any v0.5.0 hotfix branches that may emerge.

---

## File Structure

### Phase 1 — Setup

| File | Status | Role |
|---|---|---|
| `package.json` | edit | Add `update-notifier@^7.0.0` dep; bump version 0.5.0 → 0.5.1 (last task) |
| `CHANGELOG.md` | new | Keep a Changelog format. Seed with retroactive `[0.5.0]` + `[0.5.1] - Unreleased` |

### Phase 2 — Pure helpers (no spawn, no I/O at module level)

| File | Status | Role |
|---|---|---|
| `src/package-manager.js` | new | `detectPackageManager()` from `npm_config_user_agent` + `which` fallback; `detectGlobalRoot(pm)` |
| `src/changelog.js` | new | `readChangelogSection(version, path)`: pure parser. Returns `{ bullets, truncated }` or `null` |
| `tests/unit/package-manager.test.js` | new | Detection from various user-agent strings; fallback chain |
| `tests/unit/changelog.test.js` | new | Section parsing, missing version, malformed input, truncation, URL preservation |

### Phase 3 — Update notifier (banner)

| File | Status | Role |
|---|---|---|
| `src/update-notify.js` | new | `setupNotifier(pkg, args)`: applies suppression matrix, configures `update-notifier`, sets banner format |
| `tests/unit/update-notify.test.js` | new | Suppression matrix (TTY, CI, env vars, args, subcommand) |

### Phase 4 — Update command

| File | Status | Role |
|---|---|---|
| `src/update-cmd.js` | new | `runUpdate(opts)`: full flow per spec §5 (registry fetch, PM detect, prompt, singleton handling, spawn install, post-success changelog) |
| `tests/unit/update-cmd.test.js` | new | Mocked spawn + readline + fetch; version compare, prompt flow, error mapping |
| `tests/integration/update-cmd.test.js` | new | Dry-run end-to-end with mocked registry; banner suppression in `--once`; banner shown otherwise |

### Phase 5 — CLI integration

| File | Status | Role |
|---|---|---|
| `bin/cli.js` | edit | Wire `setupNotifier` early; add `update` subcommand to dispatch table; update `printUsage()` |

### Phase 6 — Docs + Release prep

| File | Status | Role |
|---|---|---|
| `README.md` | edit | One-line mention of `mdprobe update` + `NO_UPDATE_NOTIFIER` opt-out |
| `package.json` | edit | Bump version 0.5.0 → 0.5.1 |
| `CHANGELOG.md` | edit | Finalize `[0.5.1] - 2026-04-XX` section |

---

## Phase 1 — Setup

## Task 1: Branch + dependency + scaffolding

**Files:**
- Branch: create `feat/mdprobe-update` from `main`
- Modify: `package.json`
- Create: `CHANGELOG.md`

- [ ] **Step 1.1: Verify clean state and create branch**

```
cd /home/henry/mdprobe && git status && git fetch origin && git checkout main && git pull --ff-only origin main && git checkout -b feat/mdprobe-update
```

Expected: clean working tree on `feat/mdprobe-update` branched from `main` HEAD.

- [ ] **Step 1.2: Add update-notifier dependency**

```
cd /home/henry/mdprobe && npm install update-notifier@^7.0.0
```

Expected: `package.json` gains `"update-notifier": "^7.0.0"` in `dependencies`. Lockfile updated.

- [ ] **Step 1.3: Verify the dep loads**

```
cd /home/henry/mdprobe && node --input-type=module -e "import updateNotifier from 'update-notifier'; console.log(typeof updateNotifier)"
```

Expected: `function`.

- [ ] **Step 1.4: Seed CHANGELOG.md**

Create `CHANGELOG.md` with retroactive [0.5.0] section (read git log of v0.5.0 commits to populate) and an `[Unreleased]` placeholder for [0.5.1]. Format per [Keep a Changelog](https://keepachangelog.com).

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-04-29

### Added
- (populate from git log v0.4.x..v0.5.0)

### Fixed
- (populate from git log)
```

- [ ] **Step 1.5: Verify CHANGELOG.md is included in npm tarball**

```
cd /home/henry/mdprobe && npm pack --dry-run 2>&1 | grep -i changelog
```

Expected: `CHANGELOG.md` listed. If not present, add `"CHANGELOG.md"` to `package.json#files` array.

- [ ] **Step 1.6: Commit**

```
cd /home/henry/mdprobe && git add package.json package-lock.json CHANGELOG.md && git commit -m "chore(update): add update-notifier dep and seed CHANGELOG.md

Phase 1 of mdprobe update feature. Establishes Keep a Changelog
discipline so post-update output reads version notes from local
tarball (no GitHub API dependency).

Spec: docs/superpowers/specs/2026-04-29-mdprobe-update-design.md"
```

---

## Phase 2 — Pure helpers

## Task 2: package-manager.js — detect PM and global root

**Files:**
- Create: `src/package-manager.js`
- Test: `tests/unit/package-manager.test.js`

- [ ] **Step 2.1: Write failing tests**

Cover:
- `detectPackageManager()` from `npm_config_user_agent` strings: `npm/10`, `pnpm/8`, `yarn/1`, `bun/1` → returns matching name.
- Empty/unset user-agent → falls through to `which` chain (mock `execFileSync` from `node:child_process`).
- All `which` lookups fail → returns `'npm'` as ultimate fallback (npm is universal).
- `detectGlobalRoot(pm)` returns string from PM-specific command (mocked).
- `detectGlobalRoot('npm')` runs `npm root -g` via `execFileSync`.
- `detectGlobalRoot('pnpm')` runs `pnpm root -g`.
- `detectGlobalRoot('yarn')` runs `yarn global dir`.
- `detectGlobalRoot('bun')` runs `bun pm -g bin`.
- Unknown PM → throws.

Run: `cd /home/henry/mdprobe && npx vitest run tests/unit/package-manager.test.js`. Expect failures (module doesn't exist).

- [ ] **Step 2.2: Implement `src/package-manager.js`**

Pure functions, no top-level side effects. Inject the exec helper and `process.env` for testability. **Use only `execFileSync` from `node:child_process` — never the shell variant.** Pass argv as array, never as a single shell string.

- [ ] **Step 2.3: Verify tests pass**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/package-manager.test.js
```

Expected: all green.

- [ ] **Step 2.4: Commit**

```
cd /home/henry/mdprobe && git add src/package-manager.js tests/unit/package-manager.test.js && git commit -m "feat(update): add package manager detection helper

Detects npm/pnpm/yarn/bun from npm_config_user_agent with which-based
fallback. Pure module — exec helper and process.env injected for
testability. Uses execFileSync (never shell variant) to avoid
injection risk."
```

---

## Task 3: changelog.js — parse Keep a Changelog sections

**Files:**
- Create: `src/changelog.js`
- Test: `tests/unit/changelog.test.js`

- [ ] **Step 3.1: Write failing tests**

Cover:
- `readChangelogSection('0.5.1', path)` with well-formed `## [0.5.1]` → returns `{ bullets: [...], truncated: false }`.
- Section with date suffix `## [0.5.1] - 2026-04-30` → matches.
- Section with subheaders (`### Added`, `### Fixed`) → flattens bullets, preserves order, drops subheader lines.
- More than 6 bullets → returns first 6 + `truncated: true`.
- Section missing → returns `null`.
- File missing → returns `null` (no throw).
- Malformed (no `##` headers) → returns `null`.
- Bullet text containing `https://` → URL preserved verbatim.
- Bullet text with markdown link `[foo](https://bar)` → renders as `foo (https://bar)` (terminal-friendly).

- [ ] **Step 3.2: Implement `src/changelog.js`**

Pure parser. Path injected for tests. Use line-by-line scan — no markdown library dependency. Only handles bullets that start with `- ` or `* `.

- [ ] **Step 3.3: Verify tests pass**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/changelog.test.js
```

- [ ] **Step 3.4: Commit**

```
cd /home/henry/mdprobe && git add src/changelog.js tests/unit/changelog.test.js && git commit -m "feat(update): add CHANGELOG.md section parser

Pure parser for Keep a Changelog format. Returns first N bullets of a
version section with truncation flag. Failure-tolerant — returns null
on any error so post-update flow degrades gracefully."
```

---

## Phase 3 — Update notifier

## Task 4: update-notify.js — banner with suppression matrix

**Files:**
- Create: `src/update-notify.js`
- Test: `tests/unit/update-notify.test.js`

- [ ] **Step 4.1: Write failing tests**

Test the suppression decision in isolation. `setupNotifier(pkg, args, env, ttyState)` should be table-driven:

| Case | TTY out | TTY err | env.CI | env.NO_UPDATE_NOTIFIER | env.NODE_ENV | args | subcommand | Expected |
|---|---|---|---|---|---|---|---|---|
| Normal interactive | true | true | unset | unset | (any non-test) | `[]` | none | **show** |
| stdout piped | false | true | unset | unset | — | `[]` | none | suppress |
| stderr piped | true | false | unset | unset | — | `[]` | none | suppress |
| In CI | true | true | `true` | unset | — | `[]` | none | suppress |
| Opt-out flag | true | true | unset | `1` | — | `[]` | none | suppress |
| Test env | true | true | unset | unset | `test` | `[]` | none | suppress |
| --once | true | true | unset | unset | — | `['--once']` | none | suppress |
| --json | true | true | unset | unset | — | `['--json']` | none | suppress |
| update subcommand | true | true | unset | unset | — | `[]` | `update` | suppress |
| stop subcommand | true | true | unset | unset | — | `[]` | `stop` | suppress |
| migrate subcommand | true | true | unset | unset | — | `[]` | `migrate` | suppress |
| Banner format | (any show case) | — | — | — | — | — | — | message contains `https://github.com/`, `Run: mdprobe update`, `NO_UPDATE_NOTIFIER` |

For "show" cases: assert `update-notifier` was called with the right `pkg` and `updateCheckInterval`. Mock the lib via `vi.mock('update-notifier')`.

- [ ] **Step 4.2: Implement `src/update-notify.js`**

Export `setupNotifier(pkg, args, env = process.env, tty = { stdout: process.stdout.isTTY, stderr: process.stderr.isTTY })`. Suppression decisions are pure (testable). `update-notifier` invocation happens after the gate.

Banner message uses literal:
```
📦 mdProbe ${latest} available  (${current} → ${latest})

Run: mdprobe update

Changelog:
  https://github.com/henryavila/mdprobe/releases

Silence: NO_UPDATE_NOTIFIER=1
```

`update-notifier` options: `{ pkg, updateCheckInterval: 1000 * 60 * 60 * 24, shouldNotifyInNpmScript: false }`. Call `notifier.notify({ message, defer: false, isGlobal: true })`.

- [ ] **Step 4.3: Verify tests pass**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/update-notify.test.js
```

- [ ] **Step 4.4: Commit**

```
cd /home/henry/mdprobe && git add src/update-notify.js tests/unit/update-notify.test.js && git commit -m "feat(update): add update-notifier banner with suppression matrix

Banner shown only when fully interactive (TTY out + err), not in CI,
not in tests, not in --once / --json mode, and not during
update/stop/migrate subcommands. Banner copy per spec §4 with
explicit https:// URL for terminal clickability."
```

---

## Phase 4 — Update command

## Task 5: update-cmd.js — orchestrate the full update flow

**Files:**
- Create: `src/update-cmd.js`
- Test: `tests/unit/update-cmd.test.js`

The command has many moving parts but each is mockable. Write tests against `runUpdate(opts, deps)` where `deps` is `{ fetch, spawn, readline, readLockFile, removeLockFile, killProcess, readChangelogSection, packageManager, env }`.

- [ ] **Step 5.1: Write failing tests — happy path**

- Up to date (currentVersion === latestVersion, !force) → exit 0, message "mdprobe is up to date (X.Y.Z)".
- Up to date with `--force` → proceeds to install.
- Newer remote → fetches, prompts, user confirms (Y), no singleton → spawns install, verifies version, reads changelog, prints "What's new", exit 0.
- `--yes` skips prompt.
- `--dry-run` prints would-be command, exits 0 without spawning.

- [ ] **Step 5.2: Write failing tests — singleton handling**

- Lock file with live PID, user accepts → kill + remove lock + proceed.
- Lock file with live PID, user declines → abort with hint, exit 0.
- Lock file with dead PID → silent cleanup, proceed.
- `--force` skips singleton prompt and kills unconditionally.

- [ ] **Step 5.3: Write failing tests — error mapping**

- `fetch` rejects (network) → exit 1, message "Could not reach npm registry".
- `detectPackageManager()` throws → exit 1, fallback message with manual command.
- `spawn` exits with EACCES (code 243 or stderr matches) → exit 2, 3-option permission message including `https://github.com/nvm-sh/nvm`.
- `spawn` exits non-zero → forward stderr, propagate exit code.
- Post-install version mismatch → warning printed, exit 1.

- [ ] **Step 5.4: Write failing tests — output formatting**

- "What's new" section appears only when `readChangelogSection()` returns non-null.
- All URLs in output start with `https://`.
- Bullet count ≤ 6; if `truncated: true`, output includes `... (full notes: https://...)`.

- [ ] **Step 5.5: Implement `src/update-cmd.js`**

Single exported `runUpdate(opts, deps)`. Internal helpers for: `fetchLatestVersion()`, `confirmPrompt()`, `handleSingleton()`, `runInstall()`, `verifyInstall()`, `printChangelog()`. Default `deps` provided in `bin/cli.js` wiring (Task 6).

**Spawn discipline:** install runs via `spawn(pmBinary, ['install', '-g', pkgName], { stdio: 'inherit' })`. Argv is always an array. No shell, no string concatenation.

Registry fetch URL: `https://registry.npmjs.org/@henryavila/mdprobe/latest`. 10s timeout via `AbortSignal.timeout(10000)`.

- [ ] **Step 5.6: Verify unit tests pass**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/update-cmd.test.js
```

- [ ] **Step 5.7: Write integration test**

`tests/integration/update-cmd.test.js`:
- Mock `fetch` via vitest's `vi.stubGlobal`.
- Mock `spawn` from `node:child_process` to emit a fake stdout stream + exit 0.
- Set up a temp dir with a fake `node_modules/@henryavila/mdprobe/CHANGELOG.md`.
- Invoke `runUpdate({ dryRun: false, yes: true })`.
- Assert: would-be spawn args; success exit; "What's new" output appears with bullets from temp CHANGELOG.

- [ ] **Step 5.8: Verify integration test passes**

```
cd /home/henry/mdprobe && npx vitest run tests/integration/update-cmd.test.js
```

- [ ] **Step 5.9: Commit**

```
cd /home/henry/mdprobe && git add src/update-cmd.js tests/unit/update-cmd.test.js tests/integration/update-cmd.test.js && git commit -m "feat(update): add mdprobe update subcommand

End-to-end flow: fetch latest -> detect PM -> confirm -> handle running
singleton -> spawn install -> verify -> print What's new from local
CHANGELOG.md. Flags: --yes, --dry-run, --force.

Errors mapped: network, missing PM, EACCES, install failure,
post-install version mismatch. All output URLs use https:// for
terminal clickability. Spawn always argv-array, never shell."
```

---

## Phase 5 — CLI integration

## Task 6: bin/cli.js — wire notifier and update subcommand

**Files:**
- Modify: `bin/cli.js`

- [ ] **Step 6.1: Read current cli.js dispatch flow**

Identify the point where `args[0]` is checked for subcommands like `migrate` and `stop`. Add `update` to that table.

- [ ] **Step 6.2: Wire notifier early**

Right after argv parsing but before subcommand dispatch:

```js
import { setupNotifier } from '../src/update-notify.js'
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
setupNotifier(pkg, args)
```

Placement matters: must be called even on `--help`/`--version` exits (so banner shows on simple invocations) but **must not** trigger network fetch on those — `update-notifier`'s background fork handles this; the cached check is sub-millisecond.

- [ ] **Step 6.3: Add `update` subcommand to dispatch table**

```js
if (args[0] === 'update') {
  const { runUpdate } = await import('../src/update-cmd.js')
  const opts = {
    yes: hasFlag(args, '--yes', '-y'),
    dryRun: hasFlag(args, '--dry-run'),
    force: hasFlag(args, '--force'),
  }
  process.exit(await runUpdate(opts))
}
```

Position: after `migrate` and `stop` early-exit blocks (line ~85-90 of current cli.js).

- [ ] **Step 6.4: Update `printUsage()`**

Add to Subcommands list:
```
  update [--yes] [--dry-run] [--force]
                         Update mdProbe to the latest version
```

- [ ] **Step 6.5: Manual smoke test — banner**

Temporarily lower `updateCheckInterval` to 0 in `update-notify.js` (revert before commit) and:

```
cd /home/henry/mdprobe && node bin/cli.js --help
```

Expected: banner appears in stderr if a newer version is available on npm. (If 0.5.0 is the latest published, banner won't appear yet — that's fine; verify suppression instead with `node bin/cli.js --once test.md`.)

Revert the interval change.

- [ ] **Step 6.6: Manual smoke test — update subcommand dry-run**

```
cd /home/henry/mdprobe && node bin/cli.js update --dry-run
```

Expected: prints PM detection + would-be command, exits 0. Does not spawn install.

- [ ] **Step 6.7: Run full test suite**

```
cd /home/henry/mdprobe && npm test
```

Expected: all tests green, no regressions in existing suites.

- [ ] **Step 6.8: Commit**

```
cd /home/henry/mdprobe && git add bin/cli.js && git commit -m "feat(update): wire update-notifier and update subcommand into CLI

Notifier runs early in process (background fork, 24h cache, zero
startup overhead in steady state). update subcommand routed via early
exit pattern matching existing migrate/stop convention."
```

---

## Phase 6 — Docs + Release prep

## Task 7: README.md update

**Files:**
- Modify: `README.md`

- [ ] **Step 7.1: Add update section**

In the existing usage section (or a new "Updating" subsection), add:

```markdown
### Updating

```bash
mdprobe update
```

Detects your package manager (npm/pnpm/yarn/bun), stops the running server if any, installs the latest version, and shows what's new.

To silence the update notifier banner: `export NO_UPDATE_NOTIFIER=1`.
```

- [ ] **Step 7.2: Update README.pt-BR.md mirror**

Same content translated.

- [ ] **Step 7.3: Commit**

```
cd /home/henry/mdprobe && git add README.md README.pt-BR.md && git commit -m "docs(update): document mdprobe update command and NO_UPDATE_NOTIFIER opt-out"
```

---

## Task 8: Manual verification + release prep

**Files:**
- Modify: `package.json` (version bump)
- Modify: `CHANGELOG.md` (finalize 0.5.1 section)

- [ ] **Step 8.1: Run full test suite**

```
cd /home/henry/mdprobe && npm test && npm run test:e2e
```

All green. No regressions.

- [ ] **Step 8.2: Manual verification with npm pack tarball install**

Recommended approach (no verdaccio needed): use `npm pack` and install the tarball locally.

```
cd /home/henry/mdprobe && npm pack
# produces henryavila-mdprobe-0.5.1.tgz
npm i -g ./henryavila-mdprobe-0.5.1.tgz
```

Then run through the spec §8 manual checklist:

- [ ] Banner suppression: `mdprobe --once test.md` shows no banner.
- [ ] Banner suppression: `mdprobe update` does not self-notify.
- [ ] Banner suppression: `NO_UPDATE_NOTIFIER=1 mdprobe` shows no banner.
- [ ] `mdprobe update --dry-run` prints PM + would-be command, exits 0.
- [ ] `mdprobe update --help` (or argparse equivalent) lists the 3 flags.
- [ ] In iTerm2/WezTerm/Windows Terminal: changelog URL is clickable (Cmd/Ctrl+click opens browser).
- [ ] EACCES path: temporarily `chmod -w` the global node_modules and run `mdprobe update`. Confirm the 3-option message appears with `https://github.com/nvm-sh/nvm`.
- [ ] Singleton path: start `mdprobe`, then in another terminal run `mdprobe update`. Confirm prompt fires.
- [ ] Singleton path: same as above with `--force`. Confirm no prompt, server killed.
- [ ] Pipe safety: `mdprobe --help | cat` shows no banner pollution.

- [ ] **Step 8.3: Bump version and finalize CHANGELOG**

```
cd /home/henry/mdprobe && npm version 0.5.1 --no-git-tag-version
```

Edit `CHANGELOG.md`: rename `## [Unreleased]` to `## [0.5.1] - 2026-04-XX` (use today's date) and populate from this PR's commits:

```markdown
## [0.5.1] - 2026-04-XX

### Added
- `mdprobe update` subcommand: detect package manager, prompt for confirmation, handle running singleton, install latest, print "What's new" from local CHANGELOG.md
- Update notifier banner via update-notifier with full suppression matrix
- Keep a Changelog discipline with CHANGELOG.md shipped in the npm tarball

### Changed
- All terminal output URLs now use explicit `https://` prefix for OSC 8 / pattern-matching clickability
```

Add new `## [Unreleased]` placeholder above for future work.

- [ ] **Step 8.4: Final verification**

```
cd /home/henry/mdprobe && npm test && npm pack --dry-run
```

Confirm: tests pass, `CHANGELOG.md` is in the file list, package version is 0.5.1.

- [ ] **Step 8.5: Commit**

```
cd /home/henry/mdprobe && git add package.json package-lock.json CHANGELOG.md && git commit -m "chore(release): prep v0.5.1 — mdprobe update + notifier

Bump version 0.5.0 -> 0.5.1. Finalize CHANGELOG.md with full release
notes. Manual smoke checklist passed locally with npm pack + global
install of tarball."
```

- [ ] **Step 8.6: Push branch (still no release)**

```
cd /home/henry/mdprobe && git push -u origin feat/mdprobe-update
```

- [ ] **Step 8.7: Open PR via gh**

```
cd /home/henry/mdprobe && gh pr create --title "feat: add mdprobe update + notifier banner (v0.5.1)" --body "$(cat <<'EOF'
## Summary
- Adds `mdprobe update` subcommand (detect PM -> confirm -> handle singleton -> install -> show what's new from local CHANGELOG.md)
- Adds update-notifier banner with full suppression matrix (TTY, CI, --once, --json, env opt-out, in-flight subcommands)
- Establishes Keep a Changelog discipline in CHANGELOG.md
- All output URLs use https:// for terminal clickability

## Test plan
- [x] Unit tests: package-manager, changelog parser, suppression matrix, command flow, error mapping
- [x] Integration test: dry-run end-to-end with mocked registry + spawn
- [x] Manual: npm pack + global install of tarball, walked through spec §8 checklist

## Spec
docs/superpowers/specs/2026-04-29-mdprobe-update-design.md

## Plan
docs/superpowers/plans/2026-04-29-mdprobe-update.md
EOF
)"
```

- [ ] **Step 8.8: STOP — await explicit user approval before tag/publish**

Per `feedback_no_auto_release.md`: do **not** tag, do **not** publish. The PR is the final artifact for review. User decides whether to (a) merge + tag + publish, (b) request changes, (c) defer to v0.6.0.

---

## Estimated effort

| Phase | Tasks | Estimated time |
|---|---|---|
| Phase 1 — Setup | Task 1 | 30 min |
| Phase 2 — Pure helpers | Tasks 2-3 | 1.5 h |
| Phase 3 — Notifier | Task 4 | 1.5 h |
| Phase 4 — Update command | Task 5 | 3 h |
| Phase 5 — CLI integration | Task 6 | 45 min |
| Phase 6 — Docs + Release prep | Tasks 7-8 | 1.5 h |
| **Total** | **8 tasks** | **~9 h** |

Each task ends with a commit. Total ~8 commits on `feat/mdprobe-update`. PR is the unit of review.

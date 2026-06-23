# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- _Pending entries for the next release will be added here._

## [0.7.2] - 2026-06-23

### Fixed
- **Live reload is reliable immediately after startup.** `createServer` returned before the file watcher (chokidar) finished its initial scan, so a change made in the first moments after the server started could be dropped and never reach the browser. The server now waits for the watcher to be ready (capped so a slow scan can't block startup) before reporting itself ready. This also de-flakes the RF06 live-reload integration tests under parallel load.

## [0.7.1] - 2026-06-23

### Fixed
- **Unknown command gives guidance instead of a cryptic file error.** Running e.g. `mdprobe install` (there is no such subcommand) forwarded the word as a filename and printed `Error: install does not exist`. The CLI now recognizes a bare command-like first argument that is not a known command and not an existing path, and prints what the user can actually do (`mdprobe setup`, `mdprobe <file.md>`, the command list), with an extra note for installer-like words that mdProbe is installed via npm/npx. Real file/directory arguments are unaffected — a missing `*.md` still reports `does not exist`.

## [0.7.0] - 2026-06-23

### Added
- **`mdprobe update` prunes stale duplicate installs.** After a successful upgrade, the updater scans `PATH` for every other global mdProbe install (across npm prefixes, a system `/usr` prefix, bun's global, …) and — with confirmation — removes every copy that is not the freshly-installed one, so the command you run is always the version you just installed. Each stale copy is removed with its owning package manager's uninstaller, prefix-scoped to that install; a permission-protected copy (e.g. a root-owned `/usr`) prints the exact `sudo` command instead of failing the update. `--yes` auto-confirms the removal; `--no-prune` opts out.

### Fixed
- **`mdprobe update` could install into the wrong package manager.** Detection picked the first package manager found on `PATH` (bun, pnpm, …) regardless of how mdProbe itself was installed, so a user with bun present but an npm-installed mdProbe would upgrade bun's global and leave the running npm binary stale. Detection now derives the package manager from the install location of the running binary, falling back to the previous `PATH` probe only when that location is inconclusive.
- **Post-install verification reported a false version mismatch under bun.** `bun list -g … --json` ignores `--json` and prints a tree (`└── @henryavila/mdprobe@x.y.z`); the verifier could not parse it and warned `Found: (unknown)` even when the install had succeeded. It now also parses bun's tree output.

## [0.6.0] - 2026-06-17

### Added
- **Remote access providers.** A generic exposure layer so a running mdProbe can be reached from another device, with Tailscale as the motivating built-in (not the whole architecture). Providers: `off`, `external`, `tailscale`, `lan` (`ngrok`/`cloudflare` specified as planned). New CLI flags `--expose`, `--remote-base-url`, `--bind-host`, and `mdprobe stop --unexpose`. The core keeps `server.url`/`lock.url` local for ping/join/singleton and tracks remote metadata separately; the lock persists `expose`/`exposePort`/`bindHost`/`remoteBaseUrl`/`remoteUrl`, and the CLI prints both `Local:` and `Remote:` URLs. MCP `mdprobe_view`/`mdprobe_status` return `remoteBaseUrl`/`remoteUrl`/`expose`/`exposeRisk`.
- **"Copy markdown" toolbar button.** Copies the raw source of the current file to the clipboard for reuse (paste into an LLM/agent, a PR, another doc). Uses the source already held in memory (no extra fetch) and falls back to a `<textarea>` + `execCommand` when the Clipboard API is unavailable — e.g. over plain HTTP with `--expose lan`, which is not a secure context.
- **Exposure summary at startup.** Always logs the resolved `Exposure: expose=… bindHost=… remoteBaseUrl=…` line when exposure is active, instead of staying silent on success.

### Fixed
- **Control-plane endpoints gated for remote exposure.** `add-files`/`broadcast` stay restricted to localhost for `lan`/`external` unless `allowPublicUnauthenticated=true`; MCP and `stop` paths hardened alongside.
- **Tailscale serve mapping verified via readback.** `reconcileTailscale` previously announced the remote URL whenever `tailscale serve` did not throw, even if the mapping never persisted. It now re-reads `tailscale serve status --json` and only advertises the URL when a handler proxying to the local port is present (or warns explicitly when status is unreadable).
- **Remote URLs printed for multi-file exposure.** With 2+ files the proxy was configured but no `Remote:` line was printed. The CLI now prints the remote base plus one per-file deep link.
- **Corrected the LAN exposure warning.** It claimed sibling files in the served directories were exposed; only explicitly registered files are served.
- **Orphaned `tailscale serve` cleaned on next start.** A non-graceful exit left the `:exposePort` mapping pointing at a dead port; the next start now clears a stale mapping it does not re-establish.
- **Singleton no longer joined on a different explicit `--port`.** Passing `--port` that differs from the running instance previously sent files to the wrong server; it now starts a separate instance on the requested port.
- **`stop` stale-lock-cleaned signal restored**, and a pre-push hook now runs the test suite before every push.
- **Detached-server test leak.** `cli-detach` spawned real `-d` background servers but one test never captured the pid, leaking an idle node process per suite run. Cleanup now falls back to the lock pid, and an `afterAll` guard fails (and kills) any detached server that escapes per-test teardown.

## [0.5.2] - 2026-05-26

### Fixed
- **Mermaid diagrams silently skipped.** `initMermaid` set `data-processed="true"` on every `<pre class="mermaid">` element before calling `mermaid.run()`. Mermaid v11 checks this attribute internally and skips already-processed nodes, so no diagram ever rendered. Removed the premature attribute — Mermaid now manages it after successful SVG injection.
- **MCP stale server reuse.** `getOrCreateServer` cached the server promise without re-checking liveness. If the singleton was killed externally, the MCP kept returning a dead URL. It now pings the cached server before reuse and recovers automatically.
- **`mdprobe stop` orphan detection.** When no lock file exists, `stop` now scans ports 3000–3010 via `/api/status` to find and kill orphaned server instances instead of silently reporting "no server running."

## [0.5.1] - 2026-05-15

### Fixed
- **Highlight precision across inline elements.** Annotations whose selection crossed inline `<code>`, `<strong>`, `<em>` or `<a>` boundaries used to drift by the number of markdown-syntax characters in the path (backticks, asterisks, `[`). `describe()` and `buildDomRanges()` now share a DOM walker (`anchoring/v2/dom-source-map.js`) that tracks the rendered-text cursor and the source-offset cursor in lockstep, re-syncing at every element with `data-source-start`. Click-to-resolve uses the same walker.
- **Dev-server cache staleness.** The HTML shell was read once at server import and served without a `Cache-Control` header. Rebuilding `dist/` while a server was still running left it referencing a bundle hash that no longer existed; browsers further cached the stale shell by heuristic, so bug fixes were invisible after rebuilds. The shell is now re-read on every request and sent with `Cache-Control: no-cache, no-store, must-revalidate`. Hashed asset paths keep their `immutable` cache header.
- **Popover textarea focus after double-click.** Drag-select correctly focused the comment input, but double-click did not — the second `click` event of a dblclick fires after the popover opens and can blur a freshly-focused textarea. Defense in depth: HTML `autoFocus` (atomic with insertion) + synchronous `focus()` in `useEffect` + a deferred re-focus via `requestAnimationFrame`.

### Changed
- `dist/index.html` is no longer git-tracked. The file is still shipped via `package.json#files` (read from disk, not git), but rebuilds will no longer show up in `git status` and `git checkout` can no longer silently revert the bundle reference to a hash that has been overwritten on disk.
- Playwright E2E config switched to full Chromium (`channel: 'chromium'`) so synthesized double-click word-snapping matches real-browser behavior.

### Tests
- 14 new automated checks covering all three fixes: unit specs on the DOM walker, an integration spec on cache headers + shell freshness, and Playwright specs that exercise real mouse gestures (double-click, drag-select, cross-block drag) against a fixture mirroring the original bug report. Each fix was validated by stashing it and confirming the corresponding tests fail without it.

## [0.5.0] - 2026-04-29

### Added
- **Char-precise highlighting**: annotations are anchored by UTF-16 char offsets in the source markdown plus quote+context selectors. Cross-block selections render exactly the selected text — no more line expansion.
- **CSS Custom Highlight API rendering**: zero DOM mutation, GPU-accelerated. Eliminates the browser freeze on annotation save/edit/resolve.
- **Drift recovery pipeline**: 5-step fallback (hash check → exact → fuzzy with threshold 0.60 → mdast tree path → keyword distance → orphan). Annotations survive markdown edits gracefully.
- **`drifted` state**: explicit acknowledgment required when context is uncertain (visualized with dashed amber underline).
- **`mdprobe migrate`** CLI command for batch v1→v2 schema conversion (with `--dry-run` and recursive directory support).
- **`mdprobe update`** subcommand: detects your package manager (npm/pnpm/yarn/bun), prompts before stopping any running singleton, runs the install, and prints "What's new" from the local CHANGELOG.md after the upgrade. Supports `--yes`, `--dry-run`, and `--force` flags.
- **Update notifier banner** via `update-notifier`. Discreet banner shown once per 24h when a newer version is on npm. Suppressed in CI, in pipes, in `--once`/`--json` mode, and during `update`/`stop`/`migrate`/`setup` subcommands. Opt out with `NO_UPDATE_NOTIFIER=1`.
- **Keep a Changelog discipline**: `CHANGELOG.md` now ships in the npm tarball so post-update output reads release notes from the freshly-installed version (no GitHub API dependency).

### Changed
- **Schema v2** for `.annotations.yaml`: `selectors.position` (line/col) replaced by `range { start, end }` (UTF-16 offsets). Auto-migration on load with `.bak` backup; CLI command for batch.
- **Click handling**: uses `caretPositionFromPoint`. `Ctrl/Cmd+click` on annotated link navigates; click without modifier selects the annotation.
- **Visual overlap**: multiple annotations on the same text show as natural color blending (alpha 0.25 per annotation). Newer annotations render on top.
- All terminal output URLs use explicit `https://` prefix for OSC 8 / pattern-matching clickability in modern terminals (iTerm2, Windows Terminal, Kitty, WezTerm, GNOME Terminal, VS Code).

### Removed
- Support for browsers without CSS Custom Highlight API. Required: Chrome 105+, Firefox 140+, Safari 17.2+. mdProbe shows a modal and disables inline highlighting on older browsers.
- Old mark-based renderer (`src/ui/highlighters/mark-highlighter.js`).
- Legacy anchoring module (`src/anchoring.js`).

### Migration
Existing `.annotations.yaml` files are upgraded automatically on first load. A `.bak` backup is saved alongside (e.g., `spec.md.annotations.yaml.bak`). To roll back, restore from the `.bak` file. Or run `npx mdprobe migrate <dir>` proactively.

[Unreleased]: https://github.com/henryavila/mdprobe/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/henryavila/mdprobe/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/henryavila/mdprobe/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/henryavila/mdprobe/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/henryavila/mdprobe/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/henryavila/mdprobe/releases/tag/v0.5.2
[0.5.1]: https://github.com/henryavila/mdprobe/releases/tag/v0.5.1
[0.5.0]: https://github.com/henryavila/mdprobe/releases/tag/v0.5.0

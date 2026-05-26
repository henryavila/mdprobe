# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- _Pending entries for the next release will be added here._

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

[Unreleased]: https://github.com/henryavila/mdprobe/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/henryavila/mdprobe/releases/tag/v0.5.1
[0.5.0]: https://github.com/henryavila/mdprobe/releases/tag/v0.5.0

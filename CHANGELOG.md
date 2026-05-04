# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- _Pending entries for the next release will be added here._

## [0.6.0] - 2026-04-29

### Added
- `mdprobe update` subcommand: detects your package manager (npm/pnpm/yarn/bun), prompts before stopping any running singleton, runs the install, and prints "What's new" from the local CHANGELOG.md after the upgrade. Supports `--yes`, `--dry-run`, and `--force` flags.
- Update notifier banner via `update-notifier`. Discreet banner shown once per 24h when a newer version is on npm. Suppressed in CI, in pipes, in `--once`/`--json` mode, and during `update`/`stop`/`migrate`/`setup` subcommands. Opt out with `NO_UPDATE_NOTIFIER=1`.
- Keep a Changelog discipline: `CHANGELOG.md` now ships in the npm tarball so post-update output reads release notes from the freshly-installed version (no GitHub API dependency).

### Changed
- All terminal output URLs use explicit `https://` prefix for OSC 8 / pattern-matching clickability in modern terminals (iTerm2, Windows Terminal, Kitty, WezTerm, GNOME Terminal, VS Code).

## [0.5.0] - 2026-04-29

### Added
- **Char-precise highlighting**: annotations are anchored by UTF-16 char offsets in the source markdown plus quote+context selectors. Cross-block selections render exactly the selected text — no more line expansion.
- **CSS Custom Highlight API rendering**: zero DOM mutation, GPU-accelerated. Eliminates the browser freeze on annotation save/edit/resolve.
- **Drift recovery pipeline**: 5-step fallback (hash check → exact → fuzzy with threshold 0.60 → mdast tree path → keyword distance → orphan). Annotations survive markdown edits gracefully.
- **`drifted` state**: explicit acknowledgment required when context is uncertain (visualized with dashed amber underline).
- **`mdprobe migrate`** CLI command for batch v1→v2 schema conversion (with `--dry-run` and recursive directory support).

### Changed
- **Schema v2** for `.annotations.yaml`: `selectors.position` (line/col) replaced by `range { start, end }` (UTF-16 offsets). Auto-migration on load with `.bak` backup; CLI command for batch.
- **Click handling**: uses `caretPositionFromPoint`. `Ctrl/Cmd+click` on annotated link navigates; click without modifier selects the annotation.
- **Visual overlap**: multiple annotations on the same text show as natural color blending (alpha 0.25 per annotation). Newer annotations render on top.

### Removed
- Support for browsers without CSS Custom Highlight API. Required: Chrome 105+, Firefox 140+, Safari 17.2+. mdProbe shows a modal and disables inline highlighting on older browsers.
- Old mark-based renderer (`src/ui/highlighters/mark-highlighter.js`).
- Legacy anchoring module (`src/anchoring.js`).

### Migration
Existing `.annotations.yaml` files are upgraded automatically on first load. A `.bak` backup is saved alongside (e.g., `spec.md.annotations.yaml.bak`). To roll back, restore from the `.bak` file. Or run `npx mdprobe migrate <dir>` proactively.

[Unreleased]: https://github.com/henryavila/mdprobe/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/henryavila/mdprobe/releases/tag/v0.6.0
[0.5.0]: https://github.com/henryavila/mdprobe/releases/tag/v0.5.0

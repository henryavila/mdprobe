# Architecture

mdProbe is a Markdown viewer, reviewer, and annotation library. This document describes the project structure, the rendering pipeline, the v2 anchoring subsystem, and the key design decisions that shaped them.

> Deep design rationale for the highlights-v2 subsystem: [`docs/superpowers/specs/2026-04-29-highlights-v2-design.md`](superpowers/specs/2026-04-29-highlights-v2-design.md)
> Schema reference: [SCHEMA.md](SCHEMA.md)

---

## Project structure

```
bin/
  cli.js                      CLI entry point (subcommands: serve, mcp, setup, config, export, migrate, stop)

src/
  server.js                   HTTP + WebSocket server (createServer)
  singleton.js                Lock file + cross-process singleton coordination
  mcp.js                      MCP server — 4 tools (mdprobe_view, mdprobe_annotations, mdprobe_update, mdprobe_status)
  renderer.js                 Markdown → HTML (unified / remark / rehype pipeline; emits data-source-start/end)
  annotations.js              AnnotationFile class — CRUD, section approval, persistence
  export.js                   Export: report, inline, JSON, SARIF
  setup.js                    Programmatic IDE skill + MCP + hook registration
  setup-ui.js                 Interactive setup wizard (clack prompts)
  handler.js                  Library API for embedding (createHandler)
  config.js                   User config (~/.mdprobe.json)
  open-browser.js             Cross-platform browser launcher
  hash.js                     SHA-256 drift detection (hashContent, detectDrift)
  telemetry.js                Structured local telemetry logger
  cli-utils.js                CLI flag parsing helpers

  anchoring/
    v2/
      index.js                Public exports: describe, locate, buildDomRanges, computeContextHash
      schema.js               Version detection, v1→v2 migration transformer, computeContextHash
      locate.js               5-step drift-recovery pipeline
      capture.js              DOM selection → v2 selectors (describe)
      build-ranges.js         annotation[] → browser Range objects (buildDomRanges)
      fuzzy.js                Fuzzy string match with scoring
      treepath.js             AST heading/paragraph navigation
      fingerprint.js          Token-set fingerprint + Jaccard similarity
      keywords.js             Rare-word extraction
      migrate.js              File-level v1→v2 YAML migration (migrateFile, needsMigration)

  cli/
    migrate-cmd.js            `mdprobe migrate` — batch YAML migration with --dry-run
    stop-cmd.js               `mdprobe stop` — kill singleton and clean lock file

  ui/
    components/               Preact components (AnnotationPanel, AnnotationModal, ReplyList, etc.)
    hooks/
      useAnnotations.js       Annotation state management
      useWebSocket.js         WebSocket reconnect + re-fetch on reconnect
      useKeyboard.js          Keyboard shortcuts
      useTheme.js             Theme switching
      useClientLibs.js        Dynamic client library loader
    state/
      store.js                Preact Signals global state
    styles/
      themes.css              Catppuccin Latte / Frappé / Macchiato / Mocha themes
    highlighters/
      index.js                Highlighter selector (picks best available)
      capability.js           Feature detection (CSS Custom Highlight API support)
      css-highlight-highlighter.js  Primary highlighter using CSS Custom Highlight API
      unsupported-modal.jsx   Shown when the browser doesn't support CSS Highlight API
    click/
      resolver.js             Maps click coordinates to annotation IDs via highlight ranges

schema.json                   JSON Schema for the annotation YAML format (v1; v2 update tracked in #63)
skills/mdprobe/               AI agent skill (SKILL.md) for Claude Code integration
docs/
  SCHEMA.md                   Annotation schema reference (this release)
  EMBEDDING.md                Library API and programmatic usage
  HTTP-API.md                 HTTP endpoint reference
  ARCHITECTURE.md             This file
  specs/                      Historical spec documents
  superpowers/specs/          Design documents (highlight-v2, orphaned-annotations, etc.)
```

---

## Layered architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Source Markdown file                                        │
│  spec.md                                                     │
└──────────────────┬──────────────────────────────────────────┘
                   │ renderer.js (unified/remark/rehype)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  HTML with data-source-start / data-source-end attributes   │
│  on every block and inline element                          │
└──────────────────┬──────────────────────────────────────────┘
                   │ browser: user selects text
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  describe(selection, container)          anchoring/v2/       │
│  → { range, quote, anchor }              capture.js         │
│    range:  { start, end }  (UTF-16 offsets in source)       │
│    quote:  { exact, prefix, suffix }                        │
│    anchor: { contextHash }                                  │
└──────────────────┬──────────────────────────────────────────┘
                   │ POST /api/annotations (action: add)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  spec.annotations.yaml  (sidecar YAML)                      │
│  schema_version: 2                                           │
└──────────────────┬──────────────────────────────────────────┘
                   │ on next page load / file change
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  locate(ann, source, mdast)              anchoring/v2/       │
│  5-step pipeline:                        locate.js          │
│    Step 0 — integrity (contextHash fast-path)               │
│    Step 1 — exact string match (unique occurrence)          │
│    Step 2 — fuzzy match within ±2 kB window (score ≥ 0.60) │
│    Step 3 — treePath AST navigation + fuzzy                 │
│    Step 4 — keyword-anchor fuzzy recovery                   │
│  → { state: 'confident'|'drifted'|'orphan', score, range } │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  buildDomRanges(annotations, container)  build-ranges.js    │
│  → Map<annotationId, Range>                                 │
└──────────────────┬──────────────────────────────────────────┘
                   │ browser: CSS Custom Highlight API
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  CSS.highlights.set(name, new Highlight(...ranges))         │
│  Highlights rendered without any DOM mutation               │
│  css-highlight-highlighter.js                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Key design decisions

### Why CSS Custom Highlight API (zero DOM mutation)

Previous versions used the `<mark>` element injector (`mark-highlighter.js`, removed). Injecting marks into the rendered HTML caused:

- Offset arithmetic errors when `data-source-start/end` attributes were on parent elements but annotations spanned inline text.
- Paint loops when the highlight state changed (each mutation triggered re-render).
- `innerHTML` usage blocked by the project's security hook.

The CSS Custom Highlight API (`CSS.highlights.set(name, new Highlight(range))`) applies visual highlights entirely via CSS without touching the DOM. Highlights survive React/Preact re-renders because they are keyed to `Range` objects, not element identity.

`capability.js` detects support at startup. `unsupported-modal.jsx` is shown on browsers without support (primarily Firefox < 117 and Safari < 17.2).

### Why character-offset anchoring (precision)

Line/column coordinates (v1) were ambiguous under reformatting tools (Prettier, `markdownlint --fix`) that change line boundaries without altering meaning. UTF-16 character offsets are stable for any transformation that does not insert or delete characters within the annotated span, and they map directly to the `data-source-start/end` attributes emitted by the renderer.

### Why a 5-step drift-recovery pipeline (Hypothesis-style)

Document review happens asynchronously — the document author may edit the file while annotations are being written. When offsets become stale the pipeline attempts to recover the original intent:

| Step | Strategy | Threshold | State on match |
|------|----------|-----------|----------------|
| 0 | `contextHash` integrity check | exact | `confident` |
| 1 | Exact string match (unique) | — | `confident` |
| 2 | Fuzzy match within ±2 kB window | ≥ 0.80 → confident, ≥ 0.60 → drifted | `confident` / `drifted` |
| 3 | AST `treePath` heading + paragraph navigation | ≥ 0.65 + ≥ 0.60 | `drifted` |
| 4 | Keyword-anchor fuzzy search | ≥ 0.75 | `drifted` |
| — | No match found | — | `orphan` |

The threshold floor of 0.60 mirrors the Hypothesis web-annotation approach: prefer a `drifted` result that a human can confirm over a silent drop. `acceptDrift` confirms the new location and resets status to `open`.

### Why a singleton server (one server, multiple files)

Running one server per invocation wastes ports and loses cross-session annotation state. The singleton protocol (lock file at `~/.mdprobe.lock` + `GET /api/status` health check) lets subsequent `mdprobe` calls join the running server via `POST /api/add-files` instead of starting new processes.

`--once` mode deliberately bypasses the singleton so automated review pipelines get isolated, deterministic runs.

### Why Preact + Signals (not React)

The review UI ships as a self-contained bundle inside the npm package. React's bundle size (~40 kB min+gzip) was disproportionate for this use case. Preact + htm (no JSX transform at runtime) + Signals (fine-grained reactivity, no virtual-DOM diffing for highlights) results in a ~10 kB bundle that loads near-instantly.

---

## MCP tools

The MCP server (`src/mcp.js`) exposes four tools over stdio transport for Claude Code integration:

| Tool | Purpose |
|------|---------|
| `mdprobe_view` | Open files or inline content in the browser. Accepts `paths[]` or `content` (mutually exclusive). |
| `mdprobe_annotations` | Read the full annotation dataset for a file. Returns summary counts. |
| `mdprobe_update` | Batch annotation mutations: `resolve`, `reopen`, `reply`, `add`, `delete`. |
| `mdprobe_status` | Returns `{ running, url, files }` for the current MCP session. |

The MCP server reuses (or starts) the same HTTP server as the CLI. When Claude Code and the CLI are running simultaneously, the MCP process discovers the existing server via the lock file and forwards WebSocket broadcasts via `POST /api/broadcast`.

---

## CLI subcommands

```
mdprobe [files...] [--port n] [--once] [-d|--detach] [--no-open]
mdprobe setup [--yes] [--author <name>] [--remove]
mdprobe mcp
mdprobe config [key] [value]
mdprobe export <path> --report|--inline|--json|--sarif
mdprobe migrate <path-or-dir> [--dry-run]
mdprobe stop [--force]
```

`migrate` and `stop` are implemented as dedicated modules in `src/cli/` to keep `bin/cli.js` focused on flag parsing and dispatch.

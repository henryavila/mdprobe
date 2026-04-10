![mdProbe](header.png)

# mdProbe

Markdown viewer and reviewer with live reload, persistent annotations, and AI agent integration.

[🇧🇷 Leia em Português](README.pt-BR.md)

Open `.md` files in the browser, annotate inline, approve sections, and export structured feedback as YAML — all from the terminal.

---

## What mdProbe is

- A **CLI tool** that renders markdown in the browser with live reload
- An **annotation system** where you select text and add tagged comments (bug, question, suggestion, nitpick)
- A **review workflow** with section-level approval (approve/reject per heading)
- An **MCP server** that lets AI agents (Claude Code, Cursor, etc.) open files, read annotations, and resolve feedback programmatically

## What mdProbe is not

- Not a markdown editor — you edit in your own editor, mdprobe renders and annotates
- Not a static site generator — it runs a local server for live preview
- Not exclusive to AI — works perfectly as a standalone review tool

---

## Install

```bash
npm install -g @henryavila/mdprobe
mdprobe setup
```

The setup wizard configures your author name, installs the AI skill to detected IDEs (Claude Code, Cursor, Gemini), registers the MCP server, and adds a PostToolUse hook.

For non-interactive environments: `mdprobe setup --yes --author "Your Name"`

Or run without installing:

```bash
npx @henryavila/mdprobe README.md
```

**Requirements:** Node.js 20+, a browser.

---

## Quick Start

### View and edit

```bash
mdprobe README.md
```

Opens rendered markdown in the browser. Edit the source file — the browser updates instantly via WebSocket.

```bash
mdprobe docs/
```

Discovers all `.md` files recursively and shows a file picker.

### Annotate

Select any text in the browser → choose a tag → write a comment → save.

| Tag | Meaning |
|-----|---------|
| `bug` | Something is wrong |
| `question` | Needs clarification |
| `suggestion` | Improvement idea |
| `nitpick` | Minor style/wording |

Annotations are stored in `.annotations.yaml` sidecar files — human-readable, git-friendly.

---

## Singleton Server

mdProbe runs a **single server instance**. Multiple invocations share the same server instead of starting duplicates:

```bash
mdprobe README.md          # Starts server on port 3000, opens browser
mdprobe CHANGELOG.md       # Detects running server, adds file, opens browser, exits
```

The second invocation adds its files to the existing server and exits immediately. The browser shows all files in the sidebar.

**How it works:** A lock file at `/tmp/mdprobe.lock` records the running server's PID, port, and URL. New invocations read the lock file, verify the server is alive via HTTP health check, and join via `POST /api/add-files`. On shutdown (`Ctrl+C`), the lock file is removed automatically.

**Stale lock recovery:** If a previous instance crashed, the next invocation detects the dead process and starts fresh.

---

## Two Review Workflows

mdProbe supports two distinct review workflows for different contexts:

### 1. Blocking review (`--once`) — for CI/CD and scripts

```bash
mdprobe spec.md --once
```

Blocks the process until you click **"Finish Review"** in the UI. When you finish, annotations are saved to `spec.annotations.yaml` and the process exits with the list of created files. This is useful for pipelines that need human sign-off before continuing.

`--once` mode always creates an **isolated server instance** — it does not participate in the singleton. This ensures review sessions have independent lifecycle.

### 2. AI-assisted review (MCP) — for AI coding agents

When working with AI agents (Claude Code, Cursor, etc.), the workflow is different. The agent does **not** use `--once`. Instead:

```
Agent writes spec.md
    ↓
Agent calls mdprobe_view → browser opens, server stays running
    ↓
Human reads, annotates, approves/rejects sections
    ↓
Human tells agent via chat: "done reviewing"
    ↓
Agent calls mdprobe_annotations → reads all feedback
    ↓
Agent fixes bugs, answers questions, evaluates suggestions
    ↓
Agent reports changes, asks human to confirm
    ↓
Agent calls mdprobe_update → resolves annotations
    ↓
Human sees resolved items in real-time (greyed out)
```

The server stays running across the entire conversation. The agent reads annotations on demand — no blocking, no process exit. Multiple files can be reviewed in the same session via the singleton server.

---

## Features

### Rendering

GFM tables, syntax highlighting (highlight.js), Mermaid diagrams, math/LaTeX (KaTeX), YAML/TOML frontmatter, raw HTML passthrough, images from source directory.

### Live Reload

File changes detected via chokidar, pushed over WebSocket. Debounced at 100ms. Scroll position preserved.

### Section Approval

Every heading gets approve/reject buttons. Approving a parent cascades to all children. Progress bar tracks reviewed vs total sections.

### Drift Detection

Warning banner when the source file changes after annotations were created.

### Themes

Five themes based on Catppuccin: Mocha (dark, default), Macchiato, Frappe, Latte, Light.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `[` | Toggle left panel (files + TOC) |
| `]` | Toggle right panel (annotations) |
| `\` | Focus mode (hide both panels) |
| `j` / `k` | Next / previous annotation |
| `?` | Help overlay |
| `Ctrl+Enter` | Save annotation |

### Export

```bash
mdprobe export spec.md --report   # Markdown review report
mdprobe export spec.md --inline   # Annotations inserted into source
mdprobe export spec.md --json     # Plain JSON
mdprobe export spec.md --sarif    # SARIF 2.1.0 (CI/CD integration)
```

---

## AI Agent Integration

mdProbe includes an MCP (Model Context Protocol) server and a skill file (`SKILL.md`) that teaches AI agents how to use the review workflow. This enables a two-way loop: the agent writes markdown, the human annotates, the agent reads feedback and resolves it.

### Setup

```bash
mdprobe setup
```

Interactive wizard that:
1. Installs the `SKILL.md` to detected IDEs (Claude Code, Cursor, Gemini)
2. Registers the MCP server (`mdprobe mcp`) in your Claude Code config
3. Adds a PostToolUse hook that reminds the agent to use mdprobe when editing `.md` files
4. Configures your author name

Non-interactive: `mdprobe setup --yes --author "Your Name"`
Remove everything: `mdprobe setup --remove`

### MCP Tools

Once set up, AI agents can call these tools:

| Tool | Purpose |
|------|---------|
| `mdprobe_view` | Open `.md` files in the browser |
| `mdprobe_annotations` | Read annotations and section statuses |
| `mdprobe_update` | Resolve, reply, add, or delete annotations |
| `mdprobe_status` | Check if the server is running |

The MCP server participates in the singleton — if a CLI-started server is already running, the agent reuses it.

### Manual MCP Registration

If you prefer not to use `mdprobe setup`:

```bash
claude mcp add --scope user --transport stdio mdprobe -- mdprobe mcp
```

---

## CLI Reference

```
mdprobe [files...] [options]

Options:
  --port <n>      Port number (default: 3000, auto-increments if busy)
  --once          Blocking review — isolated server, exits on "Finish Review"
  --no-open       Don't auto-open browser
  --help, -h      Show help
  --version, -v   Show version

Subcommands:
  setup                  Interactive setup (skill + MCP + hook)
  setup --remove         Uninstall everything
  setup --yes [--author] Non-interactive setup
  mcp                    Start MCP server (stdio, for AI agents)
  config [key] [value]   Manage configuration
  export <path> [flags]  Export annotations (--report, --inline, --json, --sarif)
```

---

## Library API

### Embedding in your own server

```javascript
import { createHandler } from '@henryavila/mdprobe'

const handler = createHandler({
  resolveFile: (req) => '/path/to/file.md',
  listFiles: () => [
    { id: 'spec', path: '/docs/spec.md', label: 'Specification' },
  ],
  basePath: '/review',
  author: 'Review Bot',
  onComplete: (result) => {
    console.log(`Review done: ${result.annotations} annotations`)
  },
})

import http from 'node:http'
http.createServer(handler).listen(3000)
```

### Working with annotations programmatically

```javascript
import { AnnotationFile } from '@henryavila/mdprobe/annotations'

const af = await AnnotationFile.load('spec.annotations.yaml')

// Query
const open = af.getOpen()
const bugs = af.getByTag('bug')

// Mutate
af.add({
  selectors: {
    position: { startLine: 10, startColumn: 1, endLine: 10, endColumn: 40 },
    quote: { exact: 'selected text', prefix: '', suffix: '' },
  },
  comment: 'This needs clarification',
  tag: 'question',
  author: 'Henry',
})
af.resolve(bugs[0].id)
await af.save('spec.annotations.yaml')

// Export
import { exportJSON, exportSARIF } from '@henryavila/mdprobe/export'
const sarif = exportSARIF(af, 'spec.md')
```

---

## Annotation Schema

Sidecar file format (`<filename>.annotations.yaml`):

```yaml
version: 1
source: spec.md
source_hash: "sha256:abc123..."
sections:
  - heading: Introduction
    level: 2
    status: approved
annotations:
  - id: "a1b2c3d4"
    selectors:
      position: { startLine: 15, startColumn: 1, endLine: 15, endColumn: 42 }
      quote: { exact: "The system shall support concurrent users" }
    comment: "How many concurrent users?"
    tag: question
    status: open
    author: Henry
    created_at: "2026-04-08T10:30:00.000Z"
    replies:
      - author: Agent
        comment: "Target is 500 concurrent."
        created_at: "2026-04-08T11:00:00.000Z"
```

JSON Schema available at `@henryavila/mdprobe/schema.json`.

---

## HTTP API

Available when the server is running:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files` | List markdown files |
| `GET` | `/api/file?path=<file>` | Rendered HTML + TOC + frontmatter |
| `GET` | `/api/annotations?path=<file>` | Annotations + sections + drift status |
| `POST` | `/api/annotations` | Create/update/delete annotations |
| `POST` | `/api/sections` | Approve/reject/reset sections |
| `GET` | `/api/export?path=<file>&format=<fmt>` | Export (json, report, inline, sarif) |
| `GET` | `/api/status` | Server identity, PID, port, file list |
| `POST` | `/api/add-files` | Add files to a running server (singleton join) |

WebSocket at `/ws` for real-time updates.

---

## Development

```bash
git clone https://github.com/henryavila/mdprobe.git
cd mdprobe
npm install
npm run build:ui
npm test
```

### Project Structure

```
bin/cli.js              CLI entry point
src/
  server.js             HTTP + WebSocket server
  singleton.js          Lock file + cross-process singleton coordination
  mcp.js                MCP server (4 tools, stdio transport)
  renderer.js           Markdown → HTML (unified/remark/rehype)
  annotations.js        Annotation CRUD + section approval
  export.js             Export: report, inline, JSON, SARIF
  setup.js              IDE skill + MCP + hook registration
  setup-ui.js           Interactive setup wizard
  handler.js            Library API for embedding
  config.js             User config (~/.mdprobe.json)
  open-browser.js       Cross-platform browser launcher
  hash.js               SHA-256 drift detection
  anchoring.js          Text position matching
  ui/
    components/         Preact components
    hooks/              WebSocket, keyboard, theme, annotations
    state/store.js      Preact Signals state
    styles/themes.css   Catppuccin themes
schema.json             Annotation YAML schema
skills/mdprobe/         AI agent skill (SKILL.md)
```

---

## License

MIT © [Henry Avila](https://github.com/henryavila)

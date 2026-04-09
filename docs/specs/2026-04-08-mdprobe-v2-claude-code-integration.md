# mdprobe v2 — Claude Code Integration

**Date:** 2026-04-08  
**Status:** Draft  
**Author:** Henry Avila + Claude

---

## Problem

AI agents generate and reference markdown files constantly (specs, RFCs, design docs, ADRs), but:

1. **Paths are useless** — agent prints `docs/specs/design.md`, human has to manually navigate to read it
2. **No review loop** — agent asks "revise this spec" but has no tool to open the file for structured review
3. **Skill trigger is unreliable** — current skill only activates for "markdown rendering + feedback", missing visualization and review of existing files
4. **Library API focus is wrong** — skill teaches JavaScript imports, but Claude Code agents use Bash and Read tools

## Solution

Three components working together:

```
┌────────────────────────────────────────────────────────────┐
│ MCP Server          │ Skill               │ Setup CLI      │
│                     │                     │                │
│ Infrastructure:     │ Behavior:           │ Onboarding:    │
│ - HTTP server       │ - When to show URLs │ - Author name  │
│ - Browser open      │ - When to auto-open │ - URL style    │
│ - Tool interface    │ - How to read YAML  │ - MCP register │
│ - File registry     │ - Review workflows  │ - Multi-IDE    │
└────────────────────────────────────────────────────────────┘
```

---

## 1. MCP Server (`mdprobe mcp`)

### Lifecycle

1. Claude Code starts → spawns `mdprobe mcp` via stdio (configured in `~/.claude.json`)
2. MCP server starts in standby — no HTTP server yet (zero overhead)
3. First `mdprobe_view` call → lazy-starts HTTP server on available port
4. HTTP server persists until Claude Code session ends
5. Subsequent calls add files dynamically to the running server

### Tools

#### `mdprobe_view`

Opens markdown files in the browser for viewing or review.

```
Input:  { paths: string[], open?: boolean }
Output: { url: string, files: string[] }
```

- `paths`: relative or absolute paths to .md files
- `open`: whether to auto-open browser (default: true)
- Resolves paths relative to CWD
- Adds files to running server (or starts server if first call)
- Opens browser using platform-appropriate command (reuses existing `openBrowser()` logic)
- Returns base URL and registered file list

#### `mdprobe_annotations`

Reads annotations for a file after human review.

```
Input:  { path: string }
Output: {
  source: string,
  sections: [{ heading, level, status }],
  annotations: [{ id, tag, comment, status, author, selectors, replies }],
  summary: { total, open, resolved, bugs, questions, suggestions, nitpicks }
}
```

- Reads the `.annotations.yaml` sidecar file
- Returns structured data (not raw YAML)
- Includes computed summary for quick triage

#### `mdprobe_update`

Updates annotations — resolve, reopen, reply, create.

```
Input:  { 
  path: string,
  actions: [
    { action: "resolve", id: string },
    { action: "reopen", id: string },
    { action: "reply", id: string, comment: string },
    { action: "add", selectors: {...}, comment: string, tag: string },
    { action: "delete", id: string }
  ]
}
Output: { 
  updated: number,
  annotations: [{ id, tag, comment, status, ... }],
  summary: { total, open, resolved }
}
```

- Accepts batch operations (multiple actions in one call)
- Author is auto-filled from `~/.mdprobe.json` config (fallback: `"Agent"` if config missing)
- Changes are saved to `.annotations.yaml` immediately
- If HTTP server is running, broadcasts updates via WebSocket (human sees changes in real-time)

#### `mdprobe_status`

Returns current server state.

```
Input:  {}
Output: { running: boolean, url?: string, files?: string[] }
```

### Server binding

The HTTP server listens on `127.0.0.1`. The displayed URL uses the configured style:

| Config `urlStyle` | Displayed URL |
|-------------------|---------------|
| `mdprobe.localhost` | `http://mdprobe.localhost:3000/spec.md` |
| `localhost` | `http://localhost:3000/spec.md` |

`mdprobe.localhost` works because modern browsers resolve `*.localhost` → `127.0.0.1` (RFC 6761). The server doesn't need to know — it's the same IP either way.

### Dynamic file registration

Current server uses a fixed `resolvedFiles` array set at creation. New behavior:

- `createServer()` returns a method to add files: `server.addFiles(paths)`
- New files appear in the file picker immediately
- WebSocket broadcasts `file-added` event to connected browsers

### URL routing

Clean path-based routing instead of query params:

| URL | Behavior |
|-----|----------|
| `http://mdprobe.localhost:3000/` | File picker (all registered files) |
| `http://mdprobe.localhost:3000/spec.md` | Direct to file (basename match) |
| `http://mdprobe.localhost:3000/docs/specs/spec.md` | Direct to file (path suffix match) |

**Server-side:** Any GET request that doesn't match `/api/*` or `/assets/*` serves the HTML shell (SPA pattern). The pathname is passed through to the client.

**Client-side:** The UI reads `window.location.pathname` on load, calls `findFile()` to match, and auto-selects the file. Falls back to the file picker if no match.

---

## 2. Skill (`SKILL.md`)

### Frontmatter

```yaml
---
name: mdprobe
description: Render and review markdown files in the browser. Use whenever
  generating, editing, or referencing any .md file. Opens a live preview
  with annotations, section approval, and structured feedback via YAML sidecars.
---
```

### Core rules

#### Rule 1 — Always show URL when citing .md

Whenever the agent mentions a .md file path in output, call `mdprobe_view` and show:

```
📄 docs/spec.md → http://{urlStyle}:{port}/spec.md
```

Example with `mdprobe.localhost`: `http://mdprobe.localhost:3000/spec.md`
Example with `localhost`: `http://localhost:3000/spec.md`

Multiple files in one response → one combined call:

```
📄 3 arquivos → http://{urlStyle}:{port}
```

#### Rule 2 — Review opens automatically

When the context is review (human needs to read and give feedback now):

1. Call `mdprobe_view({ paths, open: true })`
2. Browser opens automatically
3. Show:

```
📄 Aberto para revisão no browser.
Anote seus comentários. Me avise quando terminar.
```

#### Rule 3 — Read, address, and resolve annotations

When human says they finished reviewing:

1. Call `mdprobe_annotations({ path })` for each reviewed file
2. Process each open annotation:
   - `bug` → fix the issue
   - `question` → answer or clarify
   - `suggestion` → evaluate and implement or justify skipping
   - `nitpick` → fix if trivial
3. Report what was addressed and ask human to confirm
4. After human confirms, call `mdprobe_update` to mark annotations as resolved:
   ```
   mdprobe_update({
     path: "spec.md",
     actions: [
       { action: "resolve", id: "a1b2c3d4" },
       { action: "reply", id: "a1b2c3d4", comment: "Fixed: added rateLimit param" },
       ...
     ]
   })
   ```
5. Human sees resolved annotations in real-time in the browser (greyed out)

#### Rule 4 — Reply to explain decisions

When the agent addresses an annotation but the fix isn't self-evident, add a reply explaining what was done before resolving:

```
mdprobe_update({
  path: "spec.md",
  actions: [
    { action: "reply", id: "a1b2", comment: "Changed to PostgreSQL per ADR-003" },
    { action: "resolve", id: "a1b2" }
  ]
})
```

When the agent **disagrees** with a suggestion, reply with justification but do NOT resolve — leave it open for the human to decide:

```
mdprobe_update({
  path: "spec.md",
  actions: [
    { action: "reply", id: "c3d4", comment: "Keeping current approach because X. Let me know if you still want to change." }
  ]
})
```

#### Rule 5 — Pre-annotate areas of uncertainty

Before asking for review, the agent can create annotations to guide the human's attention to areas that need input:

```
mdprobe_update({
  path: "spec.md",
  actions: [
    { action: "add", selectors: { position: { startLine: 42, startColumn: 1, endLine: 42, endColumn: 50 }, quote: { exact: "Rate limit: 100/min", prefix: "", suffix: "" } }, comment: "Is 100/min enough? Load test showed 300/min spikes.", tag: "question" },
    { action: "add", selectors: { position: { startLine: 78, startColumn: 1, endLine: 78, endColumn: 30 }, quote: { exact: "Auth via JWT", prefix: "", suffix: "" } }, comment: "Two options: JWT or session cookies. I went with JWT for statelessness. OK?", tag: "suggestion" }
  ]
})
```

The human sees these annotations already in the browser when they start reviewing — focuses their attention on what matters.

#### Rule 6 — Delete only own annotations

The agent may delete its own annotations (where `author` matches the agent's name) if they become irrelevant after changes. Never delete human annotations — resolve or reply instead.

#### Rule 7 — No `--once` in Claude Code

The `--once` blocking mode is for scripted/CI use. In Claude Code, the human signals "done" via chat. The agent reads annotations on demand via `mdprobe_annotations`.

### Skill structure

```
SKILL.md (< 250 lines)
├── When to Use / When NOT to Use
├── Rules (7 core rules)
│   1. Always show URL when citing .md
│   2. Review opens automatically
│   3. Read, address, and resolve annotations (with confirmation)
│   4. Reply to explain decisions (or disagree without resolving)
│   5. Pre-annotate areas of uncertainty before review
│   6. Delete only own annotations
│   7. No --once in Claude Code
├── Review workflow (step by step)
├── Annotation tags (bug/question/suggestion/nitpick)
└── Section approval (how cascade works)
```

Keep under 250 lines. No JavaScript library examples — only MCP tools.

---

## 3. Setup CLI (`mdprobe setup`)

### Interactive flow

```
$ mdprobe setup

  ◆ mdprobe v0.2.0 — setup

  ◇ Seu nome para anotações:
  │ Henry

  ◇ Estilo de URL:
  │ ● mdprobe.localhost (Chrome/Firefox/Edge)
  │ ○ localhost (compatível com todos)

  ◇ IDEs detectados:
  │ ✓ Claude Code
  │ ✓ Cursor

  ◆ Instalando...

  ✓ Skill instalada:
    ~/.claude/skills/mdprobe/SKILL.md
    ~/.cursor/skills/mdprobe/SKILL.md

  ✓ MCP server registrado (global)

  ✓ Config salva em ~/.mdprobe.json

  ◇ Reinicie o Claude Code para ativar.

  └ Done!
```

### What it does

1. **Prompt author name** — saved to `~/.mdprobe.json`
2. **Prompt URL style** — `mdprobe.localhost` or `localhost`
3. **Detect IDEs** — check for `~/.claude/skills/`, `~/.cursor/skills/`, `~/.gemini/skills/` directories
4. **Install skill** — copy SKILL.md to each detected IDE's skill directory:
   - Claude Code: `~/.claude/skills/mdprobe/SKILL.md`
   - Cursor: `~/.cursor/skills/mdprobe/SKILL.md`
   - Gemini: `~/.gemini/skills/mdprobe/SKILL.md`
5. **Register MCP server** — run `claude mcp add --scope user --transport stdio mdprobe -- mdprobe mcp`
6. **Save config** — write `~/.mdprobe.json`

### Non-interactive mode

```bash
mdprobe setup --yes                     # accept defaults
mdprobe setup --yes --author "Henry"    # with author
mdprobe setup --remove                  # uninstall everything
```

### Config file (`~/.mdprobe.json`)

```json
{
  "author": "Henry",
  "urlStyle": "mdprobe.localhost"
}
```

### Architecture (testable)

```
src/setup.js        ← core logic (pure, no interactive I/O)
  - installSkill(basePath, ide, content) → writes file
  - registerMCP() → calls claude CLI (fallback: write ~/.claude.json directly)
  - registerHook() → safe merge into ~/.claude/settings.json
  - saveConfig(config) → writes ~/.mdprobe.json
  - removeAll() → uninstalls skill + MCP + hook + config
  - detectIDEs() → returns list of detected IDEs

src/setup-ui.js     ← interactive UI (@clack/prompts)
  - promptAuthor()
  - promptUrlStyle()
  - confirmIDEs()

tests/setup.test.js ← tests core logic in tempdir
  - skill created at correct path per IDE
  - config saved correctly
  - --remove cleans everything
  - idempotent (re-run doesn't duplicate)
  - skips already-configured author
```

### Dependency

Add `@clack/prompts` as a dependency for the interactive setup UX.

---

## 4. Code changes required

### New files

| File | Purpose |
|------|---------|
| `src/mcp.js` | MCP server implementation (stdio protocol + tool handlers) |
| `src/setup.js` | Setup core logic (skill install, MCP register, hook register, config) |
| `src/setup-ui.js` | Interactive setup UI (@clack/prompts) |
| `src/open-browser.js` | Extracted browser-open logic (reused by CLI and MCP) |
| `tests/unit/setup.test.js` | Setup core logic tests (skill install, MCP register, hook merge, config, remove, IDE detection) |
| `tests/unit/mcp.test.js` | MCP tool handler tests (view, annotations, update, status) |
| `tests/unit/open-browser.test.js` | Browser open logic per platform |
| `tests/unit/server-dynamic.test.js` | Dynamic file registration (`addFiles`) and path-based routing |
| `tests/unit/deep-link.test.js` | UI deep linking via URL pathname |

### Modified files

| File | Change |
|------|--------|
| `bin/cli.js` | Add `setup` and `mcp` subcommands |
| `~/.claude/settings.json` | PostToolUse hook for Write/Edit on .md files (via setup) |
| `src/server.js` | Add `addFiles()` method for dynamic file registration |
| `src/ui/app.jsx` | Read `window.location.pathname` for deep linking |
| `src/server.js` | Add path-based routing (`/spec.md` → file lookup) |
| `package.json` | Add `@modelcontextprotocol/sdk` and `@clack/prompts` dependencies |
| `README.md` | Document MCP integration, setup, new workflow |
| `skills/mdprobe/SKILL.md` | Complete rewrite (MCP-focused, < 250 lines) |

### Removed patterns

| What | Why |
|------|-----|
| `mdprobe install --plugin` | Replaced by `mdprobe setup` |
| JS library examples in skill | Agents use MCP tools, not JS imports |
| `--once` emphasis in skill | Agents use chat for "done" signal |

---

## 5. Output format in terminal

### Single file cited

```
📄 docs/spec.md → http://{urlStyle}:{port}/spec.md
```

(e.g. `http://mdprobe.localhost:3000/spec.md` or `http://localhost:3000/spec.md`)

### Single file opened for review

```
📄 Aberto para revisão no browser.
Anote seus comentários. Me avise quando terminar.
```

### Multiple files cited

```
📄 3 arquivos → http://{urlStyle}:{port}
```

### Multiple files for review

```
📄 3 specs abertos para revisão no browser.
Anote seus comentários. Me avise quando terminar.
```

### Post-review (agent reads feedback)

```
Lendo anotações de spec.md: 3 open (1 bug, 2 questions), 2 resolved

[bug] Line 42: "Rate limit should be configurable"
  → Corrigido: adicionado parâmetro `rateLimit` com default 100/min

[question] Line 15: "Qual banco de dados?"
  → PostgreSQL, conforme ADR-003

[question] Line 28: "Timeline?"
  → 2 sprints estimados, prioridade P1

Confirma que posso marcar as 3 anotações como resolvidas?
```

### Post-confirmation (agent resolves annotations)

```
✓ 3 anotações marcadas como resolvidas em spec.md
```

---

## 6. End-to-end example: the sda-v2 scenario

### Before (what happened)

```
Agent: "Spec written. Revise os 3 arquivos."
→ AI summarizes specs in text (mdprobe not triggered)
→ Human can't annotate, no structured feedback
```

### After (with v2)

```
Agent: "Spec written. Revise os 3 arquivos."
→ Skill triggers: context is review of .md files
→ Calls mdprobe_view(["docs/spec.md", "docs/batch-1.md", "docs/batch-2.md"])
→ HTTP server starts, browser opens automatically

Agent output:
  📄 3 specs abertos para revisão no browser.
  Anote seus comentários. Me avise quando terminar.

  [Human reviews in browser, adds annotations, approves sections]

Human: "terminei a revisão"

→ Agent calls mdprobe_annotations for each file
→ Reads structured feedback
→ Addresses each annotation
→ Reports back and asks for confirmation:

  Lendo anotações...
  spec.md: 2 bugs, 1 question (all addressed)
  batch-1.md: 1 suggestion (implemented)
  batch-2.md: approved, no annotations

  Confirma que posso marcar como resolvidas?
```

---

## 7. Hook PostToolUse (enforcer)

A PostToolUse hook on Write/Edit of `.md` files reinforces the skill trigger. Even if the skill isn't activated, the hook fires and reminds the agent to offer mdprobe.

The `mdprobe setup` command registers this hook in `~/.claude/settings.json`.

**Safe merge strategy:** The setup reads the existing `settings.json`, parses the `hooks.PostToolUse` array, checks if an mdprobe hook already exists (by searching for `[mdprobe]` in the command string), and appends only if absent. Existing hooks from other tools (ECC, etc.) are preserved. The `--remove` command reverses this by finding and removing only the mdprobe entry.

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "node -e \"const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const p=d.tool_input?.file_path||''; if(p.endsWith('.md')){const j={decision:'allow',reason:'[mdprobe] .md file modified: '+require('path').basename(p)+'. Offer to open with mdprobe.'}; process.stdout.write(JSON.stringify(j))}\""
      }]
    }]
  }
}
```

When triggered, the hook returns feedback to the agent: `"[mdprobe] .md file modified: spec.md. Offer to open with mdprobe."` This ensures the agent always knows to show the mdprobe URL, even without the skill being loaded.

---

## 8. Not included (future)

| Feature | Reason |
|---------|--------|
| OSC 8 hyperlinks | Terminals already auto-detect raw URLs |
| Custom protocol handler (`mdprobe://`) | Requires OS-level registration per platform (Windows Registry, Linux .desktop, macOS Info.plist) + WSL complexity. Estimated 2-3 days of work for marginal UX gain over HTTP URLs that already work everywhere. |

### Note on `--once`

The `--once` blocking mode already exists and remains available. It has real value in non-Claude-Code contexts (CI scripts, non-interactive agents, pipelines) where the process needs to block and return an exit code. In the Claude Code skill, `--once` is de-emphasized because the chat is a more natural "done" signal, but it is NOT removed.

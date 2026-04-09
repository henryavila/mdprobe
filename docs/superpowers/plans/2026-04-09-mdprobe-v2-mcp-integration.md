# mdprobe v2 — MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP server, setup CLI, and SKILL.md rewrite so Claude Code agents can view/review markdown via tools instead of CLI commands.

**Architecture:** MCP server (stdio) lazy-starts the existing HTTP server on first `mdprobe_view` call. Setup CLI installs skill + registers MCP in one command. Server gains `addFiles()` for dynamic file registration and SPA routing for deep links.

**Tech Stack:** @modelcontextprotocol/sdk (MCP stdio), zod (tool schemas), @clack/prompts (setup UI), existing Node.js HTTP + WebSocket server

**Spec:** `docs/specs/2026-04-08-mdprobe-v2-claude-code-integration.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/open-browser.js` | Platform-aware browser open (extracted from cli.js) |
| `src/mcp.js` | MCP stdio server — 4 tools, lazy HTTP lifecycle |
| `src/setup.js` | Setup core logic — pure functions, no I/O prompts |
| `src/setup-ui.js` | Interactive setup UI (@clack/prompts) |
| `tests/unit/open-browser.test.js` | Browser open per-platform tests |
| `tests/unit/mcp.test.js` | MCP tool handler tests |
| `tests/unit/setup.test.js` | Setup logic tests (tempdir) |
| `tests/unit/server-dynamic.test.js` | addFiles() + SPA routing tests |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add 3 deps: `@modelcontextprotocol/sdk`, `zod`, `@clack/prompts` |
| `src/server.js` | Add `addFiles()` return, SPA catch-all routing |
| `bin/cli.js` | Add `setup` + `mcp` subcommands, use `openBrowser()` |
| `src/ui/app.jsx` | Deep link: read `window.location.pathname`, match file |
| `skills/mdprobe/SKILL.md` | Complete rewrite — MCP tools only, <250 lines |

---

## Task 1: Install Dependencies

**Files:** `package.json`

- [ ] **Step 1:** Install production deps

```bash
npm install @modelcontextprotocol/sdk zod @clack/prompts
```

- [ ] **Step 2:** Verify existing tests still pass

```bash
npm test
```

- [ ] **Step 3:** Commit

```bash
git add package.json package-lock.json
git commit -m "chore: add MCP SDK, zod, and clack deps for v2"
```

---

## Task 2: Extract open-browser.js

**Files:**
- Create: `src/open-browser.js`
- Create: `tests/unit/open-browser.test.js`
- Modify: `bin/cli.js` (replace inline browser logic)

- [ ] **Step 1: Write failing test**

```js
// tests/unit/open-browser.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the platform detection logic, not actual browser launching
describe('openBrowser', () => {
  it('exports openBrowser function', async () => {
    const mod = await import('../../src/open-browser.js')
    expect(typeof mod.openBrowser).toBe('function')
  })
})
```

- [ ] **Step 2: Implement open-browser.js**

```js
// src/open-browser.js
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

export async function openBrowser(url) {
  const isWSL = await readFile('/proc/version', 'utf-8')
    .then(v => /microsoft/i.test(v))
    .catch(() => false)

  let cmd, args
  if (process.platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', url]
  } else if (isWSL) {
    cmd = '/mnt/c/Windows/System32/cmd.exe'
    args = ['/c', 'start', url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }

  return new Promise((resolve) => {
    execFile(cmd, args, { stdio: 'ignore' }, () => resolve())
  })
}
```

- [ ] **Step 3: Update bin/cli.js** — replace inline browser code (lines 306-327) with:

```js
import { openBrowser } from '../src/open-browser.js'
// ...
if (!noOpenFlag) {
  try { await openBrowser(server.url) } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/open-browser.js tests/unit/open-browser.test.js bin/cli.js
git commit -m "refactor: extract openBrowser into reusable module"
```

---

## Task 3: Server addFiles() + SPA Routing

**Files:**
- Modify: `src/server.js`
- Create: `tests/unit/server-dynamic.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/unit/server-dynamic.test.js
import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from '../../src/server.js'

describe('dynamic file registration', () => {
  let server
  const tmp = join(tmpdir(), 'mdprobe-dyn-' + Date.now())

  afterEach(async () => {
    if (server) await server.close()
    await rm(tmp, { recursive: true, force: true })
  })

  it('addFiles() registers new files to the running server', async () => {
    await mkdir(tmp, { recursive: true })
    const f1 = join(tmp, 'a.md')
    const f2 = join(tmp, 'b.md')
    await writeFile(f1, '# A')
    await writeFile(f2, '# B')

    server = await createServer({ files: [f1], port: 0, open: false })
    // Initially only a.md
    let res = await fetch(`${server.url}/api/files`)
    let data = await res.json()
    expect(data).toHaveLength(1)

    // Add b.md dynamically
    server.addFiles([f2])
    res = await fetch(`${server.url}/api/files`)
    data = await res.json()
    expect(data).toHaveLength(2)
    expect(data.map(f => f.path)).toContain('b.md')
  })
})

describe('SPA routing', () => {
  let server
  const tmp = join(tmpdir(), 'mdprobe-spa-' + Date.now())

  afterEach(async () => {
    if (server) await server.close()
    await rm(tmp, { recursive: true, force: true })
  })

  it('serves HTML shell for non-API paths (SPA catch-all)', async () => {
    await mkdir(tmp, { recursive: true })
    const f = join(tmp, 'spec.md')
    await writeFile(f, '# Spec')

    server = await createServer({ files: [f], port: 0, open: false })

    const res = await fetch(`${server.url}/spec.md`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('mdprobe')
  })
})
```

- [ ] **Step 2: Add `addFiles()` to server.js**

In `createServer()`, after building the server object, add:

```js
serverObj.addFiles = (newPaths) => {
  for (const p of newPaths) {
    const abs = node_path.resolve(p)
    if (!resolvedFiles.includes(abs)) {
      resolvedFiles.push(abs)
      // Add to watcher
      const dir = node_path.dirname(abs)
      watcher.add(dir)
      // Broadcast to connected clients
      broadcastToAll({ type: 'file-added', file: node_path.basename(abs) })
    }
  }
}
```

- [ ] **Step 3: Add SPA catch-all routing**

In `createRequestHandler`, before the 404 fallback, add:

```js
// SPA catch-all: any GET that isn't /api/* or /assets/* serves the HTML shell
if (req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/assets/') && pathname !== '/ws') {
  return sendHTML(res, 200, SHELL_HTML)
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/unit/server-dynamic.test.js
git commit -m "feat: add dynamic file registration and SPA routing"
```

---

## Task 4: MCP Server

**Files:**
- Create: `src/mcp.js`
- Create: `tests/unit/mcp.test.js`

- [ ] **Step 1: Write tests for MCP tool handlers**

Test each tool handler in isolation by mocking the server lifecycle. Focus on:
- `mdprobe_view`: starts server, returns URL
- `mdprobe_annotations`: reads sidecar YAML, returns structured data
- `mdprobe_update`: batch operations (resolve, reply, add, delete)
- `mdprobe_status`: returns running/stopped state

- [ ] **Step 2: Implement src/mcp.js**

Core structure:

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { resolve, basename } from 'node:path'
import { createServer } from './server.js'
import { openBrowser } from './open-browser.js'
import { AnnotationFile } from './annotations.js'
import { getConfig } from './config.js'
import { readFile } from 'node:fs/promises'
import { hashContent } from './hash.js'

let httpServer = null

async function getOrCreateServer() {
  if (httpServer) return httpServer
  httpServer = await createServer({ files: [], port: 3000, open: false })
  return httpServer
}

function getUrlStyle(config) {
  const style = config.urlStyle || 'localhost'
  return style
}

function buildUrl(port, urlStyle, path = '') {
  const host = urlStyle === 'mdprobe.localhost' ? 'mdprobe.localhost' : 'localhost'
  return `http://${host}:${port}${path ? '/' + path : ''}`
}

export async function startMcpServer() {
  const config = await getConfig()
  const author = config.author || 'Agent'
  const urlStyle = getUrlStyle(config)

  const server = new McpServer({
    name: 'mdprobe',
    version: '0.2.0',
  })

  // mdprobe_view
  server.registerTool('mdprobe_view', {
    description: 'Open markdown files in the browser for viewing or review',
    inputSchema: z.object({
      paths: z.array(z.string()).describe('Paths to .md files'),
      open: z.boolean().optional().default(true).describe('Auto-open browser'),
    }),
  }, async ({ paths, open }) => {
    const srv = await getOrCreateServer()
    const resolved = paths.map(p => resolve(p))
    srv.addFiles(resolved)
    const url = buildUrl(srv.port, urlStyle)
    if (open) await openBrowser(url).catch(() => {})
    const fileList = resolved.map(p => basename(p))
    return {
      content: [{ type: 'text', text: JSON.stringify({ url, files: fileList }) }],
    }
  })

  // mdprobe_annotations
  server.registerTool('mdprobe_annotations', {
    description: 'Read annotations for a file after human review',
    inputSchema: z.object({
      path: z.string().describe('Path to .md file'),
    }),
  }, async ({ path }) => {
    const resolved = resolve(path)
    const sidecarPath = resolved.replace(/\.md$/, '.annotations.yaml')
    let af
    try {
      af = await AnnotationFile.load(sidecarPath)
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          source: basename(resolved),
          sections: [], annotations: [],
          summary: { total: 0, open: 0, resolved: 0, bugs: 0, questions: 0, suggestions: 0, nitpicks: 0 },
        }) }],
      }
    }
    const json = af.toJSON()
    const open = af.getOpen()
    const summary = {
      total: json.annotations.length,
      open: open.length,
      resolved: af.getResolved().length,
      bugs: af.getByTag('bug').length,
      questions: af.getByTag('question').length,
      suggestions: af.getByTag('suggestion').length,
      nitpicks: af.getByTag('nitpick').length,
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ ...json, summary }) }],
    }
  })

  // mdprobe_update
  server.registerTool('mdprobe_update', {
    description: 'Update annotations — resolve, reopen, reply, create, delete',
    inputSchema: z.object({
      path: z.string(),
      actions: z.array(z.object({
        action: z.enum(['resolve', 'reopen', 'reply', 'add', 'delete']),
        id: z.string().optional(),
        comment: z.string().optional(),
        tag: z.enum(['bug', 'question', 'suggestion', 'nitpick']).optional(),
        selectors: z.any().optional(),
      })),
    }),
  }, async ({ path, actions }) => {
    const resolved = resolve(path)
    const sidecarPath = resolved.replace(/\.md$/, '.annotations.yaml')
    let af
    try {
      af = await AnnotationFile.load(sidecarPath)
    } catch {
      const content = await readFile(resolved, 'utf-8')
      af = AnnotationFile.create(basename(resolved), `sha256:${hashContent(content)}`)
    }

    for (const act of actions) {
      switch (act.action) {
        case 'resolve': af.resolve(act.id); break
        case 'reopen': af.reopen(act.id); break
        case 'reply': af.addReply(act.id, { author, comment: act.comment }); break
        case 'add': af.add({ selectors: act.selectors, comment: act.comment, tag: act.tag, author }); break
        case 'delete': af.delete(act.id); break
      }
    }

    await af.save(sidecarPath)
    const json = af.toJSON()
    return {
      content: [{ type: 'text', text: JSON.stringify({
        updated: actions.length,
        annotations: json.annotations,
        summary: { total: json.annotations.length, open: af.getOpen().length, resolved: af.getResolved().length },
      }) }],
    }
  })

  // mdprobe_status
  server.registerTool('mdprobe_status', {
    description: 'Returns current server state',
    inputSchema: z.object({}),
  }, async () => {
    if (!httpServer) {
      return { content: [{ type: 'text', text: JSON.stringify({ running: false }) }] }
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ running: true, url: httpServer.url }) }],
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

---

## Task 5: Setup Core Logic

**Files:**
- Create: `src/setup.js`
- Create: `tests/unit/setup.test.js`

Core functions (pure, testable in tempdir):

- `detectIDEs()` — check for `~/.claude/skills/`, `~/.cursor/skills/`, `~/.gemini/skills/`
- `installSkill(basePath, ide, content)` — write SKILL.md to IDE skill dir
- `registerMCP()` — run `claude mcp add --scope user --transport stdio mdprobe -- mdprobe mcp`
- `registerHook(settingsPath)` — safe merge PostToolUse hook into settings.json
- `saveConfig(config, configPath)` — write `~/.mdprobe.json`
- `removeAll(opts)` — uninstall everything
- `generateSkillContent()` — return SKILL.md content string

Tests: all functions in tempdir, verify file creation, idempotency, safe merge, removal.

- [ ] **Step 1: Write tests**
- [ ] **Step 2: Implement src/setup.js**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

---

## Task 6: Setup Interactive UI

**Files:**
- Create: `src/setup-ui.js`

Uses @clack/prompts for interactive setup flow:
- `intro()` with version
- `text()` for author name
- `select()` for URL style
- `confirm()` for detected IDEs
- `spinner()` for install progress
- `outro()` with success message

Calls setup.js functions for actual work. Non-interactive `--yes` mode bypasses prompts.

- [ ] **Step 1: Implement src/setup-ui.js**
- [ ] **Step 2: Manual test: `node bin/cli.js setup`**
- [ ] **Step 3: Commit**

---

## Task 7: CLI Subcommands

**Files:**
- Modify: `bin/cli.js`

Add two subcommand branches before the serve-mode default:

```js
// ---- setup subcommand ----
if (subcommand === 'setup') {
  const { runSetup } = await import('../src/setup-ui.js')
  await runSetup(args)
  process.exit(0)
}

// ---- mcp subcommand ----
if (subcommand === 'mcp') {
  const { startMcpServer } = await import('../src/mcp.js')
  await startMcpServer()
  // MCP server runs until parent process terminates — don't exit
}
```

Remove old `install --plugin` subcommand. Update `printUsage()`.

- [ ] **Step 1: Modify cli.js**
- [ ] **Step 2: Run integration tests**
- [ ] **Step 3: Commit**

---

## Task 8: UI Deep Linking

**Files:**
- Modify: `src/ui/app.jsx`

On mount, read `window.location.pathname`. If it's not `/`, use it to find and auto-select a file:

```js
// In useEffect after fetching files:
const pathname = window.location.pathname
if (pathname !== '/' && data.length > 0) {
  const target = pathname.replace(/^\//, '')
  const match = data.find(f =>
    f.path === target ||
    f.absPath?.endsWith('/' + target) ||
    f.path === target.split('/').pop()
  )
  if (match) {
    handleFileSelect(match.path)
    return // skip default first-file selection
  }
}
```

- [ ] **Step 1: Modify app.jsx**
- [ ] **Step 2: Build UI: `npm run build:ui`**
- [ ] **Step 3: Commit**

---

## Task 9: SKILL.md Rewrite

**Files:**
- Rewrite: `skills/mdprobe/SKILL.md`

Complete rewrite per spec section 2. MCP tools only, no JS library examples. <250 lines.

Structure:
1. Frontmatter (name, description)
2. When to Use / When NOT to Use
3. 7 Core Rules
4. Review Workflow (step by step)
5. Annotation Tags table
6. Section Approval (cascade explanation)

- [ ] **Step 1: Write new SKILL.md**
- [ ] **Step 2: Verify line count < 250**
- [ ] **Step 3: Commit**

---

## Verification

After all tasks:

```bash
npm test                    # all tests pass
npm run build:ui            # UI builds
node bin/cli.js --help      # shows setup + mcp subcommands
node bin/cli.js mcp &       # MCP server starts on stdio
wc -l skills/mdprobe/SKILL.md  # < 250 lines
```

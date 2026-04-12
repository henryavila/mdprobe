# Issue #2 — Inline Review Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix AI agents presenting content inline instead of using mdProbe for review, and harden singleton server against stale connections.

**Architecture:** Four surgical fixes: (1) SKILL.md rewrite with anti-pattern + decision rule, (2) tool description semantic trigger, (3) `content` parameter on `mdprobe_view` for one-step draft+review, (4) `buildHash` in singleton protocol to reject stale servers.

**Tech Stack:** Node.js, Vitest, Zod, MCP SDK

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `tests/unit/mcp.test.js` | Modify | Add tests for `content` param, validation, tool description |
| `src/mcp.js` | Modify | Tool description + `content`/`filename` params + validation |
| `tests/unit/singleton.test.js` | Modify | Add tests for `buildHash` in discovery |
| `src/singleton.js` | Modify | Add `buildHash` to lock file, compare on discovery |
| `src/server.js` | Modify | Add `buildHash` to `/api/status` response |
| `tests/unit/skill.test.js` | Create | Validate SKILL.md content |
| `skills/mdprobe/SKILL.md` | Modify | Frontmatter + anti-pattern + decision rule + Rule 8 |

---

### Task 1: `content` param — failing tests

**Files:**
- Modify: `tests/unit/mcp.test.js`

- [ ] **Step 1: Write failing tests for `content` parameter validation**

Add a new `describe` block at the end of `tests/unit/mcp.test.js`:

```js
describe('mdprobe_view content parameter validation', () => {
  let tmp

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  })

  it('saves content to filename and returns savedTo path', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-content-'))
    const filename = join(tmp, 'draft.md')
    const content = '# Draft\n\nThis is a test draft with enough content.'

    const { writeFile: fsWrite } = await import('node:fs/promises')
    const { resolve } = await import('node:path')

    // Simulate what mdprobe_view does with content param
    const { saveContentToFile } = await import('../../src/mcp.js')
    const result = await saveContentToFile(content, filename)

    expect(result.savedTo).toBe(resolve(filename))
    const saved = await readFile(filename, 'utf-8')
    expect(saved).toBe(content)
  })

  it('returns error when content provided without filename', async () => {
    const { validateViewParams } = await import('../../src/mcp.js')
    const result = validateViewParams({ content: '# Hello' })
    expect(result.error).toMatch(/filename.*required/i)
  })

  it('returns error when both paths and content provided', async () => {
    const { validateViewParams } = await import('../../src/mcp.js')
    const result = validateViewParams({ paths: ['a.md'], content: '# Hello', filename: 'b.md' })
    expect(result.error).toMatch(/cannot.*both/i)
  })

  it('returns error when neither paths nor content provided', async () => {
    const { validateViewParams } = await import('../../src/mcp.js')
    const result = validateViewParams({})
    expect(result.error).toMatch(/either.*paths.*content/i)
  })

  it('overwrites existing file with content', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-overwrite-'))
    const filename = join(tmp, 'existing.md')
    await writeFile(filename, '# Old content')

    const { saveContentToFile } = await import('../../src/mcp.js')
    await saveContentToFile('# New content', filename)

    const saved = await readFile(filename, 'utf-8')
    expect(saved).toBe('# New content')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/mcp.test.js --reporter=verbose`
Expected: FAIL — `saveContentToFile` and `validateViewParams` not exported from `src/mcp.js`

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/mcp.test.js
git commit -m "test: add failing tests for mdprobe_view content parameter"
```

---

### Task 2: `content` param — implementation

**Files:**
- Modify: `src/mcp.js:1-80`

- [ ] **Step 1: Add `validateViewParams` and `saveContentToFile` helpers**

Add after the `buildUrl` function (after line 48) in `src/mcp.js`:

```js
/**
 * Validate mdprobe_view input: either paths OR content+filename, not both/neither.
 * @param {{paths?: string[], content?: string, filename?: string}} params
 * @returns {{error?: string, mode?: 'paths'|'content'}}
 */
export function validateViewParams(params) {
  const hasPaths = Array.isArray(params.paths) && params.paths.length > 0
  const hasContent = typeof params.content === 'string' && params.content.length > 0

  if (hasPaths && hasContent) {
    return { error: 'Cannot provide both paths and content. Use one or the other.' }
  }
  if (!hasPaths && !hasContent) {
    return { error: 'Either paths or content must be provided.' }
  }
  if (hasContent && !params.filename) {
    return { error: 'filename is required when content is provided.' }
  }
  return { mode: hasPaths ? 'paths' : 'content' }
}

/**
 * Save raw content to a file, creating directories if needed.
 * @param {string} content
 * @param {string} filename - Absolute or relative path
 * @returns {Promise<{savedTo: string}>}
 */
export async function saveContentToFile(content, filename) {
  const absPath = resolve(filename)
  await mkdir(dirname(absPath), { recursive: true })
  await writeFile(absPath, content, 'utf-8')
  return { savedTo: absPath }
}
```

Add `writeFile` and `dirname` to the imports at the top of `src/mcp.js`:

```js
import { resolve, basename, dirname } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
```

- [ ] **Step 2: Update `mdprobe_view` tool registration**

Replace the tool registration (lines 60-80) with:

```js
  server.registerTool('mdprobe_view', {
    description: 'Open content for human review in the browser. Call this BEFORE asking for feedback on any content >20 lines — findings, specs, plans, analysis, or any long output.',
    inputSchema: z.object({
      paths: z.array(z.string()).optional().describe('Paths to .md files (relative or absolute)'),
      content: z.string().optional().describe('Raw markdown content to save and open'),
      filename: z.string().optional().describe('Filename to save content to (required with content)'),
      open: z.boolean().optional().default(true).describe('Auto-open browser'),
    }),
  }, async (params) => {
    const validation = validateViewParams(params)
    if (validation.error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: validation.error }) }],
        isError: true,
      }
    }

    const srv = await getOrCreateServer()
    let resolved
    let savedTo

    if (validation.mode === 'content') {
      const result = await saveContentToFile(params.content, params.filename)
      savedTo = result.savedTo
      resolved = [savedTo]
    } else {
      resolved = params.paths.map(p => resolve(p))
    }

    srv.addFiles(resolved)

    const url = resolved.length === 1
      ? buildUrl(srv.port, urlStyle, basename(resolved[0]))
      : buildUrl(srv.port, urlStyle)
    if (params.open) await openBrowser(url).catch(() => {})

    const response = { url, files: resolved.map(p => basename(p)) }
    if (savedTo) response.savedTo = savedTo

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
    }
  })
```

Note: `urlStyle` is used from the closure in `startMcpServer()` — this is already the pattern.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/unit/mcp.test.js --reporter=verbose`
Expected: ALL PASS (both old and new tests)

- [ ] **Step 4: Commit**

```bash
git add src/mcp.js tests/unit/mcp.test.js
git commit -m "feat: add content parameter to mdprobe_view for one-step draft+review"
```

---

### Task 3: Tool description test

**Files:**
- Modify: `tests/unit/mcp.test.js`
- (Already done in implementation — verify description)

- [ ] **Step 1: Add tool description test**

Add to the `describe('mdprobe_view content parameter validation')` block:

```js
  it('tool description contains semantic review trigger', async () => {
    // Read mcp.js source and verify the description string
    const mcpSource = await readFile(join(__dirname, '../../src/mcp.js'), 'utf-8')
    expect(mcpSource).toContain('BEFORE asking for feedback')
    expect(mcpSource).toContain('findings, specs, plans, analysis')
  })
```

Add `__dirname` setup at the top of the test file (after imports), or use `import.meta.url`:

```js
import { fileURLToPath } from 'node:url'
const __dirname = join(fileURLToPath(import.meta.url), '..')
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/unit/mcp.test.js --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/mcp.test.js
git commit -m "test: add tool description semantic trigger validation"
```

---

### Task 4: Singleton `buildHash` — failing tests

**Files:**
- Modify: `tests/unit/singleton.test.js`

- [ ] **Step 1: Write failing tests for buildHash in singleton discovery**

Add a new `describe` block at the end of `tests/unit/singleton.test.js`:

```js
// ---------------------------------------------------------------------------
// buildHash stale server detection
// ---------------------------------------------------------------------------

describe('buildHash stale server detection', () => {
  let testServer

  afterEach(() => {
    if (testServer) {
      testServer.close()
      testServer = null
    }
  })

  it('rejects server with different buildHash', async () => {
    testServer = node_http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: 'mdprobe', pid: process.pid, buildHash: 'old-hash-abc' }))
      }
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    await writeLockFile({
      pid: process.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: new Date().toISOString(),
      buildHash: 'old-hash-abc',
    }, lockPath)

    // Pass a different buildHash as "current"
    const result = await discoverExistingServer(lockPath, 'new-hash-xyz')
    expect(result).toBeNull()
    // Lock file should be cleaned up
    expect(await readLockFile(lockPath)).toBeNull()
  })

  it('accepts server with matching buildHash', async () => {
    const hash = 'matching-hash-123'
    testServer = node_http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: 'mdprobe', pid: process.pid, buildHash: hash }))
      }
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    await writeLockFile({
      pid: process.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: new Date().toISOString(),
      buildHash: hash,
    }, lockPath)

    const result = await discoverExistingServer(lockPath, hash)
    expect(result).toEqual({
      url: `http://127.0.0.1:${port}`,
      port,
    })
  })

  it('rejects lock file missing buildHash (backward compat)', async () => {
    testServer = node_http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: 'mdprobe', pid: process.pid }))
      }
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    // Lock file WITHOUT buildHash (old format)
    await writeLockFile({
      pid: process.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: new Date().toISOString(),
    }, lockPath)

    const result = await discoverExistingServer(lockPath, 'current-hash')
    expect(result).toBeNull()
    expect(await readLockFile(lockPath)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/singleton.test.js --reporter=verbose`
Expected: FAIL — `discoverExistingServer` doesn't accept a `buildHash` parameter yet

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/singleton.test.js
git commit -m "test: add failing tests for singleton buildHash stale detection"
```

---

### Task 5: Singleton `buildHash` — implementation

**Files:**
- Modify: `src/singleton.js:96-118`
- Modify: `src/server.js:711-719`
- Modify: `src/mcp.js:30-36`

- [ ] **Step 1: Add `computeBuildHash` and update `discoverExistingServer`**

Add new imports and export to `src/singleton.js`. The file already imports `{ readFile, writeFile, unlink }` from `node:fs/promises` and `{ join }` from `node:path`. Update these imports:

```js
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import node_http from 'node:http'
import { fileURLToPath } from 'node:url'
import { hashContent } from './hash.js'

const __filename = fileURLToPath(import.meta.url)
const DIST_INDEX = join(dirname(__filename), '..', 'dist', 'index.html')
```

Then add `computeBuildHash` after the constants:

```js
/**
 * Compute a build hash from dist/index.html content.
 * Falls back to package version if dist doesn't exist (dev mode).
 * @returns {Promise<string>}
 */
export async function computeBuildHash() {
  try {
    const content = await readFile(DIST_INDEX, 'utf-8')
    return hashContent(content)
  } catch {
    try {
      const pkg = JSON.parse(await readFile(join(dirname(__filename), '..', 'package.json'), 'utf-8'))
      return `pkg:${pkg.version}`
    } catch {
      return 'unknown'
    }
  }
}
```

Update `discoverExistingServer` to accept and compare `buildHash` (replace lines 103-119):

```js
/**
 * Discover an existing running mdprobe server via lock file + HTTP verification.
 * Cleans up stale lock files automatically.
 * @param {string} [lockPath]
 * @param {string} [currentBuildHash] - If provided, reject servers with different buildHash
 * @returns {Promise<{url: string, port: number} | null>}
 */
export async function discoverExistingServer(lockPath = DEFAULT_LOCK_PATH, currentBuildHash) {
  const lock = await readLockFile(lockPath)
  if (!lock) return null

  // Reject lock files without buildHash when we have one (backward compat)
  if (currentBuildHash && !lock.buildHash) {
    await removeLockFile(lockPath)
    return null
  }

  // Reject lock files with different buildHash (stale server)
  if (currentBuildHash && lock.buildHash !== currentBuildHash) {
    await removeLockFile(lockPath)
    return null
  }

  if (!isProcessAlive(lock.pid)) {
    await removeLockFile(lockPath)
    return null
  }

  const { alive } = await pingServer(lock.url)
  if (!alive) {
    await removeLockFile(lockPath)
    return null
  }

  return { url: lock.url, port: lock.port }
}
```

- [ ] **Step 2: Update `/api/status` in `src/server.js`**

The `/api/status` handler is at line 711. It needs to include `buildHash`. Since `createServer` is a long function, the cleanest approach is to accept `buildHash` as an option and include it in the response.

Find the status handler in `src/server.js` (around line 711-719) and add `buildHash`:

```js
      // GET /api/status — identity check for singleton discovery
      if (req.method === 'GET' && pathname === '/api/status') {
        return sendJSON(res, 200, {
          identity: 'mdprobe',
          pid: process.pid,
          port,
          files: resolvedFiles.map(f => node_path.basename(f)),
          uptime: process.uptime(),
          buildHash: opts.buildHash || null,
        })
      }
```

- [ ] **Step 3: Update `getOrCreateServer` in `src/mcp.js` to pass buildHash**

Replace `getOrCreateServer` (lines 15-42) with:

```js
async function getOrCreateServer(port = 3000) {
  if (!httpServerPromise) {
    const buildHash = await computeBuildHash()

    const existing = await discoverExistingServer(undefined, buildHash)
    if (existing) {
      httpServerPromise = Promise.resolve({
        url: existing.url,
        port: existing.port,
        addFiles: (paths) => joinExistingServer(existing.url, paths),
        getFiles: () => [],
        broadcast: () => {},
        close: async () => {},
        _remote: true,
      })
    } else {
      httpServerPromise = createServer({ files: [], port, open: false, buildHash }).then(async (srv) => {
        await writeLockFile({
          pid: process.pid,
          port: srv.port,
          url: srv.url,
          startedAt: new Date().toISOString(),
          buildHash,
        })
        return srv
      })
    }
  }
  return httpServerPromise
}
```

Add `computeBuildHash` to the import from `singleton.js`:

```js
import { discoverExistingServer, joinExistingServer, writeLockFile, computeBuildHash } from './singleton.js'
```

- [ ] **Step 4: Run all singleton tests**

Run: `npx vitest run tests/unit/singleton.test.js --reporter=verbose`
Expected: ALL PASS

Note: existing tests that call `discoverExistingServer(lockPath)` without `buildHash` should still pass — the parameter is optional and defaults to `undefined`, which skips the hash check.

- [ ] **Step 5: Commit**

```bash
git add src/singleton.js src/server.js src/mcp.js tests/unit/singleton.test.js
git commit -m "feat: add buildHash to singleton protocol for stale server detection"
```

---

### Task 6: SKILL.md validation tests

**Files:**
- Create: `tests/unit/skill.test.js`

- [ ] **Step 1: Write SKILL.md validation tests**

Create `tests/unit/skill.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const SKILL_PATH = join(__dirname, '../../skills/mdprobe/SKILL.md')

describe('SKILL.md content validation', () => {
  let content

  // Load once
  it('loads SKILL.md', async () => {
    content = await readFile(SKILL_PATH, 'utf-8')
    expect(content).toBeTruthy()
  })

  it('frontmatter description contains BEFORE trigger', () => {
    // Frontmatter is between the first two --- lines
    const frontmatter = content.split('---')[1]
    expect(frontmatter).toContain('BEFORE')
    expect(frontmatter).toMatch(/feedback|review/i)
  })

  it('contains anti-pattern section', () => {
    expect(content).toMatch(/anti.?pattern/i)
    expect(content).toContain('NEVER present')
  })

  it('contains decision rule for >20 lines', () => {
    expect(content).toMatch(/>\s*20\s*lines/i)
    expect(content).toMatch(/mdprobe_view/i)
  })

  it('contains Rule 8 for content parameter', () => {
    expect(content).toContain('Rule 8')
    expect(content).toContain('content')
    expect(content).toMatch(/format.*markdown/i)
  })

  it('covers all content types, not just .md files', () => {
    expect(content).toMatch(/findings|analysis|validation/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/skill.test.js --reporter=verbose`
Expected: FAIL — SKILL.md doesn't contain anti-pattern section, BEFORE trigger, etc.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/skill.test.js
git commit -m "test: add SKILL.md content validation tests"
```

---

### Task 7: SKILL.md — rewrite

**Files:**
- Modify: `skills/mdprobe/SKILL.md`

- [ ] **Step 1: Rewrite frontmatter**

Replace lines 1-6 of `skills/mdprobe/SKILL.md`:

```yaml
---
name: mdProbe
description: Human review tool for any content >20 lines. BEFORE asking for
  feedback on findings, specs, plans, analysis, or any long output, save to
  file and open with mdprobe_view. Renders markdown with annotations, section
  approval, and structured feedback via YAML sidecars.
---
```

- [ ] **Step 2: Update "When to Use" section**

Replace lines 10-16:

```markdown
## When to Use

- ANY content >20 lines that needs human review (findings, specs, plans, analysis, validation lists)
- Generating, editing, or referencing `.md` files
- Tables, Mermaid diagrams, math/LaTeX, syntax-highlighted code
- Human needs to **review and annotate** before you proceed
- You need **section-level approval** (approved/rejected per heading)
```

- [ ] **Step 3: Add anti-pattern section after "When NOT to Use"**

Insert after line 23 (after "When NOT to Use" section, before the `---`):

```markdown

## Anti-pattern: Inline Review

**NEVER present content >20 lines inline in conversation for human review.**

This includes specs, findings, plans, analysis, validation lists — any long output
that the human needs to read and evaluate. Terminal scrolling is bad UX: no annotations,
no section approval, no rendered tables/diagrams.

**Decision rule:**
- Content >20 lines AND purpose is review/feedback?
  → Format as markdown → `mdprobe_view({ content, filename })` → wait for feedback
- Content <20 lines OR purely informational (no review needed)?
  → Show inline in conversation

If you catch yourself pasting a long code block, spec, or findings list in the
conversation and asking "what do you think?" — STOP. Save it to a file and use mdProbe.
```

- [ ] **Step 4: Update MCP Tools table**

Replace the `mdprobe_view` row in the MCP Tools table to reflect new params:

```markdown
| `mdprobe_view` | `{ paths?, content?, filename?, open? }` | `{ url, files, savedTo? }` | Open content in browser for human review |
```

- [ ] **Step 5: Add Rule 8 after Rule 7**

Insert before the `---` that precedes "Review Workflow":

```markdown

### Rule 8 — Draft and review in one step

When you have ANY content >20 lines that needs human review, use the `content`
parameter instead of presenting it inline in the conversation:

> mdprobe_view({ content: "# Analysis\n\n| Finding | Severity |\n...", filename: "analysis.md", open: true })

This saves the file AND opens it for review in one call.
Format the content as markdown for best rendering (headings, lists, tables, code blocks).
You generate the content, so you control the format — there's no parser limitation.
```

- [ ] **Step 6: Run SKILL.md validation tests**

Run: `npx vitest run tests/unit/skill.test.js --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS (590+ existing + ~15 new tests)

- [ ] **Step 8: Commit**

```bash
git add skills/mdprobe/SKILL.md tests/unit/skill.test.js
git commit -m "feat: rewrite SKILL.md with anti-pattern, decision rule, and content parameter"
```

---

### Task 8: Full verification and final commit

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS — no regressions

- [ ] **Step 2: Check for lint/format issues**

Run: `npx vitest run 2>&1 | tail -5`
Expected: Clean output, all tests pass

- [ ] **Step 3: Verify git status**

Run: `git status && git diff --stat`
Expected: Clean working tree (all changes committed in tasks 1-7)

- [ ] **Step 4: Push to remote**

```bash
git push origin feat/mcp-integration
```

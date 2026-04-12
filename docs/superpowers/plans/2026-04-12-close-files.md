# Close Files Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to close/remove files from the singleton server via a "×" button in the file list UI.

**Architecture:** New `DELETE /api/remove-file` endpoint removes the file from `resolvedFiles`, unwatches it from chokidar, and broadcasts `file-removed` via WebSocket. Frontend adds a close button per file item. Re-opening happens naturally when `addFiles` is called again (e.g., via MCP `mdprobe_view`).

**Tech Stack:** Node.js HTTP server, Preact + Signals, chokidar, Vitest (TDD)

---

### Task 1: Backend — `removeFile` function and `DELETE /api/remove-file` endpoint

**Files:**
- Modify: `src/server.js:374-384` (add `removeFilesFn` next to `addFilesFn`)
- Modify: `src/server.js:448-477` (expose `removeFile` on serverObj)
- Modify: `src/server.js:767-782` (add endpoint after `/api/add-files`)
- Test: `tests/integration/singleton.test.js`

- [ ] **Step 1: Write failing tests for DELETE /api/remove-file**

Add an `httpDelete` helper and a new describe block in `tests/integration/singleton.test.js`:

```javascript
function httpDelete(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const parsed = new URL(url)
    const req = node_http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let resBody = ''
      res.on('data', (chunk) => { resBody += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: resBody }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
```

Then add the test block:

```javascript
// ---------------------------------------------------------------------------
// DELETE /api/remove-file endpoint
// ---------------------------------------------------------------------------

describe('DELETE /api/remove-file', () => {
  it('removes a file from the server', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 0,
      open: false,
    }))

    const res = await httpDelete(`${server.url}/api/remove-file`, { file: 'rfc.md' })
    expect(res.status).toBe(200)

    const json = JSON.parse(res.body)
    expect(json.ok).toBe(true)
    expect(json.files).toContain('spec.md')
    expect(json.files).not.toContain('rfc.md')
  })

  it('returns 404 for unknown file', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 0,
      open: false,
    }))

    const res = await httpDelete(`${server.url}/api/remove-file`, { file: 'nope.md' })
    expect(res.status).toBe(404)
  })

  it('returns 400 when trying to remove the last file', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 0,
      open: false,
    }))

    const res = await httpDelete(`${server.url}/api/remove-file`, { file: 'spec.md' })
    expect(res.status).toBe(400)

    const json = JSON.parse(res.body)
    expect(json.error).toMatch(/last file/i)
  })

  it('removed file disappears from /api/files', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 0,
      open: false,
    }))

    await httpDelete(`${server.url}/api/remove-file`, { file: 'rfc.md' })

    const filesRes = await httpGet(`${server.url}/api/files`)
    const filesList = JSON.parse(filesRes.body)
    const names = filesList.map(f => f.path)
    expect(names).toContain('spec.md')
    expect(names).not.toContain('rfc.md')
  })

  it('removed file can be re-added via /api/add-files', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 0,
      open: false,
    }))

    await httpDelete(`${server.url}/api/remove-file`, { file: 'rfc.md' })
    const addRes = await httpPost(`${server.url}/api/add-files`, { files: [rfcPath] })
    const json = JSON.parse(addRes.body)
    expect(json.ok).toBe(true)
    expect(json.files).toContain('rfc.md')
    expect(json.added).toContain('rfc.md')
  })

  it('returns 400 for missing file field', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 0,
      open: false,
    }))

    const res = await httpDelete(`${server.url}/api/remove-file`, {})
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/singleton.test.js --reporter=verbose`
Expected: All new tests FAIL (404 — endpoint doesn't exist)

- [ ] **Step 3: Implement removeFile function in server.js**

In `src/server.js`, after the `addFilesFn` assignment (line ~384), add `removeFileFn`:

```javascript
  let removeFileFn = () => {}
  removeFileFn = (basename) => {
    const idx = resolvedFiles.findIndex(f => node_path.basename(f) === basename)
    if (idx === -1) return { found: false }
    if (resolvedFiles.length <= 1) return { lastFile: true }

    const absPath = resolvedFiles[idx]
    resolvedFiles.splice(idx, 1)

    // Clear any pending debounce timer for this file
    for (const [timerPath, timer] of debounceTimers.entries()) {
      if (node_path.basename(timerPath) === basename) {
        clearTimeout(timer)
        debounceTimers.delete(timerPath)
      }
    }

    // Unwatch directory if no other files reference it
    const dir = node_path.dirname(absPath)
    const dirStillNeeded = resolvedFiles.some(f => node_path.dirname(f) === dir)
    if (!dirStillNeeded) {
      watcher.unwatch(dir)
    }

    broadcastToAll({ type: 'file-removed', file: basename })
    return { found: true, removed: basename }
  }
```

Expose on the server object (inside `serverObj`, after `broadcast`):

```javascript
    removeFile: (basename) => removeFileFn(basename),
```

- [ ] **Step 4: Add the DELETE /api/remove-file endpoint**

In `src/server.js`, inside `createRequestHandler`, add `removeFile` to the destructured params:

```javascript
function createRequestHandler({ resolvedFiles, assetBaseDir, once, author, port, buildHash, getOnFinish, broadcast, addFiles, removeFile }) {
```

Then add the endpoint after the `POST /api/add-files` block (after line ~782):

```javascript
      // DELETE /api/remove-file — remove a file from the server
      if (req.method === 'DELETE' && pathname === '/api/remove-file') {
        const body = await readBody(req)
        const { file } = body
        if (!file || typeof file !== 'string') {
          return sendJSON(res, 400, { error: 'Missing or invalid file field' })
        }
        const result = removeFile(file)
        if (result.lastFile) {
          return sendJSON(res, 400, { error: 'Cannot remove the last file' })
        }
        if (!result.found) {
          return sendJSON(res, 404, { error: `File not found: ${file}` })
        }
        return sendJSON(res, 200, {
          ok: true,
          files: resolvedFiles.map(f => node_path.basename(f)),
        })
      }
```

Wire `removeFile` into the `createRequestHandler` call (line ~297):

```javascript
    removeFile: (basename) => removeFileFn(basename),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/singleton.test.js --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server.js tests/integration/singleton.test.js
git commit -m "feat: add DELETE /api/remove-file endpoint for closing files"
```

---

### Task 2: Frontend — Close button in LeftPanel

**Files:**
- Modify: `src/ui/components/LeftPanel.jsx:46-65`
- Modify: `src/ui/styles/themes.css:777-809`

- [ ] **Step 1: Add close button to file items in LeftPanel.jsx**

Replace the file list map block in `src/ui/components/LeftPanel.jsx` (lines 46-65):

```jsx
          {/* Files section */}
          {files.value.length > 1 && (
            <div class="file-list-section">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); padding: 4px 4px 6px; font-weight: 600">Files</div>
              {files.value.map(f => {
                const path = f.path || f
                const label = f.label || path.replace('.md', '')
                const isActive = path === currentFile.value
                return (
                  <div
                    key={path}
                    class={`file-item ${isActive ? 'active' : ''}`}
                    onClick={() => onFileSelect(path)}
                  >
                    <span class="icon">{'\uD83D\uDCC4'}</span>
                    <span class="file-label">{label}</span>
                    {files.value.length > 1 && (
                      <button
                        class="file-close-btn"
                        title="Close file"
                        onClick={(e) => {
                          e.stopPropagation()
                          onFileClose(path)
                        }}
                      >&times;</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
```

Update the component signature to accept `onFileClose`:

```jsx
export function LeftPanel({ onFileSelect, onFileClose }) {
```

- [ ] **Step 2: Add CSS for the close button**

In `src/ui/styles/themes.css`, after `.file-item .name` block (after line 809), add:

```css
.file-close-btn {
  display: none;
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

.file-close-btn:hover {
  color: var(--text-primary);
  background: var(--bg-secondary);
}

.file-item:hover .file-close-btn {
  display: block;
}
```

- [ ] **Step 3: Wire up onFileClose in App.jsx**

In `src/ui/app.jsx`, add `handleFileClose` after `handleFileSelect` (after line 80):

```javascript
  async function handleFileClose(filePath) {
    await fetch('/api/remove-file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath }),
    })
    // If we closed the active file, switch to the first remaining file
    if (currentFile.value === filePath) {
      const remaining = files.value.filter(f => (f.path || f) !== filePath)
      if (remaining.length > 0) {
        handleFileSelect(remaining[0].path || remaining[0])
      }
    }
  }
```

Pass it to `LeftPanel`:

```jsx
      <LeftPanel onFileSelect={handleFileSelect} onFileClose={handleFileClose} />
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests PASS (no regressions)

- [ ] **Step 5: Manual test**

Run: `node bin/cli.js tests/fixtures/*.md` (or any two .md files)
- Verify close button appears on hover for each file item
- Verify clicking "×" removes the file from the list
- Verify closing the active file switches to another file
- Verify the close button does NOT appear when only 1 file remains

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/LeftPanel.jsx src/ui/styles/themes.css src/ui/app.jsx
git commit -m "feat: add close button to file list items"
```

---

### Task 3: Integration test — close + re-add via addFiles

**Files:**
- Modify: `tests/integration/singleton.test.js`

- [ ] **Step 1: Add WebSocket broadcast test for file-removed on close**

Add inside the `DELETE /api/remove-file` describe block:

```javascript
  it('broadcasts file-removed via WebSocket', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 0,
      open: false,
    }))

    // Connect WebSocket
    const ws = await new Promise((resolve) => {
      const { WebSocket } = await import('ws')
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`)
      socket.on('open', () => resolve(socket))
    })

    const msgPromise = new Promise((resolve) => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())))
    })

    await httpDelete(`${server.url}/api/remove-file`, { file: 'rfc.md' })

    const msg = await msgPromise
    expect(msg.type).toBe('file-removed')
    expect(msg.file).toBe('rfc.md')

    ws.close()
  })
```

Note: this test requires `ws` package which is already a dependency (used by WebSocketServer in server.js). The import must be dynamic because vitest may have issues with static ws imports in integration tests. If the test framework has a different pattern for WS testing in the existing live-reload tests, follow that pattern instead.

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/integration/singleton.test.js --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/singleton.test.js
git commit -m "test: add WebSocket broadcast test for file removal"
```

---

### Task 4: Build verification and final manual test

- [ ] **Step 1: Run production build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Manual end-to-end test**

1. Open two .md files: `node bin/cli.js README.md package.json` (or any two .md files in the project)
2. Verify both files appear in the left panel
3. Hover over a file → close button appears
4. Click "×" → file is removed
5. Only one file remains → no close button visible
6. (If MCP is available) Call `mdprobe_view` with the removed file → it reappears

- [ ] **Step 4: Commit any fixes if needed**

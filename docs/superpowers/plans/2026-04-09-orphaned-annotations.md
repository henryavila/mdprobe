# Orphaned Annotation Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When drift is detected, classify each annotation as found or orphaned and show orphaned annotations in a separate collapsible section in the right panel.

**Architecture:** Server-side `reanchorAll()` runs automatically on drift detection and returns per-annotation status in the API response. Frontend splits annotations into two groups: anchored (rendered normally) and orphaned (collapsible section at bottom of right panel). No data is persisted — anchor status is transient.

**Tech Stack:** Node.js server, Preact + Signals frontend, Vitest for testing

---

### Task 1: Server — include anchorStatus in API response on drift

**Files:**
- Modify: `src/server.js:531-535` (drift detection block in GET /api/annotations)
- Test: `tests/integration/drift-banner-layout.test.js` (extend existing)

- [ ] **Step 1: Write failing test — drift response includes anchorStatus with orphan**

Add to `tests/integration/drift-banner-layout.test.js`:

```javascript
it('drift response includes anchorStatus with orphan when annotated text is deleted', async () => {
  // Create server with file containing known text
  const mdPath = await writeFixture('orphan.md', '# Orphan Test\n\nThis exact text will be annotated.\n\nAnother paragraph.\n')
  const server = track(await createServer({
    files: [mdPath],
    port: 5210,
    open: false,
  }))

  // Add annotation on "This exact text will be annotated."
  const addRes = await httpRequest(`${server.url}/api/annotations`, 'POST', {
    file: 'orphan.md',
    action: 'add',
    data: {
      selectors: {
        position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 40 },
        quote: { exact: 'This exact text will be annotated.', prefix: '', suffix: '' },
      },
      comment: 'Test',
      tag: 'bug',
      author: 'Tester',
    },
  })
  expect(addRes.status).toBe(200)
  const annotationId = addRes.json().annotations[0].id

  // Delete the annotated text entirely
  await node_fs.writeFile(mdPath, '# Orphan Test\n\nCompletely different content now.\n\nAnother paragraph.\n', 'utf-8')
  await new Promise(r => setTimeout(r, 300))

  // Fetch annotations — drift should include anchorStatus
  const annRes = await httpRequest(`${server.url}/api/annotations?path=orphan.md`)
  const data = annRes.json()

  expect(data.drift).toBeTruthy()
  expect(typeof data.drift).toBe('object')
  expect(data.drift.anchorStatus).toBeDefined()
  expect(data.drift.anchorStatus[annotationId]).toBe('orphan')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/drift-banner-layout.test.js -t "anchorStatus"`
Expected: FAIL — `data.drift` is `true` (boolean), not an object

- [ ] **Step 3: Write failing test — drift with all annotations re-anchored**

Add to the same file:

```javascript
it('drift response shows anchored status when text is moved but still present', async () => {
  const mdPath = await writeFixture('moved.md', '# Moved Test\n\nOriginal text here.\n')
  const server = track(await createServer({
    files: [mdPath],
    port: 5211,
    open: false,
  }))

  const addRes = await httpRequest(`${server.url}/api/annotations`, 'POST', {
    file: 'moved.md',
    action: 'add',
    data: {
      selectors: {
        position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 20 },
        quote: { exact: 'Original text here.', prefix: '', suffix: '' },
      },
      comment: 'Test',
      tag: 'question',
      author: 'Tester',
    },
  })
  expect(addRes.status).toBe(200)
  const annotationId = addRes.json().annotations[0].id

  // Move text — add lines before it (text still present, different position)
  await node_fs.writeFile(mdPath, '# Moved Test\n\nNew line 1.\n\nNew line 2.\n\nOriginal text here.\n', 'utf-8')
  await new Promise(r => setTimeout(r, 300))

  const annRes = await httpRequest(`${server.url}/api/annotations?path=moved.md`)
  const data = annRes.json()

  expect(data.drift).toBeTruthy()
  expect(typeof data.drift).toBe('object')
  expect(data.drift.anchorStatus[annotationId]).toBe('anchored')
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/integration/drift-banner-layout.test.js -t "anchored status"`
Expected: FAIL — same reason

- [ ] **Step 5: Implement — server returns anchorStatus on drift**

In `src/server.js`, add the import at the top (line 1 area):

```javascript
import { reanchorAll } from './anchoring.js'
```

Replace lines 531-535:

```javascript
          // Check for drift
          try {
            const drift = await detectDrift(sidecarPath, match)
            if (drift.drifted) json.drift = true
          } catch { /* no drift info available */ }
```

With:

```javascript
          // Check for drift and re-anchor annotations
          try {
            const drift = await detectDrift(sidecarPath, match)
            if (drift.drifted) {
              const content = await node_fs.readFile(match, 'utf8')
              const anchorResults = reanchorAll(json.annotations, content)
              json.drift = {
                anchorStatus: Object.fromEntries(
                  [...anchorResults].map(([id, r]) => [id, r.status === 'orphan' ? 'orphan' : 'anchored'])
                )
              }
            }
          } catch { /* no drift info available */ }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/integration/drift-banner-layout.test.js`
Expected: ALL PASS (new tests + existing tests — existing tests check `data.drift` is truthy, which an object satisfies)

- [ ] **Step 7: Commit**

```bash
git add src/server.js tests/integration/drift-banner-layout.test.js
git commit -m "feat(server): return per-annotation anchorStatus on drift detection (#3)"
```

---

### Task 2: Store — anchorStatus signal and computed splits

**Files:**
- Modify: `src/ui/state/store.js:24` (after driftWarning signal)
- Test: `tests/unit/store.test.js` (create)

- [ ] **Step 1: Write failing test for anchorStatus signal and computed splits**

Create `tests/unit/store.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'

// Signals are singletons — import and mutate directly
import {
  annotations, anchorStatus,
  orphanedAnnotations, anchoredAnnotations,
  showResolved, filterTag, filterAuthor,
} from '../../src/ui/state/store.js'

describe('anchorStatus store signals', () => {
  beforeEach(() => {
    annotations.value = []
    anchorStatus.value = {}
    showResolved.value = false
    filterTag.value = null
    filterAuthor.value = null
  })

  it('orphanedAnnotations filters by orphan status', () => {
    annotations.value = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'x', comment: 'c1' },
      { id: 'a2', status: 'open', tag: 'question', author: 'x', comment: 'c2' },
      { id: 'a3', status: 'open', tag: 'suggestion', author: 'x', comment: 'c3' },
    ]
    anchorStatus.value = { a1: 'anchored', a2: 'orphan', a3: 'anchored' }

    expect(orphanedAnnotations.value).toHaveLength(1)
    expect(orphanedAnnotations.value[0].id).toBe('a2')
  })

  it('anchoredAnnotations excludes orphans', () => {
    annotations.value = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'x', comment: 'c1' },
      { id: 'a2', status: 'open', tag: 'bug', author: 'x', comment: 'c2' },
    ]
    anchorStatus.value = { a1: 'orphan', a2: 'anchored' }

    expect(anchoredAnnotations.value).toHaveLength(1)
    expect(anchoredAnnotations.value[0].id).toBe('a2')
  })

  it('annotations not in anchorStatus map are treated as anchored', () => {
    annotations.value = [
      { id: 'new1', status: 'open', tag: 'bug', author: 'x', comment: 'c1' },
    ]
    anchorStatus.value = {}  // empty — no drift

    expect(anchoredAnnotations.value).toHaveLength(1)
    expect(orphanedAnnotations.value).toHaveLength(0)
  })

  it('empty anchorStatus means no orphans', () => {
    annotations.value = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'x', comment: 'c1' },
    ]
    anchorStatus.value = {}

    expect(orphanedAnnotations.value).toHaveLength(0)
    expect(anchoredAnnotations.value).toHaveLength(1)
  })

  it('respects existing filters (tag, author, showResolved)', () => {
    annotations.value = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'alice', comment: 'c1' },
      { id: 'a2', status: 'resolved', tag: 'bug', author: 'alice', comment: 'c2' },
      { id: 'a3', status: 'open', tag: 'question', author: 'bob', comment: 'c3' },
    ]
    anchorStatus.value = { a1: 'orphan', a2: 'orphan', a3: 'anchored' }
    showResolved.value = false  // a2 filtered out

    // a1 is orphan + open, a2 is orphan but resolved (filtered out)
    expect(orphanedAnnotations.value).toHaveLength(1)
    expect(orphanedAnnotations.value[0].id).toBe('a1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/store.test.js`
Expected: FAIL — `anchorStatus`, `orphanedAnnotations`, `anchoredAnnotations` not exported

- [ ] **Step 3: Implement — add signals to store**

In `src/ui/state/store.js`, add after line 24 (`export const driftWarning = signal(false)`):

```javascript
export const anchorStatus = signal({})  // Map<annotationId, 'anchored'|'orphan'>
```

Add after line 56 (after `filteredAnnotations` computed):

```javascript
export const orphanedAnnotations = computed(() =>
  filteredAnnotations.value.filter(a => anchorStatus.value[a.id] === 'orphan')
)

export const anchoredAnnotations = computed(() =>
  filteredAnnotations.value.filter(a => anchorStatus.value[a.id] !== 'orphan')
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/store.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/state/store.js tests/unit/store.test.js
git commit -m "feat(store): add anchorStatus signal with orphaned/anchored computed splits (#3)"
```

---

### Task 3: Frontend hooks — parse drift response and populate anchorStatus

**Files:**
- Modify: `src/ui/hooks/useAnnotations.js:1,27` (import + fetch handler)
- Modify: `src/ui/hooks/useWebSocket.js:9,85-87` (import + drift handler)

- [ ] **Step 1: Update useAnnotations to parse drift object**

In `src/ui/hooks/useAnnotations.js`, update line 1 import:

```javascript
import { annotations, sections, currentFile, author, driftWarning, sectionLevel, anchorStatus } from '../state/store.js'
```

Replace line 27:

```javascript
    driftWarning.value = data.drift || false
```

With:

```javascript
    driftWarning.value = data.drift || false
    if (data.drift && typeof data.drift === 'object') {
      anchorStatus.value = data.drift.anchorStatus || {}
    } else {
      anchorStatus.value = {}
    }
```

- [ ] **Step 2: Update useWebSocket to handle anchorStatus in drift messages**

In `src/ui/hooks/useWebSocket.js`, update line 9 import to add `anchorStatus`:

```javascript
import {
  currentHtml,
  currentToc,
  currentFile,
  files,
  annotations,
  sections,
  driftWarning,
  anchorStatus,
} from '../state/store.js'
```

Replace lines 85-87:

```javascript
        case 'drift':
          driftWarning.value = msg.warning || true
          break
```

With:

```javascript
        case 'drift':
          driftWarning.value = msg.warning || true
          if (msg.anchorStatus) {
            anchorStatus.value = msg.anchorStatus
          }
          break
```

- [ ] **Step 3: Run all existing tests to verify nothing breaks**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/ui/hooks/useAnnotations.js src/ui/hooks/useWebSocket.js
git commit -m "feat(hooks): parse anchorStatus from drift response and WebSocket (#3)"
```

---

### Task 4: Banner — show orphan count instead of generic message

**Files:**
- Modify: `src/ui/app.jsx:9,105-111` (import + banner)

- [ ] **Step 1: Update banner to show orphan count**

In `src/ui/app.jsx`, update line 9 import to add `orphanedAnnotations`:

```javascript
import { files, currentFile, currentHtml, currentToc, author, reviewMode,
         leftPanelOpen, rightPanelOpen, openAnnotations, sectionStats, driftWarning,
         orphanedAnnotations } from './state/store.js'
```

Replace lines 105-111:

```javascript
      {/* Drift warning banner */}
      {driftWarning.value && (
        <div class="drift-banner">
          Arquivo modificado desde a ultima revisao. Algumas anotacoes podem estar desalinhadas.
          <button class="btn btn-sm" style="margin-left: 8px" onClick={() => driftWarning.value = false}>Dismiss</button>
        </div>
      )}
```

With:

```javascript
      {/* Drift warning banner */}
      {driftWarning.value && (
        <div class="drift-banner">
          {orphanedAnnotations.value.length > 0
            ? `Arquivo modificado — ${orphanedAnnotations.value.length} anotação(ões) não encontrada(s)`
            : 'Arquivo modificado desde a ultima revisao. Algumas anotacoes podem estar desalinhadas.'}
          <button class="btn btn-sm" style="margin-left: 8px" onClick={() => driftWarning.value = false}>Dismiss</button>
        </div>
      )}
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/ui/app.jsx
git commit -m "feat(banner): show orphan count when drift is detected (#3)"
```

---

### Task 5: RightPanel — split list and add orphaned section

**Files:**
- Modify: `src/ui/components/RightPanel.jsx:2,66-141` (imports + list split)

- [ ] **Step 1: Update RightPanel to split annotations and render orphaned section**

In `src/ui/components/RightPanel.jsx`, update line 2 imports:

```javascript
import { rightPanelOpen, filteredAnnotations, selectedAnnotationId, showResolved,
         filterTag, filterAuthor, uniqueTags, uniqueAuthors, openAnnotations,
         anchoredAnnotations, orphanedAnnotations, anchorStatus } from '../state/store.js'
```

Replace lines 66-141 (the annotation list `<div>` with overflow-y):

```javascript
          {/* Annotation list */}
          <div style="overflow-y: auto; padding: 0 8px; flex: 1">
            {anchoredAnnotations.value.length === 0 && orphanedAnnotations.value.length === 0 ? (
              <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px">
                No annotations
              </div>
            ) : (
              <>
                {anchoredAnnotations.value.length === 0 && filteredAnnotations.value.length > 0 ? (
                  <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px">
                    No annotations
                  </div>
                ) : (
                  anchoredAnnotations.value.map(ann => (
                    <AnnotationCard
                      key={ann.id}
                      ann={ann}
                      isSelected={selectedAnnotationId.value === ann.id}
                      onClick={() => handleAnnotationClick(ann)}
                      annotationOps={annotationOps}
                      editingId={editingId}
                      setEditingId={setEditingId}
                    />
                  ))
                )}

                {orphanedAnnotations.value.length > 0 && (
                  <OrphanedSection
                    annotations={orphanedAnnotations.value}
                    selectedAnnotationId={selectedAnnotationId.value}
                    onSelect={(ann) => { selectedAnnotationId.value = ann.id }}
                    annotationOps={annotationOps}
                    editingId={editingId}
                    setEditingId={setEditingId}
                  />
                )}
              </>
            )}
          </div>
```

Extract the annotation card into a reusable function. Add these components before the `ReplyInput` function at the bottom of the file:

```javascript
function AnnotationCard({ ann, isSelected, onClick, annotationOps, editingId, setEditingId, orphaned = false }) {
  return (
    <div
      data-annotation-id={ann.id}
      class={`annotation-card ${isSelected ? 'selected' : ''} ${ann.status === 'resolved' ? 'resolved' : ''} ${orphaned ? 'orphaned' : ''}`}
      onClick={onClick}
    >
      {/* Tag + Author + Status */}
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px">
        <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
        <span style="font-size: 11px; color: var(--text-muted)">{ann.author}</span>
        {ann.status === 'resolved' && <span style="font-size: 10px; color: var(--status-approved)">✓ resolved</span>}
        {orphaned && <span style="font-size: 10px; color: var(--tag-bug)">não encontrada</span>}
      </div>

      {/* Quote */}
      {ann.selectors?.quote?.exact && (
        <div class="quote">{ann.selectors.quote.exact}</div>
      )}

      {/* Comment */}
      <div style="font-size: 13px; margin-top: 4px">{ann.comment}</div>

      {/* Actions (when selected) */}
      {isSelected && (
        <div style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap">
          {ann.status === 'open' ? (
            <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); annotationOps.resolveAnnotation(ann.id) }}>
              Resolve
            </button>
          ) : (
            <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); annotationOps.reopenAnnotation(ann.id) }}>
              Reopen
            </button>
          )}
          <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); setEditingId(ann.id) }}>
            Edit
          </button>
          <button class="btn btn-sm btn-danger" onClick={(e) => {
            e.stopPropagation()
            if (confirm('Delete this annotation?')) annotationOps.deleteAnnotation(ann.id)
          }}>
            Delete
          </button>
        </div>
      )}

      {/* Edit form */}
      {editingId === ann.id && (
        <AnnotationForm
          annotation={ann}
          onSave={(data) => {
            annotationOps.updateAnnotation(ann.id, data)
            setEditingId(null)
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {/* Replies */}
      {ann.replies?.length > 0 && (
        <ReplyThread replies={ann.replies} />
      )}

      {/* Reply input (when selected) */}
      {isSelected && (
        <ReplyInput annotationId={ann.id} onReply={annotationOps.addReply} />
      )}
    </div>
  )
}

function OrphanedSection({ annotations, selectedAnnotationId, onSelect, annotationOps, editingId, setEditingId }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div class="orphaned-section">
      <div class="orphaned-section-header" onClick={() => setCollapsed(c => !c)}>
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>Não encontradas ({annotations.length})</span>
      </div>
      {!collapsed && annotations.map(ann => (
        <AnnotationCard
          key={ann.id}
          ann={ann}
          isSelected={selectedAnnotationId === ann.id}
          onClick={() => onSelect(ann)}
          annotationOps={annotationOps}
          editingId={editingId}
          setEditingId={setEditingId}
          orphaned
        />
      ))}
    </div>
  )
}
```

Note: `handleAnnotationClick` in the main component scrolls to the highlight. Orphaned cards call `onSelect` directly (just sets `selectedAnnotationId`) without scrolling — there's no highlight to scroll to.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/RightPanel.jsx
git commit -m "feat(panel): split annotations list with collapsible orphaned section (#3)"
```

---

### Task 6: CSS — orphaned annotation styles

**Files:**
- Modify: `src/ui/styles/themes.css:1141` (after drift-banner styles)

- [ ] **Step 1: Add CSS for orphaned section and cards**

In `src/ui/styles/themes.css`, add after line 1141 (after `.drift-banner .dismiss:hover`):

```css

/* --------------------------------------------------------------------------
   Orphaned annotations section
   -------------------------------------------------------------------------- */
.orphaned-section {
  border-top: 1px solid var(--border);
  padding-top: 8px;
  margin-top: 8px;
}

.orphaned-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 6px 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--tag-bug);
}

.orphaned-section-header:hover {
  opacity: 0.8;
}

.annotation-card.orphaned {
  opacity: 0.65;
  border-left-color: var(--tag-bug);
  border-left-style: dashed;
}

.annotation-card.orphaned .quote {
  text-decoration: line-through;
}
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles/themes.css
git commit -m "feat(css): add orphaned annotation styles (#3)"
```

---

### Task 7: Server WebSocket — broadcast anchorStatus on file change

**Files:**
- Modify: `src/server.js:384-402` (watcher change handler)

- [ ] **Step 1: Write failing test — WebSocket drift message includes anchorStatus**

Add to `tests/integration/drift-banner-layout.test.js`:

```javascript
it('WebSocket broadcasts drift with anchorStatus when file changes', async () => {
  const mdPath = await writeFixture('ws-drift.md', '# WS Test\n\nAnnotated text here.\n')
  const server = track(await createServer({
    files: [mdPath],
    port: 5212,
    open: false,
  }))

  // Add annotation
  await httpRequest(`${server.url}/api/annotations`, 'POST', {
    file: 'ws-drift.md',
    action: 'add',
    data: {
      selectors: {
        position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 22 },
        quote: { exact: 'Annotated text here.', prefix: '', suffix: '' },
      },
      comment: 'WS test',
      tag: 'bug',
      author: 'Tester',
    },
  })

  // Connect WebSocket and listen for drift message
  const WebSocket = (await import('ws')).default
  const ws = new WebSocket(`ws://127.0.0.1:5212/ws`)
  const messages = []

  await new Promise((resolve) => { ws.on('open', resolve) })
  ws.on('message', (data) => { messages.push(JSON.parse(data.toString())) })

  // Modify file — delete annotated text to create orphan
  await node_fs.writeFile(mdPath, '# WS Test\n\nTotally different content.\n', 'utf-8')

  // Wait for debounce + processing
  await new Promise(r => setTimeout(r, 500))

  ws.close()

  // Find drift message
  const driftMsg = messages.find(m => m.type === 'drift')
  expect(driftMsg).toBeDefined()
  expect(driftMsg.anchorStatus).toBeDefined()
  // The annotation's text was deleted → orphan
  const statuses = Object.values(driftMsg.anchorStatus)
  expect(statuses).toContain('orphan')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/drift-banner-layout.test.js -t "WebSocket broadcasts"`
Expected: FAIL — no drift message sent over WebSocket

- [ ] **Step 3: Implement — add drift broadcast to file watcher**

In `src/server.js`, update the watcher change handler (lines 384-402). After the `broadcastToAll({ type: 'update' ... })` call, add drift detection:

```javascript
    debounceTimers.set(filePath, setTimeout(async () => {
      debounceTimers.delete(filePath)
      try {
        const content = await node_fs.readFile(filePath, 'utf-8')
        const rendered = render(content)
        broadcastToAll({
          type: 'update',
          file: fileName,
          html: rendered.html,
          toc: rendered.toc,
        })

        // Check for drift and broadcast anchor status
        const sidecarPath = filePath.replace(/\.md$/, '.annotations.yaml')
        try {
          const drift = await detectDrift(sidecarPath, filePath)
          if (drift.drifted) {
            const af = await AnnotationFile.load(sidecarPath)
            const anns = af.toJSON().annotations
            const anchorResults = reanchorAll(anns, content)
            broadcastToAll({
              type: 'drift',
              warning: true,
              file: fileName,
              anchorStatus: Object.fromEntries(
                [...anchorResults].map(([id, r]) => [id, r.status === 'orphan' ? 'orphan' : 'anchored'])
              ),
            })
          }
        } catch { /* no sidecar or drift check failed — skip */ }
      } catch (err) {
        broadcastToAll({
          type: 'error',
          file: fileName,
          message: err.message,
        })
      }
    }, 100))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/drift-banner-layout.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.js tests/integration/drift-banner-layout.test.js
git commit -m "feat(server): broadcast drift with anchorStatus over WebSocket (#3)"
```

---

### Task 8: Integration test — full end-to-end orphan detection flow

**Files:**
- Test: `tests/integration/drift-banner-layout.test.js` (extend)

- [ ] **Step 1: Write E2E test — no drift when no sidecar exists**

Add to the existing test file:

```javascript
it('no drift field when file has no annotations', async () => {
  const mdPath = await writeFixture('nodrift.md', '# No Drift\n\nClean file.\n')
  const server = track(await createServer({
    files: [mdPath],
    port: 5213,
    open: false,
  }))

  const res = await httpRequest(`${server.url}/api/annotations?path=nodrift.md`)
  const data = res.json()

  expect(data.drift).toBeFalsy()
})
```

- [ ] **Step 2: Write E2E test — drift object is backwards-compatible (truthy check)**

```javascript
it('drift object is truthy for backward compatibility', async () => {
  const mdPath = await writeFixture('compat.md', '# Compat\n\nSome text.\n')
  const server = track(await createServer({
    files: [mdPath],
    port: 5214,
    open: false,
  }))

  await httpRequest(`${server.url}/api/annotations`, 'POST', {
    file: 'compat.md',
    action: 'add',
    data: {
      selectors: {
        position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 10 },
        quote: { exact: 'Some text.', prefix: '', suffix: '' },
      },
      comment: 'Test',
      tag: 'bug',
      author: 'Tester',
    },
  })

  await node_fs.writeFile(mdPath, '# Compat\n\nChanged.\n', 'utf-8')
  await new Promise(r => setTimeout(r, 300))

  const res = await httpRequest(`${server.url}/api/annotations?path=compat.md`)
  const data = res.json()

  // Object is truthy — backward compatible with `if (data.drift)`
  expect(data.drift).toBeTruthy()
  expect(typeof data.drift).toBe('object')
})
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/drift-banner-layout.test.js
git commit -m "test: add integration tests for orphan detection edge cases (#3)"
```

---

### Task 9: Final verification and cleanup

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS — zero failures

- [ ] **Step 2: Manual smoke test**

Start mdprobe with a test file:
```bash
node src/cli.js tests/fixtures/sample.md
```

1. Add an annotation on some text
2. Edit the fixture file — delete the annotated text
3. Refresh the page — verify:
   - Banner shows "Arquivo modificado — 1 anotação(ões) não encontrada(s)"
   - Orphaned section appears at bottom of right panel
   - Orphaned card has dashed border, reduced opacity, strikethrough quote
   - Clicking orphaned card does NOT scroll content
   - Resolve/Delete/Edit work on orphaned card

- [ ] **Step 3: Commit any final adjustments**

```bash
git add -A
git commit -m "fix: final adjustments from smoke test (#3)"
```

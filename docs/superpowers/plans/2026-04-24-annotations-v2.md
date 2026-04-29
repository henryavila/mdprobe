# Annotations v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate browser freeze on annotation save/edit/resolve AND replace the cramped inline edit/reply UX with a dedicated modal — shipping both as one release.

**Architecture:** Two parallel streams landing together. Stream A replaces nuke-and-pave highlight mutation with a diff-based `Highlighter` interface and decouples the three `useEffect` blocks in `Content.jsx`. Stream B introduces `AnnotationModal` (~720 px, centered, backdrop) for edit/reply while keeping `Popover` for create, and brings replies to full visual parity with root comments.

**Tech Stack:** Preact + Signals (client), Vitest + @testing-library/preact (unit/component tests), Playwright (E2E), plain JS (no TypeScript — project convention), vanilla CSS via `themes.css`.

**Spec:** `docs/superpowers/specs/2026-04-24-annotations-v2-design.md`

**Project rule reminder:** This project has a security hook that blocks `innerHTML` assignment. All DOM construction in tests and production uses `createElement` / `textContent` / `createElementNS`. See memory: `feedback_no_innerhtml.md`.

---

## File Structure

### Stream A — Performance

| File | Role |
|---|---|
| `src/ui/diff/annotation-diff.js` **(new)** | Pure function `diffAnnotations(prev, next, opts)` returning `{ added, removed, kept }`. |
| `src/ui/highlighters/mark-highlighter.js` **(new)** | Factory `createMarkHighlighter()` exposing `{ sync, clear, setSelection }`. Wraps existing strategies 1/2/3 from `Content.jsx`. |
| `src/ui/highlighters/index.js` **(new)** | Chooses the active highlighter. Today: always mark. |
| `src/ui/components/Content.jsx` **(modify)** | Delegates to the highlighter. Splits three effects. Keeps `handleMouseUp` + `handleContentClick`. |
| `src/ui/styles/themes.css` **(modify)** | Selection rule moves from class-based to attribute-based. |

### Stream B — UX

| File | Role |
|---|---|
| `src/ui/state/store.js` **(modify)** | New `modalAnnotationId` + `modalOpenMode` signals + `openAnnotationModal` / `closeAnnotationModal` helpers. |
| `src/ui/components/AnnotationForm.jsx` **(modify)** | Accepts `mode` prop: `'create' | 'edit' | 'reply'`. |
| `src/ui/components/ReplyItem.jsx` **(new)** | One reply with Edit/Delete actions. |
| `src/ui/components/ReplyList.jsx` **(new)** | Renders `ReplyItem[]` + count separator. Replaces `ReplyThread.jsx`. |
| `src/ui/components/AnnotationModal.jsx` **(new)** | Dedicated dialog for edit/reply/thread view. |
| `src/ui/components/RightPanel.jsx` **(modify)** | Removes inline `AnnotationForm` and `ReplyInput`. Edit/Reply buttons call `openAnnotationModal`. |
| `src/ui/components/ReplyThread.jsx` **(delete)** | Replaced by `ReplyList` + `ReplyItem`. |
| `src/ui/hooks/useAnnotations.js` **(modify)** | Adds `editReply(annId, replyId, comment)` and `deleteReply(annId, replyId)`. |
| `src/annotations.js` **(modify)** | Assigns `id` to replies at creation AND backfills missing ids on load. Adds `editReply`/`deleteReply` methods. |
| `src/server.js` **(modify)** | Routes `editReply` and `deleteReply` actions. |
| `src/ui/app.jsx` **(modify)** | Mounts `<AnnotationModal />` at app root. |
| `src/ui/styles/themes.css` **(modify)** | Modal styles + reply parity. |

### Tests

| File | Role |
|---|---|
| `tests/unit/annotation-diff.test.js` **(new)** | Unit tests for the diff function. |
| `tests/unit/mark-highlighter.test.jsx` **(new)** | Tests the highlighter sync/clear/setSelection contract. |
| `tests/unit/content-highlights.test.jsx` **(modify)** | Adapt to new effect structure; add "select change does not re-run applyHighlights" assertion. |
| `tests/unit/annotations.test.js` **(modify)** | Reply id backfill + editReply/deleteReply methods. |
| `tests/integration/annotation-api.test.js` **(modify)** | `editReply`/`deleteReply` HTTP actions. |
| `tests/unit/useAnnotations.test.jsx` **(modify)** | Client `editReply`/`deleteReply`. |
| `tests/unit/store.test.js` **(modify)** | `modalAnnotationId` + `modalOpenMode` signals. |
| `tests/unit/annotation-form.test.jsx` **(new)** | `mode` prop behavior. |
| `tests/unit/reply-item.test.jsx` **(new)** | Render, edit-in-place, delete confirm. |
| `tests/unit/reply-list.test.jsx` **(new)** | Ordering, count, empty state. |
| `tests/unit/annotation-modal.test.jsx` **(new)** | Open/close, focus, ESC, backdrop, dirty-draft confirm. |
| `tests/unit/right-panel.test.jsx` **(modify)** | Buttons dispatch to modal signal; inline form gone. |
| `tests/e2e/annotation-modal-flow.spec.js` **(new)** | Happy path: create → open modal → reply → edit reply → delete reply. |
| `tests/e2e/annotation-perf.spec.js` **(new)** | 100-annotation smoke: rapid resolves stay under frame budget. |

---

## Task 1: Annotation diff function (foundation, no deps)

**Files:**
- Create: `src/ui/diff/annotation-diff.js`
- Test: `tests/unit/annotation-diff.test.js`

- [ ] **Step 1.1: Write the failing tests**

```js
// tests/unit/annotation-diff.test.js
import { describe, it, expect } from 'vitest'
import { diffAnnotations } from '../../src/ui/diff/annotation-diff.js'

const make = (id, { tag = 'question', status = 'open', comment = 'c' } = {}) => ({
  id, tag, status, comment, selectors: { position: { startLine: 1 } },
})

describe('diffAnnotations', () => {
  it('returns empty diff for identical input', () => {
    const a = [make('1'), make('2')]
    expect(diffAnnotations(a, a, { showResolved: false }))
      .toEqual({ added: [], removed: [], kept: ['1', '2'] })
  })

  it('detects added ids', () => {
    const prev = [make('1')]
    const next = [make('1'), make('2')]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: ['2'], removed: [], kept: ['1'] })
  })

  it('detects removed ids', () => {
    const prev = [make('1'), make('2')]
    const next = [make('1')]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: [], removed: ['2'], kept: ['1'] })
  })

  it('treats a tag change as removed + added', () => {
    const prev = [make('1', { tag: 'question' })]
    const next = [make('1', { tag: 'bug' })]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: ['1'], removed: ['1'], kept: [] })
  })

  it('treats a status flip to resolved as removed when showResolved is false', () => {
    const prev = [make('1', { status: 'open' })]
    const next = [make('1', { status: 'resolved' })]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: [], removed: ['1'], kept: [] })
  })

  it('keeps resolved ids when showResolved is true and status does not change', () => {
    const prev = [make('1', { status: 'resolved' })]
    const next = [make('1', { status: 'resolved' })]
    expect(diffAnnotations(prev, next, { showResolved: true }))
      .toEqual({ added: [], removed: [], kept: ['1'] })
  })

  it('filters resolved from both sides when showResolved is false', () => {
    const prev = [make('1', { status: 'resolved' }), make('2')]
    const next = [make('1', { status: 'resolved' }), make('2')]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: [], removed: [], kept: ['2'] })
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run tests/unit/annotation-diff.test.js`
Expected: FAIL with `Failed to resolve import "../../src/ui/diff/annotation-diff.js"`.

- [ ] **Step 1.3: Implement `diffAnnotations`**

```js
// src/ui/diff/annotation-diff.js

function isVisible(ann, showResolved) {
  return showResolved || ann.status === 'open'
}

function fingerprint(ann) {
  return `${ann.tag}|${ann.status}`
}

export function diffAnnotations(prev, next, { showResolved }) {
  const prevMap = new Map()
  for (const a of prev) if (isVisible(a, showResolved)) prevMap.set(a.id, a)

  const nextMap = new Map()
  for (const a of next) if (isVisible(a, showResolved)) nextMap.set(a.id, a)

  const added = []
  const removed = []
  const kept = []

  for (const [id, n] of nextMap) {
    const p = prevMap.get(id)
    if (!p) { added.push(id); continue }
    if (fingerprint(p) !== fingerprint(n)) { added.push(id); removed.push(id); continue }
    kept.push(id)
  }
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removed.push(id)
  }

  return { added, removed, kept }
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx vitest run tests/unit/annotation-diff.test.js`
Expected: PASS — 7/7.

- [ ] **Step 1.5: Commit**

```bash
git add src/ui/diff/annotation-diff.js tests/unit/annotation-diff.test.js
git commit -m "feat(ui): add annotation diff for incremental highlight updates"
```

---

## Task 2: Mark highlighter module (extract + diff-aware)

**Files:**
- Create: `src/ui/highlighters/mark-highlighter.js`
- Create: `src/ui/highlighters/index.js`
- Test: `tests/unit/mark-highlighter.test.jsx`

- [ ] **Step 2.1: Write the failing tests (DOM built via createElement, never via HTML string assignment)**

```jsx
// tests/unit/mark-highlighter.test.jsx
import { describe, it, expect, beforeEach } from 'vitest'
import { createMarkHighlighter } from '../../src/ui/highlighters/mark-highlighter.js'

function makePara(line, text) {
  const p = document.createElement('p')
  p.setAttribute('data-source-line', String(line))
  p.textContent = text
  return p
}

function buildContent(paras) {
  const el = document.createElement('div')
  el.className = 'content-area'
  for (const p of paras) el.appendChild(p)
  document.body.replaceChildren(el)
  return el
}

function cloneStructure(el) {
  return el.cloneNode(true).outerHTML
}

const ann = (id, line, text) => ({
  id, tag: 'question', status: 'open', comment: 'x',
  selectors: {
    position: { startLine: line, startColumn: 1, endLine: line, endColumn: text.length + 1 },
    quote: { exact: text, prefix: '', suffix: '' },
  },
})

describe('mark-highlighter', () => {
  let el
  beforeEach(() => {
    el = buildContent([makePara(1, 'Hello world'), makePara(2, 'Another line')])
  })

  it('sync injects a <mark> for each visible annotation', () => {
    const h = createMarkHighlighter()
    h.sync(el, [ann('a', 1, 'Hello')], { showResolved: false, prevAnnotations: [] })
    const marks = el.querySelectorAll('mark[data-highlight-id="a"]')
    expect(marks.length).toBe(1)
    expect(marks[0].textContent).toBe('Hello')
  })

  it('sync with empty diff does not mutate the DOM', () => {
    const h = createMarkHighlighter()
    const anns = [ann('a', 1, 'Hello')]
    h.sync(el, anns, { showResolved: false, prevAnnotations: [] })
    const before = cloneStructure(el)
    h.sync(el, anns, { showResolved: false, prevAnnotations: anns })
    expect(cloneStructure(el)).toBe(before)
  })

  it('sync removes <mark> for ids no longer present', () => {
    const h = createMarkHighlighter()
    h.sync(el, [ann('a', 1, 'Hello')], { showResolved: false, prevAnnotations: [] })
    h.sync(el, [], { showResolved: false, prevAnnotations: [ann('a', 1, 'Hello')] })
    expect(el.querySelectorAll('mark[data-highlight-id]').length).toBe(0)
  })

  it('clear removes every mark', () => {
    const h = createMarkHighlighter()
    h.sync(el, [ann('a', 1, 'Hello'), ann('b', 2, 'Another')], { showResolved: false, prevAnnotations: [] })
    h.clear(el)
    expect(el.querySelectorAll('mark[data-highlight-id]').length).toBe(0)
  })

  it('setSelection sets data-selected and is-selected class without rebuilding marks', () => {
    const h = createMarkHighlighter()
    h.sync(el, [ann('a', 1, 'Hello')], { showResolved: false, prevAnnotations: [] })
    const markBefore = el.querySelector('mark[data-highlight-id="a"]')
    h.setSelection(el, 'a')
    expect(el.getAttribute('data-selected')).toBe('a')
    expect(el.querySelector('mark.is-selected')).not.toBeNull()
    // same node identity — no rebuild
    expect(el.querySelector('mark[data-highlight-id="a"]')).toBe(markBefore)
    h.setSelection(el, null)
    expect(el.hasAttribute('data-selected')).toBe(false)
    expect(el.querySelector('mark.is-selected')).toBeNull()
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mark-highlighter.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement the highlighter**

```js
// src/ui/highlighters/mark-highlighter.js
import { diffAnnotations } from '../diff/annotation-diff.js'

export function createMarkHighlighter() {
  return { sync, clear, setSelection }

  function sync(contentEl, annotations, { showResolved, prevAnnotations = [], selectedId = null }) {
    const { added, removed } = diffAnnotations(prevAnnotations, annotations, { showResolved })
    if (removed.length === 0 && added.length === 0) return

    if (removed.length > 0) removeMarks(contentEl, removed)
    if (added.length > 0) {
      const byId = new Map(annotations.map(a => [a.id, a]))
      for (const id of added) {
        const a = byId.get(id)
        if (a) injectMark(contentEl, a, selectedId)
      }
    }
  }

  function clear(contentEl) {
    const marks = contentEl.querySelectorAll('mark[data-highlight-id]')
    for (const mark of marks) unwrap(mark)
  }

  function setSelection(contentEl, annotationId) {
    const prev = contentEl.querySelectorAll('mark.is-selected')
    for (const m of prev) m.classList.remove('is-selected')
    if (annotationId == null) {
      contentEl.removeAttribute('data-selected')
      return
    }
    contentEl.setAttribute('data-selected', annotationId)
    const marks = contentEl.querySelectorAll(`mark[data-highlight-id="${CSS.escape(annotationId)}"]`)
    for (const m of marks) m.classList.add('is-selected')
  }
}

function removeMarks(contentEl, ids) {
  for (const id of ids) {
    const marks = contentEl.querySelectorAll(`mark[data-highlight-id="${CSS.escape(id)}"]`)
    for (const mark of marks) unwrap(mark)
  }
}

function unwrap(mark) {
  const parent = mark.parentNode
  if (!parent) return
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
  parent.removeChild(mark)
}

function injectMark(contentEl, ann, selectedId) {
  const startLine = ann.selectors?.position?.startLine
  if (!startLine) return
  const sourceEl = contentEl.querySelector(`[data-source-line="${startLine}"]`)
  if (!sourceEl) return
  const exact = ann.selectors?.quote?.exact
  if (!exact) return

  const selClass = selectedId === ann.id ? ' is-selected' : ''
  const markClass = `annotation-highlight tag-${ann.tag}${ann.status === 'resolved' ? ' resolved' : ''}${selClass}`

  if (trySingleElement(sourceEl, exact, ann.id, markClass)) return
  const endLine = ann.selectors?.position?.endLine || startLine
  if (tryCrossElement(contentEl, sourceEl, endLine, exact, ann.id, markClass)) return
  highlightLineRange(contentEl, startLine, endLine, ann.id, markClass)
}

function collectTextNodes(root, result) {
  for (const child of root.childNodes) {
    if (child.nodeType === 3) {
      if (child.textContent.trim() !== '') result.push(child)
    } else if (child.nodeType === 1) {
      collectTextNodes(child, result)
    }
  }
}

function trySingleElement(sourceEl, exact, id, className) {
  const textNodes = []
  collectTextNodes(sourceEl, textNodes)
  for (const node of textNodes) {
    const idx = node.textContent.indexOf(exact)
    if (idx === -1) continue
    const range = document.createRange()
    range.setStart(node, idx)
    range.setEnd(node, idx + exact.length)
    const mark = document.createElement('mark')
    mark.setAttribute('data-highlight-id', id)
    mark.className = className
    try { range.surroundContents(mark); return true } catch { return false }
  }
  return false
}

function tryCrossElement(contentEl, sourceEl, endLine, exact, id, className) {
  const textNodes = []
  const els = contentEl.querySelectorAll('[data-source-line]')
  for (const e of els) {
    const line = parseInt(e.getAttribute('data-source-line'))
    if (line < parseInt(sourceEl.getAttribute('data-source-line'))) continue
    if (line > endLine) break
    if (e.parentElement?.closest(`[data-source-line="${line}"]`)) continue
    collectTextNodes(e, textNodes)
  }
  if (textNodes.length === 0) return false

  let concat = ''
  const nodeMap = []
  for (let i = 0; i < textNodes.length; i++) {
    if (i > 0) {
      const prevLine = textNodes[i - 1].parentElement?.closest('[data-source-line]')?.getAttribute('data-source-line')
      const currLine = textNodes[i].parentElement?.closest('[data-source-line]')?.getAttribute('data-source-line')
      if (prevLine !== currLine) concat += '\n'
    }
    const start = concat.length
    concat += textNodes[i].textContent
    nodeMap.push({ node: textNodes[i], startInConcat: start, endInConcat: concat.length })
  }

  let matchIdx = concat.indexOf(exact)
  if (matchIdx === -1) {
    let normConcat = ''
    const normMap = []
    for (let i = 0; i < textNodes.length; i++) {
      if (i > 0) {
        const prevLine = textNodes[i - 1].parentElement?.closest('[data-source-line]')?.getAttribute('data-source-line')
        const currLine = textNodes[i].parentElement?.closest('[data-source-line]')?.getAttribute('data-source-line')
        if (prevLine !== currLine) normConcat += ' '
      }
      const start = normConcat.length
      normConcat += textNodes[i].textContent.replace(/\s+/g, ' ')
      normMap.push({ node: textNodes[i], startInNorm: start, endInNorm: normConcat.length })
    }
    const normalizedExact = exact.replace(/\s+/g, ' ')
    const normIdx = normConcat.indexOf(normalizedExact)
    if (normIdx === -1) return false
    const normEnd = normIdx + normalizedExact.length
    for (const nm of normMap) {
      const s = Math.max(normIdx, nm.startInNorm)
      const e = Math.min(normEnd, nm.endInNorm)
      if (s >= e) continue
      wrapTextNode(nm.node, s - nm.startInNorm, e - nm.startInNorm, id, className)
    }
    return true
  }

  const matchEnd = matchIdx + exact.length
  for (const nm of nodeMap) {
    const s = Math.max(matchIdx, nm.startInConcat)
    const e = Math.min(matchEnd, nm.endInConcat)
    if (s >= e) continue
    wrapTextNode(nm.node, s - nm.startInConcat, e - nm.startInConcat, id, className)
  }
  return true
}

function highlightLineRange(contentEl, startLine, endLine, id, className) {
  const textNodes = []
  const els = contentEl.querySelectorAll('[data-source-line]')
  for (const e of els) {
    const line = parseInt(e.getAttribute('data-source-line'))
    if (line < startLine || line > endLine) continue
    if (e.parentElement?.closest(`[data-source-line="${line}"]`)) continue
    collectTextNodes(e, textNodes)
  }
  for (const tn of textNodes) wrapTextNode(tn, 0, tn.textContent.length, id, className)
}

function wrapTextNode(textNode, start, end, id, className) {
  if (start >= end || start >= textNode.textContent.length) return
  try {
    const range = document.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, Math.min(end, textNode.textContent.length))
    const mark = document.createElement('mark')
    mark.setAttribute('data-highlight-id', id)
    mark.className = className
    range.surroundContents(mark)
  } catch { /* range crosses element boundaries */ }
}
```

- [ ] **Step 2.4: Create the highlighter index**

```js
// src/ui/highlighters/index.js
import { createMarkHighlighter } from './mark-highlighter.js'

// Capability detection placeholder for a future CSS Custom Highlight API
// implementation. For v0.5.0 we always use the mark-based highlighter.
export function getHighlighter() {
  return createMarkHighlighter()
}
```

- [ ] **Step 2.5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/mark-highlighter.test.jsx`
Expected: PASS — 5/5.

- [ ] **Step 2.6: Commit**

```bash
git add src/ui/highlighters tests/unit/mark-highlighter.test.jsx
git commit -m "feat(ui): add pluggable Highlighter interface with mark implementation"
```

---

## Task 3: Refactor Content.jsx — delegate + split effects

**Files:**
- Modify: `src/ui/components/Content.jsx`
- Modify: `tests/unit/content-highlights.test.jsx`

- [ ] **Step 3.1: Update `Content.jsx` to delegate to the highlighter and split effects**

Add import at the top:

```jsx
import { getHighlighter } from '../highlighters/index.js'
```

Inside `Content` function body (right after `const [popover, setPopover] = useState(null)`):

```jsx
const highlighterRef = useRef(null)
const prevAnnsRef = useRef([])
if (!highlighterRef.current) highlighterRef.current = getHighlighter()
```

Replace the current highlight `useEffect` block (lines ~12-39) with these three:

```jsx
// (A) Highlight sync — diff-aware; does NOT depend on selection
useEffect(() => {
  const el = contentRef.current
  if (!el) return
  const h = highlighterRef.current
  const raf1 = requestAnimationFrame(() => {
    const raf2 = requestAnimationFrame(() => {
      h.sync(el, annotations.value, {
        showResolved: showResolved.value,
        prevAnnotations: prevAnnsRef.current,
        selectedId: selectedAnnotationId.value,
      })
      prevAnnsRef.current = annotations.value
      h.setSelection(el, selectedAnnotationId.value)
    })
    return () => cancelAnimationFrame(raf2)
  })
  return () => cancelAnimationFrame(raf1)
}, [annotations.value, showResolved.value])

// (B) HTML changed — wipe prev snapshot so next sync rebuilds from scratch
useEffect(() => {
  const el = contentRef.current
  if (!el) return
  highlighterRef.current.clear(el)
  prevAnnsRef.current = []
}, [currentHtml.value])

// (C) Selection — attribute-only, zero mark mutations
useEffect(() => {
  const el = contentRef.current
  if (!el) return
  highlighterRef.current.setSelection(el, selectedAnnotationId.value)
}, [selectedAnnotationId.value])
```

Delete these functions from `Content.jsx` (they moved to `mark-highlighter.js`):
- `applyHighlights`
- `collectTextNodes`
- `trySingleElementHighlight`
- `tryCrossElementHighlight`
- `highlightLineRange`
- `wrapTextNode`

Keep: `findSourceLineParent`, `handleMouseUp`, `findSourceNode`, `handleContentClick`, `createCopyIcon`, `createCheckIcon`.

Section-approval effect (line ~80) and code-block-toolbar effect (line ~139) keep their existing deps (`[currentHtml.value, sections.value]` and `[currentHtml.value]` respectively — already correctly scoped).

- [ ] **Step 3.2: Update `content-highlights.test.jsx` for 2-frame rAF + add selection-preserves-marks test**

Update `flushHighlights` helper at the top:

```jsx
async function flushHighlights() {
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
}
```

Add at the end of the file (inside the main `describe` or as a sibling):

```jsx
describe('Selection does not retrigger highlight rebuild', () => {
  it('changing selectedAnnotationId preserves existing mark nodes', async () => {
    const html = '<p data-source-line="1">Hello world</p>'
    const anns = [{
      id: 'a1', tag: 'question', status: 'open', comment: '',
      selectors: {
        position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
        quote: { exact: 'Hello', prefix: '', suffix: '' },
      },
    }]
    const container = await renderWithHighlights(html, anns)

    const markBefore = container.querySelector('mark[data-highlight-id="a1"]')
    expect(markBefore).not.toBeNull()

    await act(() => { selectedAnnotationId.value = 'a1' })
    await flushHighlights()

    const markAfter = container.querySelector('mark[data-highlight-id="a1"]')
    expect(markAfter).toBe(markBefore)
    const root = container.querySelector('.content-area')
    expect(root.getAttribute('data-selected')).toBe('a1')
  })
})
```

- [ ] **Step 3.3: Run suite**

Run: `npx vitest run tests/unit/content-highlights.test.jsx tests/unit/mark-highlighter.test.jsx`
Expected: ALL PASS.

- [ ] **Step 3.4: Commit**

```bash
git add src/ui/components/Content.jsx tests/unit/content-highlights.test.jsx
git commit -m "refactor(ui): delegate highlighting to pluggable highlighter; split effects"
```

---

## Task 4: Selection CSS

**Files:**
- Modify: `src/ui/styles/themes.css`

- [ ] **Step 4.1: Replace `.annotation-highlight.selected` rules**

Find the existing selection rule for `.annotation-highlight.selected` (search `.annotation-highlight`) and replace with:

```css
.content-area mark.annotation-highlight { cursor: pointer; }
.content-area[data-selected] mark[data-highlight-id] { filter: saturate(0.55); }
.content-area[data-selected] mark.is-selected {
  filter: none;
  box-shadow: 0 0 0 2px var(--accent);
  border-radius: 2px;
}
```

- [ ] **Step 4.2: Verify CSS parses**

Run: `npm run build:ui`
Expected: Build succeeds.

- [ ] **Step 4.3: Commit**

```bash
git add src/ui/styles/themes.css
git commit -m "style(ui): move selection visual to attribute + is-selected class"
```

---

## Task 5: Server reply id + backfill on load

**Files:**
- Modify: `src/annotations.js`
- Modify: `tests/unit/annotations.test.js`

- [ ] **Step 5.1: Write the failing tests**

Append to `tests/unit/annotations.test.js` (match the existing test helpers and file load pattern used elsewhere in that file — if load is via a file path, write to a temp file first):

```js
describe('reply id assignment', () => {
  it('addReply assigns a uuid id', () => {
    const store = makeStore() // use the existing helper in this test file
    const ann = store.add({
      selectors: { position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }, quote: { exact: 'a', prefix: '', suffix: '' } },
      comment: 'root', tag: 'question', author: 'me',
    })
    store.addReply(ann.id, { author: 'me', comment: 'first' })
    const reloaded = store.get(ann.id)
    expect(reloaded.replies[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('loading annotations with legacy replies (no id) backfills ids', async () => {
    // Write a legacy yaml to a temp file and load
    const tmp = await writeTempYaml(`
annotations:
  - id: root-1
    selectors:
      position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 3 }
      quote: { exact: 'hi', prefix: '', suffix: '' }
    comment: x
    tag: question
    author: me
    status: open
    replies:
      - author: other
        comment: legacy
        created_at: '2026-01-01T00:00:00Z'
`)
    const store = await loadStoreFromTempYaml(tmp) // follow existing file's helper pattern
    const ann = store.get('root-1')
    expect(ann.replies[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })
})
```

*Implementing agent:* inspect the existing tests in `tests/unit/annotations.test.js` for the real helper names and adjust accordingly. The tests above use placeholder helper names — replace them with what already exists.

- [ ] **Step 5.2: Run test to verify failure**

Run: `npx vitest run tests/unit/annotations.test.js -t "reply id"`
Expected: FAIL — reply has no id.

- [ ] **Step 5.3: Add id assignment and backfill to `src/annotations.js`**

Add to imports at top:

```js
import { randomUUID } from 'node:crypto'
```

Modify `addReply` (around line 215):

```js
addReply(annotationId, { author, comment }) {
  const ann = this._findOrThrow(annotationId)
  ann.replies.push({
    id: randomUUID(),
    author,
    comment,
    created_at: new Date().toISOString(),
  })
}
```

In the load path, after the `if (!ann.replies) ann.replies = []` line (around line 50), add:

```js
for (const reply of ann.replies) {
  if (!reply.id) reply.id = randomUUID()
}
```

- [ ] **Step 5.4: Run tests**

Run: `npx vitest run tests/unit/annotations.test.js`
Expected: ALL PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/annotations.js tests/unit/annotations.test.js
git commit -m "feat(server): assign ids to replies on create and backfill on load"
```

---

## Task 6: Server endpoints for editReply and deleteReply

**Files:**
- Modify: `src/annotations.js` (add methods)
- Modify: `src/server.js` (route actions)
- Modify: `tests/integration/annotation-api.test.js`

- [ ] **Step 6.1: Add `editReply` and `deleteReply` to `AnnotationStore`**

In `src/annotations.js`, after `addReply`:

```js
editReply(annotationId, replyId, comment) {
  const ann = this._findOrThrow(annotationId)
  const reply = ann.replies.find(r => r.id === replyId)
  if (!reply) throw new Error(`Reply ${replyId} not found on ${annotationId}`)
  reply.comment = comment
  reply.updated_at = new Date().toISOString()
}

deleteReply(annotationId, replyId) {
  const ann = this._findOrThrow(annotationId)
  const before = ann.replies.length
  ann.replies = ann.replies.filter(r => r.id !== replyId)
  if (ann.replies.length === before) throw new Error(`Reply ${replyId} not found on ${annotationId}`)
}
```

- [ ] **Step 6.2: Route the actions in `src/server.js`**

Find the action-dispatch block that handles `action: 'reply'` (search `case 'reply'` or similar). Add parallel cases right after it, mirroring the `'reply'` case pattern (save + broadcast):

```js
case 'editReply':
  store.editReply(data.id, data.replyId, data.comment)
  break
case 'deleteReply':
  store.deleteReply(data.id, data.replyId)
  break
```

If the 'reply' case uses a different style (e.g., a dispatch map), apply the same style for the two new actions.

- [ ] **Step 6.3: Write integration tests**

Append to `tests/integration/annotation-api.test.js`, using whatever `startTestServer` / helper API the file already uses:

```js
describe('editReply / deleteReply HTTP actions', () => {
  it('edits a reply comment by id', async () => {
    const { server, url, filePath } = await startTestServer()
    // Create annotation
    const create = await fetch(`${url}/api/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: filePath, action: 'add',
        data: { selectors: { position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }, quote: { exact: 'a', prefix: '', suffix: '' } }, comment: 'root', tag: 'question', author: 'me' },
      }),
    })
    const added = await create.json()
    const annId = added.annotations[0].id

    // Add reply
    const reply = await fetch(`${url}/api/annotations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath, action: 'reply', data: { id: annId, author: 'me', comment: 'first' } }),
    })
    const withReply = await reply.json()
    const replyId = withReply.annotations[0].replies[0].id
    expect(replyId).toBeDefined()

    // Edit reply
    const edit = await fetch(`${url}/api/annotations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath, action: 'editReply', data: { id: annId, replyId, comment: 'edited' } }),
    })
    expect(edit.status).toBe(200)
    const after = await edit.json()
    expect(after.annotations[0].replies[0].comment).toBe('edited')

    await server.close()
  })

  it('deletes a reply by id', async () => {
    const { server, url, filePath } = await startTestServer()
    // (same setup as above through reply creation)
    // ...
    const del = await fetch(`${url}/api/annotations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath, action: 'deleteReply', data: { id: annId, replyId } }),
    })
    expect(del.status).toBe(200)
    const after = await del.json()
    expect(after.annotations[0].replies).toHaveLength(0)
    await server.close()
  })
})
```

- [ ] **Step 6.4: Run tests**

Run: `npx vitest run tests/integration/annotation-api.test.js`
Expected: ALL PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/annotations.js src/server.js tests/integration/annotation-api.test.js
git commit -m "feat(server): add editReply and deleteReply HTTP actions"
```

---

## Task 7: Client hooks — editReply and deleteReply

**Files:**
- Modify: `src/ui/hooks/useAnnotations.js`
- Modify: `tests/unit/useAnnotations.test.jsx`

- [ ] **Step 7.1: Add methods to `useAnnotations.js`**

After `addReply` (around line 82), add:

```js
async function editReply(annotationId, replyId, comment) {
  const data = await postAnnotation('editReply', { id: annotationId, replyId, comment })
  if (data.annotations) setAnnotations(data.annotations)
}

async function deleteReply(annotationId, replyId) {
  const data = await postAnnotation('deleteReply', { id: annotationId, replyId })
  if (data.annotations) setAnnotations(data.annotations)
}
```

Add to the returned object:

```js
return {
  fetchAnnotations,
  createAnnotation,
  resolveAnnotation,
  reopenAnnotation,
  updateAnnotation,
  deleteAnnotation,
  addReply,
  editReply,
  deleteReply,
  approveSection,
  rejectSection,
  resetSection,
  approveAllSections,
  clearAllSections,
}
```

- [ ] **Step 7.2: Add tests (mirror existing style in the file)**

Append to `tests/unit/useAnnotations.test.jsx`:

```jsx
describe('editReply / deleteReply client ops', () => {
  it('editReply posts editReply action with correct payload', async () => {
    // Use the existing render + fetch-mock pattern in this file
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ annotations: [] }),
    })
    global.fetch = mockFetch

    const { ops } = renderUseAnnotations() // use the file's existing helper
    await ops.editReply('ann-1', 'reply-2', 'new text')

    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.action).toBe('editReply')
    expect(body.data).toEqual({ id: 'ann-1', replyId: 'reply-2', comment: 'new text' })
  })

  it('deleteReply posts deleteReply action with correct payload', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ annotations: [] }),
    })
    global.fetch = mockFetch

    const { ops } = renderUseAnnotations()
    await ops.deleteReply('ann-1', 'reply-2')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.action).toBe('deleteReply')
    expect(body.data).toEqual({ id: 'ann-1', replyId: 'reply-2' })
  })
})
```

- [ ] **Step 7.3: Run tests**

Run: `npx vitest run tests/unit/useAnnotations.test.jsx`
Expected: ALL PASS.

- [ ] **Step 7.4: Commit**

```bash
git add src/ui/hooks/useAnnotations.js tests/unit/useAnnotations.test.jsx
git commit -m "feat(ui): add editReply/deleteReply client operations"
```

---

## Task 8: Modal state signals

**Files:**
- Modify: `src/ui/state/store.js`
- Modify: `tests/unit/store.test.js`

- [ ] **Step 8.1: Add signals and helpers to `store.js`**

Append to `src/ui/state/store.js`:

```js
export const modalAnnotationId = signal(null)
export const modalOpenMode = signal(null) // 'edit' | 'reply' | null

export function openAnnotationModal(id, mode) {
  modalAnnotationId.value = id
  modalOpenMode.value = mode
}

export function closeAnnotationModal() {
  modalAnnotationId.value = null
  modalOpenMode.value = null
}
```

- [ ] **Step 8.2: Add tests to `tests/unit/store.test.js`**

Append (matching the file's existing style):

```js
describe('modal signals', () => {
  it('modalAnnotationId and modalOpenMode default to null', async () => {
    const { modalAnnotationId, modalOpenMode } = await import('../../src/ui/state/store.js')
    expect(modalAnnotationId.value).toBe(null)
    expect(modalOpenMode.value).toBe(null)
  })

  it('openAnnotationModal sets both signals; closeAnnotationModal clears them', async () => {
    const { modalAnnotationId, modalOpenMode, openAnnotationModal, closeAnnotationModal } =
      await import('../../src/ui/state/store.js')
    openAnnotationModal('abc', 'edit')
    expect(modalAnnotationId.value).toBe('abc')
    expect(modalOpenMode.value).toBe('edit')
    closeAnnotationModal()
    expect(modalAnnotationId.value).toBe(null)
    expect(modalOpenMode.value).toBe(null)
  })
})
```

- [ ] **Step 8.3: Run tests**

Run: `npx vitest run tests/unit/store.test.js`
Expected: ALL PASS.

- [ ] **Step 8.4: Commit**

```bash
git add src/ui/state/store.js tests/unit/store.test.js
git commit -m "feat(ui): add modal signals and open/close helpers to store"
```

---

## Task 9: AnnotationForm — mode prop

**Files:**
- Modify: `src/ui/components/AnnotationForm.jsx`
- Modify: `src/ui/components/Popover.jsx`
- Create: `tests/unit/annotation-form.test.jsx`

- [ ] **Step 9.1: Replace `AnnotationForm.jsx`**

```jsx
// src/ui/components/AnnotationForm.jsx
import { useState, useRef, useEffect } from 'preact/hooks'

const TAGS = [
  { value: 'question', label: 'Question' },
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'nitpick', label: 'Nitpick' },
]

export function AnnotationForm({
  mode = 'create',
  annotation = null,
  selectors = null,
  exact = null,
  onSave,
  onCancel,
}) {
  const isEdit = mode === 'edit'
  const isReply = mode === 'reply'
  const [comment, setComment] = useState(annotation?.comment || '')
  const [tag, setTag] = useState(annotation?.tag || 'question')
  const textareaRef = useRef(null)

  useEffect(() => {
    window.getSelection()?.removeAllRanges()
    textareaRef.current?.focus()
  }, [])

  function handleSubmit(e) {
    e?.preventDefault?.()
    if (!comment.trim()) return
    if (isReply) onSave({ comment: comment.trim() })
    else if (isEdit) onSave({ comment: comment.trim(), tag })
    else onSave({ selectors, comment: comment.trim(), tag })
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit(e)
    if (e.key === 'Escape') onCancel()
  }

  return (
    <form class={`annotation-form annotation-form--${mode}`} onSubmit={handleSubmit} onKeyDown={handleKeyDown} onClick={e => e.stopPropagation()}>
      {!isReply && exact && (
        <div class="annotation-form__quote">{exact}</div>
      )}

      {!isReply && (
        <div class="annotation-form__tags">
          {TAGS.map(t => (
            <button
              key={t.value}
              type="button"
              class={`tag-pill tag-pill--${t.value}${tag === t.value ? ' tag-pill--active' : ''}`}
              onClick={() => setTag(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={comment}
        onInput={e => setComment(e.target.value)}
        placeholder={isReply ? 'Write a reply... (Ctrl+Enter to send)' : 'Add your comment... (Ctrl+Enter to save)'}
      />

      <div class="annotation-form__actions">
        <span class="annotation-form__hint">Ctrl+Enter · Esc</span>
        <button type="button" class="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" class="btn btn--primary" disabled={!comment.trim()}>
          {isReply ? 'Send' : isEdit ? 'Save' : 'Annotate'}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 9.2: Update `Popover.jsx` to pass `mode="create"`**

In `src/ui/components/Popover.jsx`, change lines 86-91 to:

```jsx
<AnnotationForm
  mode="create"
  exact={exact}
  selectors={selectors}
  onSave={onSave}
  onCancel={onCancel}
/>
```

- [ ] **Step 9.3: Write tests**

```jsx
// tests/unit/annotation-form.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { AnnotationForm } from '../../src/ui/components/AnnotationForm.jsx'

afterEach(() => cleanup())

describe('AnnotationForm mode prop', () => {
  it('mode="create" renders tags and full textarea', () => {
    const { container } = render(
      <AnnotationForm mode="create" selectors={{}} onSave={vi.fn()} onCancel={vi.fn()} />
    )
    expect(container.querySelector('.annotation-form__tags')).not.toBeNull()
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('mode="edit" prefills comment and tag', () => {
    const ann = { id: 'x', comment: 'prefilled', tag: 'bug' }
    const { container } = render(
      <AnnotationForm mode="edit" annotation={ann} onSave={vi.fn()} onCancel={vi.fn()} />
    )
    expect(container.querySelector('textarea').value).toBe('prefilled')
    expect(container.querySelector('.tag-pill--active').textContent).toMatch(/Bug/)
  })

  it('mode="reply" hides tag selector and quote', () => {
    const { container } = render(
      <AnnotationForm mode="reply" onSave={vi.fn()} onCancel={vi.fn()} exact="should not appear" />
    )
    expect(container.querySelector('.annotation-form__tags')).toBeNull()
    expect(container.querySelector('.annotation-form__quote')).toBeNull()
  })

  it('mode="reply" submits via Ctrl+Enter with the comment only', () => {
    const onSave = vi.fn()
    const { container } = render(
      <AnnotationForm mode="reply" onSave={onSave} onCancel={vi.fn()} />
    )
    const ta = container.querySelector('textarea')
    fireEvent.input(ta, { target: { value: 'my reply' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith({ comment: 'my reply' })
  })
})
```

- [ ] **Step 9.4: Run tests**

Run: `npx vitest run tests/unit/annotation-form.test.jsx tests/unit/popover-dismiss.test.jsx`
Expected: ALL PASS.

- [ ] **Step 9.5: Commit**

```bash
git add src/ui/components/AnnotationForm.jsx src/ui/components/Popover.jsx tests/unit/annotation-form.test.jsx
git commit -m "feat(ui): add mode prop to AnnotationForm (create/edit/reply)"
```

---

## Task 10: ReplyItem component

**Files:**
- Create: `src/ui/components/ReplyItem.jsx`
- Create: `tests/unit/reply-item.test.jsx`

- [ ] **Step 10.1: Implement `ReplyItem`**

```jsx
// src/ui/components/ReplyItem.jsx
import { useState } from 'preact/hooks'
import { AnnotationForm } from './AnnotationForm.jsx'

export function ReplyItem({ reply, canEdit, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div class="reply reply--editing">
        <AnnotationForm
          mode="reply"
          annotation={reply}
          onSave={({ comment }) => { onEdit(reply.id, comment); setEditing(false) }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div class="reply" data-reply-id={reply.id}>
      <div class="reply__head">
        <span class="reply__author">{reply.author}</span>
        <span class="reply__time">{formatTime(reply.created_at)}</span>
        {canEdit && (
          <span class="reply__actions">
            <button type="button" class="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" class="btn btn--danger btn--sm" onClick={() => {
              if (window.confirm('Delete this reply?')) onDelete(reply.id)
            }}>Delete</button>
          </span>
        )}
      </div>
      <div class="reply__body">{reply.comment}</div>
    </div>
  )
}

function formatTime(isoString) {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch { return isoString }
}
```

- [ ] **Step 10.2: Write tests**

```jsx
// tests/unit/reply-item.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { ReplyItem } from '../../src/ui/components/ReplyItem.jsx'

afterEach(() => cleanup())

const reply = {
  id: 'r1', author: 'alice', comment: 'hello', created_at: '2026-04-24T10:00:00Z',
}

describe('ReplyItem', () => {
  it('renders author, comment, and formatted time', () => {
    const { getByText } = render(<ReplyItem reply={reply} canEdit={true} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(getByText('alice')).toBeTruthy()
    expect(getByText('hello')).toBeTruthy()
  })

  it('hides Edit/Delete when canEdit is false', () => {
    const { container } = render(<ReplyItem reply={reply} canEdit={false} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(container.querySelector('.reply__actions')).toBeNull()
  })

  it('clicking Edit switches to inline form and Save calls onEdit', () => {
    const onEdit = vi.fn()
    const { getByText, container } = render(<ReplyItem reply={reply} canEdit={true} onEdit={onEdit} onDelete={vi.fn()} />)
    fireEvent.click(getByText('Edit'))
    const ta = container.querySelector('textarea')
    expect(ta.value).toBe('hello')
    fireEvent.input(ta, { target: { value: 'updated' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(onEdit).toHaveBeenCalledWith('r1', 'updated')
  })

  it('clicking Delete prompts and calls onDelete on confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDelete = vi.fn()
    const { getByText } = render(<ReplyItem reply={reply} canEdit={true} onEdit={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(getByText('Delete'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onDelete).toHaveBeenCalledWith('r1')
    confirmSpy.mockRestore()
  })
})
```

- [ ] **Step 10.3: Run tests**

Run: `npx vitest run tests/unit/reply-item.test.jsx`
Expected: ALL PASS.

- [ ] **Step 10.4: Commit**

```bash
git add src/ui/components/ReplyItem.jsx tests/unit/reply-item.test.jsx
git commit -m "feat(ui): add ReplyItem component with inline edit and delete"
```

---

## Task 11: ReplyList component

**Files:**
- Create: `src/ui/components/ReplyList.jsx`
- Create: `tests/unit/reply-list.test.jsx`

- [ ] **Step 11.1: Implement `ReplyList`**

```jsx
// src/ui/components/ReplyList.jsx
import { ReplyItem } from './ReplyItem.jsx'

export function ReplyList({ replies, currentAuthor, onEditReply, onDeleteReply }) {
  if (!replies || replies.length === 0) return null
  return (
    <div class="reply-list">
      <div class="reply-list__separator">Replies ({replies.length})</div>
      {replies.map(r => (
        <ReplyItem
          key={r.id}
          reply={r}
          canEdit={r.author === currentAuthor}
          onEdit={onEditReply}
          onDelete={onDeleteReply}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 11.2: Write tests**

```jsx
// tests/unit/reply-list.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/preact'
import { ReplyList } from '../../src/ui/components/ReplyList.jsx'

afterEach(() => cleanup())

describe('ReplyList', () => {
  it('renders nothing when replies is empty', () => {
    const { container } = render(<ReplyList replies={[]} currentAuthor="me" onEditReply={vi.fn()} onDeleteReply={vi.fn()} />)
    expect(container.querySelector('.reply-list')).toBeNull()
  })

  it('renders the separator with count when replies exist', () => {
    const replies = [{ id: 'a', author: 'x', comment: 'hi', created_at: '' }]
    const { getByText } = render(<ReplyList replies={replies} currentAuthor="me" onEditReply={vi.fn()} onDeleteReply={vi.fn()} />)
    expect(getByText('Replies (1)')).toBeTruthy()
  })

  it('only exposes edit/delete to the reply author', () => {
    const replies = [
      { id: 'a', author: 'me', comment: 'mine' },
      { id: 'b', author: 'other', comment: 'theirs' },
    ]
    const { container } = render(<ReplyList replies={replies} currentAuthor="me" onEditReply={vi.fn()} onDeleteReply={vi.fn()} />)
    const items = container.querySelectorAll('[data-reply-id]')
    expect(items[0].querySelector('.reply__actions')).not.toBeNull()
    expect(items[1].querySelector('.reply__actions')).toBeNull()
  })
})
```

- [ ] **Step 11.3: Run tests**

Run: `npx vitest run tests/unit/reply-list.test.jsx`
Expected: ALL PASS.

- [ ] **Step 11.4: Commit**

```bash
git add src/ui/components/ReplyList.jsx tests/unit/reply-list.test.jsx
git commit -m "feat(ui): add ReplyList component (replaces ReplyThread)"
```

---

## Task 12: AnnotationModal component

**Files:**
- Create: `src/ui/components/AnnotationModal.jsx`
- Create: `tests/unit/annotation-modal.test.jsx`

- [ ] **Step 12.1: Implement `AnnotationModal`**

```jsx
// src/ui/components/AnnotationModal.jsx
import { useEffect, useRef, useState } from 'preact/hooks'
import { annotations, modalAnnotationId, modalOpenMode, author, closeAnnotationModal } from '../state/store.js'
import { AnnotationForm } from './AnnotationForm.jsx'
import { ReplyList } from './ReplyList.jsx'

export function AnnotationModal({ annotationOps }) {
  const id = modalAnnotationId.value
  const mode = modalOpenMode.value
  if (!id) return null

  const ann = annotations.value.find(a => a.id === id)
  if (!ann) return null

  const [editingRoot, setEditingRoot] = useState(mode === 'edit')
  const [draft, setDraft] = useState('')
  const footerTextareaRef = useRef(null)
  const lastFocusRef = useRef(null)

  useEffect(() => {
    lastFocusRef.current = document.activeElement
    function onKey(e) { if (e.key === 'Escape') tryClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      lastFocusRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    if (mode === 'reply') footerTextareaRef.current?.focus?.()
  }, [mode])

  function tryClose() {
    if (draft.trim() && !window.confirm('Discard draft?')) return
    closeAnnotationModal()
  }

  function handleBackdropClick(e) {
    if (e.target.classList.contains('annotation-modal__backdrop')) tryClose()
  }

  function handleSaveRoot({ comment, tag }) {
    annotationOps.updateAnnotation(id, { comment, tag })
    setEditingRoot(false)
  }

  function handleSendReply() {
    const text = draft.trim()
    if (!text) return
    annotationOps.addReply(id, text)
    setDraft('')
  }

  function handleKeyDownFooter(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSendReply()
  }

  const isAuthor = ann.author === author.value

  return (
    <div class="annotation-modal__backdrop" onClick={handleBackdropClick}>
      <div class="annotation-modal" role="dialog" aria-modal="true">
        <header class="annotation-modal__header">
          <span class="annotation-modal__title">
            Discussion · <span class="annotation-modal__author">{ann.author}</span>
            <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
          </span>
          <button type="button" class="btn btn--ghost" aria-label="Close" onClick={tryClose}>×</button>
        </header>

        <div class="annotation-modal__body">
          {ann.selectors?.quote?.exact && (
            <div class="annotation-modal__quote">{ann.selectors.quote.exact}</div>
          )}

          <section class="annotation-modal__root">
            <div class="annotation-modal__root-head">
              <span>{ann.author}</span>
              {isAuthor && !editingRoot && (
                <button type="button" class="btn btn--ghost btn--sm" onClick={() => setEditingRoot(true)}>Edit</button>
              )}
            </div>
            {editingRoot ? (
              <AnnotationForm
                mode="edit"
                annotation={ann}
                onSave={handleSaveRoot}
                onCancel={() => setEditingRoot(false)}
              />
            ) : (
              <div class="annotation-modal__root-body">{ann.comment}</div>
            )}
          </section>

          <ReplyList
            replies={ann.replies || []}
            currentAuthor={author.value}
            onEditReply={annotationOps.editReply}
            onDeleteReply={annotationOps.deleteReply}
          />
        </div>

        <footer class="annotation-modal__footer">
          <textarea
            ref={footerTextareaRef}
            value={draft}
            onInput={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDownFooter}
            placeholder="Write a reply... (Ctrl+Enter to send)"
          />
          <button type="button" class="btn btn--primary" disabled={!draft.trim()} onClick={handleSendReply}>
            Send
          </button>
        </footer>
      </div>
    </div>
  )
}
```

- [ ] **Step 12.2: Write tests**

```jsx
// tests/unit/annotation-modal.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { AnnotationModal } from '../../src/ui/components/AnnotationModal.jsx'
import { modalAnnotationId, modalOpenMode, annotations, author } from '../../src/ui/state/store.js'

afterEach(() => { cleanup(); modalAnnotationId.value = null; modalOpenMode.value = null })

function setup(anns, mode = 'edit', currentId = 'a1') {
  annotations.value = anns
  author.value = 'me'
  modalAnnotationId.value = currentId
  modalOpenMode.value = mode
}

const makeOps = () => ({
  updateAnnotation: vi.fn(),
  addReply: vi.fn(),
  editReply: vi.fn(),
  deleteReply: vi.fn(),
  deleteAnnotation: vi.fn(),
  resolveAnnotation: vi.fn(),
})

describe('AnnotationModal', () => {
  it('renders nothing when modalAnnotationId is null', () => {
    modalAnnotationId.value = null
    const { container } = render(<AnnotationModal annotationOps={makeOps()} />)
    expect(container.querySelector('.annotation-modal')).toBeNull()
  })

  it('renders quote, root comment, and replies when open', () => {
    const ann = {
      id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'root comment',
      selectors: { quote: { exact: 'quoted text' } },
      replies: [{ id: 'r1', author: 'other', comment: 'first reply', created_at: '' }],
    }
    setup([ann], 'edit')
    const { getByText } = render(<AnnotationModal annotationOps={makeOps()} />)
    expect(getByText('quoted text')).toBeTruthy()
    expect(getByText('first reply')).toBeTruthy()
  })

  it('clicking backdrop with empty draft closes modal', () => {
    const ann = { id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'c', selectors: { quote: { exact: 'q' } }, replies: [] }
    setup([ann], 'reply')
    const { container } = render(<AnnotationModal annotationOps={makeOps()} />)
    fireEvent.click(container.querySelector('.annotation-modal__backdrop'))
    expect(modalAnnotationId.value).toBe(null)
  })

  it('ESC closes modal', () => {
    const ann = { id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'c', selectors: { quote: { exact: 'q' } }, replies: [] }
    setup([ann], 'edit')
    render(<AnnotationModal annotationOps={makeOps()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(modalAnnotationId.value).toBe(null)
  })

  it('dirty reply textarea prompts confirm on backdrop click', () => {
    const ann = { id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'c', selectors: { quote: { exact: 'q' } }, replies: [] }
    setup([ann], 'reply')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(<AnnotationModal annotationOps={makeOps()} />)
    const ta = container.querySelector('.annotation-modal__footer textarea')
    fireEvent.input(ta, { target: { value: 'half-written' } })
    fireEvent.click(container.querySelector('.annotation-modal__backdrop'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(modalAnnotationId.value).toBe('a1')
    confirmSpy.mockRestore()
  })

  it('Ctrl+Enter in footer calls addReply and clears draft', () => {
    const ann = { id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'c', selectors: { quote: { exact: 'q' } }, replies: [] }
    setup([ann], 'reply')
    const ops = makeOps()
    const { container } = render(<AnnotationModal annotationOps={ops} />)
    const ta = container.querySelector('.annotation-modal__footer textarea')
    fireEvent.input(ta, { target: { value: 'my reply' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(ops.addReply).toHaveBeenCalledWith('a1', 'my reply')
  })
})
```

- [ ] **Step 12.3: Run tests**

Run: `npx vitest run tests/unit/annotation-modal.test.jsx`
Expected: ALL PASS.

- [ ] **Step 12.4: Commit**

```bash
git add src/ui/components/AnnotationModal.jsx tests/unit/annotation-modal.test.jsx
git commit -m "feat(ui): add AnnotationModal for dedicated edit/reply experience"
```

---

## Task 13: Wire RightPanel to the modal + mount modal in app

**Files:**
- Modify: `src/ui/components/RightPanel.jsx`
- Modify: `src/ui/app.jsx`
- Delete: `src/ui/components/ReplyThread.jsx`
- Modify: `tests/unit/right-panel.test.jsx`

- [ ] **Step 13.1: Rewrite `AnnotationCard` inside `RightPanel.jsx`**

Update imports at the top (remove `AnnotationForm`, remove `ReplyThread`, add `openAnnotationModal`):

```jsx
import { useState } from 'preact/hooks'
import { rightPanelOpen, filteredAnnotations, selectedAnnotationId, showResolved,
         filterTag, filterAuthor, uniqueTags, uniqueAuthors, openAnnotations,
         anchoredAnnotations, orphanedAnnotations, driftWarning,
         openAnnotationModal } from '../state/store.js'
```

Remove the `const [editingId, setEditingId] = useState(null)` line inside `RightPanel`.

Replace `AnnotationCard` body with:

```jsx
function AnnotationCard({ ann, isSelected, onClick, annotationOps, orphaned = false }) {
  return (
    <div
      data-annotation-id={ann.id}
      class={`annotation-card ${isSelected ? 'selected' : ''} ${ann.status === 'resolved' ? 'resolved' : ''} ${orphaned ? 'orphaned' : ''}`}
      onClick={onClick}
    >
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px">
        <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
        <span style="font-size: 11px; color: var(--text-muted)">{ann.author}</span>
        {ann.status === 'resolved' && <span style="font-size: 10px; color: var(--status-approved)">✓ resolved</span>}
        {orphaned && <span style="font-size: 10px; color: var(--tag-bug)">not found</span>}
        {ann.replies?.length > 0 && (
          <span style="font-size: 10px; color: var(--text-muted); margin-left: auto">
            {ann.replies.length} {ann.replies.length === 1 ? 'reply' : 'replies'}
          </span>
        )}
      </div>

      {ann.selectors?.quote?.exact && (
        <div class="quote">{ann.selectors.quote.exact}</div>
      )}

      <div style="font-size: 13px; margin-top: 4px">{ann.comment}</div>

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
          <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); openAnnotationModal(ann.id, 'edit') }}>
            Edit
          </button>
          <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); openAnnotationModal(ann.id, 'reply') }}>
            Reply
          </button>
          <button class="btn btn-sm btn-danger" onClick={(e) => {
            e.stopPropagation()
            if (confirm('Delete this annotation?')) annotationOps.deleteAnnotation(ann.id)
          }}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
```

Also remove the `ReplyInput` function from the bottom of the file (everything after the last `function OrphanedSection` through end of file, except the module's exports).

Remove `editingId` / `setEditingId` props from `AnnotationCard` and `OrphanedSection` call sites (above).

- [ ] **Step 13.2: Delete `ReplyThread.jsx`**

```bash
git rm src/ui/components/ReplyThread.jsx
```

- [ ] **Step 13.3: Mount `AnnotationModal` in `app.jsx`**

Open `src/ui/app.jsx`. Add import:

```jsx
import { AnnotationModal } from './components/AnnotationModal.jsx'
```

In the main return / JSX tree, add `<AnnotationModal annotationOps={annotationOps} />` as a sibling of the existing top-level layout (e.g., next to `<Content />`, `<RightPanel />`). Location-wise, put it last in the tree so it stacks above everything.

- [ ] **Step 13.4: Update `tests/unit/right-panel.test.jsx`**

Remove or rewrite any test that asserts inline edit form or inline reply input. Add:

```jsx
describe('Card action buttons route through modal signals', () => {
  it('clicking Edit sets modalAnnotationId and modalOpenMode="edit"', async () => {
    const store = await import('../../src/ui/state/store.js')
    // Use existing test helper to render with one annotation selected
    const { getByText } = renderPanelWithSelectedAnnotation('ann-1') // use file's existing helper
    fireEvent.click(getByText('Edit'))
    expect(store.modalAnnotationId.value).toBe('ann-1')
    expect(store.modalOpenMode.value).toBe('edit')
  })

  it('clicking Reply sets modalAnnotationId and modalOpenMode="reply"', async () => {
    const store = await import('../../src/ui/state/store.js')
    const { getByText } = renderPanelWithSelectedAnnotation('ann-1')
    fireEvent.click(getByText('Reply'))
    expect(store.modalAnnotationId.value).toBe('ann-1')
    expect(store.modalOpenMode.value).toBe('reply')
  })

  it('no inline annotation-form inside selected card', () => {
    const { container } = renderPanelWithSelectedAnnotation('ann-1')
    expect(container.querySelector('.annotation-card .annotation-form')).toBeNull()
  })

  it('no inline reply-input inside selected card', () => {
    const { container } = renderPanelWithSelectedAnnotation('ann-1')
    expect(container.querySelector('.annotation-card .reply-input')).toBeNull()
  })
})
```

*Implementing agent:* `renderPanelWithSelectedAnnotation` is a placeholder — replace with the actual helper name used elsewhere in `right-panel.test.jsx`.

- [ ] **Step 13.5: Run tests**

Run: `npx vitest run tests/unit/right-panel.test.jsx tests/unit/annotation-modal.test.jsx`
Expected: ALL PASS.

- [ ] **Step 13.6: Commit**

```bash
git add -A
git commit -m "refactor(ui): route Edit/Reply through AnnotationModal; drop inline forms"
```

---

## Task 14: CSS — modal styles + reply parity

**Files:**
- Modify: `src/ui/styles/themes.css`

- [ ] **Step 14.1: Replace the `/* Reply thread */` block**

Find the block starting at `.reply {` (around line 834) and replace the entire block (all `.reply*` and `.reply-input*` rules through line ~886) with:

```css
/* --------------------------------------------------------------------------
   Replies (in AnnotationModal)
   -------------------------------------------------------------------------- */
.reply-list {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.reply-list__separator {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 8px;
}

.reply {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.reply:last-child { border-bottom: none; }

.reply__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.reply__author { font-weight: 600; color: var(--text-secondary); }
.reply__time { font-size: 11px; }
.reply__actions { margin-left: auto; display: flex; gap: 6px; }

.reply__body {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
  white-space: pre-wrap;
}

.reply--editing { padding: 0; }
```

- [ ] **Step 14.2: Append modal styles at the end of `themes.css`**

```css
/* --------------------------------------------------------------------------
   Annotation Modal
   -------------------------------------------------------------------------- */
.annotation-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.annotation-modal {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  width: min(720px, 100%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.annotation-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.annotation-modal__title {
  font-size: 14px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.annotation-modal__author { font-weight: 600; color: var(--text-primary); }

.annotation-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}

.annotation-modal__quote {
  font-style: italic;
  color: var(--text-secondary);
  border-left: 3px solid var(--accent);
  padding: 8px 12px;
  margin-bottom: 16px;
  font-size: 13px;
  background: rgba(137, 180, 250, 0.05);
  border-radius: 0 4px 4px 0;
}

.annotation-modal__root { margin-bottom: 12px; }

.annotation-modal__root-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.annotation-modal__root-body {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
  white-space: pre-wrap;
}

.annotation-modal__footer {
  display: flex;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
  align-items: flex-end;
}

.annotation-modal__footer textarea {
  flex: 1;
  min-height: 80px;
  max-height: 200px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  line-height: 1.5;
}

.annotation-modal__footer textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(137, 180, 250, 0.25);
}
```

- [ ] **Step 14.3: Run UI build to verify no CSS errors**

Run: `npm run build:ui`
Expected: build succeeds.

- [ ] **Step 14.4: Commit**

```bash
git add src/ui/styles/themes.css
git commit -m "style(ui): add modal styles and reply parity typography"
```

---

## Task 15: E2E — happy path modal flow

**Files:**
- Create: `tests/e2e/annotation-modal-flow.spec.js`

- [ ] **Step 15.1: Write the test (match existing tests/e2e helper pattern)**

Look at any existing `tests/e2e/*.spec.js` to match how the project starts the server and navigates. Template:

```js
// tests/e2e/annotation-modal-flow.spec.js
import { test, expect } from '@playwright/test'
// Use whatever helper existing e2e tests use — e.g.:
// import { startTestServer } from './helpers/server.js'

test('create → open modal → reply → edit reply → delete reply', async ({ page }) => {
  const { url, filePath } = await startTestServer({ fixture: 'simple.md' })
  await page.goto(url)

  // Select a word to create an annotation
  const p = page.locator('p').first()
  await p.evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  })
  await p.dispatchEvent('mouseup')

  await page.fill('.popover textarea', 'root annotation')
  await page.click('.popover button[type="submit"]')
  await expect(page.locator('mark[data-highlight-id]')).toHaveCount(1)

  // Select the card, then Reply
  await page.click('.annotation-card')
  await page.click('.annotation-card button:has-text("Reply")')
  await expect(page.locator('.annotation-modal')).toBeVisible()

  // Send reply
  await page.fill('.annotation-modal__footer textarea', 'my first reply')
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('.reply__body', { hasText: 'my first reply' })).toBeVisible()

  // Edit reply
  await page.click('.reply button:has-text("Edit")')
  await page.fill('.reply textarea', 'edited reply')
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('.reply__body', { hasText: 'edited reply' })).toBeVisible()

  // Delete reply
  page.on('dialog', d => d.accept())
  await page.click('.reply button:has-text("Delete")')
  await expect(page.locator('.reply')).toHaveCount(0)

  // ESC closes
  await page.keyboard.press('Escape')
  await expect(page.locator('.annotation-modal')).not.toBeVisible()
})
```

- [ ] **Step 15.2: Run E2E**

Run: `npm run test:e2e -- tests/e2e/annotation-modal-flow.spec.js`
Expected: PASS.

- [ ] **Step 15.3: Commit**

```bash
git add tests/e2e/annotation-modal-flow.spec.js
git commit -m "test(e2e): cover annotation modal happy path"
```

---

## Task 16: E2E — performance smoke

**Files:**
- Create: `tests/e2e/annotation-perf.spec.js`
- Create: `tests/e2e/fixtures/large-with-100-annotations.md`
- Create: `tests/e2e/fixtures/large-with-100-annotations.annotations.yaml`

- [ ] **Step 16.1: Generate the fixture**

Create `tests/e2e/fixtures/large-with-100-annotations.md` with at least 60 lines of repeating text. Concretely, write this content:

```md
# Perf fixture

Line one with word alpha.
Line two with word beta.
Line three with word gamma.
Line four with word delta.
(repeat with unique line content through line 60)
```

Generate the annotation sidecar via Node (run this one-off command):

```bash
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const anns = [];
for (let i = 0; i < 100; i++) {
  anns.push({
    id: 'ann-' + i,
    selectors: { position: { startLine: (i % 50) + 2, startColumn: 1, endLine: (i % 50) + 2, endColumn: 5 }, quote: { exact: 'Line', prefix: '', suffix: '' } },
    comment: 'test annotation ' + i,
    tag: 'question', author: 'test', status: 'open', replies: [],
  });
}
fs.writeFileSync('tests/e2e/fixtures/large-with-100-annotations.annotations.yaml', yaml.dump({ annotations: anns }));
console.log('fixture written');
"
```

- [ ] **Step 16.2: Write the spec**

```js
// tests/e2e/annotation-perf.spec.js
import { test, expect } from '@playwright/test'
// import { startTestServer } from './helpers/server.js' — match existing pattern

test('rapid resolve of annotations keeps long tasks below budget', async ({ page }) => {
  const { url, filePath } = await startTestServer({ fixture: 'large-with-100-annotations.md' })
  await page.goto(url)
  await expect(page.locator('mark[data-highlight-id]').first()).toBeVisible()

  const longTaskCount = await page.evaluate((file) => {
    return new Promise(resolve => {
      let count = 0
      const obs = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (entry.duration > 100) count++
      })
      obs.observe({ entryTypes: ['longtask'] })

      const resolves = []
      for (let i = 0; i < 20; i++) {
        resolves.push(fetch('/api/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file, action: 'resolve', data: { id: 'ann-' + i } }),
        }))
      }
      Promise.all(resolves).then(() => setTimeout(() => { obs.disconnect(); resolve(count) }, 500))
    })
  }, filePath)

  // Regression guard: the old nuke-and-pave would produce many long tasks during
  // a burst of resolves. With diff-based updates, we expect at most 2.
  expect(longTaskCount).toBeLessThan(3)
})
```

- [ ] **Step 16.3: Run E2E**

Run: `npm run test:e2e -- tests/e2e/annotation-perf.spec.js`
Expected: PASS (long-task count < 3).

- [ ] **Step 16.4: Commit**

```bash
git add tests/e2e/annotation-perf.spec.js tests/e2e/fixtures/large-with-100-annotations*
git commit -m "test(e2e): add rapid-resolve performance smoke"
```

---

## Task 17: Release prep — version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify (or create): `CHANGELOG.md`

- [ ] **Step 17.1: Bump version**

In `package.json`, change `"version": "0.4.3"` to `"version": "0.5.0"`.

- [ ] **Step 17.2: Write the CHANGELOG entry (prepend, create file if absent)**

Prepend to `CHANGELOG.md`:

```markdown
# Changelog

## [0.5.0] — 2026-04-24

### Added
- **AnnotationModal**: a dedicated centered dialog (~720 px) for editing annotations and managing reply threads. Opens via the Edit or Reply button on an annotation card.
- **Reply editing and deletion**: replies now have stable ids (assigned server-side, backfilled on load) and can be edited or deleted by their author.
- Pluggable `Highlighter` interface — future CSS Custom Highlight API migration will drop in without touching UI or data.

### Changed
- **Highlight performance**: annotation saves/edits/resolves now produce diff-based DOM updates instead of full nuke-and-pave. Selecting an annotation no longer rebuilds highlights. Together these eliminate the browser freeze on repeated edits.
- **Reply visual parity**: replies share typography with the root comment (no more "second-class" quote styling).
- Inline edit form inside right-panel cards has been replaced by the modal.
- Inline reply input at the bottom of right-panel cards has been moved into the modal.

### Internal
- Introduces `src/ui/diff/annotation-diff.js` and `src/ui/highlighters/`.
- Three separate `useEffect` blocks in `Content.jsx` now decoupled by concern (highlights, selection, decorations).
```

- [ ] **Step 17.3: Run full test suite**

Run: `npm test`
Expected: ALL PASS.

Run: `npm run test:e2e`
Expected: ALL PASS.

- [ ] **Step 17.4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release 0.5.0 — annotations v2 (perf + modal)"
```

**Do NOT tag, publish, or push to main** — per `feedback_no_auto_release.md`, releases require explicit user approval. Stop here and hand back to the user.

---

## Appendix — Self-review

**Spec coverage check:**

| Spec §  | Covered by task(s) |
|---|---|
| §4.1 Diff-based highlights | 1, 2 |
| §4.2 Decouple the three useEffect | 3 |
| §4.3 Remove normalize() from hot loop | 2 (inherited from clean extract) |
| §4.4 rAF 2-frame debounce | 3 |
| §4.5 Highlighter interface | 2 |
| §4.6 Perf envelope verification | 16 |
| §5.1–5.5 Modal + forms + replies | 9, 10, 11, 12, 13 |
| §5.6 Right-panel behavior change | 13 |
| §5.7 Deletion semantics | 6, 10, 12 |
| §6 Reply id backfill | 5 |
| §7 Testing strategy | 1–16 (test-first) |
| §8 Rollout (v0.5.0, no flag) | 17 |

**Placeholder scan:** No `TBD` or `implement later`. Helper names like `startTestServer` / `renderUseAnnotations` / `renderPanelWithSelectedAnnotation` are called out as "match the existing helper in the file" rather than invented — the implementing agent must read the file and use the real helper name.

**Type/name consistency:**
- `diffAnnotations(prev, next, { showResolved })` signature used consistently across Tasks 1, 2, 3.
- `createMarkHighlighter()` returns `{ sync, clear, setSelection }` with consistent args across Tasks 2, 3.
- `openAnnotationModal(id, mode)` / `closeAnnotationModal()` signature consistent across Tasks 8, 12, 13.
- `editReply(annId, replyId, comment)` and `deleteReply(annId, replyId)` — same signature in Tasks 6 (server), 7 (client hook), 10/11/12 (UI consumers).

No unresolved issues.

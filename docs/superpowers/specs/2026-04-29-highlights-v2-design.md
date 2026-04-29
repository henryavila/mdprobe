# Highlights v2 — Precise + High-Performance Anchoring

**Date:** 2026-04-29
**Status:** Draft for review
**Authors:** @henry, Claude
**Scope:** Single consolidated release (v0.5.0). Replaces the highlight rendering layer entirely. Keeps Stream B work (modal + reply parity, commits T5–T14) intact.
**Predecessor:** `docs/superpowers/specs/2026-04-24-annotations-v2-design.md` (Stream A of that spec is superseded; Stream B remains.)

---

## 1. Problem statement

The current highlight rendering layer suffers from two distinct, structurally-related defects observed in production use of mdprobe:

1. **Imprecise selections.** Selecting from the middle of one line through the middle of another saves an annotation that, on re-anchor, expands to cover entire lines (sometimes spilling onto adjacent lines). Root cause: the existing `mark-highlighter.js` has a 3-strategy fallback chain whose Strategy 3 (`highlightLineRange`) destacates entire lines from `startLine` to `endLine` when exact and cross-element matches fail. This was a desperation fallback; it became the visible bug.

2. **Browser freeze on save/edit.** Any annotation save triggers full nuke-and-pave: every `<mark>` element removed, every annotation re-anchored, every `<mark>` re-injected. This thrashes the GPU compositor in documents with even moderate annotation density.

Both problems share a common architectural root: the persistence layer stores `(line, column)` + `quote.exact` and the renderer attempts to find that exact text in the rendered HTML via string matching. Markdown→HTML rendering transforms whitespace, indentation, and inline structure — making string matching unreliable. The line-range fallback was added to mask this, but it became a feature bug.

A previous attempt (Stream A of `2026-04-24-annotations-v2-design.md`) reduced the freeze severity via diff-based mark mutation, but did not fix precision and retained the architectural mismatch. This spec replaces the entire approach.

## 2. Goals and non-goals

### Goals

- **Precision**: char-precise highlighting of the exact text the user selected, regardless of how the selection crosses block elements, inline elements, or whitespace.
- **Performance**: zero-DOM-mutation rendering. Sub-100ms re-anchoring for 1000 annotations on typical documents. Click-to-select latency under 5ms.
- **Drift recovery**: annotations survive markdown edits gracefully via a multi-signal pipeline (5 fallback steps), with explicit thresholds preventing silent wrong-anchor failures.
- **Visual clarity for overlap**: multiple annotations covering the same text are visually distinguishable through natural alpha blending, with a clear z-order rule (newer on top).
- **Zero data loss across migration**: existing `.annotations.yaml` files (schema v1) are migrated automatically to v2 with a `.bak` backup.

### Non-goals (explicit)

- Supporting browsers without CSS Custom Highlight API. v0.5.0 is a hard requirement (Chrome 105+, Firefox 140+, Safari 17.2+).
- Stable block ID injection in the markdown source (Obsidian-style `^id`). Considered and deferred — adds source pollution that can break under external editors.
- Embedding-based semantic anchoring. Considered and rejected — risk of false positives across topically related paragraphs without character precision.
- Multi-user concurrent editing of the same annotations file. mdprobe remains single-user.
- Hover preview tooltip on highlights. Click is the sole interaction at the text level; the right panel is the preview surface.

## 3. High-level architecture

Three layers, fully decoupled:

```
                ┌─────────────────────────────────────┐
                │   Source markdown (.md file)        │
                └──────────────┬──────────────────────┘
                               ▼
                ┌─────────────────────────────────────┐
                │   Renderer (renderer.js)            │
                │   markdown → HTML                   │
                │   Each block/inline element gains   │
                │   data-source-start/end attributes  │
                │   (UTF-16 char offsets in source)   │
                └──────────────┬──────────────────────┘
                               ▼
                ┌─────────────────────────────────────┐
                │   .content-area (DOM)               │
                └──────────┬─────────────┬────────────┘
                           │             │
                           ▼             ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │  describe()          │    │  locate() pipeline   │
        │  Selection → Selectors│   │  Selectors → Range[] │
        │  (capture)           │    │  (hydrate)           │
        └──────────┬───────────┘    └──────────┬───────────┘
                   │                            │
                   ▼                            ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │ .annotations.yaml    │    │ CSS Custom Highlight │
        │ (schema v2)          │    │ API: paints ranges   │
        │ range + quote +      │    │ no DOM mutation      │
        │ anchor (multi-signal)│    │                      │
        └──────────────────────┘    └──────────────────────┘
```

**Key separation:** `anchoring/v2/` is pure JS that knows nothing about CSS or DOM mutation. `highlighters/css-highlight-highlighter.js` is pure DOM API that knows nothing about anchoring algorithms. The handoff is the `Range[]` produced by `locate()`.

## 4. Schema v2 — Data model

### Per-annotation YAML

```yaml
schema_version: 2
annotations:
  - id: 7d3f1a2b
    author: henry
    tag: question                    # | bug | suggestion | nitpick
    status: open                     # | resolved | drifted | orphan
    comment: "Por que essa flag está hardcoded?"
    created_at: 2026-04-25T14:30:00Z
    updated_at: 2026-04-25T14:30:00Z

    range:
      start: 1245                    # UTF-16 char offset in the source markdown
      end: 1289

    quote:
      exact: "FEATURE_FLAG = true"
      prefix: "...32 chars before..."
      suffix: "...32 chars after..."

    anchor:
      contextHash: "sha256:7f3a..."  # sha256(prefix + exact + suffix)
      treePath:
        headingText: "Configuração"
        headingLevel: 2
        paragraphIndex: 3
        paragraphFingerprint: "minhash:a4f2..."
        charOffsetInParagraph: 45
      keywords:
        - { word: "FEATURE_FLAG", distFromStart: 0 }
        - { word: "hardcoded", distFromStart: 18 }

    replies:                         # unchanged from current schema
      - id: r1
        author: ...
        comment: ...
        created_at: ...

config:
  source_hash: "sha256:..."          # hash of source markdown at last write
  last_anchored: 2026-04-28T...
  schema_version: 2
```

### Field roles

| Field | Purpose | Pipeline step that uses it |
|---|---|---|
| `range.start/end` | Primary char-offset anchor | Steps 0, 1, 2, click resolver, render |
| `quote.exact` | Drift recovery target text | Steps 0, 1, 2 |
| `quote.prefix/suffix` | Disambiguation context (32 chars each side) | Step 2 fuzzy |
| `anchor.contextHash` | Fast-path integrity check | Step 0 |
| `anchor.treePath.*` | Structural fallback when fuzzy fails | Step 3 |
| `anchor.keywords` | Last resort before orphan | Step 4 |
| `status` | Visual state and lifecycle | UI rendering |

### Removal from schema v1

The following fields disappear in v2:

- `selectors.position { startLine, startColumn, endLine, endColumn }` — replaced by `range { start, end }`.

`quote { exact, prefix, suffix }` is preserved (already exists in v1).

### Migration policy (auto + CLI hybrid)

**Auto-migration on load** (default, transparent):

1. mdprobe reads a `.annotations.yaml`.
2. If `schema_version` missing or `< 2` → trigger migrate.
3. Backup written: `<file>.annotations.yaml.bak` (overwriting any prior `.bak`).
4. **Essential backfill only** in memory:
   - `range.start/end` from `(line, col)` + source.
   - `quote.exact/prefix/suffix` copied from v1 (already present) or recomputed from source.
   - `anchor.contextHash` = sha256(prefix + exact + suffix).
   - `anchor.treePath`, `anchor.keywords` left empty (computed lazily on first re-anchor).
5. Atomic write: `.tmp` → `rename()` (POSIX atomic).
6. Console log: `mdprobe: migrated N annotations to schema v2 in <file> (backup: <file>.bak)`.
7. UI toast (5 seconds): "Anotações atualizadas para nova estrutura. Backup salvo."
8. On migrate failure: do NOT write. Keep v1 file. Log error. UI toast (red): "Erro ao atualizar anotações. Arquivo não foi modificado."

**CLI command** (optional, power-user / batch):

```
npx mdprobe migrate <path>          # migrate single file or recursive in directory
npx mdprobe migrate <path> --dry-run # report what would change, no writes
```

CLI uses the same internal function as auto-migration. Output is stdout (suitable for CI / scripts).

## 5. Module structure

### New files

```
src/anchoring/
  v2/
    schema.js          # version detection; serializer; v1 → v2 transformer (essential)
    migrate.js         # backup + atomic write; orchestrates schema.js
    capture.js         # describe(): DOM Range → Selectors
    locate.js          # 5-step pipeline; returns { ranges, state, score }
    fingerprint.js     # MinHash on normalized word sets
    keywords.js        # Rare-word extraction (TF-IDF-light)
    fuzzy.js           # approx-string-match wrapper
    treepath.js        # mdast → tree-path selectors
  index.js             # public API: describe(), locate()

src/ui/highlighters/
  css-highlight-highlighter.js    # implements { sync, syncOne, clear, setSelection }
  unsupported-modal.jsx           # hard-requirement boot modal
  capability.js                   # CSS.highlights detection

src/ui/click/
  resolver.js                     # caretPositionFromPoint → annotation lookup

src/cli/
  migrate-cmd.js                  # CLI entry; calls anchoring/v2/migrate.js
```

### Modified files

```
src/renderer.js                   # rehypeSourcePositions extended: emit data-source-start/end
src/annotations.js                # auto-migration trigger on load; atomic save with backup
src/ui/components/Content.jsx     # swap to CSS highlighter; click resolver wiring
src/ui/components/RightPanel.jsx  # render `drifted` and `orphan` sections; counters
src/ui/state/store.js             # signals: currentSource, currentMdast (added)
src/ui/styles/themes.css          # ::highlight() rules; remove old .annotation-highlight
package.json                      # add approx-string-match dep
bin/cli.js                        # route 'migrate' subcommand to migrate-cmd
```

### Removed files

```
src/ui/highlighters/mark-highlighter.js    # superseded by css-highlight-highlighter
src/anchoring.js                            # superseded by anchoring/v2/
```

### Module dependency graph

```
Content.jsx
  ├──> highlighters/css-highlight-highlighter.js
  │      └──> anchoring/v2/locate.js
  │             ├──> anchoring/v2/fuzzy.js
  │             ├──> anchoring/v2/fingerprint.js
  │             ├──> anchoring/v2/keywords.js
  │             └──> anchoring/v2/treepath.js
  ├──> ui/click/resolver.js
  └──> highlighters/capability.js
         └──> unsupported-modal.jsx (when !supported)

annotations.js (server)
  └──> anchoring/v2/migrate.js
         └──> anchoring/v2/schema.js

renderer.js
  └──> rehype custom plugin (extended)

cli/migrate-cmd.js
  └──> anchoring/v2/migrate.js
```

### Decomposition principles

- **`anchoring/v2/` is pure JS, no UI deps.** Testable headless. Reusable from CLI/MCP/server.
- **Each pipeline component (`fuzzy.js`, `keywords.js`, etc.) is 80–150 lines.** Local reasoning, isolated tests.
- **`migrate.js` is invoked by both auto-migration and CLI.** Zero code duplication.
- **`click/resolver.js` is the single point that mixes DOM with annotation lookup.** Concentrates edge cases.

## 6. Pipeline — Capture and hydration

### 6.1 Renderer extension

`src/renderer.js` already has `rehypeSourcePositions` that injects `data-source-line`. Extend it to also emit `data-source-start` and `data-source-end` from `node.position.start.offset` and `node.position.end.offset` (UTF-16 absolute char offsets, guaranteed by remark-parse).

This plugin must run **before `rehype-raw`** (which destroys `position` metadata). The current pipeline already follows this order — preserve it.

Cost: ~2 attributes per element. ~6 KB extra HTML on a 200-element document. Negligible.

### 6.2 `describe(range, contentEl, source)` — selection capture

Inputs:
- `range`: a DOM `Range` object from `window.getSelection().getRangeAt(0)`
- `contentEl`: the `.content-area` root
- `source`: the current markdown source string

Output: `{ range, quote, anchor }` per the schema.

Algorithm:

1. From `range.startContainer` (a TextNode), walk parents until ancestor with `[data-source-start]`.
2. `start = parseInt(ancestor.dataset.sourceStart) + textOffsetWithinAncestor(ancestor, range.startContainer, range.startOffset)`
3. Same for `end`.
4. `quote.exact = source.slice(start, end)` — extract from the **source string**, not from `range.toString()`.
   - Rationale: `range.toString()` collapses whitespace between block elements. The source preserves exact char fidelity.
5. `quote.prefix = source.slice(max(0, start-32), start)`, `quote.suffix = source.slice(end, end+32)`.
6. `anchor.contextHash = sha256(prefix + exact + suffix)`.
7. `anchor.treePath` derived from mdast walk: find heading parent, paragraph index in section, char offset within paragraph.
8. `anchor.keywords` = top 2–3 words by inverse-frequency-in-source within `quote.exact`. Skip stop-words.

`textOffsetWithinAncestor()` uses `TreeWalker(NodeFilter.SHOW_TEXT)` to count chars in text nodes preceding `range.startContainer`, plus `range.startOffset`. ~30 lines, headless-testable.

### 6.3 `locate(annotation, source, contentEl, mdast)` — drift recovery pipeline

Inputs:
- `annotation`: object with `range`, `quote`, `anchor`
- `source`: current markdown source string
- `contentEl`: DOM root for Range construction
- `mdast`: parsed AST (cached across all annotations of the same file load)

Output:
```
{
  domRanges: Range[],
  state: 'confident' | 'drifted' | 'orphan',
  score: number  // 0..1
}
```

#### Step 0 — Integrity check (target: 99% of cases, ~0.1ms)

```
currentHash = sha256(source.slice(start-32, start) +
                     source.slice(start, end) +
                     source.slice(end, end+32))
if currentHash === annotation.anchor.contextHash:
  → use range.start/end directly
  → state = confident, score = 1.0
  return
```

When the file has not changed since last save (the common case), this is the only step that runs.

#### Step 1 — Exact match search (~1ms)

```
matches = findAllOccurrences(source, annotation.quote.exact)
if matches.length === 1:
  → start = matches[0]; end = start + quote.exact.length
  → state = confident, score = 0.95
  return
if matches.length > 1:
  → multiple candidates; pass to Step 2 with all candidates as hints
```

#### Step 2 — Fuzzy quote + context (Myers bit-parallel via approx-string-match)

```
maxErrors = min(32, floor(quote.exact.length * 0.25))

# Bound the search window to ±2000 chars from the original hint position
window = source.slice(max(0, hint - 2000), hint + 2000)

candidates = approxSearch(window, quote.exact, maxErrors)

for c in candidates:
  prefixSim = similarity(quote.prefix, source.slice(c-32, c))
  suffixSim = similarity(quote.suffix, source.slice(c+exactLen, c+exactLen+32))
  quoteSim  = 1 - (c.errors / quote.exact.length)
  posScore  = 1 - (abs(c - hint) / source.length)
  c.score = (50*quoteSim + 20*prefixSim + 20*suffixSim + 2*posScore) / 92

best = max(candidates by score)

if best.score >= 0.80:
  → state = confident; return
elif best.score >= 0.60:
  → state = drifted; return  # UI shows dashed-amber underline + acknowledge prompt
else:
  → next step
```

**Threshold rationale:**
- `maxErrors = 25%` of quote length is more conservative than Hypothesis's 50%, deliberately reducing false positives at modest cost in false negatives. A 14-char quote tolerates 3 character edits (typo + space). A 100-char quote tolerates 25 (paragraph-level rephrase).
- `score >= 0.60` floor prevents the silent-wrong-anchor failure mode documented in Hypothesis's issue tracker. Below 0.60, the quote contributes too weakly relative to the (potentially noisy) context match.
- `score >= 0.80` for confident keeps high precision: at this score, quote match alone exceeds 0.7, prefix and suffix both near 1.0.

#### Step 3 — Tree-path matching (mdast structural)

```
heading = findHeadingByText(mdast, anchor.treePath.headingText)
  # exact match preferred; fallback to Levenshtein <= 2 for typo recovery

if !heading:
  → next step

paragraphs = paragraphsUnder(mdast, heading)
candidates = paragraphs[paragraphIndex-1 .. paragraphIndex+1]

for p in candidates:
  fpSim = jaccard(minhash(p.text), anchor.treePath.paragraphFingerprint)
  kwsPresent = countKeywordsIn(p.text, anchor.keywords)
  idxProx = 1 - abs(p.index - paragraphIndex) / 10
  p.score = 0.4*fpSim + 0.4*(kwsPresent/anchor.keywords.length) + 0.2*idxProx

bestParagraph = max(candidates by score)

if bestParagraph.score >= 0.65:
  → run Step 2 fuzzy DENTRO de bestParagraph.text only
  → if Step 2 returns score >= 0.60: state = drifted, return
  → else: next step
```

**Why this works:** survives paragraph reordering between unrelated sections, and survives typo edits within the annotated paragraph (paragraph fingerprint tolerates ~30% word changes).

#### Step 4 — Keyword distance search

```
for keyword in anchor.keywords:
  occurrences = findAllOccurrences(source, keyword.word)
  for occ in occurrences:
    expectedStart = occ - keyword.distFromStart
    fuzzyResult = approxSearch(
      source.slice(expectedStart-50, expectedStart+50+exactLen),
      quote.exact,
      maxErrors
    )
    if fuzzyResult.score >= 0.75:
      → state = drifted, return
```

Higher threshold (0.75) here because keyword search has more false-positive surface than context-windowed fuzzy.

#### Step 5 — Orphan

```
return { domRanges: [], state: 'orphan', score: 0 }
```

### 6.4 DOM Range construction from char offsets

Once `locate` returns `{ start, end, state }`:

```
1. elements = contentEl.querySelectorAll('[data-source-start]')
2. Filter: elements where [start, end) intersects [el.sourceStart, el.sourceEnd)
3. For each intersecting element:
   - Walk text nodes within the element
   - For each text node, compute its source offset (parent's sourceStart + cumulative text length)
   - Determine the offset range within the text node that intersects [start, end)
   - Create a Range with setStart(textNode, relStart) / setEnd(textNode, relEnd)
4. Return list of Ranges (one per intersecting element, possibly fragmented within an element)
5. Sanity check: concatenated Range.toString() should match quote.exact (modulo block-separator whitespace)
```

**Why multiple Ranges:** a selection spanning two paragraphs produces two Ranges (one per `<p>`). CSS Custom Highlight API accepts multi-Range in a single Highlight. Visual result: exact text fragment in P1 + exact text fragment in P2, with a natural rendering gap between them. **The line-expansion bug is structurally impossible.**

### 6.5 Edge cases — coverage matrix

| Scenario | Expected behavior | Pipeline handles via |
|---|---|---|
| Selection mid-P1 → mid-P2 | 2 Range fragments, gap between | Multi-element Range builder |
| Selection through inline `<code>` | Code segment highlighted; outer text continues | Each text node gets its own Range fragment |
| Selection across list `<li>` items | List markers (bullets) NOT highlighted | Range only spans text nodes, not marker pseudo-content |
| Selection includes heading + paragraph below | Heading partial + paragraph partial | 2 Ranges, one per element |
| HTML entities (`&lt;`) in code blocks | Source offset diverges from rendered text | Step 0 hash mismatch → Step 1+ resolves |
| Whitespace collapse (source: 2 spaces, DOM: 1 space) | Same situation | Same |
| Click on link `<a>` with Ctrl/Cmd | Browser navigates | Resolver returns null, default action proceeds |
| Click on link `<a>` without modifier | Annotation selected (per Q6 decision) | Resolver picks topmost annotation |
| Click on whitespace between paragraphs | Deselects | `caretPositionFromPoint` returns null or non-text node |
| Annotation covering entire line + sub-annotation on partial | Both visible, blended color in overlap region | Multi-Highlight with priority by created_at |
| Identical quote text in two locations | Step 1 finds 2 matches; Step 2 disambiguates via prefix/suffix | Step 1 → Step 2 |
| Annotation in deleted paragraph | Steps 1–4 fail | Step 5: orphan, surface in panel |
| Annotation after major refactor where keywords moved | Step 4 finds keyword + verifies via fuzzy | Step 4 succeeds with score ≥ 0.75 |

## 7. Rendering — CSS Custom Highlight integration

### 7.1 Boot capability check (hard requirement)

```js
// src/ui/highlighters/capability.js
export function isHighlightApiSupported() {
  return typeof CSS !== 'undefined'
      && CSS.highlights !== undefined
      && typeof Highlight === 'function'
}
```

In `app.jsx`, gate render:

```jsx
if (!isHighlightApiSupported()) {
  return <UnsupportedModal />
}
```

Modal explains: "mdProbe requer Chrome 105+, Firefox 140+ ou Safari 17.2+." The right panel still loads (lists annotations with quote text); only the inline highlight rendering is disabled.

### 7.2 Highlighter API

```js
// src/ui/highlighters/css-highlight-highlighter.js
export function createCssHighlightHighlighter() {
  const registry = new Map()         // ann.id → { highlight, ranges, state, name }
  let dynamicStyleEl = null

  return { sync, syncOne, clear, setSelection }

  function sync(contentEl, annotations, opts) {
    const { source, mdast, prevAnnotations = [] } = opts
    const { added, removed, kept } = diffAnnotations(prevAnnotations, annotations, opts)
    for (const id of removed) removeOne(id)
    for (const id of [...added, ...kept]) syncOne(id, contentEl, annotations, source, mdast)
  }

  function syncOne(id, contentEl, annotations, source, mdast) {
    const ann = annotations.find(a => a.id === id)
    if (!ann) return
    const { domRanges, state } = locate(ann, source, contentEl, mdast)
    if (state === 'orphan') {
      removeOne(id)
      // store reflects orphan state; RightPanel renders accordingly
      return
    }
    const h = new Highlight(...domRanges)
    h.priority = new Date(ann.created_at).getTime()
    const name = `ann-${id}`
    CSS.highlights.set(name, h)
    registry.set(id, { highlight: h, ranges: domRanges, state, name })
    upsertRule(contentEl, ann, state)
  }

  function clear(contentEl) {
    for (const id of [...registry.keys()]) removeOne(id)
  }

  function setSelection(contentEl, annotationId) {
    CSS.highlights.delete('ann-selected')
    if (annotationId == null) return
    const entry = registry.get(annotationId)
    if (!entry) return
    const sel = new Highlight(...entry.ranges)
    sel.priority = Number.MAX_SAFE_INTEGER
    CSS.highlights.set('ann-selected', sel)
  }

  function removeOne(id) {
    const entry = registry.get(id)
    if (!entry) return
    CSS.highlights.delete(entry.name)
    registry.delete(id)
    removeRule(id)
  }

  // upsertRule / removeRule: maintain a single <style id="mdprobe-highlight-rules">
  // with one CSSRule per annotation — `::highlight(ann-{id}) { ... }`
}
```

### 7.3 CSS rules

Static rule for selection (in `themes.css`):

```css
::highlight(ann-selected) {
  background-color: rgba(255, 235, 59, 0.45);
  text-decoration: underline 2px solid var(--accent);
}
```

Per-annotation rules (injected dynamically into `<style id="mdprobe-highlight-rules">`):

```css
::highlight(ann-7d3f1a2b) {
  background-color: rgba(137, 180, 250, 0.25);   /* tag color, alpha based on state */
}
::highlight(ann-9e2a1c8b) {
  background-color: rgba(243, 139, 168, 0.40);   /* drifted: higher alpha */
  text-decoration: underline 2px dashed var(--accent);
}
```

Tag color palette:

| Tag | Color (alpha 0.25 default) |
|---|---|
| question | `rgba(137, 180, 250, 0.25)` (blue) |
| bug | `rgba(243, 139, 168, 0.25)` (pink) |
| suggestion | `rgba(166, 227, 161, 0.25)` (green) |
| nitpick | `rgba(249, 226, 175, 0.25)` (yellow) |

Overlap behavior is the natural alpha-blending of the API: where two highlights cover the same chars, the higher-priority one paints on top, but because both alphas are sub-1, the colors mix. Distinct mixes give visual cues for overlap without explicit code.

### 7.4 Click handling

```js
// src/ui/click/resolver.js
export function resolveClickedAnnotation(event, contentEl, annotations) {
  // Edge case: link with Ctrl/Cmd → let browser navigate
  if (event.target.tagName === 'A' && (event.ctrlKey || event.metaKey)) {
    return null
  }

  const pos = document.caretPositionFromPoint(event.clientX, event.clientY)
  if (!pos || pos.offsetNode.nodeType !== Node.TEXT_NODE) {
    return null
  }

  // Walk to ancestor with [data-source-start]
  let el = pos.offsetNode.parentElement
  while (el && el !== contentEl && !el.hasAttribute('data-source-start')) {
    el = el.parentElement
  }
  if (!el || el === contentEl) return null

  const sourceOffset = parseInt(el.dataset.sourceStart) +
                       textOffsetWithinAncestor(el, pos.offsetNode, pos.offset)

  const candidates = annotations.filter(a =>
    a.range.start <= sourceOffset && sourceOffset < a.range.end
  )
  if (candidates.length === 0) return null

  // Topmost wins (priority = created_at); per Q6 decision
  return candidates.reduce((a, b) =>
    new Date(a.created_at) > new Date(b.created_at) ? a : b
  )
}
```

In `Content.jsx`:

```jsx
function handleContentClick(e) {
  const ann = resolveClickedAnnotation(e, contentRef.current, annotations.value)
  if (ann) {
    selectedAnnotationId.value = ann.id
  } else {
    selectedAnnotationId.value = null   // click in empty area deselects
  }
}
```

### 7.5 Three useEffect blocks in Content.jsx

```jsx
const highlighterRef = useRef(null)
const prevAnnsRef = useRef([])
if (!highlighterRef.current) highlighterRef.current = getHighlighter()

// (A) Sync — annotations or filter changed
useEffect(() => {
  highlighterRef.current.sync(contentRef.current, annotations.value, {
    source: currentSource.value,
    mdast: currentMdast.value,
    prevAnnotations: prevAnnsRef.current,
    showResolved: showResolved.value,
  })
  prevAnnsRef.current = annotations.value
}, [annotations.value, showResolved.value])

// (B) Selection — visual change only
useEffect(() => {
  highlighterRef.current.setSelection(contentRef.current, selectedAnnotationId.value)
}, [selectedAnnotationId.value])

// (C) HTML reload — clear and let next sync rebuild
useEffect(() => {
  highlighterRef.current.clear(contentRef.current)
  prevAnnsRef.current = []
}, [currentHtml.value])
```

### 7.6 Performance characteristics

For a 200-annotation document on a typical machine:

| Operation | Cost | Frequency |
|---|---|---|
| Boot first sync (file unchanged via Step 0 hash) | ~10ms | 1×/file load |
| Boot first sync (initial migrate, lazy backfill) | ~50–500ms | 1× per legacy file |
| Save one annotation (syncOne) | ~5–50ms | per edit |
| Click-to-select | ~1–3ms | per click |
| Selection visual update | ~0.1ms | per select |
| Resolve / reopen | ~5–50ms | per toggle |

Compared to v1 (pre-Stream A): save took 200–400ms with full DOM thrash. v2 is 50–80× faster on saves and char-precise.

## 8. UX states

### 8.1 Three lifecycle states

| `status` | Visual in text | Visual in right panel |
|---|---|---|
| `open` (anchor confident) | Highlight in tag color, alpha 0.25 | Normal card |
| `resolved` | Gray highlight, alpha 0.15 | Strikethrough/dimmed card |
| `drifted` | Highlight in tag color + dashed amber underline | Card with ⚠️ icon + "texto pode ter mudado" |
| `orphan` | No inline highlight | Card in dedicated "Não localizadas (N)" section |

### 8.2 `drifted` state flow

When the pipeline returns `drifted`:

1. Highlight rendered with dashed amber underline overlay (via the dynamic `::highlight()` rule).
2. Right-panel card surfaces ⚠️ icon and message: *"Texto próximo foi modificado — confirme se ainda faz sentido."*
3. Card exposes 3 action buttons:
   - **"Aceitar nova localização"** → updates `range`/`anchor.contextHash`; sets `status: open`. Future loads return confident at Step 0.
   - **"Re-anchor manual"** → activates selection mode (next text selection updates the anchor).
   - **"Descartar"** → confirm + delete.

The `drifted` state does NOT silently auto-promote to `confident`. Acknowledgment is required. This is the structural defense against silent wrong-anchor failures.

### 8.3 `orphan` state flow

When the pipeline returns `orphan`:

1. No inline highlight (no DOM region to attach to).
2. Right-panel renders a dedicated "Não localizadas (N)" collapsible section below active annotations.
3. Each orphan card shows:
   - Quote in blockquote: `> exact text`
   - Context: `prefix...exact...suffix`
   - Tag, author, comment, date
   - Action buttons: **"Re-attach manualmente"** or **"Descartar"**.

Orphans persist in the YAML — they are NOT auto-deleted. The user decides retention.

### 8.4 Manual re-attach mode

Triggered from a `drifted` or `orphan` card:

1. UI cursor mode shifts (subtle indicator at top bar: "Selecione o trecho correto").
2. The next text selection invokes `describe()` to recompute selectors.
3. Annotation's `range`, `quote`, `anchor` all updated; `status` set to `open`.
4. ESC cancels the mode.

Reuses `describe()` from initial creation — no separate code path.

### 8.5 Right panel changes

`RightPanel.jsx` (Stream B kept) gains:

1. Filter: `[ ] Show drifted only`.
2. Section "Drifted (N)" — separate from "Open (N)" if any.
3. Section "Não localizadas (N)" — collapsible, at end of panel.
4. Header counter: `(N open · M drifted · K orphan)` when applicable, else `(N open)`.

### 8.6 Migration UX

Auto-migration on file load:

1. Console log (terminal where mdprobe runs):
   `mdprobe: migrated N annotations to schema v2 in <file> (backup: <file>.bak)`
2. UI toast in the main view (5 seconds):
   "Anotações atualizadas para nova estrutura. Backup salvo." + dismiss button.
3. On migrate failure: NO write happens. Toast in red: "Erro ao atualizar anotações. Arquivo não foi modificado." + console error.

CLI (`mdprobe migrate`) outputs stdout instead of toasts, for CI/script compatibility.

### 8.7 No hover

Hover on highlights is intentionally not implemented. The right panel is the canonical detail surface; click is the sole text-level interaction. This avoids:

- The cost of `mousemove` listener computing hit-testing against highlight ranges.
- The accessibility complications of CSS Highlight API not supporting `:hover` pseudo-class natively.

May be revisited if user feedback demands it.

## 9. Testing strategy

### 9.1 Unit tests (Vitest, headless)

**`anchoring/v2/capture.test.js`**
- `describe()` for selection within single text node
- `describe()` for selection spanning two paragraphs
- `describe()` for selection through inline `<code>`
- `describe()` for selection across heading + paragraph
- `describe()` extracts `quote.exact` from source, not from `range.toString()`
- `describe()` produces correct `prefix`/`suffix` even at document boundaries

**`anchoring/v2/locate.test.js`** — pipeline tests
- Step 0: hash match → confident, score 1.0
- Step 0: hash mismatch → falls through to Step 1
- Step 1: single exact match → confident
- Step 1: zero matches → Step 2
- Step 1: multiple matches → Step 2 disambiguates via context
- Step 2: `score >= 0.80` → confident
- Step 2: `0.60 <= score < 0.80` → drifted
- Step 2: `score < 0.60` → Step 3
- Step 3: heading found, paragraph fingerprint matches → drifted
- Step 3: heading not found → Step 4
- Step 4: keyword found, fuzzy succeeds → drifted
- Step 4: keyword not found → orphan
- Empty source → orphan (defensive)
- Source unchanged → only Step 0 runs

**`anchoring/v2/fingerprint.test.js`** — MinHash
- Identical strings → Jaccard 1.0
- Disjoint word sets → Jaccard ≤ 0.1
- Stop-words filtered before hashing
- Order-invariant

**`anchoring/v2/keywords.test.js`** — rare-word extraction
- Common stop-words filtered
- Returns 2–3 lowest-frequency words
- Empty input → empty list

**`anchoring/v2/migrate.test.js`** — schema migration
- v1 → v2 essential backfill correct
- Legacy file without `schema_version` treated as v1
- Atomic write: original preserved on simulated mid-write failure
- `.bak` written before mutation

**`highlighters/css-highlight-highlighter.test.js`** — DOM tests via happy-dom
- `sync()` empty array → no highlights registered
- `sync()` two annotations → two named highlights with correct priority
- `syncOne()` updates only one annotation
- `clear()` removes all highlights and rules
- `setSelection()` adds `ann-selected` with priority MAX_SAFE_INTEGER
- `setSelection(null)` removes `ann-selected`

**`click/resolver.test.js`**
- Click on text within annotation → returns annotation
- Click in empty area → returns null
- Click on link with Ctrl → returns null (defer to browser)
- Click on link without Ctrl → returns annotation
- Click in overlap region → returns topmost (newest)
- Click on whitespace → returns null

### 9.2 Integration tests (Vitest with happy-dom)

**`tests/integration/annotation-precision.test.jsx`**
- Cross-block selection: midline of P1 → midline of P2 produces highlight matching the exact char range
- Cross-element selection through `<code>` preserves code visual
- Selection through list `<li>` excludes bullet markers
- Heading-spanning selection produces 2 separate highlight ranges

**`tests/integration/drift-recovery.test.jsx`**
- Annotation survives whitespace edit before quote (Step 0 fail → Step 1 single match → confident)
- Annotation survives paragraph reorder unrelated to it (Step 0 fail → Step 1 fail → Step 3 succeeds)
- Annotation in modified paragraph drifts (Step 2 returns 0.60–0.80 score → state drifted)
- Annotation with deleted target text orphans (all steps fail → state orphan)
- Drifted annotation's "Aceitar" button promotes to confident with new range/contextHash

**`tests/integration/migration.test.js`**
- Loading a v1 file triggers auto-migration with backup
- Failed migration leaves v1 file intact, no `.bak` overwrite
- CLI `migrate --dry-run` reports changes without writing
- CLI `migrate <dir>` recursive walks all `.annotations.yaml` files

### 9.3 E2E tests (Playwright)

**`tests/e2e/highlights-precision.spec.js`** — the primary regression guard
- Create annotation with cross-block selection. Reload page. Highlight matches exact selection (no line expansion).
- Create annotation through inline code. Reload. Code styling preserved within highlight.
- Create annotation, edit markdown to add paragraph before, reload. Annotation still anchored correctly (Step 1 happy path).
- Create annotation, edit markdown to break the quote text. Reload. Annotation surfaces as `drifted` with dashed amber underline.

**`tests/e2e/highlights-perf.spec.js`** — perf smoke
- Document with 200 pre-seeded annotations. Open. Time first-render.
- Trigger 20 rapid resolve operations. Frame drops < 3 longtasks (>100ms).
- Single-annotation save in 200-annotation document completes in < 100ms.

**`tests/e2e/click-handling.spec.js`** — edge cases
- Click on annotation selects it
- Click on overlapping annotations selects newest
- Ctrl+click on link navigates
- Click on link (no modifier) selects annotation
- Click on whitespace deselects

### 9.4 Coverage targets

- `anchoring/v2/`: ≥ 90% line coverage. This is the critical layer — we cannot regress here.
- `highlighters/css-highlight-highlighter.js`: ≥ 85%.
- `click/resolver.js`: ≥ 90% (edge cases are the entire point).
- `cli/migrate-cmd.js`: ≥ 80%.

CI gates these via `vitest run --coverage` with thresholds in `vitest.config.js`.

## 10. Rollout

- **Single release: v0.5.0**, minor bump because schema migration is a breaking change for downstream consumers (none expected, but signal correctly).
- **No feature flag.** The two implementations cannot coexist (the highlighter is replaced wholesale).
- **CHANGELOG entry** explains:
  - New: precise char-offset anchoring; CSS Custom Highlight API rendering; drift recovery pipeline; auto-migration of v1 files.
  - Breaking: `.annotations.yaml` schema upgraded to v2 (backup written automatically).
  - Removed: support for browsers without CSS Custom Highlight API.
- **Manual smoke** before tag: load a real-world document with diverse markdown features (lists, tables, code blocks, math, mermaid), create cross-block annotations, edit source, verify drift behavior, run CLI migrate on a directory.
- **Rollback path:** if v0.5 has issues, user reverts to v0.4 by restoring from `.bak` files. The downgrade is non-destructive; v0.4 ignores schema_version field and reads `position` (which we keep computing in essential migrate? — see §11 risk).

## 11. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Migrate has bug; corrupts annotations file | High | `.bak` backup before write; atomic rename; UI toast on failure (no write happens) |
| `data-source-offset` plugin breaks for some markdown construct (tables, math, etc.) | Medium | Test fixture covers each construct; pipeline degrades to fuzzy when offset is missing |
| `caretPositionFromPoint` fails on user's browser (despite check) | Low | Capability check at boot; modal blocks app load |
| `approx-string-match` lib has edge case bug (Unicode handling) | Low | Pin version; integration tests cover non-ASCII content |
| Performance regression in 1000+ annotation document | Medium | E2E perf gate; profile before tag |
| User on rollback to v0.4 cannot read v2 file | Medium | `.bak` is written before every migrate (preserves v1 file). Documented rollback path in CHANGELOG: `mv file.annotations.yaml.bak file.annotations.yaml` restores v1 verbatim. v0.4 reading a v2 file directly will produce undefined behavior — document `.bak` recovery as the only supported path. |
| Drifted state too aggressive (false positives orphaning real matches) | Medium | Threshold values chosen conservatively (Step 2 `0.60`); user can adjust via config in v0.6 if reports come in |
| Drifted state too lenient (silent wrong anchors) | High | Explicit `score < 0.80` → drifted (not confident); explicit acknowledge required; UX is the gate |
| `<style>` injection for per-annotation rules grows unbounded | Low | Rules removed when annotation removed; for 1000 annotations ≈ 1000 rules ≈ 100 KB CSS — within browser limits; profiled |
| Cross-element Range surroundContents-like issues | None | We don't use `surroundContents`; CSS Highlight API takes Range objects directly without wrapping |

## 12. Files touched

**New:**
- `src/anchoring/v2/schema.js`
- `src/anchoring/v2/migrate.js`
- `src/anchoring/v2/capture.js`
- `src/anchoring/v2/locate.js`
- `src/anchoring/v2/fingerprint.js`
- `src/anchoring/v2/keywords.js`
- `src/anchoring/v2/fuzzy.js`
- `src/anchoring/v2/treepath.js`
- `src/anchoring/v2/index.js`
- `src/ui/highlighters/css-highlight-highlighter.js`
- `src/ui/highlighters/unsupported-modal.jsx`
- `src/ui/highlighters/capability.js`
- `src/ui/click/resolver.js`
- `src/cli/migrate-cmd.js`
- `tests/unit/anchoring-capture.test.jsx`
- `tests/unit/anchoring-locate.test.js`
- `tests/unit/anchoring-fingerprint.test.js`
- `tests/unit/anchoring-keywords.test.js`
- `tests/unit/anchoring-migrate.test.js`
- `tests/unit/css-highlight-highlighter.test.jsx`
- `tests/unit/click-resolver.test.jsx`
- `tests/integration/annotation-precision.test.jsx`
- `tests/integration/drift-recovery.test.jsx`
- `tests/integration/migration.test.js`
- `tests/e2e/highlights-precision.spec.js`
- `tests/e2e/highlights-perf.spec.js`
- `tests/e2e/click-handling.spec.js`

**Modified:**
- `src/renderer.js` (extend rehypeSourcePositions)
- `src/annotations.js` (auto-migration trigger, atomic save)
- `src/ui/components/Content.jsx` (swap highlighter, click resolver)
- `src/ui/components/RightPanel.jsx` (drifted/orphan sections, counters)
- `src/ui/state/store.js` (currentSource, currentMdast signals)
- `src/ui/styles/themes.css` (`::highlight()` rules; remove old `.annotation-highlight`)
- `package.json` (add approx-string-match)
- `bin/cli.js` (route migrate subcommand)
- `CHANGELOG.md` (v0.5.0 entry)

**Removed:**
- `src/ui/highlighters/mark-highlighter.js`
- `src/anchoring.js`
- `src/ui/diff/annotation-diff.js` (T1) — `locate()` now operates per-annotation independently, so the array-level diff is no longer needed
- Old tests covering deleted modules

## 13. Open questions (none blocking)

- Should `mdprobe migrate --dry-run` output be machine-readable (JSON) for CI integration? **Deferred.** Human-readable text now; if CI needs arise, add `--format json` later.
- Should orphans auto-prune after N days? **No** for v0.5. Persist forever; user decides retention.
- Should CSS rule injection use `CSSStyleSheet.replaceSync()` (modern API) instead of `<style>` text manipulation? **Use `<style>` text** for simplicity in v0.5; revisit if perf profiling shows hotspot.

---

## Appendix A — Glossary

- **Anchor (verb)**: derive selectors at annotation creation time. Implemented by `describe()`.
- **Locate / Hydrate**: re-derive a DOM Range from stored selectors at load time. Implemented by `locate()`.
- **Drift**: the source markdown changed in ways that affect anchor accuracy.
- **Range**: native browser DOM `Range` object — describes a contiguous span of text in the rendered document.
- **Highlight**: native browser `Highlight` object (CSS Custom Highlight API) that wraps one or more `Range`s and is registered in `CSS.highlights`.

## Appendix B — Decision audit (from brainstorming)

| Decision | Choice | Rationale source |
|---|---|---|
| Data model | Clean break: `range` + `quote` + `anchor`. v1 → v2 auto-migration with `.bak` + CLI for batch | Q1, refined Q1 follow-up |
| Click handling | `caretPositionFromPoint` pure with edge case test battery | Q2 |
| Browser fallback | Hard requirement (Chrome 105+ / Firefox 140+ / Safari 17.2+) with modal | Q3 |
| Drift recovery | 5-step pipeline with absolute threshold 0.60 + DRIFTED state | Q4 |
| Rendering | CSS Custom Highlight API; granularity = 1 Highlight per annotation; priority = `created_at`; alpha 0.25 | Q5 |
| Multi-annotation overlap | Topmost (newest) wins click; alpha blending shows overlap visually | Q5, Q5-followup, Q6 |
| Migration trigger | Auto on load (default) + CLI command (optional batch) | Q1 follow-up |
| Hover | Not implemented | Q5 part 5.7 |

## Appendix C — Explicitly deferred (future)

- Stable block ID injection in markdown source (Obsidian-style `^id`)
- Embedding-based semantic anchoring as Step 4.5
- Multi-user concurrent editing
- Hover preview
- v0.4 ↔ v2 cross-version interop

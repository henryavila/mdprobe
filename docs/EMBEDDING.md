# Embedding mdProbe

mdProbe can be embedded inside your own Node.js application to provide a live Markdown review UI without running a standalone CLI server. This page covers the library API, the `AnnotationFile` class, and the export helpers.

> Schema reference: [SCHEMA.md](SCHEMA.md) — describes every field of the annotation YAML format.

---

## `createHandler` — embed as Express/Node middleware

`createHandler` returns a standard Node.js `(req, res)` request handler that owns a URL prefix of your choice.

```javascript
import { createHandler } from '@henryavila/mdprobe'
```

### Signature

```typescript
createHandler(options?: {
  resolveFile?: (req: IncomingMessage) => string
  listFiles?:   () => Array<{ id: string; path: string; label?: string }>
  basePath?:    string        // default: '/'
  author?:      string        // default author name for annotations
  onComplete?:  (result: {
    file: string
    annotations: number
    open: number
    resolved: number
  }) => void
}): (req: IncomingMessage, res: ServerResponse) => void
```

| Option | Type | Description |
|--------|------|-------------|
| `resolveFile` | `(req) => string` | Resolve an absolute file path from the incoming request. Used in single-file mode or when routing by path segment. |
| `listFiles` | `() => FileEntry[]` | Return the list of available files. Enables a multi-file picker UI at the root path. |
| `basePath` | `string` | URL prefix the handler claims. All sub-paths are relative to this. Trailing slash is normalised. Default: `'/'`. |
| `author` | `string` | Default author name stamped on new annotations created through this handler instance. |
| `onComplete` | `(result) => void` | Callback fired when the UI calls `POST /api/complete`. Receives a summary of the review session. |

The handler exposes these routes under `basePath`:

- `GET /` — file picker (if `listFiles` provided) or single rendered file
- `GET /api/files` — JSON file list
- `GET /api/annotations` — annotation data (stub; returns `[]`)
- `POST /api/complete` — triggers `onComplete` callback
- `GET /assets/style.css` — embedded stylesheet

### Express mounting example

```javascript
import express from 'express'
import { createHandler } from '@henryavila/mdprobe'

const reviewHandler = createHandler({
  listFiles: () => [
    { id: 'spec',  path: '/docs/spec.md',  label: 'Specification' },
    { id: 'guide', path: '/docs/guide.md', label: 'User Guide'    },
  ],
  resolveFile: (req) => {
    const id = req.url.split('/').pop()
    const map = { spec: '/docs/spec.md', guide: '/docs/guide.md' }
    return map[id] ?? '/docs/spec.md'
  },
  basePath: '/review',
  author: 'Review Bot',
  onComplete: ({ file, annotations, open, resolved }) => {
    console.log(`Review of ${file}: ${annotations} total, ${open} open, ${resolved} resolved`)
  },
})

const app = express()
app.use('/review', (req, res) => reviewHandler(req, res))
app.listen(3000)
```

### Plain `node:http` example

```javascript
import http from 'node:http'
import { createHandler } from '@henryavila/mdprobe'

const handler = createHandler({
  resolveFile: () => '/path/to/document.md',
  author: 'Henry',
})

http.createServer(handler).listen(3000, () => {
  console.log('Review UI at http://localhost:3000')
})
```

---

## `AnnotationFile` — programmatic annotation management

```javascript
import { AnnotationFile } from '@henryavila/mdprobe/annotations'
```

`AnnotationFile` manages the full lifecycle of a `.annotations.yaml` sidecar: loading, CRUD, section approval, persistence, and export.

### Static factory methods

#### `AnnotationFile.load(yamlPath)`

```typescript
static async load(yamlPath: string): Promise<AnnotationFile>
```

Loads an existing sidecar file from disk. Automatically migrates v1 files to schema v2 on read (writes a `.bak` backup first). Throws if the file does not exist or contains invalid YAML.

```javascript
const af = await AnnotationFile.load('/docs/spec.annotations.yaml')
```

#### `AnnotationFile.create(source, sourceHash)`

```typescript
static create(source: string, sourceHash: string): AnnotationFile
```

Creates a new empty `AnnotationFile` in memory. Does not write to disk until `save()` is called.

```javascript
import { hashContent } from '@henryavila/mdprobe/hash'
import { readFile } from 'node:fs/promises'

const content = await readFile('/docs/spec.md', 'utf-8')
const af = AnnotationFile.create('spec.md', `sha256:${hashContent(content)}`)
```

---

### Instance — CRUD methods

#### `af.add(opts)` → annotation object

Creates a new annotation and appends it to the in-memory list. Returns the created annotation.

```typescript
af.add(opts: {
  selectors: {
    range:  { start: number; end: number }
    quote:  { exact: string; prefix: string; suffix: string }
    anchor: { contextHash: string; treePath?: object; keywords?: object[] }
  }
  comment: string   // required, non-empty
  tag:     'bug' | 'question' | 'suggestion' | 'nitpick'
  author:  string
}): annotation
```

v2 example using character offsets:

```javascript
const annotation = af.add({
  selectors: {
    range: { start: 412, end: 454 },
    quote: {
      exact: 'The system shall support concurrent users',
      prefix: '## Scalability\n\n',
      suffix: ' at peak load.',
    },
    anchor: {
      contextHash: 'sha256:b1c2d3e4...',
    },
  },
  comment: 'How many concurrent users are targeted?',
  tag: 'question',
  author: 'Henry',
})
console.log(annotation.id) // e.g. "a1b2c3d4"
```

> For computing `contextHash` programmatically see `computeContextHash` below.

#### `af.resolve(id)`

Sets `status` to `'resolved'`. Idempotent.

#### `af.reopen(id)`

Sets `status` back to `'open'`.

#### `af.updateComment(id, text)`

Replaces the comment text. Throws if `text` is empty.

#### `af.updateTag(id, tag)`

Updates the tag. Throws if `tag` is not a valid enum value.

#### `af.delete(id)`

Removes the annotation. Throws if not found.

#### `af.addReply(annotationId, { author, comment })`

Appends a reply with a generated UUID. Throws if the parent annotation is not found.

#### `af.editReply(annotationId, replyId, comment)`

Updates a reply's comment text and sets `updated_at`.

#### `af.deleteReply(annotationId, replyId)`

Removes a reply. Throws if either the annotation or the reply is not found.

#### `af.acceptDrift(annotationId, range, contextHash)`

Confirms a drifted annotation's new location. Updates `ann.range`, `ann.anchor.contextHash`, and resets `status` to `'open'`.

```javascript
// After the user confirms the new highlighted span:
af.acceptDrift(ann.id, { start: 430, end: 472 }, 'sha256:newHash...')
```

---

### Instance — query methods

| Method | Returns | Description |
|--------|---------|-------------|
| `af.getById(id)` | `annotation` | Throws if not found. |
| `af.getOpen()` | `annotation[]` | All annotations with `status === 'open'`. |
| `af.getResolved()` | `annotation[]` | All annotations with `status === 'resolved'`. |
| `af.getByTag(tag)` | `annotation[]` | Filter by tag value. |
| `af.getByAuthor(author)` | `annotation[]` | Filter by author name. |

---

### Instance — section approval

```javascript
af.approveSection('Introduction')   // cascade to child sections
af.rejectSection('Scalability')
af.resetSection('Implementation')   // back to pending
af.approveAll()
af.clearAll()                        // all → pending
const withComputed = af.computeStatus()  // [{heading, level, status, computed}]
```

`computed` is `'indeterminate'` when a parent section has children with mixed statuses.

---

### Instance — persistence and serialisation

#### `af.save(yamlPath)`

```typescript
async save(yamlPath: string): Promise<void>
```

Writes human-readable YAML to disk. Uses `lineWidth: -1` (no forced line wrapping) and preserves insertion order of keys.

#### `af.toJSON()`

Returns a plain object ready for `JSON.stringify`. Always emits `schema_version: 2`. Normalises annotations to the flat `{ range, quote, anchor }` format regardless of how they were created (v1 `selectors` wrapper is unwrapped).

---

### Full mutation example

```javascript
import { AnnotationFile } from '@henryavila/mdprobe/annotations'
import { computeContextHash } from '@henryavila/mdprobe/anchoring/v2'

const af = await AnnotationFile.load('spec.annotations.yaml')

// Query
const open = af.getOpen()
const bugs = af.getByTag('bug')

// Add a new annotation (v2 selectors)
const prefix = '## Scalability\n\n'
const exact  = 'The system shall support concurrent users'
const suffix = ' at peak load.'
af.add({
  selectors: {
    range:  { start: 412, end: 454 },
    quote:  { exact, prefix, suffix },
    anchor: { contextHash: computeContextHash(prefix, exact, suffix) },
  },
  comment: 'How many concurrent users are targeted?',
  tag: 'question',
  author: 'Henry',
})

// Resolve an existing annotation
af.resolve(bugs[0].id)

// Add a reply
af.addReply(open[0].id, { author: 'Agent', comment: 'See capacity plan §3.' })

// Persist
await af.save('spec.annotations.yaml')
```

---

## Export helpers

```javascript
import {
  exportJSON,
  exportReport,
  exportInline,
  exportSARIF,
} from '@henryavila/mdprobe/export'
```

All helpers accept an `AnnotationFile` instance (or any duck-typed object with `.source`, `.annotations`, `.sections`, and `.toJSON()`).

| Function | Signature | Returns | Notes |
|----------|-----------|---------|-------|
| `exportJSON(af)` | `(af) => object` | Plain JS object | Calls `af.toJSON()`; v2 format. |
| `exportReport(af, sourceContent)` | `(af, string) => string` | Markdown report | Human-readable summary with section table and annotation list. |
| `exportInline(af, sourceContent)` | `(af, string) => string` | Markdown string | Source with annotation comments woven inline as blockquotes. |
| `exportSARIF(af, sourcePath)` | `(af, string) => object` | SARIF 2.1.0 object | `bug` → `error`, `suggestion` → `warning`, others → `note`. Only `open` annotations are included. |

```javascript
import { readFile, writeFile } from 'node:fs/promises'
import { AnnotationFile } from '@henryavila/mdprobe/annotations'
import { exportSARIF, exportReport } from '@henryavila/mdprobe/export'

const af = await AnnotationFile.load('spec.annotations.yaml')
const source = await readFile('spec.md', 'utf-8')

// SARIF for IDE integration
const sarif = exportSARIF(af, 'spec.md')
await writeFile('spec.annotations.sarif', JSON.stringify(sarif, null, 2))

// Human-readable report
const report = exportReport(af, source)
await writeFile('spec.review-report.md', report)
```

---

## Anchoring helpers (advanced / unstable)

The `@henryavila/mdprobe/anchoring/v2` module exposes internal anchoring utilities. These are used by the browser UI and the server but are **not yet stable public API** — signatures may change between minor versions.

```javascript
import {
  describe,          // DOM selection → selectors object
  locate,            // annotation → {state, score, range}
  buildDomRanges,    // annotation[] → Map<id, Range>
  computeContextHash // (prefix, exact, suffix) → "sha256:..."
} from '@henryavila/mdprobe/anchoring/v2'
```

| Export | Purpose |
|--------|---------|
| `describe(selection, container)` | Capture a browser `Selection` as v2 selectors (range + quote + anchor). Used by the annotation creation flow in the UI. |
| `locate(ann, source, mdast?)` | Run the 5-step drift-recovery pipeline against a source string. Returns `{ state, score, range }`. |
| `buildDomRanges(annotations, container)` | Map annotation IDs to browser `Range` objects for highlight rendering. |
| `computeContextHash(prefix, exact, suffix)` | Compute `sha256(prefix + exact + suffix)`. Utility for building `anchor.contextHash` programmatically. |

`locate()` states: `'confident'` (score ≥ 0.80 or Step 0 pass), `'drifted'` (score 0.60–0.79), `'orphan'` (no match found after all steps).

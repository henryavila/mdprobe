# mdProbe Markdown Rendering Architecture & Code Block Styling

## Executive Summary

mdProbe is a Preact + htm + Signals-based markdown viewer with a Node.js server backend. The markdown rendering pipeline uses a **unified/remark/rehype stack** on the server side, with custom plugins for syntax highlighting, mermaid diagrams, math rendering, and annotation source position tracking. Code blocks are styled with **Catppuccin color themes** and highlight.js for syntax coloring. **There is currently NO copy-to-clipboard functionality** implemented in the codebase.

---

## 1. Markdown Rendering Pipeline

### 1.1 Server-Side Rendering (Node.js)

**File:** `/home/henry/mdprobe/src/renderer.js`

The rendering pipeline uses a unified processor stack that transforms markdown → HTML:

```
markdown input
    ↓
remarkParse (parse to mdast)
    ↓
remarkGfm (GitHub Flavored Markdown support)
    ↓
remarkMath (LaTeX math syntax)
    ↓
remarkFrontmatter (YAML/TOML frontmatter extraction)
    ↓
[Custom: remarkExtractFrontmatter] - extracts frontmatter to file.data
    ↓
[Custom: remarkExtractToc] - extracts table of contents from headings
    ↓
remarkRehype (mdast → hast/HTML AST)
    ↓
[Custom: rehypeSourcePositions] - injects data-source-line/data-source-col
    ↓
rehypeRaw (processes raw HTML in markdown)
    ↓
[Custom: rehypeHighlight] - syntax highlighting via highlight.js
    ↓
[Custom: rehypeMermaid] - transforms mermaid blocks for client-side rendering
    ↓
[Custom: rehypeMathClass] - ensures math elements have detection markers
    ↓
rehypeStringify (hast → HTML string)
    ↓
HTML output with source positions + TOC + frontmatter
```

**Key npm dependencies** (`/home/henry/mdprobe/package.json` lines 32-48):
- `unified` (11.0.0) - AST processor framework
- `remark-parse` (11.0.0) - markdown parser
- `remark-gfm` (4.0.0) - GitHub Flavored Markdown tables, strikethrough, task lists
- `remark-math` (6.0.0) - LaTeX math blocks
- `remark-frontmatter` (5.0.0) - YAML/TOML parsing
- `remark-rehype` (11.0.0) - mdast to hast converter
- `rehype-raw` (7.0.0) - raw HTML pass-through
- `rehype-stringify` (10.0.0) - hast to HTML
- `highlight.js` (11.10.0) - syntax highlighting

### 1.2 Custom Remark Plugins

#### `remarkExtractFrontmatter()` (lines 25-37)
Visits all YAML nodes in the AST and parses them with `js-yaml`, storing in `file.data.frontmatter`.

**Returns:** YAML/TOML frontmatter as object

#### `remarkExtractToc()` (lines 42-55)
Walks all heading nodes and extracts heading text + level + line number.

**Returns:** Array of `{ heading: string, level: number, line: number }`

### 1.3 Custom Rehype Plugins

#### `rehypeSourcePositions()` (lines 73-87)
**Critical for annotations:** Injects `data-source-line` and `data-source-col` attributes on HTML elements based on their original position in the markdown source.

- Uses `node.position` from hast nodes (preserved from mdast by remark-rehype)
- Only annotates elements in `INLINE_TAGS` set (strong, em, code, a, del, sup, sub, span, etc.) with column info
- **Important:** Runs BEFORE rehype-raw so raw HTML blocks are NOT annotated
- Enables the annotation system to anchor highlights to specific lines and columns

#### `rehypeHighlight()` (lines 97-134)
**Syntax highlighting for code blocks:**

- Targets `<pre><code>` elements
- Extracts language from `language-*` class name
- **Skips:** `mermaid` and `math` language blocks (handled separately)
- Uses `highlight.js` to detect/validate language, but **preserves original text content** for search/copy (line 95 comment)
- Replaces code children with raw highlighted HTML via `type: 'raw'` node
- Adds `hljs` class to trigger stylesheets
- Adds detected language class (e.g., `language-javascript`)

**Key behavior:** Text content is NOT modified by highlighting - only HTML markup is inserted for color spans.

#### `rehypeMermaid()` (lines 148-179)
Transforms `<pre><code class="language-mermaid">` blocks into `<pre class="mermaid">` for client-side rendering.

- Extracts raw mermaid source
- Preserves `data-source-line` if present
- Replaces children with raw text node (not HTML)

#### `rehypeMathClass()` (lines 190-203)
Safety net for math element detection - adds `data-math` attribute if math class markers not found.

### 1.4 Output Structure

**Returns from `render(markdown)`:** (line 235-247)
```javascript
{
  html: string,              // Full HTML output
  toc: Array<{               // Table of contents
    heading: string,
    level: number,           // Heading depth (1-6)
    line: number             // Line number in source
  }>,
  frontmatter: object|null   // Parsed YAML frontmatter
}
```

---

## 2. Code Block Styling

### 2.1 CSS Structure

**File:** `/home/henry/mdprobe/src/ui/styles/themes.css`

#### Base Code Block Styles (lines 913-935)

**Inline code** (lines 913-919):
```css
.content-area code {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.9em;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
}
```

**Code block container** (lines 921-928):
```css
.content-area pre {
  background: var(--bg-tertiary);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0 0 16px;
  line-height: 1.5;
}
```

**Code within blocks** (lines 930-935):
```css
.content-area pre code {
  background: none;          /* Override inline code bg */
  padding: 0;                /* Override inline code padding */
  border-radius: 0;
  font-size: 13px;
}
```

#### Syntax Highlighting Colors (lines 1215-1249)

Uses **Catppuccin color palette** mapped to highlight.js token classes.

**Keywords, tags, built-ins, types:** `var(--tag-bug)` (red in dark themes)
```css
.content-area .hljs-keyword,
.content-area .hljs-selector-tag,
.content-area .hljs-built_in,
.content-area .hljs-type { color: var(--tag-bug); }
```

**Strings, attributes, symbols, templates:** `var(--tag-suggestion)` (green)
```css
.content-area .hljs-string,
.content-area .hljs-attr,
.content-area .hljs-symbol,
.content-area .hljs-template-tag,
.content-area .hljs-template-variable { color: var(--tag-suggestion); }
```

**Numbers, literals, regexps:** `var(--tag-nitpick)` (yellow)
```css
.content-area .hljs-number,
.content-area .hljs-literal,
.content-area .hljs-regexp { color: var(--tag-nitpick); }
```

**Function/class titles:** `var(--accent)` (light blue in dark themes)
```css
.content-area .hljs-title,
.content-area .hljs-title.function_,
.content-area .hljs-title.class_ { color: var(--accent); }
```

**Comments:** `var(--text-muted)` (gray) + italic
```css
.content-area .hljs-comment,
.content-area .hljs-doctag { color: var(--text-muted); font-style: italic; }
```

**Diff additions/deletions:**
```css
.content-area .hljs-addition { color: var(--tag-suggestion); background: rgba(166, 227, 161, 0.1); }
.content-area .hljs-deletion { color: var(--tag-bug); background: rgba(243, 139, 168, 0.1); }
```

### 2.2 Theme System

**5 Catppuccin themes** (`/home/henry/mdprobe/src/ui/styles/themes.css` lines 8-138):

1. **Mocha** (default dark) - lines 8-30
   - Primary bg: `#1e1e2e`, Text: `#cdd6f4`
   - Accent: `#89b4fa` (light blue)

2. **Macchiato** (dark variant) - lines 35-57
   - Primary bg: `#24273a`, Text: `#cad3f5`

3. **Frappe** (dark variant) - lines 62-84
   - Primary bg: `#303446`, Text: `#c6d0f5`

4. **Latte** (light) - lines 89-111
   - Primary bg: `#eff1f5`, Text: `#4c4f69`

5. **Light** (clean) - lines 116-138
   - Primary bg: `#ffffff`, Text: `#212529`

Each theme defines CSS custom properties:
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`
- `--text-primary`, `--text-secondary`, `--text-muted`
- `--tag-bug`, `--tag-question`, `--tag-suggestion`, `--tag-nitpick`
- `--highlight-open`, `--highlight-resolved`
- Theme is persisted to localStorage and applied via `data-theme` attribute on `<html>`

### 2.3 Mermaid & Math Styling (lines 1254-1289)

**Mermaid diagram container** (lines 1254-1267):
```css
.content-area .mermaid {
  background: var(--bg-tertiary);
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  min-height: 60px;
}
```

**Math display mode** (lines 1272-1282):
```css
.content-area .math-display {
  display: block;
  text-align: center;
  padding: 12px 16px;
  margin: 12px 0;
  background: var(--bg-tertiary);
  border-radius: 6px;
  font-family: 'KaTeX_Main', 'Times New Roman', serif;
  font-size: 1.1em;
  overflow-x: auto;
}
```

**Math inline** (lines 1284-1289):
```css
.content-area .math-inline {
  font-family: 'KaTeX_Main', 'Times New Roman', serif;
  padding: 1px 4px;
  background: var(--bg-tertiary);
  border-radius: 3px;
}
```

---

## 3. Frontend Architecture

### 3.1 Component Hierarchy

```
App.jsx (main entry point)
├── Header
│   ├── Current file display
│   ├── Progress bar (review mode)
│   └── ThemePicker, ExportMenu
├── LeftPanel
│   ├── Files list
│   └── Table of Contents (TOC)
├── Content (main content area)
│   ├── HTML rendered via dangerouslySetInnerHTML
│   ├── Annotation highlight injection (DOM manipulation)
│   ├── Text selection handling → Popover
│   └── Popover (floating annotation form)
├── RightPanel
│   ├── Annotation filters (tag, author, resolved)
│   └── AnnotationCard list
└── Footer (status bar)
```

### 3.2 Core Components

#### `Content.jsx` (lines 1-334)
**Renders markdown HTML and handles annotations:**

- **HTML Rendering** (line 312): Uses `dangerouslySetInnerHTML={{ __html: currentHtml.value }}`
  - Injected HTML contains pre-rendered syntax-highlighted code blocks from server
  - All code highlighting HTML is already applied (via rehypeHighlight)

- **Annotation Highlighting** (useEffect lines 12-52):
  1. Removes previous highlights
  2. Iterates through visible annotations
  3. **Three-strategy highlight matching:**
     - **Strategy 1** (lines 118-138): Single-element exact text match (fast path)
     - **Strategy 2** (lines 145-212): Cross-element highlight - walks text nodes, concatenates text with newlines, finds match, wraps portions in `<mark>` elements
     - **Strategy 3** (lines 215-227): Fallback - highlights all text in line range
  4. Wraps matched text in `<mark data-highlight-id="...">` elements with CSS classes

- **Mouse Selection** (lines 256-286):
  - Detects text selection on mouseUp
  - Finds source line/column from parent elements' `data-source-line`/`data-source-col`
  - Shows Popover at selection position with exact text and selectors

- **CSS Classes** (line 38):
  ```javascript
  const markClass = `annotation-highlight tag-${ann.tag}${ann.status === 'resolved' ? ' resolved' : ''}${selectedAnnotationId.value === ann.id ? ' selected' : ''}`
  ```

#### `Popover.jsx` (lines 1-94)
**Draggable floating annotation form:**

- Fixed positioning with viewport-aware placement (flips above if space below insufficient)
- Drag-handle on header bar
- Closes on Escape key
- Passes selected text + position selectors to AnnotationForm

#### `AnnotationForm.jsx` (lines 1-72)
**Annotation creation/editing form:**

- Tag selection buttons (question, bug, suggestion, nitpick)
- Textarea for comment with `Ctrl+Enter` submit
- Quote display (exact selected text)
- Form validation (requires non-empty comment)

#### `RightPanel.jsx` (lines 1-200+)
**Annotations sidebar:**

- Lists annotations with tag/author/status badges
- Clickable cards that select annotation and scroll to highlight
- Filter dropdowns (tag, author, show resolved toggle)
- Edit/Resolve/Delete/Reply actions
- Orphaned annotations section (when drift detected)

#### `LeftPanel.jsx` (lines 1-100)
**Files and TOC sidebar:**

- Files list (if multiple files)
- Table of Contents with heading levels
- Click to scroll to section
- Badges showing annotation count per section
- Status dots (approved/rejected)

### 3.3 State Management

**File:** `/home/henry/mdprobe/src/ui/state/store.js`

Uses **Preact Signals** for reactive state:

```javascript
// Content
export const currentHtml = signal('')        // Rendered HTML from server
export const currentToc = signal([])         // TOC extracted from renderer
export const currentFile = signal(null)      // Active markdown file path

// Annotations
export const annotations = signal([])        // All annotations for current file
export const sections = signal([])           // Section review statuses
export const selectedAnnotationId = signal(null)
export const showResolved = signal(false)    // Show/hide resolved annotations
export const filterTag = signal(null)        // Filter by tag
export const filterAuthor = signal(null)     // Filter by author

// UI State
export const leftPanelOpen = signal(true)    // Persisted to localStorage
export const rightPanelOpen = signal(true)   // Persisted to localStorage
export const theme = signal(...)             // Persisted to localStorage

// Computed signals (reactive derivations)
export const openAnnotations = computed(() => 
  annotations.value.filter(a => a.status === 'open')
)

export const filteredAnnotations = computed(() => {
  // Applies tag and author filters
})

export const orphanedAnnotations = computed(() => {
  // Annotations not found in drift detection
})

export const sectionStats = computed(() => {
  // Counts sections at adaptive level, tracks review progress
})
```

### 3.4 Hooks

#### `useWebSocket.js` (lines 1-140)
Manages WebSocket connection for live reload:

- Connects to `ws://host/ws`
- Message types handled:
  - `update` - new HTML + TOC from server (preserves scroll position)
  - `file-added` / `file-removed` - updates file list
  - `annotations` - broadcast annotation updates
  - `drift` - file has changed, re-anchoring may have occurred
  - `error` - logs warnings
- Exponential backoff reconnection (max 30s)

#### `useAnnotations.js` (lines 1-165)
Annotation and section CRUD operations via HTTP API:

**Annotation operations:**
- `fetchAnnotations(filePath)` - GET `/api/annotations?path=...`
- `createAnnotation({ selectors, comment, tag })` - POST `/api/annotations`
- `resolveAnnotation(id)`, `reopenAnnotation(id)`
- `updateAnnotation(id, { comment, tag })`
- `deleteAnnotation(id)`
- `addReply(annotationId, comment)` - threaded replies

**Section operations:**
- `approveSection(heading)`, `rejectSection(heading)`
- `resetSection(heading)`, `clearAllSections()`
- `approveAllSections()` - cascade approve to all

#### `useClientLibs.js` (lines 1-98)
Lazy-loads external rendering libraries:

**Mermaid** (lines 55-74):
- Loads `mermaid@11` from CDN on demand
- Selects `<pre class="mermaid:not([data-processed])">` elements
- Calls `window.mermaid.run({ nodes: [...elements] })`
- Sets theme based on current theme (dark/light)

**KaTeX** (lines 76-97):
- Loads KaTeX CSS + JS from CDN
- Selects `[data-math]`, `.math-inline`, `.math-display` elements
- Calls `window.katex.render(tex, el, { displayMode, throwOnError: false })`
- Caches rendered elements with `data-katex-rendered` attribute

#### `useTheme.js`
Theme management hook (details not shown)

#### `useKeyboard.js`
Keyboard shortcut handling (details not shown)

---

## 4. API Endpoints

**File:** `/home/henry/mdprobe/src/server.js`

### 4.1 File & Content Endpoints

#### `GET /api/files`
Returns list of markdown files:
```json
[
  { "path": "file.md", "label": "file", "absPath": "/absolute/path/file.md" }
]
```

#### `GET /api/file?path=<path>`
Renders a markdown file to HTML:

- **Process:**
  1. Lookup file by path
  2. Read markdown from disk
  3. Call `render(markdown)` from renderer.js
  4. Return JSON:
     ```json
     {
       "html": "<p>...</p><pre><code class=\"hljs language-javascript\">...</code></pre>",
       "toc": [{ "heading": "...", "level": 2, "line": 5 }],
       "frontmatter": { ... }
     }
     ```

**Key:** Code blocks already have syntax highlighting HTML (rehypeHighlight output)

### 4.2 Annotation Endpoints

#### `GET /api/annotations?path=<path>`
Fetches annotations for a file:

- Loads sidecar `.annotations.yaml` file
- Detects drift (file hash comparison)
- If drifted, runs reanchoring algorithm
- Returns:
  ```json
  {
    "version": 1,
    "source": "filename.md",
    "source_hash": "...",
    "sections": [ { "heading": "...", "status": "approved", ... } ],
    "annotations": [ { "id": "...", "selectors": { "position": { "startLine": 5 }, "quote": { "exact": "text" } }, "comment": "...", "tag": "bug", "author": "user", "status": "open" } ],
    "drift": { "drifted": boolean, "anchorStatus": { "id1": "anchored|orphan" } }
  }
  ```

#### `POST /api/annotations`
CRUD operations (action parameter):

- `add` - create annotation
- `update` - modify comment/tag
- `resolve` - mark as resolved
- `reopen` - mark as open again
- `delete` - remove annotation
- `reply` - add threaded comment

### 4.3 Section Endpoints

#### `POST /api/sections`
Section review status (action parameter):

- `approve` - mark section and children as approved
- `reject` - mark section as rejected
- `reset` - mark as pending
- `clearAll`, `approveAll` - bulk operations

### 4.4 Export Endpoint

#### `GET /api/export?path=<path>&format=<format>`
Exports annotations as JSON, YAML, or Markdown

---

## 5. HTML Rendering Flow (Client-Side)

1. **Initial Load:**
   - App.jsx fetches `/api/files` → populates file list
   - User selects file → fetches `/api/file?path=...`
   - Receives `{ html, toc, frontmatter }`
   - Stores in `currentHtml` signal

2. **HTML Injection:**
   - Content.jsx renders: `<div dangerouslySetInnerHTML={{ __html: currentHtml.value }} />`
   - Browser parses pre-rendered HTML with already-applied syntax highlighting

3. **Client Library Initialization:**
   - useClientLibs effect runs on `currentHtml` change
   - Detects `<pre class="mermaid">` blocks → loads mermaid CDN → renders
   - Detects `[data-math]` elements → loads KaTeX CDN → renders

4. **Annotation Highlighting:**
   - Content.jsx effect runs (depends on `currentHtml`, `annotations`)
   - Walks DOM tree, finds text nodes matching annotation quotes
   - Wraps matches in `<mark data-highlight-id="...">` elements

5. **Live Reload:**
   - WebSocket message `{ type: 'update', html, toc }` arrives
   - Updates `currentHtml` signal
   - Content re-renders with new HTML
   - useClientLibs re-runs for new mermaid/math
   - Annotation highlights re-injected

---

## 6. Key Source Position Attributes

**Every HTML element generated from markdown has these:**

- `data-source-line="<N>"` - Line number in source markdown
- `data-source-col="<N>"` - Column number (only on inline tags)

**Used by:**
- Annotation system to anchor highlights to source positions
- TOC clicking to scroll to section
- Error reporting (future)

**Set by:** `rehypeSourcePositions()` plugin in renderer.js (lines 73-87)

---

## 7. Clipboard & Copy Functionality

### Current Status: **NOT IMPLEMENTED**

**Search Results:**
- No clipboard API usage found (`navigator.clipboard` not in codebase)
- No copy buttons on code blocks
- No copy-to-clipboard logic in any component
- Comment in renderer.js (line 95) mentions it as a future use case:
  > "Uses hljs to detect/validate the language but preserves the original text content so that downstream consumers (search, copy-to-clipboard, tests) can rely on literal text matching."

**Implications:**
- Text content in code blocks is preserved (not replaced by HTML)
- Ready for future copy functionality implementation
- Would need to:
  1. Add copy button to `<pre>` elements (via DOM manipulation in Content.jsx)
  2. Extract text content from `<code>` child
  3. Use `navigator.clipboard.writeText()`
  4. Show toast/feedback

---

## 8. Template/Public Files

**File:** `/home/henry/mdprobe/src/ui/index.html` (lines 1-20)

Entry HTML template:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>mdProbe</title>
  <script>
    (function() {
      var theme = localStorage.getItem('mdprobe-theme') || 'mocha';
      document.documentElement.setAttribute('data-theme', theme);
    })();
  </script>
  <link rel="stylesheet" href="./styles/themes.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./app.jsx"></script>
</body>
</html>
```

**Key:**
- Theme injected synchronously before app loads (prevents flash)
- All CSS in `themes.css` (no separate stylesheets)
- Preact app entry point: `app.jsx`

---

## 9. Build Configuration

**File:** `/home/henry/mdprobe/vite.config.js`

```javascript
export default defineConfig({
  plugins: [preact()],
  root: 'src/ui',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
})
```

- Uses Vite + Preact preset
- Build output → `/dist/`
- Serves static UI files from `/dist/index.html` on server

---

## 10. Summary Table: Key Files & Their Roles

| File | Purpose | Key Exports/Functions |
|------|---------|----------------------|
| `renderer.js` | Server markdown → HTML | `render(markdown)` |
| `server.js` | HTTP/WebSocket server | `/api/*` endpoints, file serving |
| `app.jsx` | Main Preact component | App root, file/annotation orchestration |
| `Content.jsx` | Markdown display + annotation highlighting | Renders HTML, injects `<mark>` highlights |
| `LeftPanel.jsx` | Files + TOC sidebar | Navigation, section listing |
| `RightPanel.jsx` | Annotations sidebar | Annotation list, filters, actions |
| `Popover.jsx` | Floating annotation form | Draggable popover on text selection |
| `AnnotationForm.jsx` | Tag + comment input | Form submission logic |
| `store.js` | Preact Signals state | All reactive signals + computed |
| `useAnnotations.js` | Annotation CRUD hook | Fetch/create/update/delete operations |
| `useWebSocket.js` | Live reload connection | WS events, message dispatch |
| `useClientLibs.js` | Mermaid + KaTeX loader | Lazy CDN loading, rendering |
| `themes.css` | All styling | Layout grid, colors, code highlighting |

---

## 11. How Code Blocks Are Rendered

### Server-Side (renderer.js):
1. `rehypeHighlight()` plugin runs on all `<pre><code>` elements
2. Calls `hljs.highlight(source, { language: lang })`
3. Gets back `{ value: "<span class=\"hljs-keyword\">const</span> x = 5;" }`
4. Creates raw hast node: `{ type: 'raw', value: highlighted.value }`
5. Replaces code children with this raw node
6. Adds `hljs` class + language class to `<code>` element

### Result HTML (example):
```html
<pre><code class="hljs language-javascript">
  <span class="hljs-keyword">const</span> <span class="hljs-variable">x</span> = <span class="hljs-number">5</span>;
</code></pre>
```

### Client-Side (Content.jsx):
1. HTML arrives pre-highlighted
2. Browser renders colored spans immediately
3. No client-side re-processing needed
4. Text content of code block still accessible for copying

### Styling:
- CSS variables from theme define colors for each `hljs-*` class
- `pre` has `overflow-x: auto` for horizontal scroll
- `code` font family: `'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace`
- Line height: 1.5

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Preact App)                     │
├─────────────────────────────────────────────────────────────┤
│  Content.jsx                                                │
│  ├─ dangerouslySetInnerHTML={{ __html: currentHtml }}      │
│  │  └─ Contains <pre><code class="hljs language-js">       │
│  │     (Already highlighted with spans)                    │
│  └─ Annotation highlights (client-side injected <mark>)    │
├─────────────────────────────────────────────────────────────┤
│  RightPanel.jsx       │  LeftPanel.jsx                      │
│  Annotations          │  TOC + Files                        │
└─────────────────────────────────────────────────────────────┘
           ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                  Node.js Server (server.js)                 │
├─────────────────────────────────────────────────────────────┤
│  GET /api/file?path=...                                     │
│  └─ Read markdown file                                      │
│     └─ render(markdown) ← renderer.js unified pipeline      │
│        ├─ remarkParse → GFM → Math → Frontmatter           │
│        ├─ remarkRehype                                      │
│        ├─ [rehypeSourcePositions] ← data-source-line       │
│        ├─ [rehypeHighlight] ← <span> HTML                  │
│        ├─ [rehypeMermaid] ← class="mermaid"                │
│        ├─ [rehypeMathClass] ← data-math                    │
│        └─ rehypeStringify → HTML string                    │
│     └─ Return { html, toc, frontmatter }                   │
└─────────────────────────────────────────────────────────────┘
           ↕
     Markdown Files
     + .annotations.yaml
```

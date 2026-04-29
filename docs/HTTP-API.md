# HTTP API

mdProbe exposes a JSON HTTP API when the server is running (`mdprobe <files>` or `createServer()`). All endpoints are served on `http://127.0.0.1:<port>`.

A WebSocket endpoint at `/ws` provides real-time push updates.

> Annotation field shapes are documented in [SCHEMA.md](SCHEMA.md). Library embedding is in [EMBEDDING.md](EMBEDDING.md).

---

## Files

### `GET /api/files`

Returns the list of Markdown files currently loaded in the server.

**Response** `200 application/json`

```json
[
  { "path": "spec.md", "absPath": "/docs/spec.md", "label": "spec" },
  { "path": "guide.md", "absPath": "/docs/guide.md", "label": "guide" }
]
```

Basenames are deduplicated: if two absolute paths share the same basename, only the first is returned.

```bash
curl http://localhost:3000/api/files
```

---

### `GET /api/file?path=<file>`

Renders a Markdown file to HTML and returns it with table-of-contents and frontmatter.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | yes | Basename, relative path, or absolute path of the file. |

**Response** `200 application/json`

```json
{
  "html": "<h1>Specification</h1>...",
  "toc": [
    { "heading": "Introduction", "level": 2, "anchor": "introduction" },
    { "heading": "Scalability",  "level": 2, "anchor": "scalability"  }
  ],
  "frontmatter": { "title": "Spec", "version": "1.0" }
}
```

```bash
curl "http://localhost:3000/api/file?path=spec.md"
```

---

### `GET /api/source?path=<file>`

Returns the raw Markdown source of a file as plain text. Added in v0.5.0 for the browser-side anchoring pipeline.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | yes | Basename, relative path, or absolute path of the file. |

**Response** `200 text/plain`

```bash
curl "http://localhost:3000/api/source?path=spec.md"
```

---

## Annotations

### `GET /api/annotations?path=<file>`

Returns the full annotation dataset for a file, including drift status if the source has changed since the last save.

**Query parameters**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | yes | File path (same matching rules as `/api/file`). |

**Response** `200 application/json`

```json
{
  "schema_version": 2,
  "source": "spec.md",
  "source_hash": "sha256:...",
  "sections": [
    { "heading": "Introduction", "level": 2, "status": "approved", "computed": "approved" }
  ],
  "sectionLevel": 2,
  "annotations": [
    {
      "id": "a1b2c3d4",
      "author": "Henry",
      "tag": "question",
      "status": "open",
      "comment": "How many concurrent users?",
      "created_at": "2026-04-08T10:30:00.000Z",
      "range": { "start": 412, "end": 454 },
      "quote": { "exact": "...", "prefix": "...", "suffix": "..." },
      "anchor": { "contextHash": "sha256:..." },
      "replies": []
    }
  ],
  "drift": {
    "anchorStatus": {
      "a1b2c3d4": "anchored",
      "e5f6a7b8": "orphan"
    }
  }
}
```

`drift` is only present when `source_hash` no longer matches the current file. `anchorStatus` values: `"anchored"` | `"orphan"`.

`sections[].computed` can be `"pending"`, `"approved"`, `"rejected"`, or `"indeterminate"` (parent with mixed-status children).

```bash
curl "http://localhost:3000/api/annotations?path=spec.md"
```

---

### `POST /api/annotations`

Performs a create, update, or delete operation on an annotation or reply. All mutations are persisted to the `.annotations.yaml` sidecar and broadcast to connected WebSocket clients.

**Request body** `application/json`

```json
{
  "file": "spec.md",
  "action": "<action>",
  "data": { ... }
}
```

**Actions**

#### `add`

Creates a new annotation. `data` is the v2 selectors object plus metadata.

```json
{
  "file": "spec.md",
  "action": "add",
  "data": {
    "selectors": {
      "range": { "start": 412, "end": 454 },
      "quote": { "exact": "...", "prefix": "...", "suffix": "..." },
      "anchor": { "contextHash": "sha256:..." }
    },
    "comment": "How many concurrent users?",
    "tag": "question",
    "author": "Henry"
  }
}
```

#### `update`

Updates the `comment`, `tag`, or both.

```json
{ "file": "spec.md", "action": "update", "data": { "id": "a1b2c3d4", "comment": "Updated text", "tag": "bug" } }
```

#### `resolve`

```json
{ "file": "spec.md", "action": "resolve", "data": { "id": "a1b2c3d4" } }
```

#### `reopen`

```json
{ "file": "spec.md", "action": "reopen", "data": { "id": "a1b2c3d4" } }
```

#### `delete`

```json
{ "file": "spec.md", "action": "delete", "data": { "id": "a1b2c3d4" } }
```

#### `reply`

Appends a reply to an annotation.

```json
{ "file": "spec.md", "action": "reply", "data": { "id": "a1b2c3d4", "author": "Agent", "comment": "See §3." } }
```

#### `editReply`

```json
{ "file": "spec.md", "action": "editReply", "data": { "id": "a1b2c3d4", "replyId": "uuid-v4", "comment": "Revised reply." } }
```

#### `deleteReply`

```json
{ "file": "spec.md", "action": "deleteReply", "data": { "id": "a1b2c3d4", "replyId": "uuid-v4" } }
```

#### `acceptDrift`

Confirms a drifted annotation's new location. Updates `range` and `contextHash`.

```json
{
  "file": "spec.md",
  "action": "acceptDrift",
  "data": { "id": "a1b2c3d4", "range": { "start": 430, "end": 472 }, "contextHash": "sha256:..." }
}
```

**Response** `200 application/json` — the full updated annotation dataset (same shape as `GET /api/annotations`).

```bash
curl -X POST http://localhost:3000/api/annotations \
  -H 'Content-Type: application/json' \
  -d '{"file":"spec.md","action":"resolve","data":{"id":"a1b2c3d4"}}'
```

---

## Sections

### `POST /api/sections`

Approves, rejects, or resets section approval status. Cascades to child sections.

**Request body** `application/json`

```json
{
  "file": "spec.md",
  "action": "approve",
  "heading": "Introduction"
}
```

**Actions**

| Action | Description |
|--------|-------------|
| `approve` | Approve the named heading and all its children. `heading` required. |
| `reject` | Reject the named heading and all its children. `heading` required. |
| `reset` | Reset to `pending`. `heading` required. |
| `approveAll` | Approve every section in the document. `heading` not required. |
| `clearAll` | Reset every section to `pending`. `heading` not required. |

**Response** `200 application/json`

```json
{
  "sections": [
    { "heading": "Introduction", "level": 2, "status": "approved", "computed": "approved" }
  ],
  "sectionLevel": 2
}
```

```bash
curl -X POST http://localhost:3000/api/sections \
  -H 'Content-Type: application/json' \
  -d '{"file":"spec.md","action":"approveAll"}'
```

---

## Export

### `GET /api/export?path=<file>&format=<format>`

Exports annotations in the requested format.

**Query parameters**

| Parameter | Required | Values | Description |
|-----------|----------|--------|-------------|
| `path` | yes | — | File path. |
| `format` | yes | `json` \| `report` \| `inline` \| `sarif` | Export format. |

**Formats**

| Format | Content-Type | Description |
|--------|-------------|-------------|
| `json` | `application/json` | Full v2 annotation data (same as `toJSON()`). |
| `report` | `text/markdown` | Human-readable review report with summary table and annotation list. |
| `inline` | `text/markdown` | Source Markdown with annotation comments woven inline as blockquotes. |
| `sarif` | `application/json` | SARIF 2.1.0 — only `open` annotations; `bug` → `error`, `suggestion` → `warning`, others → `note`. |

```bash
# JSON export
curl "http://localhost:3000/api/export?path=spec.md&format=json"

# SARIF for IDE integration
curl "http://localhost:3000/api/export?path=spec.md&format=sarif" > spec.annotations.sarif

# Inline markdown
curl "http://localhost:3000/api/export?path=spec.md&format=inline" > spec.reviewed.md
```

---

## Server management

### `GET /api/status`

Returns server identity information. Used by the singleton discovery protocol.

**Response** `200 application/json`

```json
{
  "identity": "mdprobe",
  "pid": 12345,
  "port": 3000,
  "files": ["spec.md", "guide.md"],
  "uptime": 42.3,
  "buildHash": "abc123"
}
```

```bash
curl http://localhost:3000/api/status
```

---

### `GET /api/config`

Returns the server's current configuration subset.

**Response** `200 application/json`

```json
{ "author": "Henry" }
```

---

### `POST /api/add-files`

Adds new files to a running server. Used by the singleton join protocol: when a second `mdprobe` invocation detects an existing server, it POSTs its file list here instead of starting a new process.

**Request body**

```json
{ "files": ["/abs/path/to/new.md", "/abs/path/to/another.md"] }
```

**Response** `200 application/json`

```json
{
  "ok": true,
  "files": ["spec.md", "guide.md", "new.md"],
  "added": ["new.md"]
}
```

---

### `DELETE /api/remove-file`

Removes a file from the running server.

**Request body**

```json
{ "file": "spec.md" }
```

**Response** `200 application/json`

```json
{ "ok": true, "files": ["guide.md"] }
```

Returns `400` if trying to remove the last file, `404` if the file is not found.

---

### `POST /api/broadcast`

Forwards a WebSocket broadcast message from a remote process (e.g., MCP server running in a separate process) to all connected clients. Used internally by the MCP tool when the MCP process and the HTTP server are in different Node processes.

**Request body**

```json
{ "type": "annotations", "file": "spec.md", "annotations": [...], "sections": [...] }
```

**Response** `200 application/json` `{ "ok": true }`

---

### `GET /api/review/status`

Returns the current review mode.

**Response** `200 application/json`

```json
{ "mode": "once" }
```

`mode` is `"once"` when the server was started with `--once`. Otherwise `null`.

---

### `POST /api/review/finish`

Signals the end of a `--once` review session. Only available when `once: true` was passed to `createServer`.

Returns `400` if the server is not in `--once` mode.

**Response** `200 application/json`

```json
{
  "status": "finished",
  "yamlPaths": ["/docs/spec.annotations.yaml"]
}
```

After this call the server resolves its `finishPromise` and the CLI process exits.

---

## WebSocket `/ws`

Connect to receive real-time push updates. The server uses the `ws` library; the path is `/ws`.

```javascript
const ws = new WebSocket('ws://localhost:3000/ws')
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data)
  console.log(msg.type, msg)
}
```

### Client → Server

| Type | Description |
|------|-------------|
| `{ type: 'ping' }` | Keepalive. Server replies with `{ type: 'pong' }`. |

### Server → Client

| Type | Payload fields | Description |
|------|---------------|-------------|
| `update` | `file`, `html`, `toc` | File changed on disk — re-render available. |
| `drift` | `file`, `warning: true`, `anchorStatus` | Source changed and at least one annotation drifted. |
| `annotations` | `file`, `annotations[]`, `sections[]` | Annotation or section mutation was persisted (from any client or MCP). |
| `file-added` | `file` | A new `.md` file appeared in the watched directory or was added via `/api/add-files`. |
| `file-removed` | `file` | A `.md` file was removed from the watch list. |
| `error` | `file`, `message` | File watcher encountered a read error. |

```bash
# Quick WebSocket test with websocat
websocat ws://localhost:3000/ws
{"type":"ping"}
```

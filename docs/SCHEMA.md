# Annotation Schema v2

mdProbe stores annotations in a YAML sidecar file alongside each Markdown source. The sidecar is named `<basename>.annotations.yaml` (e.g., `spec.md` → `spec.annotations.yaml`).

A machine-readable JSON Schema is published at `@henryavila/mdprobe/schema.json`.

> See also: [ARCHITECTURE.md](ARCHITECTURE.md) for how the drift-recovery pipeline uses `anchor` fields at run-time.

---

## Top-level structure

```yaml
schema_version: 2          # integer — 2 for this format (was absent / 1 in v1)
source: spec.md            # basename of the annotated Markdown file
source_hash: "sha256:..."  # SHA-256 of the file at last save (drift detection)
sections:                  # optional — section approval tracking
  - heading: Introduction
    level: 2
    status: approved
annotations:               # array of annotation objects
  - id: "a1b2c3d4"
    ...
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | `integer` | yes | Must be `2`. Absent in v1 files. |
| `source` | `string` | yes | Basename of the source Markdown file. |
| `source_hash` | `string` | yes | `sha256:<hex>` hash used to detect file drift. |
| `sections` | `array<section>` | no | Per-heading approval records. Auto-synced from TOC on load. |
| `annotations` | `array<annotation>` | yes | The annotation records (may be empty array). |

---

## Annotation object

```yaml
id: "a1b2c3d4"                   # 8-char hex UUID fragment
author: "Henry"
tag: question                    # bug | question | suggestion | nitpick
status: open                     # open | resolved | drifted | orphan
comment: "How many concurrent users?"
created_at: "2026-04-08T10:30:00.000Z"
updated_at: "2026-04-08T11:15:00.000Z"   # optional — absent until first edit
range:
  start: 412                     # UTF-16 char offset in source (inclusive)
  end: 454                       # UTF-16 char offset in source (exclusive)
quote:
  exact: "The system shall support concurrent users"
  prefix: "## Scalability\n\n"   # up to 32 chars before exact
  suffix: " at peak load."       # up to 32 chars after exact
anchor:
  contextHash: "sha256:..."      # sha256(prefix + exact + suffix)
  treePath:                      # optional — populated on first re-anchor
    headingText: "Scalability"
    headingLevel: 2
    paragraphIndex: 0
    paragraphFingerprint: [...]  # token set for Jaccard similarity
    charOffsetInParagraph: 0
  keywords:                      # optional — rare words for Step 4 recovery
    - word: "concurrent"
      distFromStart: 4
replies:
  - id: "uuid-v4-full"
    author: "Agent"
    comment: "Target is 500 concurrent."
    created_at: "2026-04-08T11:00:00.000Z"
    updated_at: "2026-04-08T11:05:00.000Z"  # optional
```

### Field reference

#### Identity fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | 8-character hex string (first 8 chars of a UUID v4 with dashes removed). Unique within the file. |
| `author` | `string` | yes | Display name of the annotation creator. |
| `tag` | `string` | yes | Category. One of: `bug`, `question`, `suggestion`, `nitpick`. |
| `status` | `string` | yes | Lifecycle state. See [Status enum](#status-enum). |
| `comment` | `string` | yes | The annotation body text. |
| `created_at` | `string` | yes | ISO 8601 timestamp. |
| `updated_at` | `string` | no | ISO 8601 timestamp of last edit. Absent until the first mutation after creation. |

#### `range` — character offsets

```yaml
range:
  start: 412   # UTF-16 char offset, inclusive
  end: 454     # UTF-16 char offset, exclusive
```

`start` and `end` are **UTF-16 code-unit offsets** into the raw Markdown source string. They identify the exact span that was selected when the annotation was created. The runtime renderer emits `data-source-start` / `data-source-end` attributes on HTML elements so the browser can map a DOM selection back to source offsets.

Offsets may become stale when the source file is edited. The anchor pipeline re-locates the span; `acceptDrift` updates this field when the human confirms the new location.

#### `quote` — selection context

```yaml
quote:
  exact: "The system shall support concurrent users"  # verbatim selected text
  prefix: "## Scalability\n\n"                        # up to 32 chars before exact
  suffix: " at peak load."                            # up to 32 chars after exact
```

| Sub-field | Description |
|-----------|-------------|
| `exact` | The verbatim selected text at annotation creation time. |
| `prefix` | Up to 32 characters immediately before `exact`. Used to disambiguate when `exact` appears multiple times. |
| `suffix` | Up to 32 characters immediately after `exact`. Same purpose. |

#### `anchor` — drift-recovery signals

```yaml
anchor:
  contextHash: "sha256:abc123..."
  treePath: { ... }
  keywords: [...]
```

`anchor` carries the three types of recovery signals used by the five-step `locate()` pipeline.

**`contextHash`** (always present)

SHA-256 hash of the concatenation `prefix + exact + suffix`. Step 0 of the pipeline checks this hash first: if it still matches the text at the saved `range`, the annotation is immediately confirmed as `confident` without further processing.

**`treePath`** (optional — lazy backfill)

Populated on first re-anchor after the document changes. Describes the structural position within the Markdown AST at annotation time.

| Sub-field | Type | Description |
|-----------|------|-------------|
| `headingText` | `string` | Text of the nearest ancestor heading. |
| `headingLevel` | `integer` | Heading depth (1–6). |
| `paragraphIndex` | `integer` | 0-based index of the paragraph under that heading. |
| `paragraphFingerprint` | `array` | Token set (word n-grams) used for Jaccard similarity. |
| `charOffsetInParagraph` | `integer` | Char offset of `exact` within the paragraph. |

**`keywords`** (optional — lazy backfill)

Rare words extracted from the surrounding text used by Step 4 as a last-resort recovery signal.

| Sub-field | Type | Description |
|-----------|------|-------------|
| `word` | `string` | A low-frequency word in the source text. |
| `distFromStart` | `integer` | Char distance from the keyword's position to `range.start`. |

#### `replies` — threaded comments

```yaml
replies:
  - id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # full UUID v4
    author: "Agent"
    comment: "Addressed in PR #42."
    created_at: "2026-04-08T11:00:00.000Z"
    updated_at: "2026-04-08T11:05:00.000Z"  # optional
```

Each reply has a full UUID v4 `id` (unlike top-level annotations which use 8-char fragments). Reply IDs are auto-backfilled on load if absent (v1 files pre-date reply IDs).

---

## Status enum

| Value | Meaning |
|-------|---------|
| `open` | Active — requires attention. |
| `resolved` | Closed by the author or a reviewer. |
| `drifted` | Source file changed; annotation was re-located with a fuzzy match (score 0.60–0.79). Requires human confirmation via `acceptDrift`. |
| `orphan` | Source file changed and no plausible location could be found after all five recovery steps. |

`drifted` and `orphan` are set by the runtime server; they are not written to the YAML by the anchor pipeline directly — `status` in the YAML file remains `open` or `resolved`. The drift state is derived on load and surfaced to the UI through the `GET /api/annotations` response.

---

## Tag enum

| Value | Typical meaning |
|-------|----------------|
| `bug` | Factual error, broken link, or incorrect claim. Renders as SARIF `error`. |
| `question` | Clarification needed. |
| `suggestion` | Improvement idea. Renders as SARIF `warning`. |
| `nitpick` | Minor style or polish note. Renders as SARIF `note`. |

---

## Section approval

```yaml
sections:
  - heading: "Introduction"
    level: 2
    status: pending     # pending | approved | rejected
  - heading: "Scalability"
    level: 2
    status: approved
  - heading: "Horizontal Scaling"
    level: 3
    status: approved
```

Sections are derived from the current document's TOC on every load — added/removed headings are handled automatically. Approval cascades to child sections: approving `Scalability` (level 2) also approves `Horizontal Scaling` (level 3).

| Field | Type | Description |
|-------|------|-------------|
| `heading` | `string` | Exact heading text (without `#` markers). |
| `level` | `integer` | Heading depth 1–6. |
| `status` | `string` | One of `pending`, `approved`, `rejected`. |

---

## Full v2 example

```yaml
schema_version: 2
source: spec.md
source_hash: "sha256:4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5"
sections:
  - heading: Overview
    level: 2
    status: approved
  - heading: Scalability
    level: 2
    status: pending
annotations:
  - id: "a1b2c3d4"
    author: Henry
    tag: question
    status: open
    comment: "How many concurrent users are targeted?"
    created_at: "2026-04-08T10:30:00.000Z"
    updated_at: "2026-04-08T10:30:00.000Z"
    range:
      start: 412
      end: 454
    quote:
      exact: "The system shall support concurrent users"
      prefix: "## Scalability\n\n"
      suffix: " at peak load."
    anchor:
      contextHash: "sha256:b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c"
      treePath:
        headingText: Scalability
        headingLevel: 2
        paragraphIndex: 0
        paragraphFingerprint:
          - system
          - shall
          - support
          - concurrent
        charOffsetInParagraph: 0
      keywords:
        - word: concurrent
          distFromStart: 4
    replies:
      - id: "550e8400-e29b-41d4-a716-446655440000"
        author: Agent
        comment: "Target is 500 concurrent users per the capacity plan."
        created_at: "2026-04-08T11:00:00.000Z"
  - id: "e5f6a7b8"
    author: Henry
    tag: bug
    status: resolved
    comment: "This link is broken."
    created_at: "2026-04-08T12:00:00.000Z"
    updated_at: "2026-04-08T14:30:00.000Z"
    range:
      start: 892
      end: 920
    quote:
      exact: "[Architecture diagram](./arch.png)"
      prefix: "See the "
      suffix: " for context."
    anchor:
      contextHash: "sha256:c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d"
    replies: []
```

---

## Migration from v1

Schema v1 used `selectors.position { startLine, startColumn, endLine, endColumn }` instead of `range`. v0.5.0 introduces automatic migration:

- **On load**: `AnnotationFile.load()` detects v1 files (missing `schema_version: 2`) and runs the migration in-place. A backup is written to `<basename>.annotations.yaml.bak` before any changes.
- **Batch**: `mdprobe migrate <path-or-dir> [--dry-run]` migrates all `.annotations.yaml` files under a path. Use `--dry-run` to preview changes without writing.

The migration converts `selectors.position` to `range` using character offsets computed from the source file, and computes the initial `contextHash`. `treePath` and `keywords` are populated lazily on first re-anchor.

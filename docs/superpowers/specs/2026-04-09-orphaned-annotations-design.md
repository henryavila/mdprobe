# Orphaned Annotation Detection — Design Spec

**Issue:** henryavila/mdprobe#3
**Date:** 2026-04-09
**Status:** Approved

## Problem

When a file is modified after annotations were created, mdProbe shows a generic banner ("Arquivo modificado desde a ultima revisao"). With 20+ annotations, users cannot tell which ones are affected.

## Solution

When drift is detected, the server runs `reanchorAll()` (already exists) and includes per-annotation anchor status in the API response. The frontend separates annotations into two groups: those that re-anchored successfully and those that were not found. Orphaned annotations appear in a collapsible section at the bottom of the right panel.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Number of states | 2: found / not-found | 3 states (anchored/drifted/orphaned) creates jargon. Fuzzy-matched annotations still work — users don't need to know. |
| Terminology | "Não encontradas" | Plain language, no technical terms |
| Where to show | Right panel annotation list | Content highlights don't work for orphans (text was deleted) |
| Layout | Collapsible section at bottom | Separates problems from working annotations without hiding them |
| When to re-anchor | Automatic, server-side | `reanchorAll()` is fast; no reason to make user click a button |
| Persist updated positions | No — read-only | Silently overwriting YAML could mask real drift |

## Data Flow

### 1. Server (`src/server.js`, lines 527-545)

Current behavior (line 534):
```javascript
if (drift.drifted) json.drift = true
```

New behavior:
```javascript
if (drift.drifted) {
  const content = await fs.readFile(match, 'utf8')
  const anchorResults = reanchorAll(json.annotations, content)
  json.drift = {
    anchorStatus: Object.fromEntries(
      [...anchorResults].map(([id, r]) => [id, r.status === 'orphan' ? 'orphan' : 'anchored'])
    )
  }
}
```

The response changes from `drift: true` (boolean) to `drift: { anchorStatus: { "id1": "anchored", "id2": "orphan" } }` (object). When there is no drift, `drift` remains absent from the response.

**Backward compatibility:** Frontend currently checks `data.drift || false`. Since a truthy object also passes this check, existing code won't break during incremental rollout.

### 2. Store (`src/ui/state/store.js`, line 24)

Add a new signal:
```javascript
export const anchorStatus = signal({})  // Map<annotationId, 'anchored'|'orphan'>
```

Existing `driftWarning` signal remains for the banner display logic.

Computed signals for the two groups:
```javascript
export const orphanedAnnotations = computed(() =>
  filteredAnnotations.value.filter(a => anchorStatus.value[a.id] === 'orphan')
)

export const anchoredAnnotations = computed(() =>
  filteredAnnotations.value.filter(a => anchorStatus.value[a.id] !== 'orphan')
)
```

### 3. Annotation Fetch (`src/ui/hooks/useAnnotations.js`, line 27)

```javascript
driftWarning.value = data.drift || false
// NEW: populate anchor status
if (data.drift && typeof data.drift === 'object') {
  anchorStatus.value = data.drift.anchorStatus || {}
} else {
  anchorStatus.value = {}
}
```

### 4. WebSocket (`src/ui/hooks/useWebSocket.js`, lines 85-87)

Current:
```javascript
case 'drift':
  driftWarning.value = msg.warning || true
  break
```

New:
```javascript
case 'drift':
  driftWarning.value = msg.warning || true
  if (msg.anchorStatus) {
    anchorStatus.value = msg.anchorStatus
  }
  break
```

Server-side WebSocket broadcast must also include `anchorStatus` when drift is detected.

### 5. Banner (`src/ui/app.jsx`, lines 105-111)

Replace the generic message with an orphan count. `orphanedAnnotations` is the computed signal from the store:

```jsx
{driftWarning.value && (
  <div class="drift-banner">
    {orphanedAnnotations.value.length > 0
      ? `Arquivo modificado — ${orphanedAnnotations.value.length} anotação(ões) não encontrada(s)`
      : 'Arquivo modificado desde a ultima revisao.'}
    <button class="btn btn-sm" style="margin-left: 8px"
      onClick={() => driftWarning.value = false}>Dismiss</button>
  </div>
)}
```

When drift exists but all annotations re-anchored: shows the existing generic message.
When orphans exist: shows the count.

### 6. Right Panel (`src/ui/components/RightPanel.jsx`)

Split the annotation list into two sections:

**Main list (lines 66-141):** Render `anchoredAnnotations.value` instead of `filteredAnnotations.value`. No visual change to these cards.

**Orphaned section (after main list):** Collapsible section at the bottom:

```jsx
{orphanedAnnotations.value.length > 0 && (
  <OrphanedSection
    annotations={orphanedAnnotations.value}
    annotationOps={annotationOps}
  />
)}
```

OrphanedSection component:
- Collapsible header: "Não encontradas (N)"
- Expanded by default when drift is first detected
- Cards rendered with reduced opacity (0.65) and dashed left border
- Quote text shown with strikethrough (text no longer exists in file)
- Click on orphaned card does NOT scroll content (there's nothing to scroll to)
- All actions still available (resolve, delete, edit, reply)

### 7. CSS (`src/ui/styles/themes.css`)

```css
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
  padding: 6px 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--tag-bug);
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

## What Does NOT Change

- `src/anchoring.js` — `reanchorAll()` already returns exactly what we need
- `src/annotations.js` — data model unchanged, anchor status is transient
- `src/hash.js` — drift detection logic unchanged
- YAML sidecar files — no writes, positions preserved as-is

## Edge Cases

| Case | Behavior |
|------|----------|
| No drift | No `drift` field in response; `anchorStatus` stays empty; no orphaned section |
| Drift but all re-anchored | Banner shows generic message; orphaned section hidden |
| All annotations orphaned | Main list empty ("No annotations"); orphaned section shows all |
| Annotation created after drift | Not in `anchorStatus` map → treated as anchored (default) |
| File reverted (drift resolved) | Next fetch returns no `drift`; `anchorStatus` cleared; orphaned section disappears |

## Test Plan

### Unit Tests

- `reanchorAll()` integration in server route: mock drift + annotations, verify response shape
- `anchorStatus` signal: verify computed `orphanedAnnotations` / `anchoredAnnotations` split correctly
- Banner text: orphan count vs generic message

### Integration Tests

- Create annotations → modify file (delete annotated text) → fetch → verify `drift.anchorStatus` contains orphan
- Create annotations → modify file (move text) → fetch → verify all anchored (fuzzy match)
- WebSocket drift broadcast includes `anchorStatus`

### UI Tests

- Orphaned section renders when orphans exist
- Orphaned section hidden when no orphans
- Collapsible toggle works
- Orphaned card click does NOT trigger scroll-to-content
- All card actions (resolve, delete, edit, reply) work on orphaned cards

# Annotations v2 — Performance + UX Redesign

**Date:** 2026-04-24
**Status:** Draft for review
**Authors:** @henry, Claude
**Scope:** Single consolidated release ("Anotações 2.0")

---

## 1. Problem statement

Two pain points reported by users prompted this redesign:

1. **Browser freeze on accept/edit.** Every save of an annotation (create, edit, resolve, reply) triggers a full DOM nuke-and-pave of highlights — severe paint/reflow saturation. Ctrl+Alt+Del workaround (DWM repaint reprioritization) is the smoking gun that the pipeline is GPU-bound, not JS-deadlocked. See `memory/bug_browser_freeze_on_annotation.md`.
2. **Edit and reply UX feels cramped and second-class.** The `AnnotationForm` was designed for a 520 px popover but is reused inline inside ~300 px annotation cards in the right panel. Reply is worse: a single-line `<input>` with faded visual hierarchy and no edit/delete.

Both have the same architectural root: single-purpose components repurposed in ill-fitting contexts, and mutation-based highlight rendering that doesn't diff.

## 2. Goals and non-goals

### Goals
- Eliminate the browser freeze on annotation save/edit/resolve in typical documents (≤200 annotations).
- Provide a dedicated, spacious environment to edit annotations and browse/write replies.
- Bring replies to visual parity with root comments (no more "second-class citizen" appearance).
- Keep the lightweight popover experience for **creating** annotations (fast path, small gesture).
- Leave the rendering pipeline pluggable so a future CSS Custom Highlight API migration (Abordagem 2) can drop in without touching UI or data.

### Non-goals (explicitly out of scope)
- Implementing the CSS Custom Highlight API itself — reserved for a follow-up release.
- Block-level renderer virtualization (Abordagem 3 from brainstorm) — rejected as too much rewrite for too little return.
- Gutter indicator UX (Abordagem 4 from brainstorm) — not pursued; may revisit later.
- Giving replies their own tag — replies inherit the thread's tag; promoting reply tags to first-class is a future option if demand emerges.
- Changing the annotation data model on disk (`.annotations.yaml` schema stays compatible).

## 3. High-level solution

Two independent work streams that land together:

| Stream | What it does | Why grouped |
|---|---|---|
| **A. Performance (surgical)** | Stops the browser freeze by replacing nuke-and-pave with a diff, and decoupling effects so selection/section/code-block changes no longer retrigger full highlight passes. | Same files as UX work; separating them would cause merge churn. |
| **B. UX (dedicated modal)** | Popover keeps creating; a new `AnnotationModal` (~720 px, centered, backdrop) handles editing and threaded replies. Reply input becomes a multiline textarea with Ctrl+Enter/Esc and per-reply edit/delete. | Resolves the two user complaints and unifies the "discussion" experience. |

---

## 4. Stream A — Performance (Abordagem 1 arquitetural)

### 4.1 Diff-based highlight updates

Replace the current flow in `src/ui/components/Content.jsx`:

```
(current) on annotations.value change:
  remove ALL <mark> → re-inject ALL <mark>
```

with:

```
(new) on annotations.value change:
  diff prevAnnotations vs nextAnnotations →
    removed: clear <mark> for those ids
    added:   inject <mark> for those ids
    unchanged (including selection changes, unless id moved in/out of visible set): no DOM work
```

**Contract of the new diff function:**

```js
// Returns { added: [...ids], removed: [...ids], kept: [...ids] }
function diffAnnotations(prev, next, { showResolved })
```

- Uses annotation `id` as identity.
- An annotation that changed `tag` or `status` is treated as `removed` + `added` (simpler than attribute-patching).
- Orphan status changes (anchor result) are treated as `removed` + `added` (since position changes).

### 4.2 Decouple the three `useEffect` in `Content.jsx`

Current state: three effects all depend on `currentHtml.value`, and the highlight one also depends on `annotations.value` and `selectedAnnotationId.value`.

New shape:

| Effect | Deps | Responsibility |
|---|---|---|
| `applyHighlightsDiff` | `annotations.value`, `showResolved.value` | Diff + incremental mark mutations |
| `updateSelection` | `selectedAnnotationId.value` | Toggle `data-selected="<id>"` on the `.content-area` root; CSS paints via `.content-area[data-selected="<id>"] mark[data-highlight-id="<id>"]` selector |
| `injectSectionApprovals` | `currentHtml.value`, `sections.value` | Unchanged except dep list trimmed |
| `injectCodeBlockToolbars` | `currentHtml.value` | Unchanged except dep list trimmed |

CSS selector change in `themes.css`: current `.annotation-highlight.selected` rule moves to the attribute-selector shape above. Net effect: clicking an annotation (selection change) mutates **one** DOM attribute, not 100+ `<mark>` elements.

### 4.3 Remove `parent.normalize()` from the hot loop

Keep text-node normalization only on the fallback path where it's observably necessary (the cross-element whitespace-normalized match, `Content.jsx:310-323`). Remove it from the mark-removal loop — `normalize()` is O(n) per call over sibling text nodes and is called per-mark today, making it the main suspect for the freeze amplitude. The plan step for §4.6 will include a before/after measurement to confirm.

### 4.4 Expand the rAF debounce

Current: one `requestAnimationFrame` coalesces concurrent signal updates in the same frame. Expand to a two-frame window so WS broadcast + local HTTP response (typically 10-30 ms apart) collapse into a single pass. Fixed value (2 frames); no runtime config surface.

### 4.5 Highlight renderer behind an interface

Introduce a thin module `src/ui/highlighters/mark-highlighter.js` that exports a factory returning an object with this conceptual shape (plain JS — no TS):

```js
// createMarkHighlighter() returns:
{
  sync(contentEl, annotations, opts),   // apply current state (diff-aware)
  clear(contentEl),                      // remove all marks
  setSelection(contentEl, annotationId), // visual selection only
}
```

`Content.jsx` talks only to this shape. The future CSS Custom Highlight API implementation (Abordagem 2) will ship as `css-highlight-highlighter.js` exporting the same shape — swappable via feature flag or capability detection. **Not implemented in this release.**

### 4.6 Expected performance envelope

On a document with 100 annotations:
- Save one annotation → touch ~1 mark (was: ~200 DOM mutations).
- Click an annotation → 0 DOM mutations (was: full rehighlight).
- WS broadcast of a new annotation → touch ~1 mark + 1 rAF.

## 5. Stream B — UX redesign

### 5.1 Component map

```
Popover        ← existing; keeps handling CREATE only
AnnotationModal ← NEW; handles EDIT, REPLY, THREAD VIEW
AnnotationForm  ← shared, accepts a `mode: 'create' | 'edit' | 'reply'` prop
ReplyItem       ← NEW (replaces ReplyThread's inline div); one per reply, with edit/delete
ReplyList       ← wraps ReplyItem list; paritária visualmente com root comment
```

### 5.2 When each surface appears

| Trigger | Surface |
|---|---|
| Text selection in content | Popover (as today) |
| Click a `<mark>` highlight | Selects annotation; right-panel card scrolls into view (as today) |
| Click "Edit" on annotation card | **AnnotationModal** opens to that annotation, form in edit mode |
| Click "Reply" on annotation card | **AnnotationModal** opens to that annotation, reply form focused |
| Click on annotation card (no action button) | Selects (as today) — no modal |

Keyboard shortcut: pressing `Enter` on a selected annotation card opens the modal.

### 5.3 AnnotationModal anatomy

```
┌───────────────────────────────────────────────────────────┐
│  Discussion · @author · [tag-pill]                  [×]   │  ← header
├───────────────────────────────────────────────────────────┤
│  ▍ "exact quote from the markdown here"                   │  ← quote block
│                                                           │
│  @author · 2 days ago                         [Edit]      │
│  Full comment body here, same typography as content,     │  ← root
│  readable, multi-line, selectable.                       │     comment
│                                                           │
│  ─ Replies (3) ─────────────────────────────────────────  │
│                                                           │
│  @other · 1 day ago                      [Edit] [Del]    │
│  First reply body.                                       │
│                                                           │
│  @henry · 12h ago                        [Edit] [Del]    │  ← replies
│  Second reply body.                                      │     (parity
│                                                           │     with
│  @other · 2h ago                         [Edit] [Del]    │     root)
│  Third reply body.                                       │
│                                                           │
├───────────────────────────────────────────────────────────┤
│  [ write a reply... (Ctrl+Enter to send) ]      [Send]    │  ← footer form
└───────────────────────────────────────────────────────────┘
```

**Dimensions:** 720 px wide (min), auto height up to 80 vh, vertical scroll inside the body region. Header and footer are sticky.

**Dismissal:** Esc, click on backdrop, or the close button. If the footer reply textarea has unsaved content, show a native `confirm("Discard draft?")` before closing.

**Backdrop:** semi-transparent (rgba(0,0,0,0.35)), `z-index: 200` (above popover's 101). Single modal at a time.

**Accessibility:** focus trap inside modal, initial focus on the reply textarea (when opened for reply) or the comment textarea (when opened for edit). Esc returns focus to the element that opened the modal.

### 5.4 AnnotationForm changes

Add a `mode` prop:

- `mode="create"` — as today. Rendered inside Popover.
- `mode="edit"` — prefilled with `annotation.comment` and `annotation.tag`. Rendered inside the modal's root comment section when Edit is clicked.
- `mode="reply"` — textarea only (no tag selector, no quote), shorter min-height (80 px). Rendered at the modal footer. Ctrl+Enter submits; Esc cancels (but doesn't close the modal).

### 5.5 Reply: pragmatic middle-ground

Per agreed decision (option 3):

- Textarea multiline, min-height 80 px, autosize up to 200 px.
- Ctrl+Enter to send.
- Per reply: Edit (opens same textarea inline in place of reply body) and Delete (with confirm).
- **No tag** — reply inherits the root annotation's tag implicitly.
- **Typography parity with root comment**: same `font-size: 13px`, same color, same line-height. Remove the `border-left: 2px solid` + `margin-left: 12px` quote-like styling from `.reply` in `themes.css`.
- Indentation is conveyed by putting replies in a dedicated list below a separator ("Replies (N)"), not by CSS demotion.

### 5.6 Right-panel card behavior change

- **Today:** Edit renders `AnnotationForm` inline inside the card (the cramped state the user complained about).
- **After:** Edit and Reply buttons open the modal. Inline form inside the card is removed.
- **Reply input at the bottom of the card** (currently `<input type="text">`) is **removed** — replies always happen through the modal. Rationale: the card is a summary view; writing happens in the modal.
- Card retains exactly what it shows today: tag, author, status, quote snippet, full comment, Edit/Reply/Resolve/Delete buttons. No change to truncation behavior in this release.

### 5.7 Deletion semantics

- Deleting the root annotation deletes all replies (existing behavior, no change).
- Deleting a reply removes only that reply. Thread stays open.
- Deleting is confirmed via native `confirm()` — consistent with today's root-annotation delete.

## 6. Data model changes

Verified against `src/annotations.js:215-222`: today the server creates each reply with only `{ author, comment, created_at }` — no id. Edit/Delete by array index would be fragile under concurrent edits, so replies need stable identity.

**Change:** add `id` to each reply, generated server-side.
- New replies (via `addReply`): assign a UUID at creation time.
- Existing replies loaded from `.annotations.yaml` without an `id`: server backfills deterministically on read. Backfilled ids are persisted on the next write to that file (any subsequent mutation triggers a full save).
- The on-disk schema stays backward-compatible — old files load without migration and gain ids invisibly.

No client-side id fallback: the client always receives replies with ids, removing an entire class of desync bugs.

## 7. Testing strategy

### Unit (Vitest)
- `diffAnnotations(prev, next, opts)` — exhaustive cases: same set, one added, one removed, tag change, status change, showResolved toggle, orphan flip.
- `mark-highlighter.sync()` — calls the right DOM mutations given a diff; zero mutations when diff is empty.
- Reply id backfill logic (server-side).

### Integration / Component (Vitest + preact-testing-library)
- Clicking Edit opens modal with prefilled comment.
- Clicking Reply opens modal with reply textarea focused.
- Ctrl+Enter in reply textarea posts and clears.
- Esc in modal with dirty draft prompts confirm.
- Deleting a reply removes it from the thread in place.
- Deleting the root annotation closes the modal.
- Selection change on an annotation does not retrigger `applyHighlightsDiff` (spy assertion).

### E2E (Playwright)
- Full flow: select text → popover create → open modal → reply → edit reply → delete reply → close modal → verify state persisted.
- 100-annotation perf smoke: measure frame time during a rapid sequence of resolves; assert no single frame > 100 ms. (Uses `performance.measure`.)

## 8. Rollout

- **Single release** (v0.5.0 — minor bump, since it's a behavior change to edit/reply UX and should be flagged visibly in the changelog).
- **No feature flag** — both streams are infrastructural enough that shipping behind a flag adds more complexity than value for a local tool.
- **Migration note in CHANGELOG**: inline edit form inside right-panel cards is replaced by a modal; reply input moved from the card to the modal.

## 9. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Modal focus trap breaks keyboard nav | Medium | Borrow tested focus-trap from `a11y-dialog` or write a small one with tests; keyboard E2E covers it. |
| Diff algorithm misses a case and stale marks accumulate | Low | Add a "full clear + rebuild" debug command (`Ctrl+Shift+R` within the content area, dev-only) for recovery; log warning if post-diff DOM state mismatches expected. |
| Reply id backfill conflicts on concurrent edits | Low | Backfilled ids are stable after first persist; concurrent conflicts use last-write-wins as today. |
| Modal backdrop click closes with unsaved reply draft | Low | Confirm prompt on dismiss when textarea is dirty. |
| Users miss the inline edit / inline reply | Medium | Keep Edit and Reply buttons visually prominent on the card; announcement in first-run welcome message on next release. |
| Breaking tests depending on the removed inline-edit behavior | High (known) | Update all tests as part of this work; the implementation plan will scope test updates per file. |

## 10. Files touched

**Modified:**
- `src/ui/components/Content.jsx` — diff-based highlights, split effects
- `src/ui/components/AnnotationForm.jsx` — `mode` prop
- `src/ui/components/ReplyThread.jsx` — typography parity, per-reply edit/delete
- `src/ui/components/RightPanel.jsx` — remove inline edit form, remove reply input, wire buttons to modal
- `src/ui/hooks/useAnnotations.js` — add `editReply(annId, replyId, body)` and `deleteReply(annId, replyId)` ops
- `src/ui/state/store.js` — signal for currently-open modal annotation id
- `src/ui/styles/themes.css` — modal styles, reply parity styles
- `src/annotations.js` (server) — backfill reply ids on read

**New:**
- `src/ui/components/AnnotationModal.jsx`
- `src/ui/components/ReplyItem.jsx`
- `src/ui/components/ReplyList.jsx`
- `src/ui/highlighters/mark-highlighter.js`
- `src/ui/highlighters/index.js` (picks the active highlighter; today always `mark`)
- Unit tests mirroring each new file

**Deleted:**
- Inline `ReplyInput` function inside `RightPanel.jsx`

## 11. Open questions (none blocking)

- Should the modal support markdown rendering in comment/reply bodies (bold, lists, links)? **Deferred to follow-up.** This spec assumes plain text.
- Should we show the annotation thread count on the right-panel card (e.g., "3 replies")? **Nice-to-have; include if trivial.**

---

## Appendix A — Glossary

- **Anchoring** — the process in `anchoring.js` that maps a saved annotation's text quote back to a position in the current source. Unchanged by this spec.
- **Highlight** — the visual DOM element (`<mark>`) that paints the annotated range. This spec changes *how and when* they are created, not *what* they represent.
- **Selector** — the serialized form of a highlight range, persisted in `.annotations.yaml`. Unchanged.

## Appendix B — Explicitly deferred

- Abordagem 2 (CSS Custom Highlight API) — ships in a later release using the `Highlighter` interface introduced here.
- Abordagem 4 (gutter indicators) — product question, not technical; revisit only if user feedback indicates need.
- Reply tags (promoting replies to first-class) — data model is forward-compatible; if added later, only `ReplyItem.jsx` and `useAnnotations.js` change.

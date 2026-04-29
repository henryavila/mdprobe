# Screenshot regeneration guide

Screenshots showcase mdProbe features in the README.
Regenerate them whenever the UI changes significantly.

## Fixtures used

| File | Purpose |
|------|---------|
| `tests/fixtures/demo.md` | Primary source — generic Todo App spec |
| `tests/fixtures/demo.annotations.yaml` | 6 annotations covering all tag types |
| `tests/fixtures/demo-edited.md` | Modified copy — triggers drifted state for annotation `f6a7b8c9` |
| `tests/fixtures/demo-thumbnail.png` | Placeholder image so the `![Demo screenshot]` link renders |

## Resolution conventions

Capture at **1280 × 720** (720 p). Scale factor 1 (no device pixel ratio override).
Output files live in the repo root and are referenced by the README.

## Required screenshots

### screenshot-hero.png

**Purpose:** README hero — full app synthesis shot showing the core review workflow.

**Fixture:** `demo.md` + `demo.annotations.yaml`

**UI state:**
- Left sidebar open, `demo.md` selected
- Right annotation panel open
- Scroll position: visible highlights on the Authentication section (annotations 1 and 5, overlapping)
- Panel shows at least 3 annotation cards with thread expanded on annotation 1

**Capture:**
```bash
npx playwright test tests/screenshots/hero.spec.ts --headed
```

Or manually:
```js
await page.goto('http://localhost:4173/?file=demo.md')
// open panel if not already open
await page.click('[data-testid="panel-toggle"]')
await page.screenshot({ path: 'screenshot-hero.png', clip: { x: 0, y: 0, width: 1280, height: 720 } })
```

---

### screenshot-highlight-inline.png

**Purpose:** Demonstrate character-precise inline highlights within paragraphs.

**Fixture:** `demo.md` + `demo.annotations.yaml`

**UI state:**
- Scroll to **Authentication** section
- Annotations 1 (`a1b2c3d4`) and 5 (`e5f6a7b8`) both visible; overlapping highlights show alpha blending
- No panel open (highlight-only view)

**Capture:**
```js
await page.goto('http://localhost:4173/?file=demo.md')
const authHeading = page.locator('h3', { hasText: 'Authentication' })
await authHeading.scrollIntoViewIfNeeded()
await page.screenshot({ path: 'screenshot-highlight-inline.png', clip: { x: 0, y: 0, width: 1280, height: 720 } })
```

---

### screenshot-cross-block.png

**Purpose:** Show cross-block annotation spanning a heading and a code block (precision fix).

**Fixture:** `demo.md` + `demo.annotations.yaml`

**UI state:**
- Scroll to **API** section so both `### Create task` heading and the `javascript` code block are visible
- Annotation `b2c3d4e5` (bug, cross-block) highlight active across the heading and first code line
- Panel closed

**Capture:**
```js
await page.goto('http://localhost:4173/?file=demo.md')
const apiHeading = page.locator('h2', { hasText: 'API' })
await apiHeading.scrollIntoViewIfNeeded()
await page.screenshot({ path: 'screenshot-cross-block.png', clip: { x: 0, y: 0, width: 1280, height: 720 } })
```

---

### screenshot-annotation-panel.png

**Purpose:** Show the annotation side panel with tag badges, reply thread, and action buttons.

**Fixture:** `demo.md` + `demo.annotations.yaml`

**UI state:**
- Panel open
- Annotation `a1b2c3d4` (question) expanded to show the 1-reply thread
- Adjacent annotation `e5f6a7b8` (bug, overlapping) also visible in panel
- Scroll so both are in the panel without clipping

**Capture:**
```js
await page.goto('http://localhost:4173/?file=demo.md')
await page.click('[data-testid="panel-toggle"]')
// expand thread
await page.click('[data-annotation-id="a1b2c3d4"] [data-testid="expand-replies"]')
await page.screenshot({ path: 'screenshot-annotation-panel.png', clip: { x: 0, y: 0, width: 1280, height: 720 } })
```

---

### screenshot-drift-banner.png

**Purpose:** Show the drift warning banner when an annotation cannot be located.

**Fixture:** `demo-edited.md` + `demo.annotations.yaml`

**Note:** Annotation `f6a7b8c9` has `status: drifted` explicitly set. Loading `demo-edited.md`
with the same annotations file confirms the drift because the Math section text changed.

**UI state:**
- `demo-edited.md` loaded
- Drift banner visible at top of viewport (or inline near the annotation)
- Panel showing annotation `f6a7b8c9` with drifted badge

**Capture:**
```js
await page.goto('http://localhost:4173/?file=demo-edited.md&annotations=demo.annotations.yaml')
await page.waitForSelector('[data-testid="drift-banner"]')
await page.screenshot({ path: 'screenshot-drift-banner.png', clip: { x: 0, y: 0, width: 1280, height: 720 } })
```

---

### screenshot-once-review.png

**Purpose:** Demonstrate the `--once` flag single-file review mode (CLI usage).

**Fixture:** `demo.md` + `demo.annotations.yaml` (loaded via `--once`)

**UI state:**
- Minimal single-file layout (no sidebar)
- At least two annotation highlights visible in the document
- Panel open on the right showing the annotation list

**Capture:**
```bash
# Start mdProbe in --once mode
node dist/cli.js --once tests/fixtures/demo.md &

# Then in Playwright:
await page.goto('http://localhost:4173/')
await page.screenshot({ path: 'screenshot-once-review.png', clip: { x: 0, y: 0, width: 1280, height: 720 } })
```

---

## Full Playwright spec skeleton

Save as `tests/screenshots/demo-screenshots.spec.ts` and run with:

```bash
npx playwright test tests/screenshots/demo-screenshots.spec.ts
```

```typescript
import { test } from '@playwright/test'

const BASE = 'http://localhost:4173'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
})

test('hero', async ({ page }) => {
  await page.goto(`${BASE}/?file=demo.md`)
  await page.click('[data-testid="panel-toggle"]')
  await page.screenshot({ path: 'screenshot-hero.png' })
})

test('highlight-inline', async ({ page }) => {
  await page.goto(`${BASE}/?file=demo.md`)
  await page.locator('h3', { hasText: 'Authentication' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'screenshot-highlight-inline.png' })
})

test('cross-block', async ({ page }) => {
  await page.goto(`${BASE}/?file=demo.md`)
  await page.locator('h2', { hasText: 'API' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'screenshot-cross-block.png' })
})

test('annotation-panel', async ({ page }) => {
  await page.goto(`${BASE}/?file=demo.md`)
  await page.click('[data-testid="panel-toggle"]')
  await page.screenshot({ path: 'screenshot-annotation-panel.png' })
})

test('drift-banner', async ({ page }) => {
  await page.goto(`${BASE}/?file=demo-edited.md&annotations=demo.annotations.yaml`)
  await page.waitForSelector('[data-testid="drift-banner"]')
  await page.screenshot({ path: 'screenshot-drift-banner.png' })
})
```

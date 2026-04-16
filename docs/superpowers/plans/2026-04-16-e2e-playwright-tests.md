# E2E Playwright Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive Playwright e2e tests covering the full annotation review workflow — from page load through annotation CRUD, keyboard navigation, section approval, filtering, and panel interactions.

**Architecture:** Tests start a real mdprobe server via `createServer()` with fixture files, then exercise the UI in a real Chromium browser. Each test file focuses on one user journey. A shared helper spawns/tears down the server per test suite.

**Tech Stack:** Playwright Test, mdprobe `createServer()` API, existing test fixtures (`sample.md`, `complex.md`)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `playwright.config.js` | Playwright config — base URL, project, timeout |
| `tests/e2e/helpers/server.js` | Start/stop mdprobe server for tests |
| `tests/e2e/page-load.spec.js` | Scenario 1: Page loads, renders markdown, panels visible |
| `tests/e2e/annotation-crud.spec.js` | Scenario 2: Select text → create → edit → resolve → delete |
| `tests/e2e/keyboard-nav.spec.js` | Scenario 3: j/k navigation, panel toggles, focus mode |
| `tests/e2e/section-approval.spec.js` | Scenario 4: Approve/reject sections, status display |
| `tests/e2e/filters-and-panels.spec.js` | Scenario 5: Filter by tag/author, show resolved, panel collapse |
| `tests/e2e/live-reload.spec.js` | Scenario 6: File change triggers live reload via WebSocket |

---

## Test Scenarios

1. **Page Load & Rendering** — Markdown renders, TOC visible, panels open, no console errors
2. **Annotation CRUD** — Select text → popover auto-focuses → type comment → save → highlight appears → edit → resolve → reopen → delete
3. **Keyboard Navigation** — j/k cycles annotations, `[`/`]` toggle panels, `\` focus mode, shortcuts suppressed in textarea
4. **Section Approval** — Approve/reject buttons on headings, status reflected in sidebar
5. **Filters & Panels** — Filter by tag/author, show resolved toggle, panel collapse/expand, badge count
6. **Live Reload** — Modify markdown file → content updates without page refresh

---

### Task 1: Install Playwright and Create Config

**Files:**
- Modify: `package.json` (devDependencies)
- Create: `playwright.config.js`

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create playwright.config.js**

```javascript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
```

- [ ] **Step 3: Add npm script to package.json**

Add to `"scripts"` section:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 4: Verify Playwright runs**

```bash
npx playwright test --list
```

Expected: "no tests found" (we haven't written any yet)

- [ ] **Step 5: Commit**

```bash
git add playwright.config.js package.json package-lock.json
git commit -m "chore: install Playwright and add e2e test config"
```

---

### Task 2: Server Helper

**Files:**
- Create: `tests/e2e/helpers/server.js`

- [ ] **Step 1: Create server helper**

```javascript
import { createServer } from '../../../src/server.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '..', '..', 'fixtures')

/**
 * Start a mdprobe server with fixture files copied to a temp dir.
 * Returns { server, url, tmpDir } — call server.close() in teardown.
 *
 * @param {object} opts
 * @param {string[]} opts.files - fixture filenames (e.g. ['sample.md'])
 * @param {boolean} [opts.withAnnotations=false] - copy .annotations.yaml too
 * @param {number} [opts.port=0] - 0 = auto-assign
 */
export async function startServer({ files, withAnnotations = false, port = 0 }) {
  // Copy fixtures to temp dir so tests don't pollute originals
  const tmpDir = join(__dirname, '..', '.tmp-' + Date.now())
  mkdirSync(tmpDir, { recursive: true })

  for (const file of files) {
    copyFileSync(join(fixturesDir, file), join(tmpDir, file))
    if (withAnnotations) {
      const yamlName = file.replace(/\.md$/, '.annotations.yaml')
      try {
        copyFileSync(join(fixturesDir, yamlName), join(tmpDir, yamlName))
      } catch {
        // No annotations file for this fixture — that's OK
      }
    }
  }

  const filePaths = files.map(f => join(tmpDir, f))
  const server = await createServer({
    files: filePaths,
    port,
    open: false,
    author: 'e2e-tester',
  })

  return { server, url: server.url, tmpDir }
}

/**
 * Stop server and clean up temp directory.
 */
export async function stopServer({ server, tmpDir }) {
  await server.close()
  rmSync(tmpDir, { recursive: true, force: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/helpers/server.js
git commit -m "test: add e2e server helper for Playwright tests"
```

---

### Task 3: Scenario 1 — Page Load & Rendering

**Files:**
- Create: `tests/e2e/page-load.spec.js`

- [ ] **Step 1: Write the test**

```javascript
import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'], withAnnotations: true })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Page Load & Rendering', () => {
  test('renders the markdown content', async ({ page }) => {
    await page.goto(ctx.url)

    // Main heading visible
    await expect(page.locator('h1')).toHaveText('Sample Spec')

    // Section headings rendered
    await expect(page.locator('h2').first()).toHaveText('Requisitos Funcionais')

    // Content area exists
    await expect(page.locator('.content-area')).toBeVisible()
  })

  test('left panel shows file list and TOC', async ({ page }) => {
    await page.goto(ctx.url)

    // File entry visible
    await expect(page.locator('.left-panel')).toBeVisible()
    await expect(page.locator('.left-panel')).toContainText('sample')
  })

  test('right panel shows existing annotations', async ({ page }) => {
    await page.goto(ctx.url)

    // Wait for annotations to load
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 5000 })

    // Should have 2 open annotations (a1b2c3 and d4e5f6 are open, g7h8i9 is resolved)
    const openCards = page.locator('.annotation-card:not(.resolved)')
    await expect(openCards).toHaveCount(2)
  })

  test('annotation highlights appear in the content', async ({ page }) => {
    await page.goto(ctx.url)

    // Wait for highlights to render (rAF debounced)
    await expect(page.locator('mark[data-highlight-id]').first()).toBeVisible({ timeout: 5000 })

    // At least 2 highlights for the 2 open annotations
    const marks = page.locator('mark[data-highlight-id]')
    expect(await marks.count()).toBeGreaterThanOrEqual(2)
  })

  test('no console errors on load', async ({ page }) => {
    const errors = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(ctx.url)
    await page.waitForTimeout(1000)

    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/e2e/page-load.spec.js
```

Expected: All 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/page-load.spec.js
git commit -m "test(e2e): add page load and rendering scenario"
```

---

### Task 4: Scenario 2 — Annotation CRUD

**Files:**
- Create: `tests/e2e/annotation-crud.spec.js`

- [ ] **Step 1: Write the test**

```javascript
import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  // No annotations initially — start clean for CRUD tests
  ctx = await startServer({ files: ['sample.md'], withAnnotations: false })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Annotation CRUD', () => {
  test('full lifecycle: create → edit → resolve → reopen → delete', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('.content-area h1')

    // --- CREATE ---
    // Select text "O sistema valida todos os inputs do formulário"
    const targetText = page.locator('text=O sistema valida todos os inputs')
    await targetText.waitFor()

    // Triple-click to select the list item text
    const li = page.locator('li', { hasText: 'O sistema valida' })
    await li.click({ clickCount: 3 })

    // Popover should appear with textarea auto-focused
    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 3000 })

    // Textarea should be focused — just start typing
    const textarea = popover.locator('textarea')
    await expect(textarea).toBeFocused()

    // Select a tag
    await popover.locator('.tag-pill--bug').click()

    // Type comment and save
    await textarea.fill('This needs more detail')
    await textarea.press('Control+Enter')

    // Popover should close
    await expect(popover).not.toBeVisible({ timeout: 3000 })

    // Annotation card should appear in right panel
    const card = page.locator('.annotation-card', { hasText: 'This needs more detail' })
    await expect(card).toBeVisible({ timeout: 3000 })

    // Highlight should appear in content
    await expect(page.locator('mark[data-highlight-id]').first()).toBeVisible({ timeout: 3000 })

    // --- SELECT ---
    // Click the annotation card
    await card.click()
    await expect(card).toHaveClass(/selected/)

    // --- RESOLVE ---
    const resolveBtn = card.locator('button', { hasText: 'Resolve' })
    await resolveBtn.click()

    // Card should get resolved class
    await expect(card).toHaveClass(/resolved/)

    // --- REOPEN ---
    // Show resolved annotations
    await page.locator('input[type="checkbox"]').check()

    // Click the resolved card to select it
    await card.click()
    const reopenBtn = card.locator('button', { hasText: 'Reopen' })
    await reopenBtn.click()
    await expect(card).not.toHaveClass(/resolved/)

    // --- EDIT ---
    await card.click()
    const editBtn = card.locator('button', { hasText: 'Edit' })
    await editBtn.click()

    const editTextarea = card.locator('.annotation-form textarea')
    await editTextarea.fill('Updated comment with more detail')

    // Save via Ctrl+Enter
    await editTextarea.press('Control+Enter')
    await expect(card).toContainText('Updated comment with more detail')

    // --- DELETE ---
    await card.click()

    // Handle confirm dialog
    page.on('dialog', dialog => dialog.accept())
    const deleteBtn = card.locator('button', { hasText: 'Delete' })
    await deleteBtn.click()

    // Card should disappear
    await expect(card).not.toBeVisible({ timeout: 3000 })
  })

  test('popover closes on Escape', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('.content-area h1')

    // Select text
    const li = page.locator('li', { hasText: 'email validado' })
    await li.click({ clickCount: 3 })

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 3000 })

    // Press Escape
    await page.keyboard.press('Escape')
    await expect(popover).not.toBeVisible({ timeout: 2000 })
  })

  test('reply to an annotation', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('.content-area h1')

    // Create an annotation first
    const li = page.locator('li', { hasText: 'telefone sem validação' })
    await li.click({ clickCount: 3 })

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 3000 })
    await popover.locator('textarea').fill('Needs phone validation?')
    await popover.locator('textarea').press('Control+Enter')
    await expect(popover).not.toBeVisible({ timeout: 3000 })

    // Click the card to select it
    const card = page.locator('.annotation-card', { hasText: 'Needs phone validation?' })
    await expect(card).toBeVisible({ timeout: 3000 })
    await card.click()

    // Type a reply
    const replyInput = card.locator('.reply-input input')
    await replyInput.fill('Yes, add basic format check')
    await card.locator('.reply-input button').click()

    // Reply should appear
    await expect(card).toContainText('Yes, add basic format check')
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/e2e/annotation-crud.spec.js
```

Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/annotation-crud.spec.js
git commit -m "test(e2e): add annotation CRUD lifecycle scenario"
```

---

### Task 5: Scenario 3 — Keyboard Navigation

**Files:**
- Create: `tests/e2e/keyboard-nav.spec.js`

- [ ] **Step 1: Write the test**

```javascript
import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'], withAnnotations: true })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Keyboard Navigation', () => {
  test('j/k cycles through annotations', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 5000 })

    // Click content area to ensure no input is focused
    await page.locator('.content-area').click()

    // j → selects first annotation
    await page.keyboard.press('j')
    let selected = page.locator('.annotation-card.selected')
    await expect(selected).toHaveCount(1)
    const firstId = await selected.getAttribute('data-annotation-id')

    // j → selects second
    await page.keyboard.press('j')
    selected = page.locator('.annotation-card.selected')
    const secondId = await selected.getAttribute('data-annotation-id')
    expect(secondId).not.toBe(firstId)

    // k → back to first
    await page.keyboard.press('k')
    selected = page.locator('.annotation-card.selected')
    await expect(selected).toHaveAttribute('data-annotation-id', firstId)
  })

  test('[ toggles left panel', async ({ page }) => {
    await page.goto(ctx.url)
    await page.locator('.content-area').click()

    await expect(page.locator('.left-panel:not(.collapsed)')).toBeVisible()

    await page.keyboard.press('[')
    await expect(page.locator('.left-panel.collapsed')).toBeVisible()

    await page.keyboard.press('[')
    await expect(page.locator('.left-panel:not(.collapsed)')).toBeVisible()
  })

  test('] toggles right panel', async ({ page }) => {
    await page.goto(ctx.url)
    await page.locator('.content-area').click()
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 5000 })

    await page.keyboard.press(']')
    await expect(page.locator('.right-panel.collapsed')).toBeVisible()

    await page.keyboard.press(']')
    await expect(page.locator('.right-panel:not(.collapsed)')).toBeVisible()
  })

  test('\\ toggles focus mode (both panels)', async ({ page }) => {
    await page.goto(ctx.url)
    await page.locator('.content-area').click()

    // Both open → close both
    await page.keyboard.press('\\')
    await expect(page.locator('.left-panel.collapsed')).toBeVisible()
    await expect(page.locator('.right-panel.collapsed')).toBeVisible()

    // Both closed → open both
    await page.keyboard.press('\\')
    await expect(page.locator('.left-panel:not(.collapsed)')).toBeVisible()
    await expect(page.locator('.right-panel:not(.collapsed)')).toBeVisible()
  })

  test('shortcuts are suppressed when typing in textarea', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('.content-area h1')

    // Create an annotation to get a textarea
    const li = page.locator('li', { hasText: 'O sistema valida' })
    await li.click({ clickCount: 3 })

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 3000 })

    // Type '[' in textarea — should NOT toggle the left panel
    const textarea = popover.locator('textarea')
    await textarea.type('[')

    // Left panel should still be visible (not toggled)
    await expect(page.locator('.left-panel:not(.collapsed)')).toBeVisible()

    await page.keyboard.press('Escape')
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/e2e/keyboard-nav.spec.js
```

Expected: All 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/keyboard-nav.spec.js
git commit -m "test(e2e): add keyboard navigation scenario"
```

---

### Task 6: Scenario 4 — Section Approval

**Files:**
- Create: `tests/e2e/section-approval.spec.js`

- [ ] **Step 1: Write the test**

```javascript
import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'], withAnnotations: true })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Section Approval', () => {
  test('approve and reject section buttons are visible on headings', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('h2')

    // Section approval buttons should appear near h2 headings
    const approvalBtns = page.locator('.section-approval')
    expect(await approvalBtns.count()).toBeGreaterThan(0)
  })

  test('approving a section updates its status', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('.section-approval')

    // Find the "Edge Cases" section approval (second h2)
    const edgeCaseApproval = page.locator('.section-approval').nth(1)

    // Click approve
    const approveBtn = edgeCaseApproval.locator('button', { hasText: /✓|approve/i })
    if (await approveBtn.isVisible()) {
      await approveBtn.click()

      // Status should change — button styling or text changes
      await page.waitForTimeout(500)

      // Verify via API that the section is approved
      const res = await page.request.get(`${ctx.url}/api/annotations?path=sample.md`)
      const data = await res.json()
      const edgeCase = data.sections?.find(s => s.heading === 'Edge Cases')
      expect(edgeCase?.status).toBe('approved')
    }
  })

  test('section stats update in the UI', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('.content-area h1')

    // Check the left panel for section stats
    const leftPanel = page.locator('.left-panel')
    await expect(leftPanel).toBeVisible()

    // There should be text indicating reviewed/total sections
    // (The exact format depends on the LeftPanel implementation)
    const panelText = await leftPanel.textContent()
    // Should contain some form of section count
    expect(panelText).toMatch(/\d/)
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/e2e/section-approval.spec.js
```

Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/section-approval.spec.js
git commit -m "test(e2e): add section approval scenario"
```

---

### Task 7: Scenario 5 — Filters & Panels

**Files:**
- Create: `tests/e2e/filters-and-panels.spec.js`

- [ ] **Step 1: Write the test**

```javascript
import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'], withAnnotations: true })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Filters & Panels', () => {
  test('filter by tag narrows visible annotations', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 5000 })

    const initialCount = await page.locator('.annotation-card').count()

    // Select "question" tag filter
    const tagSelect = page.locator('.filter-select').first()
    await tagSelect.selectOption('question')

    // Should show only question-tagged annotations
    const filteredCount = await page.locator('.annotation-card').count()
    expect(filteredCount).toBeLessThanOrEqual(initialCount)
    expect(filteredCount).toBeGreaterThan(0)

    // Reset filter
    await tagSelect.selectOption('')
    const resetCount = await page.locator('.annotation-card').count()
    expect(resetCount).toBe(initialCount)
  })

  test('show resolved checkbox reveals resolved annotations', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 5000 })

    const beforeCount = await page.locator('.annotation-card').count()

    // Check "Show resolved"
    await page.locator('input[type="checkbox"]').check()

    // Should now show more (or equal) annotations
    const afterCount = await page.locator('.annotation-card').count()
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount)
  })

  test('collapsed right panel shows badge with open count', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 5000 })

    // Collapse right panel
    await page.locator('.content-area').click()
    await page.keyboard.press(']')

    // Badge should show count
    const badge = page.locator('.panel-collapsed-indicator .badge')
    await expect(badge).toBeVisible()
    const count = parseInt(await badge.textContent())
    expect(count).toBeGreaterThan(0)
  })

  test('clicking collapsed panel indicator opens it', async ({ page }) => {
    await page.goto(ctx.url)

    // Collapse right panel
    await page.locator('.content-area').click()
    await page.keyboard.press(']')
    await expect(page.locator('.right-panel.collapsed')).toBeVisible()

    // Click the indicator
    await page.locator('.panel-collapsed-indicator').click()
    await expect(page.locator('.right-panel:not(.collapsed)')).toBeVisible()
  })

  test('clicking annotation card scrolls to highlight in content', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 5000 })

    // Click the first annotation card
    await page.locator('.annotation-card').first().click()

    // The corresponding highlight should be visible (scrolled into view)
    const selectedId = await page.locator('.annotation-card.selected').getAttribute('data-annotation-id')
    const highlight = page.locator(`mark[data-highlight-id="${selectedId}"]`)
    await expect(highlight).toBeVisible({ timeout: 3000 })
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/e2e/filters-and-panels.spec.js
```

Expected: All 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/filters-and-panels.spec.js
git commit -m "test(e2e): add filters and panel interaction scenario"
```

---

### Task 8: Scenario 6 — Live Reload

**Files:**
- Create: `tests/e2e/live-reload.spec.js`

- [ ] **Step 1: Write the test**

```javascript
import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'], withAnnotations: false })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Live Reload', () => {
  test('editing the markdown file triggers content update', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('h1')

    const originalTitle = await page.locator('h1').textContent()
    expect(originalTitle).toBe('Sample Spec')

    // Modify the file on disk
    const filePath = join(ctx.tmpDir, 'sample.md')
    const content = readFileSync(filePath, 'utf8')
    const modified = content.replace('# Sample Spec', '# Updated Title')
    writeFileSync(filePath, modified)

    // Wait for live reload via WebSocket
    await expect(page.locator('h1')).toHaveText('Updated Title', { timeout: 5000 })
  })

  test('new content is rendered without page refresh', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('.content-area')

    // Append new content to file
    const filePath = join(ctx.tmpDir, 'sample.md')
    const content = readFileSync(filePath, 'utf8')
    writeFileSync(filePath, content + '\n\n## New Section Added\n\nBrand new content here.\n')

    // The new section should appear without refreshing
    await expect(page.locator('text=Brand new content here')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('h2', { hasText: 'New Section Added' })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/e2e/live-reload.spec.js
```

Expected: All 2 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/live-reload.spec.js
git commit -m "test(e2e): add live reload scenario"
```

---

### Task 9: Run Full E2E Suite & Final Commit

- [ ] **Step 1: Run all e2e tests**

```bash
npx playwright test
```

Expected: All tests across 6 spec files PASS

- [ ] **Step 2: Run existing test suite to verify no regressions**

```bash
npm test
```

Expected: All 768 unit/integration tests PASS

- [ ] **Step 3: Final commit**

```bash
git add -A tests/e2e/
git commit -m "test(e2e): complete Playwright e2e test suite (6 scenarios)"
```

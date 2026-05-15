// REAL mouse-event regression for the highlight-mismatch bug.
//
// Unlike `highlights-inline-code-list.spec.js`, this file uses no
// programmatic `Range` objects. The selection is created entirely by
// `page.mouse.{move,down,up}` so the test exercises the exact code path
// a human gesture goes through:
//
//   - the browser builds a `Selection`/`Range` from the synthesized
//     pointer events (the source of truth for any selection bug);
//   - `handleMouseUp` in `src/ui/components/Content.jsx` receives the
//     mouseup the same way it would from a user;
//   - the resulting annotation is persisted to the on-disk YAML.
//
// If anything in this end-to-end chain disagrees with what the user saw on
// screen, this test will reveal it.

import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { startServer, stopServer } from './helpers/server.js'

let ctx

const FIXTURE = 'inline-code-in-list.md'
const CODE_WORD = 'area_notification_deadlines'

test.beforeEach(async () => {
  ctx = await startServer({ files: [FIXTURE], withAnnotations: false })
})
test.afterEach(async () => stopServer(ctx))

function readSavedAnnotations() {
  const yamlPath = join(ctx.tmpDir, FIXTURE.replace(/\.md$/, '.annotations.yaml'))
  if (!existsSync(yamlPath)) return []
  const parsed = yaml.load(readFileSync(yamlPath, 'utf8'))
  return parsed?.annotations || []
}

async function waitForAnnotationOnDisk(page, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const anns = readSavedAnnotations()
    if (anns.length > 0) return anns
    await page.waitForTimeout(100)
  }
  return readSavedAnnotations()
}

test.describe('real-mouse selection regression', () => {
  test('double-click on inline-code word, captured annotation matches the browser selection char-for-char', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area li').first()).toBeVisible({ timeout: 5000 })

    const codeLocator = page.locator('code', { hasText: CODE_WORD })
    await expect(codeLocator).toHaveCount(1)
    // The fixture is long — scroll the target into view before clicking,
    // otherwise the synthesized mouse coordinates land on whatever happens
    // to be at (codeBox.x, codeBox.y) when the element is below the fold.
    await codeLocator.scrollIntoViewIfNeeded()

    const codeBox = await codeLocator.boundingBox()
    expect(codeBox).not.toBeNull()
    const cx = codeBox.x + codeBox.width / 2
    const cy = codeBox.y + codeBox.height / 2

    // Snapshot the live selection at every mouseup (capture phase), BEFORE
    // mdprobe's own mouseup handler shows the popover and the popover's
    // textarea autofocus collapses the selection. A double-click fires
    // TWO mouseups — the word-snap happens on the second one — so we keep
    // the listener attached and overwrite `__lastSelection` each time. The
    // final value is the post-word-snap selection.
    await page.evaluate(() => {
      window.__lastSelection = null
      document.addEventListener('mouseup', () => {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed) {
          window.__lastSelection = { text: sel.toString() }
        }
      }, true)
    })

    // Real double-click: two consecutive mousedown/up pairs at the same
    // coordinates within the double-click time threshold. The browser
    // word-snaps the selection on the second click and fires `mouseup`
    // which mdprobe captures.
    await page.mouse.move(cx, cy)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })

    const captured = await page.evaluate(() => window.__lastSelection)
    expect(captured, 'double-click did not produce a non-collapsed selection on mouseup').not.toBeNull()
    const selectionTextAtSave = captured.text
    expect(selectionTextAtSave).toBe(CODE_WORD)

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    const textarea = popover.locator('textarea')
    await textarea.fill('e2e real-mouse')
    await textarea.press('Control+Enter')
    await expect(popover).not.toBeVisible({ timeout: 5000 })

    const anns = await waitForAnnotationOnDisk(page)
    expect(anns.length).toBe(1)

    // Strip the markdown syntax characters (backticks) from the persisted
    // `exact` — what the user saw on screen never includes those — and
    // assert the result equals `selection.toString()` at the moment of save.
    const renderedFromExact = anns[0].quote.exact.replace(/`/g, '')
    expect(renderedFromExact).toBe(selectionTextAtSave)
  })

  test('drag-select across the <code> boundary and into the trailing text — persisted exact matches selection', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area li').first()).toBeVisible({ timeout: 5000 })

    // Identify the code element and the trailing text region of the SAME li.
    const codeLocator = page.locator('code', { hasText: CODE_WORD })
    await codeLocator.scrollIntoViewIfNeeded()
    const codeBox = await codeLocator.boundingBox()

    // The trailing text " (extensão...)" sits inside the same <li>. Long
    // lines may wrap to multiple visual lines, so pick a coordinate on the
    // LAST visual line of the trailing text via getClientRects().
    const trailingTarget = await page.evaluate(() => {
      const code = [...document.querySelectorAll('.content-area code')]
        .find(c => c.textContent === 'area_notification_deadlines')
      const li = code.closest('li')
      let trailing = null
      for (const c of li.childNodes) {
        if (c.nodeType === Node.TEXT_NODE && c.textContent.includes('resolved_at')) {
          trailing = c
          break
        }
      }
      if (!trailing) throw new Error('trailing text not found')
      // Find the index of "resolved_at" inside the text node, then make a
      // collapsed range there to get its on-screen coords.
      const idx = trailing.textContent.indexOf('resolved_at')
      const r = document.createRange()
      r.setStart(trailing, idx + 'resolved_at'.length)
      r.setEnd(trailing, idx + 'resolved_at'.length)
      const rects = r.getClientRects()
      const rect = rects[rects.length - 1] || r.getBoundingClientRect()
      return { x: rect.left, y: rect.top + rect.height / 2 }
    })

    // Snapshot the live selection at every mouseup (capture phase). The
    // popover's textarea autofocus collapses the selection right after
    // mdprobe's own handler runs, so we record the value while it still
    // exists. Keep the listener attached so the LAST mouseup wins (a
    // drag ends with one mouseup, a dblclick with two).
    await page.evaluate(() => {
      window.__lastSelection = null
      document.addEventListener('mouseup', () => {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed) {
          window.__lastSelection = { text: sel.toString() }
        }
      }, true)
    })

    // Real drag-select from the start of the code element to past the
    // trailing text.
    await page.mouse.move(codeBox.x + 2, codeBox.y + codeBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(trailingTarget.x, trailingTarget.y, { steps: 20 })
    await page.mouse.up()

    const captured = await page.evaluate(() => window.__lastSelection)
    expect(captured, `no selection captured at mouseup; drag fell through onto something else`).not.toBeNull()
    const selectionTextAtSave = captured.text
    expect(selectionTextAtSave).toContain(CODE_WORD)
    expect(selectionTextAtSave).toContain('resolved_at')

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    const textarea = popover.locator('textarea')
    await textarea.fill('e2e real drag')
    await textarea.press('Control+Enter')
    await expect(popover).not.toBeVisible({ timeout: 5000 })

    const anns = await waitForAnnotationOnDisk(page)
    expect(anns.length).toBe(1)

    // Round-trip: the rendered (visible) text from the persisted exact MUST
    // equal the browser's selection.toString() at the moment of save.
    const renderedFromExact = anns[0].quote.exact.replace(/`/g, '')
    expect(renderedFromExact).toBe(selectionTextAtSave)

    // And the source-positions stored must point at characters that actually
    // exist in the markdown source — `range.start` should be on a printable
    // char of the rendered text (not, e.g., on the opening backtick).
    const sourceMd = readFileSync(join(ctx.tmpDir, FIXTURE), 'utf8')
    const startChar = sourceMd[anns[0].range.start]
    // The visible selection starts with 'a' of "area_notification_deadlines".
    expect(startChar).toBe('a')
  })
})

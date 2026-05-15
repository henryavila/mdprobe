// E2E regression for the "selecting a list item with inline <code> captures
// the wrong source range and renders a highlight on totally different chars"
// bug reported by Henry on 2026-05-15.
//
// Why a Playwright test and not just a unit test
// ----------------------------------------------
// The unit tests in tests/unit/anchoring-inline-bug.test.jsx prove that
// `describe()` and `buildDomRanges()` map between DOM points and source
// offsets correctly. But the user-facing bug also involves:
//   - how the browser actually constructs a Range from a double-click event
//     (word selection inside a <code> element vs. across element boundaries);
//   - how Chromium normalizes selection endpoints when text crosses inline
//     boundaries;
//   - how the production bundle (dist/) — not the source files — handles
//     all of the above.
// A Playwright test exercises the real bundle in a real Chromium and is the
// only level at which "the user's selection matches what mdprobe captures
// AND persists" can be asserted end-to-end.

import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { startServer, stopServer } from './helpers/server.js'

let ctx

const FIXTURE = 'inline-code-in-list.md'
const TARGET_CODE_WORD = 'area_notification_deadlines'
const TARGET_LINE_VISIBLE_TEXT =
  'area_notification_deadlines (extensão cross-área: acknowledgment_of_receipt, extended_date, marked_as_overdue, resolved_at)'

// Each test gets its own server + tmpDir so the saved annotation YAML
// starts empty — these tests assert on exact annotation count and content.
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

/**
 * Programmatically build a `Range` and put it on `window.getSelection()`. We
 * use this instead of `locator.dblclick()` because headless Chromium does
 * not always extend the caret to a word boundary on synthetic double-clicks.
 * The captured range goes through the EXACT same code path as a real user
 * gesture (mouseup → handleMouseUp → describe()), so this is a faithful
 * surrogate of the user-reported scenario.
 */
async function selectViaRange(page, build) {
  return await page.evaluate(build)
}

test.describe('Selecting list item content with inline <code> — regression for 2026-05-15 bug', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area li').first()).toBeVisible({ timeout: 5000 })
  })

  test('range covering only the inline-code word persists with the right exact', async ({ page }) => {
    const selectionText = await selectViaRange(page, () => {
      const code = [...document.querySelectorAll('.content-area code')]
        .find(c => c.textContent === 'area_notification_deadlines')
      if (!code) throw new Error('code element not found')
      const t = code.firstChild
      const r = document.createRange()
      r.setStart(t, 0)
      r.setEnd(t, t.textContent.length)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      document.querySelector('.content-area').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return sel.toString()
    })
    expect(selectionText).toBe(TARGET_CODE_WORD)

    // Popover should appear (uses `.popover` per the existing CRUD tests).
    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    // Save with Ctrl+Enter.
    const textarea = popover.locator('textarea')
    await textarea.fill('regression: inline-code-word')
    await textarea.press('Control+Enter')
    await expect(popover).not.toBeVisible({ timeout: 5000 })

    const anns = await waitForAnnotationOnDisk(page)
    expect(anns.length).toBe(1)
    // The saved exact must equal the rendered text the user selected.
    expect(anns[0].quote.exact).toBe(TARGET_CODE_WORD)
    // Bug shape used to be: range.start landed on the opening backtick
    // (one char BEFORE the rendered text). Assert against that explicitly.
    const sourceMd = readFileSync(join(ctx.tmpDir, FIXTURE), 'utf8')
    expect(sourceMd[anns[0].range.start]).toBe('a')
    expect(sourceMd[anns[0].range.end - 1]).toBe('s') // last char of "deadlines"
  })

  test('range spanning <code> through the trailing text of the same <li> persists with stripped-backticks exact equal to the visible line', async ({ page }) => {
    const selectionText = await selectViaRange(page, () => {
      const code = [...document.querySelectorAll('.content-area code')]
        .find(c => c.textContent === 'area_notification_deadlines')
      if (!code) throw new Error('code element not found')
      const li = code.closest('li')
      const codeText = code.firstChild
      let trailing = null
      for (const c of li.childNodes) {
        if (c.nodeType === Node.TEXT_NODE && c.textContent.includes('extensão')) {
          trailing = c
          break
        }
      }
      if (!trailing) throw new Error('trailing text not found')
      const r = document.createRange()
      r.setStart(codeText, 0)
      r.setEnd(trailing, trailing.textContent.length)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      document.querySelector('.content-area').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return sel.toString()
    })

    // The browser's selection text equals the visible line content — no
    // backticks, no leading "- ", just what the user saw.
    expect(selectionText).toBe(TARGET_LINE_VISIBLE_TEXT)

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    const textarea = popover.locator('textarea')
    await textarea.fill('regression: full-li-with-inline-code')
    await textarea.press('Control+Enter')
    await expect(popover).not.toBeVisible({ timeout: 5000 })

    const anns = await waitForAnnotationOnDisk(page)
    expect(anns.length).toBe(1)

    // Saved exact spans contiguous source — the backticks of the inline
    // code wrap the word, so they appear in the saved exact. Once those
    // are stripped, the result must equal the visible line.
    const stripped = anns[0].quote.exact.replace(/`/g, '')
    expect(stripped).toBe(TARGET_LINE_VISIBLE_TEXT)

    // The captured range must NOT spill past the list item. The bug shape
    // saw range.end land in the NEXT paragraph (e.g. "...resolved_at)\n\n3. ").
    const sourceMd = readFileSync(join(ctx.tmpDir, FIXTURE), 'utf8')
    const tail = sourceMd.slice(anns[0].range.end, anns[0].range.end + 4)
    expect(tail.startsWith('\n')).toBe(true)
    expect(sourceMd[anns[0].range.end - 1]).toBe(')')
  })

  test('range that genuinely crosses two blocks (drag past the line) does NOT silently include extra content', async ({ page }) => {
    // The exact gesture the user described: double-click + drag past the
    // current paragraph. We simulate it as a Range from the <code> of the
    // "deadlines" line into the start of the next paragraph.
    const selectionText = await selectViaRange(page, () => {
      const code = [...document.querySelectorAll('.content-area code')]
        .find(c => c.textContent === 'area_notification_deadlines')
      if (!code) throw new Error('code element not found')
      const codeText = code.firstChild

      // Find the next sibling LI that starts with "Models" header.
      const li = code.closest('li')
      const ul = li.parentElement
      const olOrNext = ul.nextElementSibling
      // Find the LI for "AreaNotificationConfig" (first inside next ul).
      let targetLi = null
      const allLis = document.querySelectorAll('.content-area li')
      for (const x of allLis) {
        if (x.textContent.includes('AreaNotificationConfig')) { targetLi = x; break }
      }
      if (!targetLi) throw new Error('next-block li not found')
      const targetCode = targetLi.querySelector('code')
      if (!targetCode) throw new Error('next-block code not found')

      const r = document.createRange()
      r.setStart(codeText, 0)
      // End at offset 4 in the next-block code text → "Area" prefix.
      r.setEnd(targetCode.firstChild, 4)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      document.querySelector('.content-area').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return sel.toString()
    })

    // The browser's visible selection spans both blocks.
    expect(selectionText).toContain('area_notification_deadlines')
    expect(selectionText).toContain('Area') // start of next block

    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    const textarea = popover.locator('textarea')
    await textarea.fill('regression: cross-block drag')
    await textarea.press('Control+Enter')
    await expect(popover).not.toBeVisible({ timeout: 5000 })

    const anns = await waitForAnnotationOnDisk(page)
    expect(anns.length).toBe(1)

    // The saved exact MUST end with the "Area" prefix from the next block —
    // not silently extend further (which is the failure shape we're guarding
    // against). Strip markdown syntax characters before comparing.
    const exact = anns[0].quote.exact
    expect(exact).toContain('area_notification_deadlines')
    expect(exact).toContain('Area')
    // Must NOT include the rest of "AreaNotificationConfig" — only the
    // first 4 chars of that next-block code.
    expect(exact).not.toContain('AreaNotificationConfig')
  })
})

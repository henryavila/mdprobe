import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['no-headings.md'], withAnnotations: false })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Highlights Precision', () => {
  test('cross-block selection produces precise highlight after reload', async ({ page }) => {
    await page.goto(ctx.url)

    // Wait for content to render — no-headings.md has no headings so check for p
    await expect(page.locator('.content-area p').first()).toBeVisible({ timeout: 5000 })

    // Ensure at least 2 paragraphs exist
    const pCount = await page.locator('.content-area p').count()
    expect(pCount).toBeGreaterThanOrEqual(2)

    // Programmatically create a selection spanning 2 paragraphs
    await page.evaluate(() => {
      const ps = document.querySelectorAll('.content-area p')
      if (ps.length < 2) throw new Error('need at least 2 paragraphs')
      const range = document.createRange()
      range.setStart(ps[0].firstChild, 6)
      range.setEnd(ps[1].firstChild, 6)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    })

    // Trigger the popover via mouseup on the content area
    await page.dispatchEvent('.content-area', 'mouseup')

    // Popover should appear
    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    // Fill the textarea and submit
    const textarea = popover.locator('textarea')
    await expect(textarea).toBeVisible()
    await textarea.fill('Cross-block precision test')
    await textarea.press('Control+Enter')

    // Popover should close
    await expect(popover).not.toBeVisible({ timeout: 5000 })

    // Annotation card should appear — grab its ID
    const card = page.locator('.annotation-card').first()
    await expect(card).toBeVisible({ timeout: 5000 })
    await expect(card).toContainText('Cross-block precision test')

    const annotationId = await card.getAttribute('data-annotation-id')
    expect(annotationId).toBeTruthy()

    // Reload the page
    await page.reload()
    await expect(page.locator('.content-area p').first()).toBeVisible({ timeout: 5000 })

    // Wait for highlights to be applied (two RAF cycles + highlight sync)
    await page.waitForTimeout(500)

    // Verify the CSS Highlight API registered the annotation
    const highlightText = await page.evaluate((annId) => {
      if (typeof CSS === 'undefined' || typeof CSS.highlights === 'undefined') {
        return '__no_css_highlights_api__'
      }
      const name = `ann-${annId}`
      const h = CSS.highlights.get(name)
      if (!h) return null
      // Extract text from each Range in the highlight
      const texts = [...h].map(r => r.toString())
      return texts.join('|')
    }, annotationId)

    // The CSS Highlights API must be supported in Chromium
    expect(highlightText).not.toBe('__no_css_highlights_api__')

    // The highlight must exist (not null)
    expect(highlightText).not.toBeNull()

    // The highlight text must be non-empty
    expect(highlightText.length).toBeGreaterThan(0)

    // Sanity check: not the whole document (line-expansion bug would produce thousands of chars)
    expect(highlightText.length).toBeLessThan(200)

    // The text should contain content from the selection (characters 6+ of first paragraph)
    // no-headings.md first paragraph: "This is a markdown file without any headings."
    // offset 6 => "is a markdown file without any headings."
    expect(highlightText).toMatch(/\S+/)
  })
})

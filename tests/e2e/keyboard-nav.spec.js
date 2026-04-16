import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'], withAnnotations: true })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

/**
 * Helper: click the content area to ensure no input has focus,
 * then wait for annotation cards to be loaded.
 */
async function prepareForShortcuts(page) {
  await page.goto(ctx.url)
  await expect(page.locator('.content-area h1')).toContainText('Sample Spec')
  // Click content area to ensure focus is not in any input
  await page.locator('.content-area').click()
}

test.describe('Keyboard Navigation', () => {
  test('j/k cycles through annotations', async ({ page }) => {
    await prepareForShortcuts(page)

    // Wait for annotation cards to load (async)
    const cards = page.locator('.annotation-card')
    await expect(cards.first()).toBeVisible({ timeout: 10000 })

    const cardCount = await cards.count()
    expect(cardCount).toBeGreaterThanOrEqual(2)

    // Ensure content area has focus (not an input)
    await page.locator('.content-area').click()

    // j selects first annotation
    await page.keyboard.press('j')
    const firstCard = cards.nth(0)
    await expect(firstCard).toHaveClass(/selected/, { timeout: 3000 })

    // j selects second annotation
    await page.keyboard.press('j')
    const secondCard = cards.nth(1)
    await expect(secondCard).toHaveClass(/selected/, { timeout: 3000 })

    // k goes back to first annotation
    await page.keyboard.press('k')
    await expect(firstCard).toHaveClass(/selected/, { timeout: 3000 })
  })

  test('[ toggles left panel', async ({ page }) => {
    await prepareForShortcuts(page)

    const leftPanel = page.locator('.left-panel')
    await expect(leftPanel).toBeVisible({ timeout: 5000 })

    // Should not be collapsed initially
    await expect(leftPanel).not.toHaveClass(/collapsed/)

    // Press [ to collapse
    await page.keyboard.press('[')
    await expect(leftPanel).toHaveClass(/collapsed/, { timeout: 3000 })

    // Press [ again to expand
    await page.keyboard.press('[')
    await expect(leftPanel).not.toHaveClass(/collapsed/, { timeout: 3000 })
  })

  test('] toggles right panel', async ({ page }) => {
    await prepareForShortcuts(page)

    const rightPanel = page.locator('.right-panel')
    await expect(rightPanel).toBeVisible({ timeout: 5000 })

    // Should not be collapsed initially
    await expect(rightPanel).not.toHaveClass(/collapsed/)

    // Press ] to collapse
    await page.keyboard.press(']')
    await expect(rightPanel).toHaveClass(/collapsed/, { timeout: 3000 })

    // Press ] again to expand
    await page.keyboard.press(']')
    await expect(rightPanel).not.toHaveClass(/collapsed/, { timeout: 3000 })
  })

  test('\\ toggles focus mode (both panels)', async ({ page }) => {
    await prepareForShortcuts(page)

    const leftPanel = page.locator('.left-panel')
    const rightPanel = page.locator('.right-panel')
    await expect(leftPanel).toBeVisible({ timeout: 5000 })
    await expect(rightPanel).toBeVisible({ timeout: 5000 })

    // Both should be open initially
    await expect(leftPanel).not.toHaveClass(/collapsed/)
    await expect(rightPanel).not.toHaveClass(/collapsed/)

    // Press \ to enter focus mode — both collapse
    await page.keyboard.press('\\')
    await expect(leftPanel).toHaveClass(/collapsed/, { timeout: 3000 })
    await expect(rightPanel).toHaveClass(/collapsed/, { timeout: 3000 })

    // Press \ again to exit focus mode — both expand
    await page.keyboard.press('\\')
    await expect(leftPanel).not.toHaveClass(/collapsed/, { timeout: 3000 })
    await expect(rightPanel).not.toHaveClass(/collapsed/, { timeout: 3000 })
  })

  test('shortcuts suppressed when focus is in textarea', async ({ page }) => {
    await prepareForShortcuts(page)

    const leftPanel = page.locator('.left-panel')
    await expect(leftPanel).not.toHaveClass(/collapsed/)

    // Trigger the annotation popover by selecting text
    await page.evaluate(() => {
      const items = document.querySelectorAll('.content-area li')
      const target = items[0]
      if (!target) return
      const range = document.createRange()
      range.selectNodeContents(target)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    // Wait for popover with textarea to appear
    const popover = page.locator('.popover')
    await expect(popover).toBeVisible({ timeout: 5000 })

    const textarea = popover.locator('textarea')
    await expect(textarea).toBeVisible()

    // Type [ in the textarea — should NOT toggle left panel
    await textarea.type('[')

    // Left panel should still be open (not collapsed)
    await expect(leftPanel).not.toHaveClass(/collapsed/)
  })
})

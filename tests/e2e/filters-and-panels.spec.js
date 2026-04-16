import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'], withAnnotations: true })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Filters and Panels', () => {
  test('filter by tag narrows visible annotations', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 10000 })

    // Count initial cards (should be 2 open: both "question" tag)
    const initialCount = await page.locator('.annotation-card').count()
    expect(initialCount).toBeGreaterThanOrEqual(1)

    // Select "suggestion" tag in filter — this should show 0 cards since
    // the suggestion annotation is resolved and showResolved is off by default
    const filterSelect = page.locator('.filter-select')
    await filterSelect.selectOption('suggestion')

    // Wait for filter to take effect
    await page.waitForTimeout(300)
    const filteredCount = await page.locator('.annotation-card').count()
    expect(filteredCount).toBeLessThan(initialCount)
  })

  test('show resolved reveals resolved annotations', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 10000 })

    // Count open cards (resolved are hidden by default)
    const openCount = await page.locator('.annotation-card').count()

    // Check the "Show resolved" checkbox
    const checkbox = page.locator('.right-panel input[type="checkbox"]')
    await checkbox.check()

    // Wait for re-render
    await page.waitForTimeout(500)
    const totalCount = await page.locator('.annotation-card').count()
    expect(totalCount).toBeGreaterThan(openCount)
  })

  test('collapsed right panel shows badge', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 10000 })

    // Ensure content area has focus (not an input)
    await page.locator('.content-area').click()

    // Press ] to collapse right panel
    await page.keyboard.press(']')
    await expect(page.locator('.right-panel')).toHaveClass(/collapsed/, { timeout: 3000 })

    // Collapsed indicator should show a badge with open annotation count
    const badge = page.locator('.right-panel .panel-collapsed-indicator .badge')
    await expect(badge).toBeVisible({ timeout: 3000 })
    const badgeText = await badge.textContent()
    expect(parseInt(badgeText, 10)).toBeGreaterThan(0)
  })

  test('clicking collapsed indicator opens panel', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 10000 })

    // Collapse right panel via keyboard
    await page.locator('.content-area').click()
    await page.keyboard.press(']')
    await expect(page.locator('.right-panel')).toHaveClass(/collapsed/, { timeout: 3000 })

    // Click the collapsed indicator to reopen
    await page.locator('.right-panel .panel-collapsed-indicator').click()
    await expect(page.locator('.right-panel')).not.toHaveClass(/collapsed/, { timeout: 3000 })
  })

  test('clicking card scrolls to highlight', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('mark[data-highlight-id]').first()).toBeVisible({ timeout: 10000 })

    // Click the first annotation card
    const firstCard = page.locator('.annotation-card').first()
    const annotationId = await firstCard.getAttribute('data-annotation-id')
    await firstCard.click()

    // The corresponding highlight mark should be visible in the viewport
    const highlight = page.locator(`mark[data-highlight-id="${annotationId}"]`)
    await expect(highlight).toBeVisible({ timeout: 5000 })
  })
})

// Regression for "double-click opens popover but textarea is not focused"
// reported on 2026-05-15.
//
// Compare two paths to opening the popover:
//   (A) drag-select with mouse — popover opens AND textarea is focused.
//   (B) double-click — popover opens BUT textarea is NOT focused.
// Both should land in the same end state (textarea focused).

import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

let ctx

test.beforeEach(async () => {
  ctx = await startServer({ files: ['inline-code-in-list.md'], withAnnotations: false })
})
test.afterEach(async () => stopServer(ctx))

async function activeElementTag(page) {
  return await page.evaluate(() => document.activeElement?.tagName || null)
}

test.describe('annotation popover focuses its textarea on every entry path', () => {
  test('drag-select → popover textarea is focused (control case)', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area li').first()).toBeVisible({ timeout: 5000 })

    const codeLocator = page.locator('code', { hasText: 'area_notification_deadlines' })
    await codeLocator.scrollIntoViewIfNeeded()
    const box = await codeLocator.boundingBox()

    await page.mouse.move(box.x + 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 6 })
    await page.mouse.up()

    await expect(page.locator('.popover')).toBeVisible({ timeout: 3000 })
    // Two requestAnimationFrames worth of latency is enough for Preact to
    // commit AND for AnnotationForm's deferred-focus useEffect to run.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect(await activeElementTag(page)).toBe('TEXTAREA')
  })

  test('double-click → popover textarea must also be focused (the reported bug)', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area li').first()).toBeVisible({ timeout: 5000 })

    const codeLocator = page.locator('code', { hasText: 'area_notification_deadlines' })
    await codeLocator.scrollIntoViewIfNeeded()
    const box = await codeLocator.boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // Real double-click.
    await page.mouse.move(cx, cy)
    await page.mouse.down({ clickCount: 1 })
    await page.mouse.up({ clickCount: 1 })
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })

    await expect(page.locator('.popover')).toBeVisible({ timeout: 3000 })
    await page.waitForTimeout(50)
    expect(await activeElementTag(page)).toBe('TEXTAREA')
  })
})

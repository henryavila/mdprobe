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
  test('section approval buttons visible on headings', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area h1')).toContainText('Sample Spec')

    // Wait for annotations to load so section-approval elements render
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 10000 })

    // Section approval buttons are injected after sections state is populated
    const approvalButtons = page.locator('.section-approval-injected')
    await expect(approvalButtons.first()).toBeVisible({ timeout: 10000 })
    const count = await approvalButtons.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('approving a section updates its status', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area h1')).toContainText('Sample Spec')
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 10000 })

    // Wait for section-approval buttons to render
    const sectionApprovals = page.locator('.section-approval-injected')
    await expect(sectionApprovals.first()).toBeVisible({ timeout: 10000 })
    const count = await sectionApprovals.count()
    expect(count).toBeGreaterThanOrEqual(1)

    // Find a section-approval whose status span does NOT say "approved"
    let targetIndex = -1
    for (let i = 0; i < count; i++) {
      const statusText = await sectionApprovals.nth(i).locator('.section-status').last().textContent()
      if (statusText?.trim() !== 'approved') {
        targetIndex = i
        break
      }
    }
    // If all are approved, just use the first one (toggle behavior)
    if (targetIndex === -1) targetIndex = 0

    // Click the approve button (first button in the section-approval)
    const approveBtn = sectionApprovals.nth(targetIndex).locator('button').first()
    await approveBtn.click()

    // Verify via API that sections reflect the change
    const response = await page.request.get(`${ctx.url}/api/annotations?path=sample.md`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.sections).toBeDefined()
    expect(data.sections.length).toBeGreaterThanOrEqual(1)
    // At least one section should have status "approved"
    const approvedSections = data.sections.filter(s => s.status === 'approved')
    expect(approvedSections.length).toBeGreaterThanOrEqual(1)
  })

  test('section stats visible in left panel TOC', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area h1')).toContainText('Sample Spec')
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 10000 })

    // The left panel TOC shows section entries with annotation count badges
    const leftPanel = page.locator('.left-panel')
    await expect(leftPanel).toBeVisible()

    // TOC items should exist
    const tocItems = leftPanel.locator('.toc-item')
    const count = await tocItems.count()
    expect(count).toBeGreaterThanOrEqual(1)

    // At least one TOC item should have a badge with a number (annotation count)
    const badges = leftPanel.locator('.toc-item .badge')
    const badgeCount = await badges.count()
    expect(badgeCount).toBeGreaterThanOrEqual(1)

    // The badge should contain a positive number
    const badgeText = await badges.first().textContent()
    expect(parseInt(badgeText, 10)).toBeGreaterThan(0)
  })
})

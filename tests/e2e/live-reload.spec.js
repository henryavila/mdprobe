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
  test('editing file triggers content update', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area h1')).toContainText('Sample Spec')

    // Modify the h1 title in the file on disk
    const filePath = join(ctx.tmpDir, 'sample.md')
    const content = readFileSync(filePath, 'utf8')
    writeFileSync(filePath, content.replace('# Sample Spec', '# Updated Title'))

    // Wait for live reload to update the page
    await expect(page.locator('.content-area h1')).toContainText('Updated Title', { timeout: 10000 })
  })

  test('new content rendered without page refresh', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.content-area h1')).toBeVisible({ timeout: 5000 })

    // Append a new section to the file
    const filePath = join(ctx.tmpDir, 'sample.md')
    const content = readFileSync(filePath, 'utf8')
    writeFileSync(filePath, content + '\n\n## New Section\n\nThis is new content added for testing.\n')

    // Verify the new section appears without manual refresh
    await expect(page.locator('.content-area h2:has-text("New Section")')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.content-area')).toContainText('This is new content added for testing.')
  })
})

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, stopServer } from './helpers/server.js'

const fixturesDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures')
const expectedSource = readFileSync(join(fixturesDir, 'sample.md'), 'utf-8')

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: ['sample.md'] })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test.describe('Copy .md + View raw source', () => {
  test('"Copy .md" button copies the raw original markdown to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ctx.url })
    await page.goto(ctx.url)

    const copyBtn = page.getByRole('button', { name: 'Copy .md' })
    await expect(copyBtn).toBeEnabled()

    await copyBtn.click()

    // Button gives ✓ feedback...
    await expect(page.getByRole('button', { name: '✓ Copied' })).toBeVisible()

    // ...and the clipboard holds the exact original source.
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(expectedSource)

    // Feedback resets back to "Copy .md".
    await expect(page.getByRole('button', { name: 'Copy .md' })).toBeVisible({ timeout: 3000 })
  })

  test('Export menu "Raw Markdown (.md)" opens the raw source in a new tab', async ({ page, context }) => {
    await page.goto(ctx.url)

    await page.getByRole('button', { name: 'Export' }).click()

    const [rawTab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Raw Markdown (.md)' }).click(),
    ])

    await rawTab.waitForLoadState()
    expect(rawTab.url()).toContain('/api/source')

    // The opened tab serves the raw markdown as text/plain.
    const body = await rawTab.evaluate(() => document.body.innerText)
    expect(body).toContain(expectedSource.trim().split('\n')[0]) // first line of the source
  })
})

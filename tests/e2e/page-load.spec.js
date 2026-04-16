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
    await expect(page.locator('.content-area h1')).toHaveText('Sample Spec')
    await expect(page.locator('.content-area h2').first()).toContainText('Requisitos Funcionais')
    await expect(page.locator('.content-area')).toBeVisible()
  })

  test('left panel shows file list and TOC', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.left-panel')).toBeVisible()
    await expect(page.locator('.left-panel')).toContainText('Sample Spec')
  })

  test('right panel shows existing annotations', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('.annotation-card').first()).toBeVisible({ timeout: 5000 })
    const openCards = page.locator('.annotation-card:not(.resolved)')
    await expect(openCards).toHaveCount(2)
  })

  test('annotation highlights appear in the content', async ({ page }) => {
    await page.goto(ctx.url)
    await expect(page.locator('mark[data-highlight-id]').first()).toBeVisible({ timeout: 5000 })
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

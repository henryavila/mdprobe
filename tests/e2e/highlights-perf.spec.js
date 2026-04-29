import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

const FIXTURE_FILE = 'large-200-anns.md'

let ctx

test.beforeAll(async () => {
  ctx = await startServer({ files: [FIXTURE_FILE], withAnnotations: true })
})

test.afterAll(async () => {
  await stopServer(ctx)
})

test('rapid resolve burst does not produce >2 long tasks', async ({ page }) => {
  await page.goto(ctx.url)

  // Wait for highlights to render (CSS Highlight API populates after content paint)
  await page.waitForFunction(
    () => typeof CSS !== 'undefined' && CSS.highlights && CSS.highlights.size > 0,
    { timeout: 10000 }
  )

  const longTaskCount = await page.evaluate(async (fileName) => {
    return new Promise((resolve) => {
      let count = 0
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration > 100) count++
        }
      })
      obs.observe({ entryTypes: ['longtask'] })

      const resolves = []
      for (let i = 0; i < 20; i++) {
        resolves.push(
          fetch('/api/annotations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file: fileName,
              action: 'resolve',
              data: { id: 'ann-' + i },
            }),
          })
        )
      }

      Promise.all(resolves).then(() =>
        setTimeout(() => {
          obs.disconnect()
          resolve(count)
        }, 1500)
      )
    })
  }, FIXTURE_FILE)

  expect(longTaskCount).toBeLessThan(3)
})

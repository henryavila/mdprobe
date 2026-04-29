/**
 * capture-screenshots.mjs
 *
 * One-shot Playwright script to capture 6 PNG screenshots from the
 * generic demo fixtures. Run directly with Node:
 *
 *   node tests/e2e/capture-screenshots.mjs
 *
 * Output files are written to the repo root with a `screenshot-` prefix.
 */

import pkg from '../../node_modules/playwright/index.mjs'
const { chromium } = pkg

import { startServer, stopServer } from './helpers/server.js'
import { createServer as createServerDirect } from '../../src/server.js'
import path from 'node:path'
import fs from 'node:fs'
import { mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const fixturesDir = join(__dirname, '..', 'fixtures')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for CSS Highlight API to have at least one highlight registered. */
async function waitForHighlights(page, timeout = 10000) {
  await page.waitForFunction(
    () => typeof CSS !== 'undefined' && CSS.highlights && CSS.highlights.size > 0,
    { timeout },
  ).catch(() => {
    console.warn('  [warn] CSS.highlights not populated within timeout — continuing')
  })
}

/** Wait for annotations panel to show at least one annotation card. */
async function waitForAnnotationCards(page, timeout = 8000) {
  await page.waitForSelector('.annotation-card', { timeout }).catch(() => {
    console.warn('  [warn] No annotation cards found within timeout — continuing')
  })
}

/**
 * Dismiss the drift banner if it is visible.
 * The banner appears for any file whose yaml has no source_hash.
 * For screenshots that are NOT about drift, we dismiss it to keep
 * the viewport clean.
 */
async function dismissDriftBanner(page) {
  const banner = page.locator('.drift-banner button')
  const visible = await banner.isVisible().catch(() => false)
  if (visible) {
    await banner.click()
    await page.waitForTimeout(200)
  }
}

/**
 * Scroll to a heading in the content area by partial text match.
 * Handles headings that contain injected button text (e.g. "API✓✗").
 *
 * @param {import('playwright').Page} page
 * @param {string} tag   - CSS selector tag, e.g. 'h2' or 'h3'
 * @param {string} text  - Partial heading text to match
 * @param {'start'|'center'} block
 */
async function scrollToHeading(page, tag, text, block = 'start') {
  await page.evaluate(
    ({ tag, text, block }) => {
      const headings = [...document.querySelectorAll(`.content-area ${tag}`)]
      const target = headings.find(h => h.textContent.includes(text))
      if (target) {
        target.scrollIntoView({ behavior: 'instant', block })
      }
    },
    { tag, text, block },
  )
  await page.waitForTimeout(350)
}

/** Ensure the right panel is open (not collapsed). */
async function openRightPanel(page) {
  const isOpen = await page.evaluate(
    () => !document.querySelector('.right-panel')?.classList.contains('collapsed'),
  )
  if (!isOpen) {
    await page.keyboard.press(']')
    await page.waitForTimeout(300)
  }
}

/** Ensure the left panel is open (not collapsed). */
async function openLeftPanel(page) {
  const isOpen = await page.evaluate(
    () => !document.querySelector('.left-panel')?.classList.contains('collapsed'),
  )
  if (!isOpen) {
    await page.keyboard.press('[')
    await page.waitForTimeout(300)
  }
}

/**
 * Collapse both panels.
 * Uses the `\` toggle only when both panels are currently open;
 * otherwise closes each panel individually to avoid mis-toggling.
 */
async function collapseAllPanels(page) {
  const leftOpen = await page.evaluate(
    () => !document.querySelector('.left-panel')?.classList.contains('collapsed'),
  )
  const rightOpen = await page.evaluate(
    () => !document.querySelector('.right-panel')?.classList.contains('collapsed'),
  )
  if (leftOpen && rightOpen) {
    // Both open → `\` closes both
    await page.keyboard.press('\\')
    await page.waitForTimeout(300)
  } else {
    // Close individually to avoid toggle surprises
    if (leftOpen) {
      await page.keyboard.press('[')
      await page.waitForTimeout(200)
    }
    if (rightOpen) {
      await page.keyboard.press(']')
      await page.waitForTimeout(200)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function captureAll() {
  console.log('Starting screenshot capture...\n')

  // =========================================================================
  // Server 1: demo.md + annotations (normal mode)
  // =========================================================================
  console.log('Starting server 1 (demo.md + annotations)...')
  const ctx1 = await startServer({
    files: ['demo.md', 'demo-thumbnail.png'],
    withAnnotations: true,
  })
  console.log(`  Server 1 at ${ctx1.url}\n`)

  const browser1 = await chromium.launch({ headless: true })
  try {

    // -----------------------------------------------------------------------
    // 1. screenshot-hero.png
    //    Full app, both panels open, scrolled to Authentication (anns 1 + 5)
    // -----------------------------------------------------------------------
    console.log('[1/6] screenshot-hero.png (1920x1080)...')
    {
      const page = await browser1.newPage({ viewport: { width: 1920, height: 1080 } })
      await page.goto(ctx1.url)
      await page.waitForSelector('.content-area', { timeout: 10000 })
      await page.waitForTimeout(600)

      // Ensure both panels are open (they start open but be explicit)
      await openLeftPanel(page)
      await openRightPanel(page)

      // Wait for annotation cards and highlights
      await waitForAnnotationCards(page)
      await waitForHighlights(page)

      // Dismiss the drift banner (yaml has no source_hash → always triggers)
      await dismissDriftBanner(page)

      // Scroll content to Authentication section
      await scrollToHeading(page, 'h3', 'Authentication')

      await page.screenshot({ path: join(repoRoot, 'screenshot-hero.png'), fullPage: false })
      await page.close()
      console.log('  ✓ screenshot-hero.png')
    }

    // -----------------------------------------------------------------------
    // 2. screenshot-highlight-inline.png
    //    Authentication section, both panels collapsed (focus mode)
    // -----------------------------------------------------------------------
    console.log('[2/6] screenshot-highlight-inline.png (1280x720)...')
    {
      const page = await browser1.newPage({ viewport: { width: 1280, height: 720 } })
      await page.goto(ctx1.url)
      await page.waitForSelector('.content-area', { timeout: 10000 })
      await page.waitForTimeout(600)

      await waitForHighlights(page)

      // Dismiss drift banner before collapse so it doesn't show in focus mode
      await dismissDriftBanner(page)

      // Collapse both panels for focus mode
      await collapseAllPanels(page)

      // Scroll to Authentication to show annotations 1 and 5 (overlapping highlights)
      await scrollToHeading(page, 'h3', 'Authentication')

      await page.screenshot({ path: join(repoRoot, 'screenshot-highlight-inline.png'), fullPage: false })
      await page.close()
      console.log('  ✓ screenshot-highlight-inline.png')
    }

    // -----------------------------------------------------------------------
    // 3. screenshot-cross-block.png
    //    API / Create task section: heading + code block, no panels
    // -----------------------------------------------------------------------
    console.log('[3/6] screenshot-cross-block.png (1280x720)...')
    {
      const page = await browser1.newPage({ viewport: { width: 1280, height: 720 } })
      await page.goto(ctx1.url)
      await page.waitForSelector('.content-area', { timeout: 10000 })
      await page.waitForTimeout(600)

      await waitForHighlights(page)

      // Dismiss drift banner first
      await dismissDriftBanner(page)

      // Collapse panels BEFORE scrolling (avoids panel-resize reflowing scroll)
      await collapseAllPanels(page)

      // Scroll to the "### Create task" heading — annotation b2c3d4e5
      // spans this heading and the first line of the code block.
      // Use 'center' so both the heading AND the first code line are in frame.
      await scrollToHeading(page, 'h3', 'Create task', 'center')

      await page.screenshot({ path: join(repoRoot, 'screenshot-cross-block.png'), fullPage: false })
      await page.close()
      console.log('  ✓ screenshot-cross-block.png')
    }

    // -----------------------------------------------------------------------
    // 4. screenshot-overlap.png
    //    Authentication section, no panels — shows alpha blending
    // -----------------------------------------------------------------------
    console.log('[4/6] screenshot-overlap.png (1280x720)...')
    {
      const page = await browser1.newPage({ viewport: { width: 1280, height: 720 } })
      await page.goto(ctx1.url)
      await page.waitForSelector('.content-area', { timeout: 10000 })
      await page.waitForTimeout(600)

      await waitForHighlights(page)

      // Dismiss drift banner
      await dismissDriftBanner(page)

      // Collapse panels for focus on highlights
      await collapseAllPanels(page)

      // Scroll to Authentication — overlap is on "expire after **24 hours**."
      await scrollToHeading(page, 'h3', 'Authentication')

      await page.screenshot({ path: join(repoRoot, 'screenshot-overlap.png'), fullPage: false })
      await page.close()
      console.log('  ✓ screenshot-overlap.png')
    }

  } finally {
    await browser1.close()
    await stopServer(ctx1)
    console.log('\nServer 1 stopped.\n')
  }

  // =========================================================================
  // Server 2: demo-edited.md + original demo.annotations.yaml (drifted)
  //
  // The helper names yaml after the .md file, so we manually copy and rename
  // demo.annotations.yaml → demo-edited.annotations.yaml in a tmp dir.
  // =========================================================================
  console.log('Starting server 2 (demo-edited.md + annotations — drifted state)...')

  const tmpDir2 = join(__dirname, '..', '.tmp-drift-' + Date.now())
  mkdirSync(tmpDir2, { recursive: true })
  copyFileSync(join(fixturesDir, 'demo-edited.md'), join(tmpDir2, 'demo-edited.md'))
  copyFileSync(join(fixturesDir, 'demo.annotations.yaml'), join(tmpDir2, 'demo-edited.annotations.yaml'))

  const serverDrifted = await createServerDirect({
    files: [join(tmpDir2, 'demo-edited.md')],
    port: 0,
    open: false,
    author: 'e2e-tester',
  })
  console.log(`  Server 2 at ${serverDrifted.url}\n`)

  const browser2 = await chromium.launch({ headless: true })
  try {

    // -----------------------------------------------------------------------
    // 5. screenshot-drifted.png
    //    Both panels open, right panel shows Drifted section,
    //    content scrolled to Math section
    // -----------------------------------------------------------------------
    console.log('[5/6] screenshot-drifted.png (1920x1080)...')
    {
      const page = await browser2.newPage({ viewport: { width: 1920, height: 1080 } })
      await page.goto(serverDrifted.url)
      await page.waitForSelector('.content-area', { timeout: 10000 })
      await page.waitForTimeout(600)

      // Ensure both panels are open
      await openLeftPanel(page)
      await openRightPanel(page)

      // Wait for annotation cards and drifted section
      await waitForAnnotationCards(page)
      await page.waitForSelector('.drifted-section', { timeout: 8000 }).catch(() => {
        console.warn('  [warn] .drifted-section not found — continuing')
      })

      // Ensure the drifted section is expanded (click header if collapsed)
      const driftHeader = page.locator('.drifted-section .orphaned-section-header')
      if (await driftHeader.isVisible().catch(() => false)) {
        const hasCards = await page.evaluate(() =>
          document.querySelectorAll('.drifted-section .annotation-card.drifted').length > 0,
        )
        if (!hasCards) {
          await driftHeader.click()
          await page.waitForTimeout(300)
        }
      }

      // Scroll content to Math section — annotation f6a7b8c9 lives here
      await scrollToHeading(page, 'h2', 'Math')

      await page.screenshot({ path: join(repoRoot, 'screenshot-drifted.png'), fullPage: false })
      await page.close()
      console.log('  ✓ screenshot-drifted.png')
    }

  } finally {
    await browser2.close()
    await serverDrifted.close()
    rmSync(tmpDir2, { recursive: true, force: true })
    console.log('\nServer 2 stopped.\n')
  }

  // =========================================================================
  // Server 3: demo.md + annotations in --once mode
  // =========================================================================
  console.log('Starting server 3 (demo.md --once mode)...')

  const tmpDir3 = join(__dirname, '..', '.tmp-once-' + Date.now())
  mkdirSync(tmpDir3, { recursive: true })
  copyFileSync(join(fixturesDir, 'demo.md'), join(tmpDir3, 'demo.md'))
  copyFileSync(join(fixturesDir, 'demo.annotations.yaml'), join(tmpDir3, 'demo.annotations.yaml'))
  copyFileSync(join(fixturesDir, 'demo-thumbnail.png'), join(tmpDir3, 'demo-thumbnail.png'))

  const serverOnce = await createServerDirect({
    files: [join(tmpDir3, 'demo.md')],
    port: 0,
    open: false,
    once: true,
    author: 'e2e-tester',
  })
  console.log(`  Server 3 at ${serverOnce.url}\n`)

  const browser3 = await chromium.launch({ headless: true })
  try {

    // -----------------------------------------------------------------------
    // 6. screenshot-once-review.png
    //    Full app, --once mode, "Finish Review" button visible in header
    // -----------------------------------------------------------------------
    console.log('[6/6] screenshot-once-review.png (1920x1080)...')
    {
      const page = await browser3.newPage({ viewport: { width: 1920, height: 1080 } })
      await page.goto(serverOnce.url)
      await page.waitForSelector('.content-area', { timeout: 10000 })
      await page.waitForTimeout(600)

      // Wait for the "Finish Review" button (btn-primary, rendered when reviewMode=true)
      await page.waitForSelector('.btn-primary', { timeout: 8000 }).catch(() => {
        console.warn('  [warn] .btn-primary (Finish Review) not found — continuing')
      })

      await waitForAnnotationCards(page)
      await waitForHighlights(page)

      // Ensure both panels open
      await openLeftPanel(page)
      await openRightPanel(page)

      // Dismiss drift banner (yaml has no source_hash)
      await dismissDriftBanner(page)

      // Scroll to Authentication section so highlights are visible
      await scrollToHeading(page, 'h3', 'Authentication')

      await page.screenshot({ path: join(repoRoot, 'screenshot-once-review.png'), fullPage: false })
      await page.close()
      console.log('  ✓ screenshot-once-review.png')
    }

  } finally {
    await browser3.close()
    await serverOnce.close()
    rmSync(tmpDir3, { recursive: true, force: true })
    console.log('\nServer 3 stopped.\n')
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n=== Screenshot capture complete ===\n')
  const outputFiles = [
    'screenshot-hero.png',
    'screenshot-highlight-inline.png',
    'screenshot-cross-block.png',
    'screenshot-overlap.png',
    'screenshot-drifted.png',
    'screenshot-once-review.png',
  ]
  for (const f of outputFiles) {
    const fp = join(repoRoot, f)
    if (fs.existsSync(fp)) {
      const size = fs.statSync(fp).size
      console.log(`  ok  ${f}  (${(size / 1024).toFixed(1)} KB)`)
    } else {
      console.log(`  MISSING  ${f}`)
    }
  }
}

captureAll().catch(err => {
  console.error('\nFATAL:', err)
  process.exit(1)
})

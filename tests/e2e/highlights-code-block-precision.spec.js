import { test, expect } from '@playwright/test'
import { startServer, stopServer } from './helpers/server.js'

test.describe('cross-block selection: heading + code block', () => {
  let ctx
  test.beforeEach(async () => {
    ctx = await startServer({ files: ['heading-codeblock.md'] })
  })
  test.afterEach(async () => stopServer(ctx))

  /**
   * Regression test for duplicate highlight bug.
   *
   * When a user drags a selection from a heading into a code block, Chromium
   * may normalize the Range so that endContainer is the <pre> element with
   * endOffset=1 (meaning "after the <code> element child"). In this case, the
   * entire code block IS intentionally selected — that is correct.
   *
   * The previous bug was that both <pre> AND <code> carry the same
   * data-source-start/end attributes, causing buildDomRanges to produce
   * DUPLICATE ranges for the same text (code highlighted twice).
   *
   * This test verifies that even in the Chromium-normalized case, the code
   * block content appears EXACTLY ONCE in the highlight (no duplication).
   */
  test('Chromium-normalized range (endContainer=pre, offset=1) does NOT duplicate the code block highlight', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('h2:has-text("Per-annotation YAML")')

    // Simulate Chromium's selection normalization:
    // User drags from H2 to "just after the code block text" →
    // Chromium sets endContainer = <pre>, endOffset = 1
    // (meaning: after the <code> child of <pre>)
    const diag = await page.evaluate(async () => {
      const h2 = [...document.querySelectorAll('h2')].find(h => h.textContent.includes('Per-annotation YAML'))
      if (!h2) throw new Error('heading not found')
      const headingTextNode = h2.firstChild

      const pre = document.querySelector('pre')
      if (!pre) throw new Error('pre not found')

      // This is what Chromium normalizes to when user drags into a code block:
      // endContainer = <pre>, endOffset = 1 (= after the <code> child)
      const range = document.createRange()
      range.setStart(headingTextNode, 6)
      range.setEnd(pre, 1) // <-- the Chromium normalization that causes the bug

      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)

      const diag = {
        startContainer: range.startContainer.nodeType === 3 ? 'TEXT:' + range.startContainer.textContent.slice(0, 30) : 'EL:' + range.startContainer.tagName,
        startOffset: range.startOffset,
        endContainer: range.endContainer.nodeType === 3 ? 'TEXT:' + range.endContainer.textContent.slice(0, 30) : 'EL:' + range.endContainer.tagName,
        endOffset: range.endOffset,
        selectionText: sel.toString().slice(0, 300),
        preSourceStart: pre.getAttribute('data-source-start'),
        preSourceEnd: pre.getAttribute('data-source-end'),
        codeSourceStart: document.querySelector('pre code').getAttribute('data-source-start'),
        codeSourceEnd: document.querySelector('pre code').getAttribute('data-source-end'),
        codeTextLength: document.querySelector('pre code').textContent.length,
        h2SourceStart: h2.getAttribute('data-source-start'),
        h2SourceEnd: h2.getAttribute('data-source-end'),
      }

      const evt = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })
      document.querySelector('.content-area').dispatchEvent(evt)

      window.__diag__ = diag
      return diag
    })

    console.log('Diagnostic (Chromium-normalized):', JSON.stringify(diag, null, 2))

    // Wait for popover to appear
    await page.waitForSelector('.popover, .annotation-form', { timeout: 5000 })

    // Type a comment and submit
    const commentField = page.locator('.popover textarea, .annotation-form textarea').first()
    await commentField.fill('test annotation chromium-norm')

    try {
      await page.locator('.popover button[type="submit"], .annotation-form button[type="submit"]').first().click({ timeout: 2000 })
    } catch {
      await commentField.press('Control+Enter')
    }

    // Wait for highlight to appear
    await page.waitForFunction(() => CSS.highlights && CSS.highlights.size > 0, { timeout: 5000 })

    const highlightInfo = await page.evaluate(() => {
      const names = [...CSS.highlights.keys()].filter(n => n.startsWith('ann-'))
      const annName = names.find(n => n !== 'ann-selected')
      if (!annName) return { error: 'no annotation highlight' }
      const h = CSS.highlights.get(annName)
      const ranges = [...h]
      const text = ranges.map(r => r.toString()).join('|||')
      const codeContent = document.querySelector('pre code').textContent
      return {
        annName,
        rangeCount: ranges.length,
        highlightText: text,
        highlightLength: text.length,
        codeContentLength: codeContent.length,
        codeContent: codeContent.slice(0, 100),
        selectionWas: window.__diag__?.selectionText || 'unknown',
      }
    })

    console.log('Highlight info (Chromium-normalized):', JSON.stringify(highlightInfo, null, 2))

    expect(highlightInfo.error).toBeUndefined()

    // When endContainer=<pre>, offset=1, the selection genuinely covers the
    // ENTIRE code block. The correct highlight covers: paragraph + full code.
    // The pre-fix bug was that both <pre> AND <code> generated ranges, causing
    // the code text to appear TWICE. After the deduplication fix, each unique
    // block appears exactly once.

    // The code block content must appear at most ONCE in the highlight text.
    // If it appeared twice, that would be the duplication bug.
    const codeContent = highlightInfo.codeContent.trim()
    const occurrences = (highlightInfo.highlightText.match(
      new RegExp(codeContent.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    ) || []).length
    expect(occurrences).toBe(1)

    // Total highlight length must equal approximately: p-text + separator(s) + code-text
    // p = "Some text before the code block." = 32 chars + 3 (|||) + 66 (code) = 101
    // Allow a small margin for whitespace differences.
    expect(highlightInfo.highlightLength).toBeLessThanOrEqual(highlightInfo.codeContentLength + 40)
  })

  /**
   * Natural text-node selection: selecting half of heading + half of first code line.
   * Both endContainer = text node (the "normal" case).
   */
  test('selecting half of heading + half of first code line does NOT highlight whole code block', async ({ page }) => {
    await page.goto(ctx.url)
    await page.waitForSelector('h2:has-text("Per-annotation YAML")')

    const diag = await page.evaluate(async () => {
      const h2 = [...document.querySelectorAll('h2')].find(h => h.textContent.includes('Per-annotation YAML'))
      if (!h2) throw new Error('heading not found')
      const headingTextNode = h2.firstChild

      const code = document.querySelector('pre code')
      if (!code) throw new Error('code block not found')

      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, null)
      let target = null
      let node
      while ((node = walker.nextNode())) {
        if (node.textContent.includes('schema_version')) { target = node; break }
      }
      if (!target) throw new Error('schema_version text node not found')

      const range = document.createRange()
      range.setStart(headingTextNode, 6)
      range.setEnd(target, 6)

      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)

      const diag = {
        startContainer: range.startContainer.nodeType === 3 ? 'TEXT:' + range.startContainer.textContent.slice(0, 30) : 'EL:' + range.startContainer.tagName,
        startOffset: range.startOffset,
        endContainer: range.endContainer.nodeType === 3 ? 'TEXT:' + range.endContainer.textContent.slice(0, 30) : 'EL:' + range.endContainer.tagName,
        endOffset: range.endOffset,
        selectionText: sel.toString().slice(0, 200),
      }

      const evt = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })
      document.querySelector('.content-area').dispatchEvent(evt)

      window.__diag__ = diag
      return diag
    })

    console.log('Diagnostic (text-node):', JSON.stringify(diag, null, 2))

    await page.waitForSelector('.popover, .annotation-form', { timeout: 5000 })

    const commentField = page.locator('.popover textarea, .annotation-form textarea').first()
    await commentField.fill('test annotation text-node')

    try {
      await page.locator('.popover button[type="submit"], .annotation-form button[type="submit"]').first().click({ timeout: 2000 })
    } catch {
      await commentField.press('Control+Enter')
    }

    await page.waitForFunction(() => CSS.highlights && CSS.highlights.size > 0, { timeout: 5000 })

    const highlightInfo = await page.evaluate(() => {
      const names = [...CSS.highlights.keys()].filter(n => n.startsWith('ann-'))
      const annName = names.find(n => n !== 'ann-selected')
      if (!annName) return { error: 'no annotation highlight' }
      const h = CSS.highlights.get(annName)
      const ranges = [...h]
      const text = ranges.map(r => r.toString()).join('|||')
      const codeContent = document.querySelector('pre code').textContent
      return {
        annName,
        rangeCount: ranges.length,
        highlightText: text,
        highlightLength: text.length,
        codeContentLength: codeContent.length,
        selectionWas: window.__diag__?.selectionText || 'unknown',
      }
    })

    console.log('Highlight info (text-node):', JSON.stringify(highlightInfo, null, 2))

    expect(highlightInfo.error).toBeUndefined()
    expect(highlightInfo.highlightLength).toBeLessThan(highlightInfo.codeContentLength)
    expect(highlightInfo.highlightText.toLowerCase()).toContain('schema')
    expect(highlightInfo.highlightText).not.toContain('annotations:')
    expect(highlightInfo.highlightText).not.toContain('id:')
  })
})

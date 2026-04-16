import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/preact'
import { Content } from '../../src/ui/components/Content.jsx'
import {
  currentHtml,
  annotations,
  showResolved,
  selectedAnnotationId,
  sections,
} from '../../src/ui/state/store.js'

// ---------------------------------------------------------------------------
// Content highlight injection tests — TDD: written BEFORE implementing the fix
// ---------------------------------------------------------------------------

// Flush pending requestAnimationFrame callbacks (highlight injection is debounced via rAF)
async function flushHighlights() {
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
}

describe('Content highlight injection', () => {
  const noop = {
    createAnnotation: vi.fn(),
    approveSection: vi.fn(),
    rejectSection: vi.fn(),
    clearAllSections: vi.fn(),
  }

  beforeEach(() => {
    currentHtml.value = ''
    annotations.value = []
    showResolved.value = false
    selectedAnnotationId.value = null
    sections.value = []
  })

  afterEach(() => {
    cleanup()
    currentHtml.value = ''
    annotations.value = []
  })

  // Helper: render Content, set signals, and flush rAF
  async function renderWithHighlights(html, anns) {
    currentHtml.value = html
    annotations.value = anns
    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })
    await flushHighlights()
    return container
  }

  // -------------------------------------------------------------------------
  // Single-element highlight (baseline — should already work)
  // -------------------------------------------------------------------------

  it('highlights text within a single element', async () => {
    const container = await renderWithHighlights(
      '<p data-source-line="1">Hello world foo</p>',
      [{
        id: 'a1', status: 'open', tag: 'question', comment: 'test',
        selectors: { position: { startLine: 1, endLine: 1 }, quote: { exact: 'world' } },
      }],
    )

    const mark = container.querySelector('mark[data-highlight-id="a1"]')
    expect(mark).not.toBeNull()
    expect(mark.textContent).toBe('world')
  })

  // -------------------------------------------------------------------------
  // Cross-heading highlight (THE BUG — text spans multiple elements)
  // -------------------------------------------------------------------------

  it('highlights text that spans across headings', async () => {
    const container = await renderWithHighlights(
      [
        '<h2 data-source-line="1">Title A</h2>',
        '<p data-source-line="2">First paragraph text</p>',
        '<h2 data-source-line="4">Title B</h2>',
      ].join(''),
      [{
        id: 'cross1', status: 'open', tag: 'bug', comment: 'cross-heading annotation',
        selectors: { position: { startLine: 2, endLine: 4 }, quote: { exact: 'First paragraph text\nTitle B' } },
      }],
    )

    const marks = container.querySelectorAll('mark[data-highlight-id="cross1"]')
    expect(marks.length).toBeGreaterThan(0)
  })

  it('highlights text spanning two paragraphs', async () => {
    const container = await renderWithHighlights(
      [
        '<p data-source-line="1">End of first</p>',
        '<p data-source-line="3">Start of second</p>',
      ].join(''),
      [{
        id: 'span2', status: 'open', tag: 'suggestion', comment: 'spans paragraphs',
        selectors: { position: { startLine: 1, endLine: 3 }, quote: { exact: 'End of first\nStart of second' } },
      }],
    )

    const marks = container.querySelectorAll('mark[data-highlight-id="span2"]')
    expect(marks.length).toBeGreaterThan(0)

    const allText = [...marks].map((m) => m.textContent).join('')
    expect(allText).toContain('End of first')
    expect(allText).toContain('Start of second')
  })

  // -------------------------------------------------------------------------
  // Navigation: highlight element must exist so scrollIntoView works
  // -------------------------------------------------------------------------

  it('cross-heading highlight has data-highlight-id so navigation works', async () => {
    const container = await renderWithHighlights(
      [
        '<h2 data-source-line="1">Section One</h2>',
        '<p data-source-line="2">Some content here</p>',
        '<h2 data-source-line="4">Section Two</h2>',
        '<p data-source-line="5">More content here</p>',
      ].join(''),
      [{
        id: 'nav1', status: 'open', tag: 'question', comment: 'spans sections',
        selectors: { position: { startLine: 2, endLine: 4 }, quote: { exact: 'Some content here\nSection Two' } },
      }],
    )

    const firstMark = container.querySelector('mark[data-highlight-id="nav1"]')
    expect(firstMark).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // BUG: single-line annotations with inline code elements get no highlight
  // -------------------------------------------------------------------------

  it('highlights single-line text split by inline code elements', async () => {
    const container = await renderWithHighlights(
      [
        '<p data-source-line="3">First <code data-source-line="3" data-source-col="7">paragraph</code> text</p>',
        '<p data-source-line="5">Second part</p>',
      ].join(''),
      [{
        id: 'inline1', status: 'open', tag: 'bug', comment: 'text split by inline code',
        selectors: { position: { startLine: 3, endLine: 3 }, quote: { exact: 'First paragraph text' } },
      }],
    )

    const marks = container.querySelectorAll('mark[data-highlight-id="inline1"]')
    expect(marks.length).toBeGreaterThan(0)

    const allText = [...marks].map((m) => m.textContent).join('')
    expect(allText).toContain('First')
    expect(allText).toContain('text')
  })

  it('does not wrap whitespace-only text nodes in line-range fallback', async () => {
    const container = await renderWithHighlights(
      '<ul data-source-line="1">\n' +
      '<li data-source-line="1">Item one</li>\n' +
      '<li data-source-line="2">Item two</li>\n' +
      '</ul>',
      [{
        id: 'ws1', status: 'open', tag: 'bug', comment: 'should skip whitespace nodes',
        selectors: { position: { startLine: 1, endLine: 2 }, quote: { exact: 'Item one\nItem two' } },
      }],
    )

    const marks = container.querySelectorAll('mark[data-highlight-id="ws1"]')
    expect(marks.length).toBeGreaterThan(0)

    for (const mark of marks) {
      expect(mark.textContent.trim()).not.toBe('')
    }
  })

  it('highlights by line range when exact text match fails across elements', async () => {
    const container = await renderWithHighlights(
      [
        '<p data-source-line="3">Alpha text</p>',
        '<p data-source-line="5">Beta text</p>',
      ].join(''),
      [{
        id: 'fallback1', status: 'open', tag: 'nitpick', comment: 'line range fallback',
        selectors: { position: { startLine: 3, endLine: 5 }, quote: { exact: 'Alpha text   Beta text' } },
      }],
    )

    const marks = container.querySelectorAll('mark[data-highlight-id="fallback1"]')
    expect(marks.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // BUG: rapid annotation updates freeze the browser tab
  // When annotations.value is set multiple times in quick succession (e.g.
  // HTTP response + WebSocket broadcast), the highlight useEffect runs N times
  // without debounce, each time removing all marks and re-walking the DOM.
  // Without normalize() after mark removal, text nodes fragment and the
  // TreeWalker traverses an ever-growing set of nodes.
  // -------------------------------------------------------------------------

  it('survives rapid annotation updates without excessive DOM operations', async () => {
    const lines = []
    for (let i = 1; i <= 50; i++) {
      lines.push(`<p data-source-line="${i}">Content for line ${i} with some text</p>`)
    }
    currentHtml.value = lines.join('\n')

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    const startTime = performance.now()

    // Simulate rapid annotation updates (like 5 POSTs + 5 WS broadcasts = 10 updates)
    for (let i = 0; i < 10; i++) {
      const anns = []
      for (let j = 0; j <= i; j++) {
        anns.push({
          id: `rapid-${j}`, status: 'open', tag: 'question', comment: `annotation ${j}`,
          selectors: {
            position: { startLine: (j * 5) + 1, endLine: (j * 5) + 1 },
            quote: { exact: `Content for line ${(j * 5) + 1}` },
          },
        })
      }
      await act(() => { annotations.value = anns })
    }

    // Flush the final debounced rAF
    await flushHighlights()

    const elapsed = performance.now() - startTime
    expect(elapsed).toBeLessThan(500)

    const marks = container.querySelectorAll('mark[data-highlight-id]')
    expect(marks.length).toBeGreaterThan(0)
  })

  it('normalizes text nodes after removing marks to prevent fragmentation', async () => {
    currentHtml.value = '<p data-source-line="1">Hello world foo bar</p>'

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    const p = container.querySelector('[data-source-line="1"]')
    const initialNodeCount = p.childNodes.length

    // Add annotation → mark is injected → text node splits
    await act(() => {
      annotations.value = [{
        id: 'frag1', status: 'open', tag: 'bug', comment: 'test',
        selectors: { position: { startLine: 1, endLine: 1 }, quote: { exact: 'world' } },
      }]
    })
    await flushHighlights()

    // Remove annotation → marks removed → text nodes should be normalized
    await act(() => { annotations.value = [] })
    await flushHighlights()

    // After removing all annotations, text nodes should be normalized back
    // (not left fragmented as 3 separate text nodes: "Hello ", "world", " foo bar")
    expect(p.childNodes.length).toBe(initialNodeCount)
  })
})

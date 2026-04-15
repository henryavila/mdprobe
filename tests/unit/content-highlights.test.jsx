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

  // -------------------------------------------------------------------------
  // Single-element highlight (baseline — should already work)
  // -------------------------------------------------------------------------

  it('highlights text within a single element', async () => {
    currentHtml.value = '<p data-source-line="1">Hello world foo</p>'
    annotations.value = [
      {
        id: 'a1',
        status: 'open',
        tag: 'question',
        comment: 'test',
        selectors: {
          position: { startLine: 1, endLine: 1 },
          quote: { exact: 'world' },
        },
      },
    ]

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    const mark = container.querySelector('mark[data-highlight-id="a1"]')
    expect(mark).not.toBeNull()
    expect(mark.textContent).toBe('world')
  })

  // -------------------------------------------------------------------------
  // Cross-heading highlight (THE BUG — text spans multiple elements)
  // -------------------------------------------------------------------------

  it('highlights text that spans across headings', async () => {
    currentHtml.value = [
      '<h2 data-source-line="1">Title A</h2>',
      '<p data-source-line="2">First paragraph text</p>',
      '<h2 data-source-line="4">Title B</h2>',
    ].join('')

    // Annotation with exact text that spans from p into next h2
    // Browser selection across block elements includes the text from each
    annotations.value = [
      {
        id: 'cross1',
        status: 'open',
        tag: 'bug',
        comment: 'cross-heading annotation',
        selectors: {
          position: { startLine: 2, endLine: 4 },
          quote: { exact: 'First paragraph text\nTitle B' },
        },
      },
    ]

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    // Should create at least one highlight mark
    const marks = container.querySelectorAll('mark[data-highlight-id="cross1"]')
    expect(marks.length).toBeGreaterThan(0)
  })

  it('highlights text spanning two paragraphs', async () => {
    currentHtml.value = [
      '<p data-source-line="1">End of first</p>',
      '<p data-source-line="3">Start of second</p>',
    ].join('')

    annotations.value = [
      {
        id: 'span2',
        status: 'open',
        tag: 'suggestion',
        comment: 'spans paragraphs',
        selectors: {
          position: { startLine: 1, endLine: 3 },
          quote: { exact: 'End of first\nStart of second' },
        },
      },
    ]

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    const marks = container.querySelectorAll('mark[data-highlight-id="span2"]')
    expect(marks.length).toBeGreaterThan(0)

    // Both portions should be highlighted
    const allText = [...marks].map((m) => m.textContent).join('')
    expect(allText).toContain('End of first')
    expect(allText).toContain('Start of second')
  })

  // -------------------------------------------------------------------------
  // Navigation: highlight element must exist so scrollIntoView works
  // -------------------------------------------------------------------------

  it('cross-heading highlight has data-highlight-id so navigation works', async () => {
    currentHtml.value = [
      '<h2 data-source-line="1">Section One</h2>',
      '<p data-source-line="2">Some content here</p>',
      '<h2 data-source-line="4">Section Two</h2>',
      '<p data-source-line="5">More content here</p>',
    ].join('')

    annotations.value = [
      {
        id: 'nav1',
        status: 'open',
        tag: 'question',
        comment: 'spans sections',
        selectors: {
          position: { startLine: 2, endLine: 4 },
          quote: { exact: 'Some content here\nSection Two' },
        },
      },
    ]

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    // The first mark element is what scrollIntoView targets
    const firstMark = container.querySelector('mark[data-highlight-id="nav1"]')
    expect(firstMark).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Fallback: when exact text doesn't match (whitespace differences)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // BUG: single-line annotations with inline code elements get no highlight
  // When text is split by <code>, trySingleElementHighlight fails (no single
  // text node has the full text), tryCrossElementHighlight fails (TreeWalker
  // limitation), and highlightLineRange is skipped because startLine === endLine.
  // Fix: allow highlightLineRange fallback even for single-line annotations.
  // -------------------------------------------------------------------------

  it('highlights single-line text split by inline code elements', async () => {
    currentHtml.value = [
      '<p data-source-line="3">First <code data-source-line="3" data-source-col="7">paragraph</code> text</p>',
      '<p data-source-line="5">Second part</p>',
    ].join('')

    annotations.value = [
      {
        id: 'inline1',
        status: 'open',
        tag: 'bug',
        comment: 'text split by inline code',
        selectors: {
          position: { startLine: 3, endLine: 3 },
          quote: { exact: 'First paragraph text' },
        },
      },
    ]

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    const marks = container.querySelectorAll('mark[data-highlight-id="inline1"]')
    expect(marks.length).toBeGreaterThan(0)

    // Marks should contain the annotated text portions
    const allText = [...marks].map((m) => m.textContent).join('')
    expect(allText).toContain('First')
    expect(allText).toContain('text')
  })

  it('does not wrap whitespace-only text nodes in line-range fallback', async () => {
    // ul/li structure where whitespace \n nodes exist between block elements
    currentHtml.value =
      '<ul data-source-line="1">\n' +
      '<li data-source-line="1">Item one</li>\n' +
      '<li data-source-line="2">Item two</li>\n' +
      '</ul>'

    annotations.value = [
      {
        id: 'ws1',
        status: 'open',
        tag: 'bug',
        comment: 'should skip whitespace nodes',
        selectors: {
          position: { startLine: 1, endLine: 2 },
          quote: { exact: 'Item one\nItem two' },
        },
      },
    ]

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    const marks = container.querySelectorAll('mark[data-highlight-id="ws1"]')
    expect(marks.length).toBeGreaterThan(0)

    // No mark should contain only whitespace
    for (const mark of marks) {
      expect(mark.textContent.trim()).not.toBe('')
    }
  })

  it('highlights by line range when exact text match fails across elements', async () => {
    currentHtml.value = [
      '<p data-source-line="3">Alpha text</p>',
      '<p data-source-line="5">Beta text</p>',
    ].join('')

    // exact text has extra whitespace that won't match concatenated text nodes
    annotations.value = [
      {
        id: 'fallback1',
        status: 'open',
        tag: 'nitpick',
        comment: 'line range fallback',
        selectors: {
          position: { startLine: 3, endLine: 5 },
          quote: { exact: 'Alpha text   Beta text' }, // extra spaces
        },
      },
    ]

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    // Should fall back to highlighting all text nodes in line range
    const marks = container.querySelectorAll('mark[data-highlight-id="fallback1"]')
    expect(marks.length).toBeGreaterThan(0)
  })
})

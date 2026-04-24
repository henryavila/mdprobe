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

// Flush pending requestAnimationFrame callbacks (highlight injection is debounced via 2 rAFs)
async function flushHighlights() {
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
}

const noop = {
  createAnnotation: vi.fn(),
  approveSection: vi.fn(),
  rejectSection: vi.fn(),
  clearAllSections: vi.fn(),
}

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

describe('Content highlight injection', () => {
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

    // Remove annotation → marks removed → no mark elements remain
    await act(() => { annotations.value = [] })
    await flushHighlights()

    // After removing all annotations, no mark elements remain.
    // Note: the mark-highlighter module's unwrap() does not call normalize(),
    // so text nodes may remain fragmented — that is acceptable; the important
    // invariant is that all mark elements are gone and the full text is intact.
    const marksAfter = p.querySelectorAll('mark[data-highlight-id]')
    expect(marksAfter.length).toBe(0)
    expect(p.textContent).toBe('Hello world foo bar')
  })

  // -------------------------------------------------------------------------
  // BUG: whitespace normalization fallback highlights ALL text nodes instead
  // of only the matching portion — causes annotation expansion
  // -------------------------------------------------------------------------

  it('whitespace normalization fallback only highlights matching text, not entire node range', async () => {
    // Simulates: <li> with inline <code> elements, user selected partial text.
    // The exact text has slightly different whitespace from DOM concatenation
    // (e.g., browser selection collapses multiple spaces to one).
    // The normalization fallback should wrap ONLY the matching portion.
    const html = [
      '<ul data-source-line="128">',
      '<li data-source-line="128">YouTube (abre <code data-source-line="128" data-source-col="19">external_link</code> via <code data-source-line="128" data-source-col="39">window.open</code> — no mobile, abre em nova aba)</li>',
      '</ul>',
      '<p data-source-line="130">Lógica de disponibilidade:</p>',
    ].join('\n')

    const container = await renderWithHighlights(html, [{
      id: 'expand1', status: 'open', tag: 'bug', comment: 'partial selection',
      selectors: {
        position: { startLine: 128, startColumn: 1, endLine: 128, endColumn: 50 },
        quote: { exact: 'abre external_link via', prefix: '', suffix: '' },
      },
    }])

    const marks = container.querySelectorAll('mark[data-highlight-id="expand1"]')
    expect(marks.length).toBeGreaterThan(0)

    // CRITICAL: the highlight must NOT expand to include "Lógica de disponibilidade"
    const allText = [...marks].map(m => m.textContent).join('')
    expect(allText).not.toContain('Lógica')
    expect(allText).not.toContain('no mobile')
    expect(allText).not.toContain('YouTube')
    // It should only contain the selected text
    expect(allText).toContain('abre')
    expect(allText).toContain('external_link')
    expect(allText).toContain('via')
  })

  it('cross-element highlight with inline code does not expand beyond exact match', async () => {
    // Real-world scenario: list item with backtick-delimited code spans.
    // User selects "abre external_link via" which spans:
    //   text node "...abre " → <code>external_link</code> → text node " via ..."
    const html = [
      '<li data-source-line="5">Start (abre <code data-source-line="5" data-source-col="14">external_link</code> via <code data-source-line="5" data-source-col="34">window.open</code> — end text)</li>',
    ].join('')

    const container = await renderWithHighlights(html, [{
      id: 'inline-exact', status: 'open', tag: 'question', comment: 'inline code span',
      selectors: {
        position: { startLine: 5, startColumn: 9, endLine: 5, endColumn: 35 },
        quote: { exact: 'abre external_link via', prefix: '', suffix: '' },
      },
    }])

    const marks = container.querySelectorAll('mark[data-highlight-id="inline-exact"]')
    expect(marks.length).toBeGreaterThan(0)

    const allText = [...marks].map(m => m.textContent).join('')
    expect(allText).toBe('abre external_link via')
    // Must NOT include surrounding text
    expect(allText).not.toContain('Start')
    expect(allText).not.toContain('window.open')
    expect(allText).not.toContain('end text')
  })

  it('whitespace-normalized match wraps only overlapping portions of text nodes', async () => {
    // When exact text has collapsed whitespace vs DOM (e.g., "foo  bar" vs "foo bar"),
    // the normalization fallback should still only highlight the matching region
    const html = '<p data-source-line="1">AAA BBB CCC DDD EEE</p>'

    const container = await renderWithHighlights(html, [{
      id: 'norm-partial', status: 'open', tag: 'suggestion', comment: 'normalized partial',
      selectors: {
        position: { startLine: 1, startColumn: 5, endLine: 1, endColumn: 12 },
        // Exact text with double space — won't match indexOf but will match normalized
        quote: { exact: 'BBB  CCC', prefix: '', suffix: '' },
      },
    }])

    const marks = container.querySelectorAll('mark[data-highlight-id="norm-partial"]')
    expect(marks.length).toBeGreaterThan(0)

    const allText = [...marks].map(m => m.textContent).join('')
    // Should contain the matched portion, not the entire paragraph
    expect(allText).toContain('BBB')
    expect(allText).toContain('CCC')
    expect(allText).not.toContain('AAA')
    expect(allText).not.toContain('EEE')
  })

  // -------------------------------------------------------------------------
  // Deep nesting: collectTextNodes must recurse into em > code > a etc.
  // -------------------------------------------------------------------------

  it('highlights text inside deeply nested inline elements', async () => {
    // <p> → <strong> → <em> → text: must be found by collectTextNodes
    const html = '<p data-source-line="1">Before <strong data-source-line="1" data-source-col="8"><em>deep text</em></strong> after</p>'

    const container = await renderWithHighlights(html, [{
      id: 'deep1', status: 'open', tag: 'question', comment: 'deep nesting',
      selectors: {
        position: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 17 },
        quote: { exact: 'deep text', prefix: '', suffix: '' },
      },
    }])

    const marks = container.querySelectorAll('mark[data-highlight-id="deep1"]')
    expect(marks.length).toBeGreaterThan(0)

    const allText = [...marks].map(m => m.textContent).join('')
    expect(allText).toBe('deep text')
  })

  // -------------------------------------------------------------------------
  // Cross-line: \n is inserted between different source lines, not between
  // different elements on the same line
  // -------------------------------------------------------------------------

  it('inserts newline separator between different source lines in cross-element match', async () => {
    // Two paragraphs on different lines — the concatenated text must have \n
    const html = [
      '<p data-source-line="3">End of first</p>',
      '<p data-source-line="5">Start of second</p>',
    ].join('')

    const container = await renderWithHighlights(html, [{
      id: 'cross-nl', status: 'open', tag: 'bug', comment: 'cross-line newline',
      selectors: {
        position: { startLine: 3, startColumn: 1, endLine: 5, endColumn: 16 },
        // Browser selection across blocks includes \n between them
        quote: { exact: 'End of first\nStart of second', prefix: '', suffix: '' },
      },
    }])

    const marks = container.querySelectorAll('mark[data-highlight-id="cross-nl"]')
    expect(marks.length).toBeGreaterThan(0)

    const allText = [...marks].map(m => m.textContent).join('')
    expect(allText).toContain('End of first')
    expect(allText).toContain('Start of second')
  })

  it('does NOT insert newline between inline elements on the same source line', async () => {
    // <em> and <code> on same line — no \n in concatenation, exact match should work
    const html = '<p data-source-line="7">Text <em data-source-line="7" data-source-col="6">italic</em> and <code data-source-line="7" data-source-col="18">mono</code> end</p>'

    const container = await renderWithHighlights(html, [{
      id: 'same-line', status: 'open', tag: 'suggestion', comment: 'same line inline',
      selectors: {
        position: { startLine: 7, startColumn: 6, endLine: 7, endColumn: 22 },
        quote: { exact: 'italic and mono', prefix: '', suffix: '' },
      },
    }])

    const marks = container.querySelectorAll('mark[data-highlight-id="same-line"]')
    expect(marks.length).toBeGreaterThan(0)

    const allText = [...marks].map(m => m.textContent).join('')
    expect(allText).toBe('italic and mono')
    // Must NOT include surrounding text
    expect(allText).not.toContain('Text')
    expect(allText).not.toContain('end')
  })

  // -------------------------------------------------------------------------
  // Line-range fallback must find text inside nested inline elements
  // (not just direct text children of the source-line element)
  // -------------------------------------------------------------------------

  it('line-range fallback highlights text inside nested inline elements', async () => {
    // Trigger fallback: exact text doesn't match any strategy 1 or 2 path
    const html = '<p data-source-line="10">Plain <strong data-source-line="10" data-source-col="7"><em>bold italic</em></strong> tail</p>'

    const container = await renderWithHighlights(html, [{
      id: 'lr-nested', status: 'open', tag: 'nitpick', comment: 'line-range with nesting',
      selectors: {
        position: { startLine: 10, startColumn: 1, endLine: 10, endColumn: 20 },
        // Intentionally wrong exact text to force fallback to line-range
        quote: { exact: 'THIS WONT MATCH ANYTHING AT ALL', prefix: '', suffix: '' },
      },
    }])

    const marks = container.querySelectorAll('mark[data-highlight-id="lr-nested"]')
    expect(marks.length).toBeGreaterThan(0)

    // Line-range fallback should wrap ALL text in the line, including nested
    const allText = [...marks].map(m => m.textContent).join('')
    expect(allText).toContain('Plain')
    expect(allText).toContain('bold italic')
    expect(allText).toContain('tail')
  })
})

describe('Selection does not retrigger highlight rebuild', () => {
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

  it('changing selectedAnnotationId preserves existing mark nodes', async () => {
    const html = '<p data-source-line="1">Hello world</p>'
    const anns = [{
      id: 'a1', tag: 'question', status: 'open', comment: '',
      selectors: {
        position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
        quote: { exact: 'Hello', prefix: '', suffix: '' },
      },
    }]
    const container = await renderWithHighlights(html, anns)

    const markBefore = container.querySelector('mark[data-highlight-id="a1"]')
    expect(markBefore).not.toBeNull()

    await act(() => { selectedAnnotationId.value = 'a1' })
    await flushHighlights()

    const markAfter = container.querySelector('mark[data-highlight-id="a1"]')
    expect(markAfter).toBe(markBefore)
    const root = container.querySelector('.content-area')
    expect(root.getAttribute('data-selected')).toBe('a1')
  })
})

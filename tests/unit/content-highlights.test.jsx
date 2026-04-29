import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/preact'
import { Content } from '../../src/ui/components/Content.jsx'
import {
  currentHtml,
  annotations,
  showResolved,
  selectedAnnotationId,
  sections,
  currentSource,
  currentMdast,
} from '../../src/ui/state/store.js'

// ---------------------------------------------------------------------------
// Content highlight injection tests — CSS Highlight API (v2 architecture)
//
// With the CSS Highlight API there are no <mark> elements in the DOM.
// Highlights are registered in CSS.highlights as Highlight objects keyed by
// name ("ann-{id}", "ann-selected").  Tests assert on CSS.highlights state.
// ---------------------------------------------------------------------------

// Flush pending requestAnimationFrame callbacks (highlight injection debounced via 2 rAFs)
async function flushHighlights() {
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)))
}

// Clear CSS.highlights registry between tests
function clearCssHighlights() {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name)
  }
}

const noop = {
  createAnnotation: vi.fn(),
  approveSection: vi.fn(),
  rejectSection: vi.fn(),
  resetSection: vi.fn(),
  clearAllSections: vi.fn(),
}

/**
 * Build a v2-shaped annotation with character-offset range.
 * source: the raw markdown source string
 * start/end: character offsets into source
 */
function makeAnn(id, start, end, source, opts = {}) {
  const exact = source.slice(start, end)
  return {
    id,
    range: { start, end },
    quote: { exact, prefix: '', suffix: '' },
    anchor: { contextHash: '' },
    tag: opts.tag || 'question',
    status: opts.status || 'open',
    comment: opts.comment || '',
    created_at: opts.created_at || '2026-01-01T00:00:00Z',
  }
}

/**
 * Helper: render Content with HTML, annotations, and source string.
 * Sets currentSource.value so the CSS highlighter can call locate().
 */
async function renderWithHighlights(html, anns, source = '') {
  currentHtml.value = html
  annotations.value = anns
  currentSource.value = source
  let container
  await act(() => {
    const result = render(<Content annotationOps={noop} />)
    container = result.container
  })
  await flushHighlights()
  return container
}

describe('Content highlight injection (CSS Highlight API)', () => {
  beforeEach(() => {
    currentHtml.value = ''
    annotations.value = []
    showResolved.value = false
    selectedAnnotationId.value = null
    sections.value = []
    currentSource.value = ''
    currentMdast.value = null
    clearCssHighlights()
  })

  afterEach(() => {
    cleanup()
    currentHtml.value = ''
    annotations.value = []
    currentSource.value = ''
    clearCssHighlights()
  })

  // -------------------------------------------------------------------------
  // Single-element highlight (baseline)
  // -------------------------------------------------------------------------

  it('registers a CSS.highlights entry for a single annotation', async () => {
    // source: "Hello world foo"
    // element covers offset 0–15 (data-source-start/end)
    const source = 'Hello world foo'
    const html = '<p data-source-line="1" data-source-start="0" data-source-end="15">Hello world foo</p>'
    const anns = [makeAnn('a1', 0, 5, source)]

    await renderWithHighlights(html, anns, source)

    if (!CSS.highlights) return
    expect(CSS.highlights.has('ann-a1')).toBe(true)
  })

  it('does not register a highlight entry for zero annotations', async () => {
    const source = 'Hello world'
    const html = '<p data-source-start="0" data-source-end="11">Hello world</p>'

    await renderWithHighlights(html, [], source)

    if (!CSS.highlights) return
    expect(CSS.highlights.has('ann-a1')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Multi-annotation
  // -------------------------------------------------------------------------

  it('registers separate CSS.highlights entries for multiple annotations', async () => {
    const source = 'Hello world foo bar'
    const html = '<p data-source-start="0" data-source-end="19">Hello world foo bar</p>'
    const anns = [
      makeAnn('ann1', 0, 5, source),
      makeAnn('ann2', 6, 11, source),
    ]

    await renderWithHighlights(html, anns, source)

    if (!CSS.highlights) return
    expect(CSS.highlights.has('ann-ann1')).toBe(true)
    expect(CSS.highlights.has('ann-ann2')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Cross-element (multi-paragraph) annotation
  // -------------------------------------------------------------------------

  it('registers a highlight for an annotation spanning two paragraphs', async () => {
    // source: "End of first\nStart of second"
    // p1 covers 0–12, p2 covers 13–28
    const source = 'End of first\nStart of second'
    const html = [
      '<p data-source-start="0" data-source-end="12">End of first</p>',
      '<p data-source-start="13" data-source-end="28">Start of second</p>',
    ].join('')
    const anns = [makeAnn('cross1', 0, 28, source)]

    await renderWithHighlights(html, anns, source)

    if (!CSS.highlights) return
    expect(CSS.highlights.has('ann-cross1')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Orphan annotations (text not found in source)
  // -------------------------------------------------------------------------

  it('does not register a highlight for an orphan annotation', async () => {
    const source = 'Hello world'
    const html = '<p data-source-start="0" data-source-end="11">Hello world</p>'
    // Annotation with out-of-range offsets and non-matching quote
    const orphan = {
      id: 'orphan1',
      range: { start: 999, end: 1005 },
      quote: { exact: 'XXXXXX', prefix: '', suffix: '' },
      anchor: { contextHash: '' },
      tag: 'question', status: 'open', comment: '',
      created_at: '2026-01-01T00:00:00Z',
    }

    await renderWithHighlights(html, [orphan], source)

    if (!CSS.highlights) return
    expect(CSS.highlights.has('ann-orphan1')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // HTML change clears highlights
  // -------------------------------------------------------------------------

  it('clears all highlights when HTML content changes', async () => {
    const source = 'Hello world'
    const html = '<p data-source-start="0" data-source-end="11">Hello world</p>'
    const anns = [makeAnn('a1', 0, 5, source)]

    await renderWithHighlights(html, anns, source)

    if (!CSS.highlights) return
    expect(CSS.highlights.has('ann-a1')).toBe(true)

    // Change the HTML content — clears then re-syncs with same annotations
    await act(() => { currentHtml.value = '<p>New content</p>' })
    await flushHighlights()

    // After HTML change, 'ann-a1' should be removed (new content has no data-source-start)
    expect(CSS.highlights.has('ann-a1')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Rapid annotation updates do not cause errors
  // -------------------------------------------------------------------------

  it('survives rapid annotation updates without throwing', async () => {
    const source = Array.from({ length: 50 }, (_, i) => `Content for line ${i + 1}`).join('\n')
    const lines = source.split('\n')
    let offset = 0
    const htmlParts = lines.map((line, i) => {
      const start = offset
      const end = offset + line.length
      offset = end + 1 // +1 for \n
      return `<p data-source-start="${start}" data-source-end="${end}">${line}</p>`
    })

    currentHtml.value = htmlParts.join('\n')
    currentSource.value = source

    let container
    await act(() => {
      const result = render(<Content annotationOps={noop} />)
      container = result.container
    })

    const startTime = performance.now()

    // Simulate rapid annotation updates
    for (let i = 0; i < 10; i++) {
      const anns = []
      for (let j = 0; j <= i && j < lines.length; j++) {
        const lineOffset = source.indexOf(lines[j])
        anns.push(makeAnn(`rapid-${j}`, lineOffset, lineOffset + lines[j].length, source))
      }
      await act(() => { annotations.value = anns })
    }

    await flushHighlights()

    const elapsed = performance.now() - startTime
    expect(elapsed).toBeLessThan(500)

    // At least some highlights should be registered
    if (CSS.highlights) {
      const anyRegistered = [...CSS.highlights.keys()].some(k => k.startsWith('ann-rapid'))
      expect(anyRegistered).toBe(true)
    }
  })

  // -------------------------------------------------------------------------
  // Removing an annotation removes its highlight entry
  // -------------------------------------------------------------------------

  it('removes CSS.highlights entry when annotation is deleted', async () => {
    const source = 'Hello world foo bar'
    const html = '<p data-source-start="0" data-source-end="19">Hello world foo bar</p>'
    const anns = [makeAnn('del1', 0, 5, source)]

    await renderWithHighlights(html, anns, source)

    if (!CSS.highlights) return
    expect(CSS.highlights.has('ann-del1')).toBe(true)

    // Remove annotation
    await act(() => { annotations.value = [] })
    await flushHighlights()

    expect(CSS.highlights.has('ann-del1')).toBe(false)
  })
})

describe('Selection does not retrigger highlight rebuild', () => {
  beforeEach(() => {
    currentHtml.value = ''
    annotations.value = []
    showResolved.value = false
    selectedAnnotationId.value = null
    sections.value = []
    currentSource.value = ''
    currentMdast.value = null
    clearCssHighlights()
  })

  afterEach(() => {
    cleanup()
    currentHtml.value = ''
    annotations.value = []
    currentSource.value = ''
    clearCssHighlights()
  })

  it('selection updates ann-selected without rebuilding the per-annotation highlight', async () => {
    const source = 'Hello world'
    const html = '<p data-source-line="1" data-source-start="0" data-source-end="11">Hello world</p>'
    const anns = [makeAnn('a1', 0, 5, source)]

    const container = await renderWithHighlights(html, anns, source)

    if (!CSS.highlights) return
    expect(CSS.highlights.has('ann-a1')).toBe(true)
    expect(CSS.highlights.has('ann-selected')).toBe(false)

    await act(() => { selectedAnnotationId.value = 'a1' })
    await flushHighlights()

    expect(CSS.highlights.has('ann-selected')).toBe(true)
    // The per-annotation highlight should still exist
    expect(CSS.highlights.has('ann-a1')).toBe(true)
  })

  it('clearing selection removes ann-selected', async () => {
    const source = 'Hello world'
    const html = '<p data-source-start="0" data-source-end="11">Hello world</p>'
    const anns = [makeAnn('a1', 0, 5, source)]

    await renderWithHighlights(html, anns, source)

    if (!CSS.highlights) return

    await act(() => { selectedAnnotationId.value = 'a1' })
    await flushHighlights()

    expect(CSS.highlights.has('ann-selected')).toBe(true)

    await act(() => { selectedAnnotationId.value = null })
    await flushHighlights()

    expect(CSS.highlights.has('ann-selected')).toBe(false)
    // Per-annotation highlight should persist
    expect(CSS.highlights.has('ann-a1')).toBe(true)
  })
})

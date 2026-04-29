import { describe, it, expect, beforeEach } from 'vitest'
import { createCssHighlightHighlighter } from '../../src/ui/highlighters/css-highlight-highlighter.js'

function makeContent() {
  document.body.replaceChildren()
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name)
  }
  const root = document.createElement('div')
  root.className = 'content-area'
  const p = document.createElement('p')
  p.setAttribute('data-source-line', '1')
  p.setAttribute('data-source-start', '0')
  p.setAttribute('data-source-end', '11')
  p.textContent = 'Hello world'
  root.appendChild(p)
  document.body.appendChild(root)
  return root
}

const ann = (id, start, end, opts = {}) => ({
  id, range: { start, end },
  quote: { exact: 'Hello world'.slice(start, end), prefix: '', suffix: '' },
  anchor: {},
  tag: opts.tag || 'question',
  status: opts.status || 'open',
  created_at: opts.created_at || '2026-01-01T00:00:00Z',
})

describe('css-highlight-highlighter', () => {
  let h
  beforeEach(() => { h = createCssHighlightHighlighter() })

  it('sync registers a CSS.highlights entry per annotation', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    const a = ann('a', 0, 5)
    h.sync(root, [a], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    expect(CSS.highlights.has(`ann-${a.id}`)).toBe(true)
  })

  it('clear removes all registered highlights', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    h.sync(root, [ann('a', 0, 5)], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    h.clear(root)
    expect(CSS.highlights.has('ann-a')).toBe(false)
  })

  it('setSelection adds ann-selected', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    h.sync(root, [ann('a', 0, 5)], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    h.setSelection(root, 'a')
    expect(CSS.highlights.has('ann-selected')).toBe(true)
  })

  it('setSelection(null) removes ann-selected', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    h.sync(root, [ann('a', 0, 5)], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    h.setSelection(root, 'a')
    h.setSelection(root, null)
    expect(CSS.highlights.has('ann-selected')).toBe(false)
  })

  it('orphan annotations do not register a highlight', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    const orphan = ann('orphan', 999, 1000)
    h.sync(root, [orphan], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    expect(CSS.highlights.has('ann-orphan')).toBe(false)
  })
})

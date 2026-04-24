import { describe, it, expect, beforeEach } from 'vitest'
import { createMarkHighlighter } from '../../src/ui/highlighters/mark-highlighter.js'

function makePara(line, text) {
  const p = document.createElement('p')
  p.setAttribute('data-source-line', String(line))
  p.textContent = text
  return p
}

function buildContent(paras) {
  const el = document.createElement('div')
  el.className = 'content-area'
  for (const p of paras) el.appendChild(p)
  document.body.replaceChildren(el)
  return el
}

function cloneStructure(el) {
  return el.cloneNode(true).outerHTML
}

const ann = (id, line, text) => ({
  id, tag: 'question', status: 'open', comment: 'x',
  selectors: {
    position: { startLine: line, startColumn: 1, endLine: line, endColumn: text.length + 1 },
    quote: { exact: text, prefix: '', suffix: '' },
  },
})

describe('mark-highlighter', () => {
  let el
  beforeEach(() => {
    el = buildContent([makePara(1, 'Hello world'), makePara(2, 'Another line')])
  })

  it('sync injects a <mark> for each visible annotation', () => {
    const h = createMarkHighlighter()
    h.sync(el, [ann('a', 1, 'Hello')], { showResolved: false, prevAnnotations: [] })
    const marks = el.querySelectorAll('mark[data-highlight-id="a"]')
    expect(marks.length).toBe(1)
    expect(marks[0].textContent).toBe('Hello')
  })

  it('sync with empty diff does not mutate the DOM', () => {
    const h = createMarkHighlighter()
    const anns = [ann('a', 1, 'Hello')]
    h.sync(el, anns, { showResolved: false, prevAnnotations: [] })
    const before = cloneStructure(el)
    h.sync(el, anns, { showResolved: false, prevAnnotations: anns })
    expect(cloneStructure(el)).toBe(before)
  })

  it('sync removes <mark> for ids no longer present', () => {
    const h = createMarkHighlighter()
    h.sync(el, [ann('a', 1, 'Hello')], { showResolved: false, prevAnnotations: [] })
    h.sync(el, [], { showResolved: false, prevAnnotations: [ann('a', 1, 'Hello')] })
    expect(el.querySelectorAll('mark[data-highlight-id]').length).toBe(0)
  })

  it('clear removes every mark', () => {
    const h = createMarkHighlighter()
    h.sync(el, [ann('a', 1, 'Hello'), ann('b', 2, 'Another')], { showResolved: false, prevAnnotations: [] })
    h.clear(el)
    expect(el.querySelectorAll('mark[data-highlight-id]').length).toBe(0)
  })

  it('setSelection sets data-selected and is-selected class without rebuilding marks', () => {
    const h = createMarkHighlighter()
    h.sync(el, [ann('a', 1, 'Hello')], { showResolved: false, prevAnnotations: [] })
    const markBefore = el.querySelector('mark[data-highlight-id="a"]')
    h.setSelection(el, 'a')
    expect(el.getAttribute('data-selected')).toBe('a')
    expect(el.querySelector('mark.is-selected')).not.toBeNull()
    expect(el.querySelector('mark[data-highlight-id="a"]')).toBe(markBefore)
    h.setSelection(el, null)
    expect(el.hasAttribute('data-selected')).toBe(false)
    expect(el.querySelector('mark.is-selected')).toBeNull()
  })
})

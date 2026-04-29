import { describe, it, expect, beforeEach } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { describe as describeRange, textOffsetWithinAncestor } from '../../src/anchoring/v2/capture.js'

function parse(md) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
  return processor.parse(md)
}

function makeContentEl() {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  document.body.appendChild(root)
  return root
}

function makePara(line, sourceStart, sourceEnd, text) {
  const p = document.createElement('p')
  p.setAttribute('data-source-line', String(line))
  p.setAttribute('data-source-start', String(sourceStart))
  p.setAttribute('data-source-end', String(sourceEnd))
  p.textContent = text
  return p
}

describe('textOffsetWithinAncestor', () => {
  it('returns 0 when text node is the first child of ancestor', () => {
    const root = makeContentEl()
    const p = makePara(1, 0, 11, 'Hello world')
    root.appendChild(p)
    const tn = p.firstChild
    expect(textOffsetWithinAncestor(p, tn, 0)).toBe(0)
  })

  it('returns offset within multi-text-node ancestor', () => {
    const root = makeContentEl()
    const p = document.createElement('p')
    p.setAttribute('data-source-start', '0')
    p.setAttribute('data-source-end', '11')
    p.appendChild(document.createTextNode('Hello '))
    const strong = document.createElement('strong')
    strong.appendChild(document.createTextNode('world'))
    p.appendChild(strong)
    root.appendChild(p)
    const innerText = strong.firstChild
    expect(textOffsetWithinAncestor(p, innerText, 3)).toBe('Hello '.length + 3)
  })
})

describe('describe', () => {
  let root, source, mdast
  beforeEach(() => {
    root = makeContentEl()
    source = 'Header\n\nThis is a test paragraph with some words.\n'
    mdast = parse(source)
    const p = makePara(3, 8, 49, 'This is a test paragraph with some words.')
    root.appendChild(p)
  })

  it('captures range, exact, prefix, suffix from source', () => {
    const p = root.querySelector('p')
    const tn = p.firstChild
    const range = document.createRange()
    range.setStart(tn, 5)
    range.setEnd(tn, 9)

    const sel = describeRange(range, root, source, mdast)
    expect(sel.range).toEqual({ start: 13, end: 17 })
    expect(sel.quote.exact).toBe(source.slice(13, 17))
    expect(sel.quote.prefix).toBe(source.slice(Math.max(0, 13 - 32), 13))
    expect(sel.quote.suffix).toBe(source.slice(17, Math.min(source.length, 17 + 32)))
  })

  it('contextHash deterministic from prefix+exact+suffix', () => {
    const p = root.querySelector('p')
    const tn = p.firstChild
    const range = document.createRange()
    range.setStart(tn, 0)
    range.setEnd(tn, 4)
    const sel = describeRange(range, root, source, mdast)
    expect(sel.anchor.contextHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('extracts treePath when mdast is provided', () => {
    const p = root.querySelector('p')
    const tn = p.firstChild
    const range = document.createRange()
    range.setStart(tn, 0)
    range.setEnd(tn, 4)
    const sel = describeRange(range, root, source, mdast)
    expect(sel.anchor.treePath).toBeDefined()
    expect(sel.anchor.treePath.charOffsetInParagraph).toBeDefined()
  })

  it('extracts keywords when source provided', () => {
    const p = root.querySelector('p')
    const tn = p.firstChild
    const range = document.createRange()
    range.setStart(tn, 5)
    range.setEnd(tn, 20)
    const sel = describeRange(range, root, source, mdast)
    expect(sel.anchor.keywords).toBeDefined()
    expect(sel.anchor.keywords.length).toBeGreaterThan(0)
  })
})

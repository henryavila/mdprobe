import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { describe as describeRange, locate, buildDomRanges } from '../../src/anchoring/v2/index.js'

function parse(md) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
  return processor.parse(md)
}

function setupContent(source) {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  const blocks = source.split('\n\n')
  let offset = 0
  for (const block of blocks) {
    const tag = block.startsWith('# ') ? 'h1' : 'p'
    const text = block.startsWith('# ') ? block.slice(2) : block
    const el = document.createElement(tag)
    el.setAttribute('data-source-start', String(offset))
    el.setAttribute('data-source-end', String(offset + block.length))
    el.textContent = text
    root.appendChild(el)
    offset += block.length + 2
  }
  document.body.appendChild(root)
  return root
}

const source = '# Title\n\nFirst paragraph here.\n\nSecond paragraph follows.'

describe('precision: cross-block selection', () => {
  it('captures + locates a selection that spans two paragraphs to multiple ranges', () => {
    const root = setupContent(source)
    const mdast = parse(source)
    const p1 = root.querySelectorAll('p')[0]
    const p2 = root.querySelectorAll('p')[1]
    const range = document.createRange()
    range.setStart(p1.firstChild, 6)
    range.setEnd(p2.firstChild, 6)

    const sel = describeRange(range, root, source, mdast)
    const r = locate(sel, source, mdast)
    expect(r.state).toBe('confident')
    const ranges = buildDomRanges(root, r.range.start, r.range.end)
    expect(ranges.length).toBeGreaterThanOrEqual(1)
    const text = ranges.map(rg => rg.toString()).join('|')
    expect(text).toContain('paragraph here.')
    expect(text).toContain('Second')
  })

  it('a selection within a single paragraph results in a single Range with exactly the selected text', () => {
    const root = setupContent(source)
    const mdast = parse(source)
    const p1 = root.querySelectorAll('p')[0]
    const range = document.createRange()
    range.setStart(p1.firstChild, 0)
    range.setEnd(p1.firstChild, 5)

    const sel = describeRange(range, root, source, mdast)
    const r = locate(sel, source, mdast)
    const ranges = buildDomRanges(root, r.range.start, r.range.end)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].toString()).toBe('First')
  })
})

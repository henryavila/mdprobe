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

  // --- element-boundary cases (endContainer is an element, not a text node) ---

  it('handles targetNode === ancestor (element) with child-index offset', () => {
    // Simulates: <code> element where Range endContainer is the <code> itself
    // and endOffset is a child index (e.g., 4 spans highlighted by hljs)
    const root = makeContentEl()
    const pre = document.createElement('pre')
    pre.setAttribute('data-source-start', '22')
    pre.setAttribute('data-source-end', '100')
    const code = document.createElement('code')
    code.setAttribute('data-source-start', '22')
    code.setAttribute('data-source-end', '100')
    // Mimick hljs spans: "schema_version" ":" "2" ": " "description"
    const spans = ['schema_version', ':', '2', ': ', 'description']
    for (const text of spans) {
      const span = document.createElement('span')
      span.textContent = text
      code.appendChild(span)
    }
    pre.appendChild(code)
    root.appendChild(pre)

    // endContainer = code, endOffset = 4 (child index) means after 4 children
    // char count = 'schema_version'.length + ':'.length + '2'.length + ': '.length = 14+1+1+2 = 18
    const charCount = 'schema_version'.length + ':'.length + '2'.length + ': '.length
    expect(textOffsetWithinAncestor(code, code, 4)).toBe(charCount)
  })

  it('handles targetNode === ancestor with offset = 0 (selection at very start)', () => {
    const root = makeContentEl()
    const p = document.createElement('p')
    p.setAttribute('data-source-start', '10')
    p.setAttribute('data-source-end', '30')
    const span1 = document.createElement('span')
    span1.textContent = 'alpha'
    const span2 = document.createElement('span')
    span2.textContent = 'beta'
    p.appendChild(span1)
    p.appendChild(span2)
    root.appendChild(p)

    // offset = 0 means before any children — char offset 0
    expect(textOffsetWithinAncestor(p, p, 0)).toBe(0)
  })

  it('handles targetNode === ancestor with offset = children.length (selection at very end)', () => {
    const root = makeContentEl()
    const p = document.createElement('p')
    p.setAttribute('data-source-start', '10')
    p.setAttribute('data-source-end', '30')
    const span1 = document.createElement('span')
    span1.textContent = 'alpha'
    const span2 = document.createElement('span')
    span2.textContent = 'beta'
    p.appendChild(span1)
    p.appendChild(span2)
    root.appendChild(p)

    // offset = 2 (past last child) means entire text: 'alpha' + 'beta' = 9
    expect(textOffsetWithinAncestor(p, p, 2)).toBe('alpha'.length + 'beta'.length)
  })

  it('handles targetNode being a descendant element (not ancestor, not text)', () => {
    // <ul data-source-start="0" data-source-end="60">
    //   <li>first item</li>   <- 10 chars
    //   <li>second item</li>  <- 11 chars
    //   <li>third item</li>   <- 10 chars
    // </ul>
    // Range endContainer = <ul>, endOffset = 2 (after 2 <li> children)
    // expected char offset = 'first item'.length + 'second item'.length = 21
    const root = makeContentEl()
    const ul = document.createElement('ul')
    ul.setAttribute('data-source-start', '0')
    ul.setAttribute('data-source-end', '60')
    const items = ['first item', 'second item', 'third item']
    for (const text of items) {
      const li = document.createElement('li')
      li.textContent = text
      ul.appendChild(li)
    }
    root.appendChild(ul)

    const expected = 'first item'.length + 'second item'.length
    expect(textOffsetWithinAncestor(ul, ul, 2)).toBe(expected)
  })

  it('handles targetNode being a descendant element that is NOT the ancestor', () => {
    // <blockquote data-source-start="0" data-source-end="80">
    //   <p>para one</p>   <- 8 chars
    //   <p>para two</p>   <- 8 chars  <-- endContainer = this <p>, endOffset = 1 (after its child span)
    // </blockquote>
    // char offset in blockquote = 'para one'.length + 'para two'.length (after all of p2's 1 child)
    const root = makeContentEl()
    const bq = document.createElement('blockquote')
    bq.setAttribute('data-source-start', '0')
    bq.setAttribute('data-source-end', '80')
    const p1 = document.createElement('p')
    p1.textContent = 'para one'
    const p2 = document.createElement('p')
    const span = document.createElement('span')
    span.textContent = 'para two'
    p2.appendChild(span)
    bq.appendChild(p1)
    bq.appendChild(p2)
    root.appendChild(bq)

    // targetNode = p2, targetOffset = 1 (child index, after the span)
    // chars before p2 within bq = 'para one'.length = 8
    // chars within p2 up to child 1 = 'para two'.length = 8
    // total = 16
    const expected = 'para one'.length + 'para two'.length
    expect(textOffsetWithinAncestor(bq, p2, 1)).toBe(expected)
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

  it('does NOT capture entire code block when selection ends at element boundary inside it', () => {
    // Regression test: heading + hljs-rendered code block
    // User selects: mid-heading to first-line of code block
    // Bug: endContainer = <code>, endOffset = 4 (child index) was interpreted as 4 chars
    //      causing end = sourceStart + 4 which then gets clamped to sourceEnd (entire block)
    // Fix: child index must be converted to char count

    // Source layout (offsets):
    // 0..19  = "## Per-annotation YAML\n"  (h2, 22 chars + \n = 23, but we keep it simple)
    // 22..99 = code block text
    //   "schema_version: 2\ndescription: test\n"
    //   spans: ['schema_version', ': ', '2', '\n', 'description', ': ', 'test', '\n']
    //   first two spans = 'schema_version' + ': ' = 16 chars
    //   up to child index 2 = 'schema_version'.length + ': '.length = 16 chars

    document.body.replaceChildren()
    const root2 = document.createElement('div')
    root2.className = 'content-area'
    document.body.appendChild(root2)

    // h2 element: source offset 0..21 (22 chars: "## Per-annotation YAML")
    const h2 = document.createElement('h2')
    h2.setAttribute('data-source-start', '0')
    h2.setAttribute('data-source-end', '22')
    h2.textContent = 'Per-annotation YAML'
    root2.appendChild(h2)

    // code block: source offset 22..99
    const codeSource = 'schema_version: 2\ndescription: test\n'
    const pre = document.createElement('pre')
    pre.setAttribute('data-source-start', '22')
    pre.setAttribute('data-source-end', String(22 + codeSource.length))
    const code = document.createElement('code')
    code.setAttribute('data-source-start', '22')
    code.setAttribute('data-source-end', String(22 + codeSource.length))
    // hljs-like spans
    const spanTexts = ['schema_version', ': ', '2', '\n', 'description', ': ', 'test', '\n']
    for (const t of spanTexts) {
      const s = document.createElement('span')
      s.textContent = t
      code.appendChild(s)
    }
    pre.appendChild(code)
    root2.appendChild(pre)

    const mdast2 = parse('## Per-annotation YAML\n\n```\n' + codeSource + '```\n')

    // Selection:
    //   start: inside h2 text node, offset 6 (mid-word)
    //   end: <code> element itself, endOffset = 2 (after 2 span children: 'schema_version' + ': ')
    const h2Text = h2.firstChild
    const range = document.createRange()
    range.setStart(h2Text, 6)
    range.setEnd(code, 2)

    const src = '## Per-annotation YAML\n\n```\n' + codeSource + '```\n'
    const sel = describeRange(range, root2, src, mdast2)

    // start = 0 (h2 sourceStart) + 6 = 6
    expect(sel.range.start).toBe(6)

    // end = 22 (code sourceStart) + char offset up to child index 2
    // = 22 + 'schema_version'.length + ': '.length = 22 + 14 + 2 = 38
    const expectedEnd = 22 + 'schema_version'.length + ': '.length
    expect(sel.range.end).toBe(expectedEnd)

    // Must NOT span the entire code block
    const codeSourceEnd = 22 + codeSource.length
    expect(sel.range.end).toBeLessThan(codeSourceEnd)
  })
})

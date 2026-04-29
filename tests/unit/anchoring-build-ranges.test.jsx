import { describe, it, expect } from 'vitest'
import { buildDomRanges } from '../../src/anchoring/v2/build-ranges.js'

function makePara(line, start, end, text) {
  const p = document.createElement('p')
  p.setAttribute('data-source-line', String(line))
  p.setAttribute('data-source-start', String(start))
  p.setAttribute('data-source-end', String(end))
  p.textContent = text
  return p
}

function setupContent(paras) {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  for (const p of paras) root.appendChild(p)
  document.body.appendChild(root)
  return root
}

describe('buildDomRanges', () => {
  it('returns single Range covering exact text within one paragraph', () => {
    const root = setupContent([makePara(1, 0, 11, 'Hello world')])
    const ranges = buildDomRanges(root, 6, 11)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].toString()).toBe('world')
  })

  it('returns Ranges for selection spanning two paragraphs', () => {
    const root = setupContent([
      makePara(1, 0, 11, 'Hello world'),
      makePara(3, 13, 24, 'Another text'),
    ])
    const ranges = buildDomRanges(root, 6, 20)
    expect(ranges.length).toBeGreaterThanOrEqual(1)
    const combined = ranges.map(r => r.toString()).join('')
    expect(combined.includes('world')).toBe(true)
    expect(combined.includes('Anoth')).toBe(true)
  })

  it('returns empty when no element intersects the range', () => {
    const root = setupContent([makePara(1, 0, 11, 'Hello world')])
    expect(buildDomRanges(root, 100, 200)).toEqual([])
  })

  it('deduplicates <pre>/<code> pairs with identical data-source-start/end', () => {
    // Simulate a syntax-highlighted code block where both <pre> and <code>
    // carry the same data-source-start and data-source-end attributes.
    // This mirrors what rehypeSourcePositions produces: the hast position for the
    // fenced code block's <pre> and its child <code> both point to the same source span.
    // buildDomRanges should skip the outer <pre> and use only the inner <code>
    // to avoid producing two DOM ranges for the same text.
    //
    // Note: we use direct text children (not nested spans) here because happy-dom's
    // TreeWalker does not recurse into span children. The deduplication logic itself
    // is exercised by the <pre>/<code> relationship, independent of how code is tokenised.
    document.body.replaceChildren()
    const root = document.createElement('div')
    root.className = 'content-area'

    const pre = document.createElement('pre')
    pre.setAttribute('data-source-start', '10')
    pre.setAttribute('data-source-end', '50')

    const code = document.createElement('code')
    code.setAttribute('data-source-start', '10')
    code.setAttribute('data-source-end', '50')
    code.appendChild(document.createTextNode('const x = 1'))
    pre.appendChild(code)
    root.appendChild(pre)
    document.body.appendChild(root)

    // code.textContent = 'const x = 1' = 11 chars
    // Stored end = elStart + textLength = 10 + 11 = 21
    // (mirrors real-browser: stored end = pre.dataSourceStart + code.textContent.length)
    const ranges = buildDomRanges(root, 10, 21)

    // Should produce exactly ONE range (from <code> only, not <code> + <pre>)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].toString()).toContain('const')

    // Verify no duplicate text: if both pre and code were used, text would repeat
    const combined = ranges.map(r => r.toString()).join('|||')
    const constCount = (combined.match(/const/g) || []).length
    expect(constCount).toBe(1)
  })
})

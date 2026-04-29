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
})

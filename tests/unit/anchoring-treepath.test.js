import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { computeTreePath, findHeadingByText, paragraphsUnder } from '../../src/anchoring/v2/treepath.js'

function parse(md) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
  return processor.parse(md)
}

const sample = `# Title

Intro paragraph.

## Section A

First para under A.

Second para under A.

## Section B

Para under B.
`

describe('computeTreePath', () => {
  it('finds heading and paragraph index for an offset', () => {
    const mdast = parse(sample)
    const offset = sample.indexOf('Second para under A')
    const path = computeTreePath(mdast, offset)
    expect(path).not.toBeNull()
    expect(path.headingText).toBe('Section A')
    expect(path.headingLevel).toBe(2)
    expect(path.paragraphIndex).toBe(1)
    expect(path.charOffsetInParagraph).toBe(0)
  })

  it('handles offsets in middle of a paragraph', () => {
    const mdast = parse(sample)
    const target = 'First para under A'
    const offset = sample.indexOf(target) + 6
    const path = computeTreePath(mdast, offset)
    expect(path.charOffsetInParagraph).toBe(6)
  })
})

describe('findHeadingByText', () => {
  it('finds an exact-text heading', () => {
    const h = findHeadingByText(parse(sample), 'Section A')
    expect(h.depth).toBe(2)
  })

  it('returns null when no heading matches', () => {
    expect(findHeadingByText(parse(sample), 'Nonexistent')).toBeNull()
  })

  it('falls back to Levenshtein <= 2 when exact fails', () => {
    const h = findHeadingByText(parse(sample), 'Sectionn A')
    expect(h.depth).toBe(2)
  })
})

describe('paragraphsUnder', () => {
  it('returns paragraphs between this heading and the next of equal or higher level', () => {
    const mdast = parse(sample)
    const h = findHeadingByText(mdast, 'Section A')
    const paras = paragraphsUnder(mdast, h)
    expect(paras).toHaveLength(2)
    expect(paras[0].text).toBe('First para under A.')
    expect(paras[1].text).toBe('Second para under A.')
  })
})

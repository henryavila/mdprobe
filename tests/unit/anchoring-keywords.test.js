import { describe, it, expect } from 'vitest'
import { extractKeywords } from '../../src/anchoring/v2/keywords.js'

describe('extractKeywords', () => {
  it('returns up to 3 lowest-frequency content words from quote', () => {
    const quote = 'The quick FEATURE_FLAG was hardcoded'
    const source = 'The quick brown fox. The slow turtle. ' + quote + '. Another sentence.'
    const kws = extractKeywords(quote, source)
    const words = kws.map(k => k.word)
    expect(words).toContain('FEATURE_FLAG')
    expect(words).toContain('hardcoded')
    expect(kws.length).toBeLessThanOrEqual(3)
  })

  it('records distance from quote start for each keyword', () => {
    const quote = 'FEATURE_FLAG = true here'
    const source = 'irrelevant content. ' + quote + '. more content.'
    const kws = extractKeywords(quote, source)
    const flag = kws.find(k => k.word === 'FEATURE_FLAG')
    expect(flag.distFromStart).toBe(0)
  })

  it('returns empty array when quote has no content words', () => {
    expect(extractKeywords('the and a', 'whatever source content here')).toEqual([])
  })

  it('returns empty array for empty quote', () => {
    expect(extractKeywords('', 'source')).toEqual([])
  })

  it('skips stopwords', () => {
    const kws = extractKeywords('the quick brown', 'the quick brown fox')
    expect(kws.find(k => k.word === 'the')).toBeUndefined()
  })

  it('prefers rare words even if quote has common ones too', () => {
    const source = 'common common common common rare unique'
    const quote = 'common rare unique'
    const kws = extractKeywords(quote, source)
    const words = kws.map(k => k.word)
    expect(words[0]).toMatch(/^(rare|unique)$/)
  })
})

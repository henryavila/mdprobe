import { describe, it, expect } from 'vitest'
import { fuzzyMatch, stringSimilarity } from '../../src/anchoring/v2/fuzzy.js'

describe('stringSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(stringSimilarity('hello', 'hello')).toBe(1)
  })

  it('returns 0 when either side is empty', () => {
    expect(stringSimilarity('', 'hello')).toBe(0)
    expect(stringSimilarity('hello', '')).toBe(0)
    expect(stringSimilarity('', '')).toBe(0)
  })

  it('returns intermediate value for partial match', () => {
    const sim = stringSimilarity('hello world', 'hello wxrld')
    expect(sim).toBeGreaterThan(0.7)
    expect(sim).toBeLessThan(1)
  })
})

describe('fuzzyMatch', () => {
  const text = 'foo bar baz the quick FEATURE_FLAG = true and more text here'

  it('finds exact match with high score', () => {
    const r = fuzzyMatch(text, 'FEATURE_FLAG = true', { hint: 0, prefix: '', suffix: '' })
    expect(r).not.toBeNull()
    expect(r.start).toBe(text.indexOf('FEATURE_FLAG = true'))
    expect(r.score).toBeGreaterThanOrEqual(0.8)
  })

  it('finds match with one substitution', () => {
    const r = fuzzyMatch(text, 'FEATURE_FLAG = trve', { hint: 0, prefix: '', suffix: '' })
    expect(r).not.toBeNull()
    expect(r.start).toBe(text.indexOf('FEATURE_FLAG = true'))
    expect(r.score).toBeGreaterThan(0.6)
    expect(r.score).toBeLessThan(0.97)
  })

  it('returns null when nothing close', () => {
    const r = fuzzyMatch(text, 'completely_unrelated_token_xyz_abc', { hint: 0, prefix: '', suffix: '' })
    expect(r).toBeNull()
  })

  it('uses prefix/suffix to disambiguate among multiple candidates', () => {
    const dup = 'hello world. and another hello world. final hello world.'
    const r = fuzzyMatch(dup, 'hello world', { hint: 0, prefix: 'and another ', suffix: '. final' })
    expect(r).not.toBeNull()
    expect(r.start).toBe(dup.indexOf('and another hello world') + 'and another '.length)
  })
})

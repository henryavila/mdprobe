import { describe, it, expect } from 'vitest'
import { fingerprint, jaccard, normalizeWords } from '../../src/anchoring/v2/fingerprint.js'

describe('normalizeWords', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeWords('Hello, World!')).toEqual(['hello', 'world'])
  })

  it('filters short stop-words', () => {
    expect(normalizeWords('the quick brown fox')).toEqual(['quick', 'brown', 'fox'])
  })

  it('handles empty input', () => {
    expect(normalizeWords('')).toEqual([])
    expect(normalizeWords('   ')).toEqual([])
  })

  it('keeps non-ASCII letters', () => {
    expect(normalizeWords('Café é bom')).toEqual(['café', 'bom'])
  })
})

describe('fingerprint', () => {
  it('produces a deterministic string for the same input', () => {
    expect(fingerprint('the quick brown fox jumps')).toBe(fingerprint('the quick brown fox jumps'))
  })

  it('produces different fingerprints for different texts', () => {
    expect(fingerprint('apple banana cherry')).not.toBe(fingerprint('xenon yttrium zinc'))
  })

  it('returns empty for empty input', () => {
    expect(fingerprint('')).toBe('')
  })
})

describe('jaccard', () => {
  it('returns 1.0 for identical fingerprints', () => {
    const fp = fingerprint('apple banana cherry date')
    expect(jaccard(fp, fp)).toBe(1)
  })

  it('returns near 0 for disjoint texts', () => {
    const a = fingerprint('apple banana cherry date elderberry')
    const b = fingerprint('xenon yttrium zinc walnut quince')
    expect(jaccard(a, b)).toBeLessThan(0.15)
  })

  it('returns intermediate score for partial overlap', () => {
    const a = fingerprint('apple banana cherry date elderberry')
    const b = fingerprint('apple banana cherry walnut quince')
    expect(jaccard(a, b)).toBeGreaterThan(0.3)
    expect(jaccard(a, b)).toBeLessThan(0.8)
  })

  it('is order-invariant', () => {
    expect(jaccard(fingerprint('apple banana cherry date elderberry'), fingerprint('elderberry date cherry banana apple'))).toBeCloseTo(1, 5)
  })
})

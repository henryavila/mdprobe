import { describe, it, expect } from 'vitest'
import { isHighlightApiSupported } from '../../src/ui/highlighters/capability.js'

describe('isHighlightApiSupported', () => {
  it('returns boolean', () => {
    expect(typeof isHighlightApiSupported()).toBe('boolean')
  })

  it('returns true in environments with CSS.highlights', () => {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      expect(isHighlightApiSupported()).toBe(true)
    }
  })
})

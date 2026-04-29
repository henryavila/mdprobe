import { describe, it, expect } from 'vitest'
import { locate } from '../../src/anchoring/v2/locate.js'
import { computeContextHash } from '../../src/anchoring/v2/schema.js'

function makeAnn(start, end, exact, prefix, suffix) {
  return {
    id: 'a1',
    range: { start, end },
    quote: { exact, prefix, suffix },
    anchor: { contextHash: computeContextHash(prefix, exact, suffix) },
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('locate — Step 0 integrity check', () => {
  it('returns confident with score 1.0 when context matches', () => {
    const source = 'Header\n\nThis is a test paragraph with some words.\n'
    const exact = 'a test'
    const start = source.indexOf(exact)
    const ann = makeAnn(
      start, start + exact.length, exact,
      source.slice(Math.max(0, start - 32), start),
      source.slice(start + exact.length, Math.min(source.length, start + exact.length + 32)),
    )
    const r = locate(ann, source, null)
    expect(r.state).toBe('confident')
    expect(r.score).toBe(1)
    expect(r.range).toEqual({ start, end: start + exact.length })
  })
})

describe('locate — Step 1 exact match', () => {
  it('finds annotation when source shifts by N chars and quote is unique', () => {
    const exact = 'FEATURE_FLAG_unique_xyz'
    const original = 'old prefix.\n\n' + exact + ' tail'
    const newSrc = 'NEW HEADER\n\nnew intro paragraph.\n\n' + exact + ' tail'
    const start = original.indexOf(exact)
    const ann = makeAnn(
      start, start + exact.length, exact,
      original.slice(Math.max(0, start - 32), start),
      original.slice(start + exact.length, start + exact.length + 32),
    )
    const r = locate(ann, newSrc, null)
    expect(r.state).toBe('confident')
    expect(r.score).toBeGreaterThanOrEqual(0.9)
    expect(r.range.start).toBe(newSrc.indexOf(exact))
  })
})

describe('locate — Step 2 fuzzy match with threshold', () => {
  it('returns drifted or confident based on score', () => {
    const original = 'Some context here. The brown fox jumped over the lazy dog. More context follows.'
    const newSrc = 'Some context here. The grayish fox jumped over the lazy dog. More context follows.'
    const exact = 'The brown fox jumped over the lazy dog'
    const start = original.indexOf(exact)
    const ann = makeAnn(
      start, start + exact.length, exact,
      original.slice(Math.max(0, start - 32), start),
      original.slice(start + exact.length, start + exact.length + 32),
    )
    const r = locate(ann, newSrc, null)
    expect(['drifted', 'confident']).toContain(r.state)
  })

  it('returns orphan when nothing close', () => {
    const original = 'foo bar baz unique_zzzzz_xyz qux'
    const newSrc = 'completely different text without any overlap whatsoever here'
    const exact = 'unique_zzzzz_xyz'
    const start = original.indexOf(exact)
    const ann = makeAnn(
      start, start + exact.length, exact,
      original.slice(Math.max(0, start - 32), start),
      original.slice(start + exact.length, start + exact.length + 32),
    )
    const r = locate(ann, newSrc, null)
    expect(r.state).toBe('orphan')
  })
})

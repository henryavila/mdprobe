import { describe, it, expect } from 'vitest'
import { detectVersion, transformV1ToV2Essential, sourceToOffset } from '../../src/anchoring/v2/schema.js'
import { createHash } from 'node:crypto'

describe('detectVersion', () => {
  it('returns 1 when schema_version is missing', () => {
    expect(detectVersion({ annotations: [] })).toBe(1)
  })

  it('returns the explicit version when present', () => {
    expect(detectVersion({ schema_version: 2, annotations: [] })).toBe(2)
    expect(detectVersion({ schema_version: 1, annotations: [] })).toBe(1)
  })
})

describe('sourceToOffset', () => {
  it('converts (line, column) 1-indexed to UTF-16 offset', () => {
    const source = 'abc\ndef\nghi'
    expect(sourceToOffset(source, 1, 1)).toBe(0)
    expect(sourceToOffset(source, 1, 4)).toBe(3)
    expect(sourceToOffset(source, 2, 1)).toBe(4)
    expect(sourceToOffset(source, 3, 3)).toBe(10)
  })

  it('clamps out-of-range positions to source length', () => {
    expect(sourceToOffset('abc', 99, 99)).toBe(3)
  })
})

describe('transformV1ToV2Essential', () => {
  const source = 'Header\n\nThis is a test paragraph with some words.\n'

  it('converts a v1 annotation to v2 with range from line/col', () => {
    const v1 = {
      schema_version: 1,
      annotations: [{
        id: 'a1', author: 'me', tag: 'question', status: 'open', comment: 'why?',
        created_at: '2026-01-01T00:00:00Z',
        selectors: {
          position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 },
          quote: { exact: 'This', prefix: '\n', suffix: ' is' },
        },
      }],
    }
    const v2 = transformV1ToV2Essential(v1, source)
    expect(v2.schema_version).toBe(2)
    expect(v2.annotations[0].range).toEqual({ start: 8, end: 12 })
    expect(v2.annotations[0].quote).toEqual({ exact: 'This', prefix: '\n', suffix: ' is' })
    expect(v2.annotations[0].anchor.contextHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(v2.annotations[0].selectors).toBeUndefined()
  })

  it('computes contextHash deterministically', () => {
    const v1 = { annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '\n', suffix: ' is' } },
    }] }
    const v2a = transformV1ToV2Essential(v1, source)
    const expectedHex = createHash('sha256').update('\nThis is').digest('hex')
    expect(v2a.annotations[0].anchor.contextHash).toBe(`sha256:${expectedHex}`)
  })

  it('leaves treePath and keywords empty for lazy backfill', () => {
    const v1 = { annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
    }] }
    const v2 = transformV1ToV2Essential(v1, source)
    expect(v2.annotations[0].anchor.treePath).toBeUndefined()
    expect(v2.annotations[0].anchor.keywords).toBeUndefined()
  })

  it('preserves replies array', () => {
    const v1 = { annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      replies: [{ id: 'r1', author: 'b', comment: 'reply', created_at: '...' }],
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
    }] }
    const v2 = transformV1ToV2Essential(v1, source)
    expect(v2.annotations[0].replies).toEqual([{ id: 'r1', author: 'b', comment: 'reply', created_at: '...' }])
  })

  it('returns input unchanged when already v2', () => {
    const v2 = { schema_version: 2, annotations: [{ id: 'x', range: { start: 0, end: 3 }, quote: { exact: 'abc' } }] }
    expect(transformV1ToV2Essential(v2, source)).toBe(v2)
  })
})

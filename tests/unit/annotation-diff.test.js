import { describe, it, expect } from 'vitest'
import { diffAnnotations } from '../../src/ui/diff/annotation-diff.js'

const make = (id, { tag = 'question', status = 'open', comment = 'c' } = {}) => ({
  id, tag, status, comment, selectors: { position: { startLine: 1 } },
})

describe('diffAnnotations', () => {
  it('returns empty diff for identical input', () => {
    const a = [make('1'), make('2')]
    expect(diffAnnotations(a, a, { showResolved: false }))
      .toEqual({ added: [], removed: [], kept: ['1', '2'] })
  })

  it('detects added ids', () => {
    const prev = [make('1')]
    const next = [make('1'), make('2')]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: ['2'], removed: [], kept: ['1'] })
  })

  it('detects removed ids', () => {
    const prev = [make('1'), make('2')]
    const next = [make('1')]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: [], removed: ['2'], kept: ['1'] })
  })

  it('treats a tag change as removed + added', () => {
    const prev = [make('1', { tag: 'question' })]
    const next = [make('1', { tag: 'bug' })]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: ['1'], removed: ['1'], kept: [] })
  })

  it('treats a status flip to resolved as removed when showResolved is false', () => {
    const prev = [make('1', { status: 'open' })]
    const next = [make('1', { status: 'resolved' })]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: [], removed: ['1'], kept: [] })
  })

  it('keeps resolved ids when showResolved is true and status does not change', () => {
    const prev = [make('1', { status: 'resolved' })]
    const next = [make('1', { status: 'resolved' })]
    expect(diffAnnotations(prev, next, { showResolved: true }))
      .toEqual({ added: [], removed: [], kept: ['1'] })
  })

  it('filters resolved from both sides when showResolved is false', () => {
    const prev = [make('1', { status: 'resolved' }), make('2')]
    const next = [make('1', { status: 'resolved' }), make('2')]
    expect(diffAnnotations(prev, next, { showResolved: false }))
      .toEqual({ added: [], removed: [], kept: ['2'] })
  })
})

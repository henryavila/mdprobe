// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'

import {
  annotations, anchorStatus,
  orphanedAnnotations, anchoredAnnotations,
  showResolved, filterTag, filterAuthor,
} from '../../src/ui/state/store.js'

describe('anchorStatus store signals', () => {
  beforeEach(() => {
    annotations.value = []
    anchorStatus.value = {}
    showResolved.value = false
    filterTag.value = null
    filterAuthor.value = null
  })

  it('orphanedAnnotations filters by orphan status', () => {
    annotations.value = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'x', comment: 'c1' },
      { id: 'a2', status: 'open', tag: 'question', author: 'x', comment: 'c2' },
      { id: 'a3', status: 'open', tag: 'suggestion', author: 'x', comment: 'c3' },
    ]
    anchorStatus.value = { a1: 'anchored', a2: 'orphan', a3: 'anchored' }

    expect(orphanedAnnotations.value).toHaveLength(1)
    expect(orphanedAnnotations.value[0].id).toBe('a2')
  })

  it('anchoredAnnotations excludes orphans', () => {
    annotations.value = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'x', comment: 'c1' },
      { id: 'a2', status: 'open', tag: 'bug', author: 'x', comment: 'c2' },
    ]
    anchorStatus.value = { a1: 'orphan', a2: 'anchored' }

    expect(anchoredAnnotations.value).toHaveLength(1)
    expect(anchoredAnnotations.value[0].id).toBe('a2')
  })

  it('annotations not in anchorStatus map are treated as anchored', () => {
    annotations.value = [
      { id: 'new1', status: 'open', tag: 'bug', author: 'x', comment: 'c1' },
    ]
    anchorStatus.value = {}

    expect(anchoredAnnotations.value).toHaveLength(1)
    expect(orphanedAnnotations.value).toHaveLength(0)
  })

  it('empty anchorStatus means no orphans', () => {
    annotations.value = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'x', comment: 'c1' },
    ]
    anchorStatus.value = {}

    expect(orphanedAnnotations.value).toHaveLength(0)
    expect(anchoredAnnotations.value).toHaveLength(1)
  })

  it('respects existing filters (tag, author, showResolved)', () => {
    annotations.value = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'alice', comment: 'c1' },
      { id: 'a2', status: 'resolved', tag: 'bug', author: 'alice', comment: 'c2' },
      { id: 'a3', status: 'open', tag: 'question', author: 'bob', comment: 'c3' },
    ]
    anchorStatus.value = { a1: 'orphan', a2: 'orphan', a3: 'anchored' }
    showResolved.value = false

    expect(orphanedAnnotations.value).toHaveLength(1)
    expect(orphanedAnnotations.value[0].id).toBe('a1')
  })
})

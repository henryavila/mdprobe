// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'

import {
  annotations, anchorStatus,
  orphanedAnnotations, anchoredAnnotations,
  showResolved, filterTag, filterAuthor,
  setAnnotations, setAnnotationsImmediate,
  modalAnnotationId, modalOpenMode,
  openAnnotationModal, closeAnnotationModal,
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

describe('setAnnotations debounce', () => {
  beforeEach(() => {
    annotations.value = []
  })

  it('collapses rapid setAnnotations calls into one signal update', async () => {
    let updateCount = 0
    const dispose = annotations.subscribe(() => { updateCount++ })

    // Simulate 10 rapid WS broadcasts (like 10 parallel annotation POSTs)
    for (let i = 0; i < 10; i++) {
      setAnnotations([{ id: `a${i}`, status: 'open', tag: 'bug', author: 'x', comment: `c${i}` }])
    }

    // Before the debounce fires, signal should NOT have changed yet
    expect(annotations.value).toEqual([])
    const updatesBeforeDebounce = updateCount

    // Wait for debounce (50ms + margin)
    await new Promise(r => setTimeout(r, 100))

    // After debounce, signal should have the LAST value only
    expect(annotations.value).toHaveLength(1)
    expect(annotations.value[0].id).toBe('a9') // last call wins

    // Only 1 additional signal update (not 10)
    expect(updateCount - updatesBeforeDebounce).toBe(1)

    dispose()
  })

  it('setAnnotationsImmediate bypasses debounce', () => {
    setAnnotationsImmediate([{ id: 'imm1', status: 'open', tag: 'bug', author: 'x', comment: 'c' }])
    expect(annotations.value).toHaveLength(1)
    expect(annotations.value[0].id).toBe('imm1')
  })

  it('setAnnotationsImmediate cancels pending debounce', async () => {
    setAnnotations([{ id: 'debounced', status: 'open', tag: 'bug', author: 'x', comment: 'c' }])
    setAnnotationsImmediate([{ id: 'immediate', status: 'open', tag: 'bug', author: 'x', comment: 'c' }])

    // Immediate value should win
    expect(annotations.value[0].id).toBe('immediate')

    // Wait past debounce — the old debounced value should NOT overwrite
    await new Promise(r => setTimeout(r, 100))
    expect(annotations.value[0].id).toBe('immediate')
  })
})

describe('modal signals', () => {
  beforeEach(() => {
    closeAnnotationModal()
  })

  it('modalAnnotationId and modalOpenMode default to null', () => {
    expect(modalAnnotationId.value).toBe(null)
    expect(modalOpenMode.value).toBe(null)
  })

  it('openAnnotationModal sets both signals', () => {
    openAnnotationModal('abc', 'edit')
    expect(modalAnnotationId.value).toBe('abc')
    expect(modalOpenMode.value).toBe('edit')
  })

  it('openAnnotationModal supports reply mode', () => {
    openAnnotationModal('xyz', 'reply')
    expect(modalAnnotationId.value).toBe('xyz')
    expect(modalOpenMode.value).toBe('reply')
  })

  it('closeAnnotationModal clears both signals', () => {
    openAnnotationModal('abc', 'edit')
    closeAnnotationModal()
    expect(modalAnnotationId.value).toBe(null)
    expect(modalOpenMode.value).toBe(null)
  })
})

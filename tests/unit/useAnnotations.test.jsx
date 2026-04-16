import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAnnotations } from '../../src/ui/hooks/useAnnotations.js'
import {
  annotations, sections, currentFile, author, driftWarning,
  sectionLevel, anchorStatus,
} from '../../src/ui/state/store.js'

// ---------------------------------------------------------------------------
// useAnnotations — CRUD operations for annotations and sections.
// Tests mock global fetch to verify request format and signal updates.
// ---------------------------------------------------------------------------

function mockFetch(responseData) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(responseData),
  })
}

function mockFetchError(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  })
}

describe('useAnnotations', () => {
  let ops

  beforeEach(() => {
    currentFile.value = 'test.md'
    author.value = 'tester'
    annotations.value = []
    sections.value = []
    driftWarning.value = false
    anchorStatus.value = {}
    sectionLevel.value = 2
    ops = useAnnotations()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // fetchAnnotations
  // -------------------------------------------------------------------------

  describe('fetchAnnotations', () => {
    it('fetches annotations and updates store signals', async () => {
      const mockAnns = [{ id: 'a1', comment: 'test', status: 'open', tag: 'bug' }]
      const mockSecs = [{ heading: 'Intro', status: 'approved', level: 2 }]
      globalThis.fetch = mockFetch({
        annotations: mockAnns,
        sections: mockSecs,
        sectionLevel: 3,
        drift: { anchorStatus: { a1: 'anchored' } },
      })

      await ops.fetchAnnotations('test.md')

      expect(annotations.value).toEqual(mockAnns)
      expect(sections.value).toEqual(mockSecs)
      expect(sectionLevel.value).toBe(3)
      expect(driftWarning.value).toEqual({ anchorStatus: { a1: 'anchored' } })
      expect(anchorStatus.value).toEqual({ a1: 'anchored' })
    })

    it('sends correct URL with encoded file path', async () => {
      globalThis.fetch = mockFetch({ annotations: [], sections: [] })

      await ops.fetchAnnotations('path/with spaces.md')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/annotations?path=path%2Fwith%20spaces.md',
      )
    })

    it('throws on non-ok response', async () => {
      globalThis.fetch = mockFetchError(404)

      await expect(ops.fetchAnnotations('test.md')).rejects.toThrow('Failed to fetch annotations: 404')
    })

    it('clears anchorStatus when drift is falsy', async () => {
      anchorStatus.value = { old: 'orphan' }
      globalThis.fetch = mockFetch({ annotations: [], sections: [], drift: false })

      await ops.fetchAnnotations('test.md')

      expect(anchorStatus.value).toEqual({})
    })

    it('handles missing optional fields gracefully', async () => {
      globalThis.fetch = mockFetch({})

      await ops.fetchAnnotations('test.md')

      expect(annotations.value).toEqual([])
      expect(sections.value).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // createAnnotation
  // -------------------------------------------------------------------------

  describe('createAnnotation', () => {
    it('sends correct POST body and updates store', async () => {
      const resultAnns = [{ id: 'new1', comment: 'hello', status: 'open', tag: 'question' }]
      globalThis.fetch = mockFetch({ annotations: resultAnns })

      const selectors = {
        position: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
        quote: { exact: 'some text', prefix: '', suffix: '' },
      }

      await ops.createAnnotation({ selectors, comment: 'hello', tag: 'question' })

      const call = globalThis.fetch.mock.calls[0]
      expect(call[0]).toBe('/api/annotations')
      const body = JSON.parse(call[1].body)
      expect(body.action).toBe('add')
      expect(body.file).toBe('test.md')
      expect(body.data.selectors).toEqual(selectors)
      expect(body.data.comment).toBe('hello')
      expect(body.data.tag).toBe('question')
      expect(body.data.author).toBe('tester')
    })
  })

  // -------------------------------------------------------------------------
  // resolveAnnotation / reopenAnnotation
  // -------------------------------------------------------------------------

  describe('resolveAnnotation', () => {
    it('sends resolve action with annotation id', async () => {
      globalThis.fetch = mockFetch({ annotations: [] })

      await ops.resolveAnnotation('abc123')

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('resolve')
      expect(body.data.id).toBe('abc123')
    })
  })

  describe('reopenAnnotation', () => {
    it('sends reopen action with annotation id', async () => {
      globalThis.fetch = mockFetch({ annotations: [] })

      await ops.reopenAnnotation('abc123')

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('reopen')
      expect(body.data.id).toBe('abc123')
    })
  })

  // -------------------------------------------------------------------------
  // updateAnnotation / deleteAnnotation
  // -------------------------------------------------------------------------

  describe('updateAnnotation', () => {
    it('sends update action with id, comment, and tag', async () => {
      globalThis.fetch = mockFetch({ annotations: [] })

      await ops.updateAnnotation('abc123', { comment: 'updated', tag: 'bug' })

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('update')
      expect(body.data.id).toBe('abc123')
      expect(body.data.comment).toBe('updated')
      expect(body.data.tag).toBe('bug')
    })
  })

  describe('deleteAnnotation', () => {
    it('sends delete action with id', async () => {
      globalThis.fetch = mockFetch({ annotations: [] })

      await ops.deleteAnnotation('abc123')

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('delete')
      expect(body.data.id).toBe('abc123')
    })
  })

  // -------------------------------------------------------------------------
  // addReply
  // -------------------------------------------------------------------------

  describe('addReply', () => {
    it('sends reply action with annotation id, author, and comment', async () => {
      globalThis.fetch = mockFetch({ annotations: [] })

      await ops.addReply('abc123', 'nice catch')

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('reply')
      expect(body.data.id).toBe('abc123')
      expect(body.data.author).toBe('tester')
      expect(body.data.comment).toBe('nice catch')
    })
  })

  // -------------------------------------------------------------------------
  // Section operations
  // -------------------------------------------------------------------------

  describe('approveSection', () => {
    it('sends approve action and updates sections signal', async () => {
      const resultSecs = [{ heading: 'Intro', status: 'approved', level: 2 }]
      globalThis.fetch = mockFetch({ sections: resultSecs, sectionLevel: 2 })

      await ops.approveSection('Intro')

      const call = globalThis.fetch.mock.calls[0]
      expect(call[0]).toBe('/api/sections')
      const body = JSON.parse(call[1].body)
      expect(body.action).toBe('approve')
      expect(body.heading).toBe('Intro')
      expect(body.file).toBe('test.md')
      expect(sections.value).toEqual(resultSecs)
    })
  })

  describe('rejectSection', () => {
    it('sends reject action', async () => {
      globalThis.fetch = mockFetch({ sections: [], sectionLevel: 2 })

      await ops.rejectSection('Bad Section')

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('reject')
      expect(body.heading).toBe('Bad Section')
    })
  })

  describe('approveAllSections', () => {
    it('sends approveAll action without heading', async () => {
      globalThis.fetch = mockFetch({ sections: [] })

      await ops.approveAllSections()

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('approveAll')
      expect(body.heading).toBeUndefined()
    })
  })

  describe('clearAllSections', () => {
    it('sends clearAll action', async () => {
      globalThis.fetch = mockFetch({ sections: [] })

      await ops.clearAllSections()

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('clearAll')
    })
  })

  describe('resetSection', () => {
    it('sends reset action with heading', async () => {
      globalThis.fetch = mockFetch({ sections: [], sectionLevel: 2 })

      await ops.resetSection('Some Heading')

      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
      expect(body.action).toBe('reset')
      expect(body.heading).toBe('Some Heading')
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws on failed annotation POST', async () => {
      globalThis.fetch = mockFetchError(500)

      await expect(ops.resolveAnnotation('x')).rejects.toThrow('Annotation resolve failed: 500')
    })

    it('throws on failed section POST', async () => {
      globalThis.fetch = mockFetchError(500)

      await expect(ops.approveSection('x')).rejects.toThrow('Section approve failed: 500')
    })
  })
})

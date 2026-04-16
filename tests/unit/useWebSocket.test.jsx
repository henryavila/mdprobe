import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/preact'
import {
  currentHtml, currentToc, currentFile, files,
  annotations, sections, driftWarning, anchorStatus,
} from '../../src/ui/state/store.js'

// ---------------------------------------------------------------------------
// useWebSocket — WebSocket connection, message dispatch, reconnection.
// Tests mock global WebSocket to verify message handling and signal updates.
// ---------------------------------------------------------------------------

// Capture constructed WebSocket instances
let wsInstances = []
let MockWebSocket

function setupMockWebSocket() {
  wsInstances = []
  MockWebSocket = vi.fn(function (url) {
    this.url = url
    this.readyState = 0 // CONNECTING
    this.close = vi.fn()
    this.send = vi.fn()
    wsInstances.push(this)
    // Auto-trigger onopen in the next microtask
    setTimeout(() => {
      this.readyState = 1 // OPEN
      this.onopen?.()
    }, 0)
  })
  globalThis.WebSocket = MockWebSocket
}

describe('useWebSocket', () => {
  let useWebSocket

  beforeEach(async () => {
    currentHtml.value = ''
    currentToc.value = []
    currentFile.value = 'test.md'
    files.value = []
    annotations.value = []
    sections.value = []
    driftWarning.value = false
    anchorStatus.value = {}

    setupMockWebSocket()
    // Dynamic import to ensure our mock is in place before module loads
    const mod = await import('../../src/ui/hooks/useWebSocket.js')
    useWebSocket = mod.useWebSocket
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function lastWs() {
    return wsInstances[wsInstances.length - 1]
  }

  function sendMessage(ws, msg) {
    ws.onmessage?.({ data: JSON.stringify(msg) })
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  describe('connection', () => {
    it('creates a WebSocket connection on mount', async () => {
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      expect(lastWs().url).toContain('/ws')
    })

    it('closes WebSocket on unmount', async () => {
      const { unmount } = renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))
      const ws = lastWs()

      unmount()
      expect(ws.close).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  describe('message handling', () => {
    it('handles "update" message — sets HTML and TOC', async () => {
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      sendMessage(lastWs(), {
        type: 'update',
        html: '<p>Hello</p>',
        toc: [{ text: 'Intro', level: 1 }],
      })

      expect(currentHtml.value).toBe('<p>Hello</p>')
      expect(currentToc.value).toEqual([{ text: 'Intro', level: 1 }])
    })

    it('handles "file-added" message — appends to files list', async () => {
      files.value = [{ path: 'existing.md', label: 'existing' }]
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      sendMessage(lastWs(), { type: 'file-added', file: 'new-file.md' })

      expect(files.value).toHaveLength(2)
      expect(files.value[1].path).toBe('new-file.md')
    })

    it('handles "file-added" — deduplicates existing files', async () => {
      files.value = [{ path: 'test.md', label: 'test' }]
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      sendMessage(lastWs(), { type: 'file-added', file: 'test.md' })

      expect(files.value).toHaveLength(1) // Not duplicated
    })

    it('handles "file-removed" message — removes from files list', async () => {
      files.value = [
        { path: 'a.md', label: 'a' },
        { path: 'b.md', label: 'b' },
      ]
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      sendMessage(lastWs(), { type: 'file-removed', file: 'a.md' })

      expect(files.value).toHaveLength(1)
      expect(files.value[0].path).toBe('b.md')
    })

    it('handles "annotations" message — updates annotations for current file', async () => {
      const anns = [{ id: 'a1', comment: 'test', status: 'open', tag: 'bug' }]
      const secs = [{ heading: 'Intro', status: 'approved', level: 2 }]
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      sendMessage(lastWs(), {
        type: 'annotations',
        file: 'test.md',
        annotations: anns,
        sections: secs,
      })

      // Annotations use debounced setters — wait for the timeout
      await vi.waitFor(() => expect(annotations.value).toEqual(anns))
      await vi.waitFor(() => expect(sections.value).toEqual(secs))
    })

    it('ignores "annotations" for a different file', async () => {
      annotations.value = [{ id: 'existing' }]
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      sendMessage(lastWs(), {
        type: 'annotations',
        file: 'other-file.md',
        annotations: [{ id: 'new' }],
      })

      // Should not update — still the old value
      // Wait a bit to ensure the debounce would have fired
      await new Promise(r => setTimeout(r, 100))
      expect(annotations.value).toEqual([{ id: 'existing' }])
    })

    it('handles "drift" message — sets drift warning', async () => {
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      sendMessage(lastWs(), {
        type: 'drift',
        warning: true,
        anchorStatus: { a1: 'orphan' },
      })

      expect(driftWarning.value).toBe(true)
      expect(anchorStatus.value).toEqual({ a1: 'orphan' })
    })

    it('handles "error" message gracefully (no crash)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      sendMessage(lastWs(), { type: 'error', message: 'parse error' })

      expect(warnSpy).toHaveBeenCalledWith('mdProbe:', 'parse error')
      warnSpy.mockRestore()
    })

    it('handles malformed JSON gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      renderHook(() => useWebSocket())
      await vi.waitFor(() => expect(wsInstances.length).toBeGreaterThan(0))

      lastWs().onmessage?.({ data: 'not json {{{' })

      expect(warnSpy).toHaveBeenCalledWith('mdProbe: received non-JSON WebSocket message')
      warnSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // Reconnection
  // -------------------------------------------------------------------------

  describe('reconnection', () => {
    it('reconnects on close with exponential backoff', async () => {
      // Mock fetch for the reconnect's file list re-sync
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      })

      vi.useFakeTimers()
      renderHook(() => useWebSocket())

      // Wait for initial connection
      await vi.advanceTimersByTimeAsync(10)
      expect(wsInstances.length).toBe(1)

      // Simulate disconnect
      lastWs().onclose?.()

      // Advance past first reconnect delay (~2000ms + jitter)
      await vi.advanceTimersByTimeAsync(3000)
      expect(wsInstances.length).toBe(2)

      vi.useRealTimers()
    })

    it('re-fetches file list on reconnect', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ path: 'refreshed.md', label: 'refreshed' }]),
      })
      globalThis.fetch = fetchSpy

      vi.useFakeTimers()
      renderHook(() => useWebSocket())

      // First connection
      await vi.advanceTimersByTimeAsync(10)
      const firstWs = lastWs()

      // Simulate disconnect and reconnect
      firstWs.onclose?.()
      await vi.advanceTimersByTimeAsync(3000)

      // The second WS connects and triggers onopen
      const secondWs = lastWs()
      expect(secondWs).not.toBe(firstWs)

      // onopen fires → should fetch /api/files (since hasConnected is true)
      await vi.advanceTimersByTimeAsync(10)

      expect(fetchSpy).toHaveBeenCalledWith('/api/files')

      vi.useRealTimers()
    })
  })
})

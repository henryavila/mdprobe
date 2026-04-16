import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent } from '@testing-library/preact'
import { renderHook, cleanup } from '@testing-library/preact'
import { useKeyboard } from '../../src/ui/hooks/useKeyboard.js'
import {
  leftPanelOpen, rightPanelOpen, selectedAnnotationId,
  annotations, showResolved, filterTag, filterAuthor,
} from '../../src/ui/state/store.js'

// ---------------------------------------------------------------------------
// useKeyboard — global keyboard shortcuts for panel toggles, annotation
// navigation, and help overlay.
// ---------------------------------------------------------------------------

describe('useKeyboard', () => {
  beforeEach(() => {
    leftPanelOpen.value = true
    rightPanelOpen.value = true
    selectedAnnotationId.value = null
    annotations.value = []
    showResolved.value = false
    filterTag.value = null
    filterAuthor.value = null
  })

  afterEach(() => {
    cleanup()
  })

  function pressKey(key) {
    fireEvent.keyDown(document, { key })
  }

  // -------------------------------------------------------------------------
  // Panel toggles
  // -------------------------------------------------------------------------

  describe('panel toggles', () => {
    it('[ toggles left panel', () => {
      renderHook(() => useKeyboard())

      expect(leftPanelOpen.value).toBe(true)
      pressKey('[')
      expect(leftPanelOpen.value).toBe(false)
      pressKey('[')
      expect(leftPanelOpen.value).toBe(true)
    })

    it('] toggles right panel', () => {
      renderHook(() => useKeyboard())

      expect(rightPanelOpen.value).toBe(true)
      pressKey(']')
      expect(rightPanelOpen.value).toBe(false)
      pressKey(']')
      expect(rightPanelOpen.value).toBe(true)
    })

    it('\\ toggles both panels (focus mode)', () => {
      renderHook(() => useKeyboard())

      // Both open → close both
      pressKey('\\')
      expect(leftPanelOpen.value).toBe(false)
      expect(rightPanelOpen.value).toBe(false)

      // Both closed → open both
      pressKey('\\')
      expect(leftPanelOpen.value).toBe(true)
      expect(rightPanelOpen.value).toBe(true)
    })

    it('\\ when only one panel is open → opens both', () => {
      leftPanelOpen.value = true
      rightPanelOpen.value = false

      renderHook(() => useKeyboard())
      pressKey('\\')

      // Not both open → opens both
      expect(leftPanelOpen.value).toBe(true)
      expect(rightPanelOpen.value).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Annotation navigation (j/k)
  // -------------------------------------------------------------------------

  describe('annotation navigation', () => {
    const anns = [
      { id: 'a1', status: 'open', tag: 'bug', author: 'x' },
      { id: 'a2', status: 'open', tag: 'question', author: 'x' },
      { id: 'a3', status: 'open', tag: 'suggestion', author: 'x' },
    ]

    beforeEach(() => {
      annotations.value = anns
    })

    it('j selects the first annotation when none selected', () => {
      renderHook(() => useKeyboard())

      pressKey('j')
      expect(selectedAnnotationId.value).toBe('a1')
    })

    it('j advances to next annotation', () => {
      selectedAnnotationId.value = 'a1'
      renderHook(() => useKeyboard())

      pressKey('j')
      expect(selectedAnnotationId.value).toBe('a2')
    })

    it('k selects previous annotation', () => {
      selectedAnnotationId.value = 'a2'
      renderHook(() => useKeyboard())

      pressKey('k')
      expect(selectedAnnotationId.value).toBe('a1')
    })

    it('j wraps around from last to first', () => {
      selectedAnnotationId.value = 'a3'
      renderHook(() => useKeyboard())

      pressKey('j')
      expect(selectedAnnotationId.value).toBe('a1')
    })

    it('k wraps around from first to last', () => {
      selectedAnnotationId.value = 'a1'
      renderHook(() => useKeyboard())

      pressKey('k')
      expect(selectedAnnotationId.value).toBe('a3')
    })

    it('k selects last annotation when none selected', () => {
      renderHook(() => useKeyboard())

      pressKey('k')
      expect(selectedAnnotationId.value).toBe('a3')
    })

    it('does nothing when annotation list is empty', () => {
      annotations.value = []
      renderHook(() => useKeyboard())

      pressKey('j')
      expect(selectedAnnotationId.value).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Help overlay
  // -------------------------------------------------------------------------

  describe('help overlay', () => {
    it('? calls onShowHelp callback', () => {
      const onShowHelp = vi.fn()
      renderHook(() => useKeyboard({ onShowHelp }))

      pressKey('?')
      expect(onShowHelp).toHaveBeenCalledTimes(1)
    })

    it('? does not throw when onShowHelp is not provided', () => {
      renderHook(() => useKeyboard())

      expect(() => pressKey('?')).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Suppression in form controls
  // -------------------------------------------------------------------------

  describe('form control suppression', () => {
    it('does not trigger shortcuts when a textarea is focused', () => {
      renderHook(() => useKeyboard())

      const textarea = document.createElement('textarea')
      document.body.appendChild(textarea)
      textarea.focus()

      pressKey('[')
      // Panel should NOT have toggled
      expect(leftPanelOpen.value).toBe(true)

      document.body.removeChild(textarea)
    })

    it('does not trigger shortcuts when an input is focused', () => {
      renderHook(() => useKeyboard())

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()

      pressKey(']')
      expect(rightPanelOpen.value).toBe(true)

      document.body.removeChild(input)
    })
  })

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    it('removes event listener on unmount', () => {
      const { unmount } = renderHook(() => useKeyboard())

      unmount()

      leftPanelOpen.value = true
      pressKey('[')
      // Should NOT have toggled since the hook is unmounted
      expect(leftPanelOpen.value).toBe(true)
    })
  })
})

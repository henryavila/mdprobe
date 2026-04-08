import { useEffect } from 'preact/hooks'
import {
  leftPanelOpen,
  rightPanelOpen,
  selectedAnnotationId,
  filteredAnnotations,
} from '../state/store.js'

/**
 * Registers global keyboard shortcuts for the mdprobe UI.
 * Shortcuts are suppressed when focus is inside a text input, textarea,
 * select, or contentEditable element.
 *
 * Bindings:
 *   [   – toggle left panel
 *   ]   – toggle right panel
 *   \   – toggle both panels (focus mode)
 *   j   – select next annotation
 *   k   – select previous annotation
 *   r   – reserved (resolve, handled by parent)
 *   e   – reserved (edit, handled by parent)
 *   ?   – show help overlay
 *
 * @param {{ onShowHelp?: () => void }} options
 */
export function useKeyboard({ onShowHelp } = {}) {
  useEffect(() => {
    function handleKey(e) {
      // Don't intercept when typing in form controls
      const tag = document.activeElement?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return
      if (document.activeElement?.isContentEditable) return

      switch (e.key) {
        case '[':
          e.preventDefault()
          leftPanelOpen.value = !leftPanelOpen.value
          break

        case ']':
          e.preventDefault()
          rightPanelOpen.value = !rightPanelOpen.value
          break

        case '\\': {
          e.preventDefault()
          const bothOpen = leftPanelOpen.value && rightPanelOpen.value
          leftPanelOpen.value = !bothOpen
          rightPanelOpen.value = !bothOpen
          break
        }

        case 'j':
          e.preventDefault()
          navigateAnnotation(1)
          break

        case 'k':
          e.preventDefault()
          navigateAnnotation(-1)
          break

        case 'r':
          // Resolve – handled by parent component listener
          break

        case 'e':
          // Edit – handled by parent component listener
          break

        case '?':
          e.preventDefault()
          onShowHelp?.()
          break

        default:
          break
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onShowHelp])
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Move selection to the next/previous annotation in the filtered list
 * and scroll both the right-panel card and the content highlight into view.
 *
 * @param {1|-1} direction  1 = next, -1 = previous
 */
function navigateAnnotation(direction) {
  const list = filteredAnnotations.value
  if (list.length === 0) return

  const currentId = selectedAnnotationId.value
  const currentIndex = list.findIndex((a) => a.id === currentId)

  let nextIndex
  if (currentIndex === -1) {
    // Nothing selected yet – jump to first or last depending on direction
    nextIndex = direction > 0 ? 0 : list.length - 1
  } else {
    nextIndex = currentIndex + direction
    // Wrap around
    if (nextIndex < 0) nextIndex = list.length - 1
    if (nextIndex >= list.length) nextIndex = 0
  }

  const target = list[nextIndex]
  selectedAnnotationId.value = target.id

  // Scroll the annotation card into view in the right panel
  const card = document.querySelector(
    `[data-annotation-id="${target.id}"]`,
  )
  card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

  // Scroll the corresponding content highlight into view
  const highlight = document.querySelector(
    `[data-highlight-id="${target.id}"]`,
  )
  highlight?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

import { useState, useEffect, useRef } from 'preact/hooks'
import { AnnotationForm } from './AnnotationForm.jsx'

/**
 * Draggable annotation popover — appears at the text selection position.
 * No backdrop: uses strong shadow for visual separation.
 * Drag-handle on the header lets users reposition to read content underneath.
 */
export function Popover({ x, y, exact, selectors, onSave, onCancel }) {
  const popoverRef = useRef(null)
  const dragRef = useRef({ active: false, startX: 0, startY: 0 })

  // Compute initial viewport-aware position
  const popoverWidth = 520
  const popoverHeight = 440
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 800
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
  const spaceBelow = viewportH - y
  const flipAbove = spaceBelow < popoverHeight

  const initialLeft = Math.max(16, Math.min(x - popoverWidth / 2, viewportW - popoverWidth - 16))
  const initialTop = flipAbove ? Math.max(8, y - popoverHeight - 8) : y

  const [pos, setPos] = useState({ left: initialLeft, top: initialTop })

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  // Drag: mousemove + mouseup on document for smooth tracking
  useEffect(() => {
    function onMouseMove(e) {
      if (!dragRef.current.active) return
      setPos({
        left: e.clientX - dragRef.current.startX,
        top: e.clientY - dragRef.current.startY,
      })
    }
    function onMouseUp() {
      dragRef.current.active = false
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  function handleDragStart(e) {
    if (e.button !== 0) return
    dragRef.current = {
      active: true,
      startX: e.clientX - pos.left,
      startY: e.clientY - pos.top,
    }
    e.preventDefault()
  }

  const style = {
    position: 'fixed',
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    width: `${popoverWidth}px`,
    zIndex: 101,
  }

  return (
    <div class="popover popover--enter" ref={popoverRef} style={style}>
      <div class="popover__header" onMouseDown={handleDragStart}>
        <span class="popover__title">New Annotation</span>
        <button
          type="button"
          class="popover__close"
          onClick={onCancel}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <AnnotationForm
        mode="create"
        exact={exact}
        selectors={selectors}
        onSave={onSave}
        onCancel={onCancel}
      />
    </div>
  )
}

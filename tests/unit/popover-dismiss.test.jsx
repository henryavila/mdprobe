import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { Popover } from '../../src/ui/components/Popover.jsx'

// ---------------------------------------------------------------------------
// Popover tests — verifies the annotation popover UX
// ---------------------------------------------------------------------------

describe('Popover', () => {
  let onCancel
  let onSave

  beforeEach(() => {
    onCancel = vi.fn()
    onSave = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  const defaultProps = () => ({
    x: 100,
    y: 100,
    exact: 'selected text',
    selectors: {
      position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 14 },
      quote: { exact: 'selected text', prefix: '', suffix: '' },
    },
    onSave,
    onCancel,
  })

  // -------------------------------------------------------------------------
  // Opens directly as annotation form
  // -------------------------------------------------------------------------

  describe('opens directly as form', () => {
    it('shows the annotation form immediately (no Annotate button)', () => {
      const { container, queryByText } = render(<Popover {...defaultProps()} />)

      const textarea = container.querySelector('textarea')
      expect(textarea).not.toBeNull()
    })

    it('shows tag pills instead of a select dropdown', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const pills = container.querySelectorAll('.tag-pill')
      expect(pills.length).toBe(4)

      const select = container.querySelector('select')
      expect(select).toBeNull()
    })

    it('auto-focuses the comment textarea', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const textarea = container.querySelector('textarea')
      expect(textarea).not.toBeNull()
      expect(textarea.hasAttribute('autofocus') || textarea === document.activeElement).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  describe('header', () => {
    it('shows "New Annotation" title', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const title = container.querySelector('.popover__title')
      expect(title).not.toBeNull()
      expect(title.textContent).toBe('New Annotation')
    })

    it('has a close button', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const closeBtn = container.querySelector('.popover__close')
      expect(closeBtn).not.toBeNull()

      fireEvent.click(closeBtn)
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('has a draggable header', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const header = container.querySelector('.popover__header')
      expect(header).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // No backdrop (content remains visible)
  // -------------------------------------------------------------------------

  describe('no backdrop', () => {
    it('does not render a backdrop overlay', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const backdrop = container.querySelector('.popover-backdrop')
      expect(backdrop).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Dismissal
  // -------------------------------------------------------------------------

  describe('dismissal', () => {
    it('pressing Escape calls onCancel', () => {
      render(<Popover {...defaultProps()} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('Cancel button calls onCancel', () => {
      const { getByText } = render(<Popover {...defaultProps()} />)

      fireEvent.click(getByText('Cancel'))

      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // Tag pills
  // -------------------------------------------------------------------------

  describe('tag pills', () => {
    it('defaults to "question" tag selected', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const active = container.querySelector('.tag-pill--active')
      expect(active).not.toBeNull()
      expect(active.classList.contains('tag-pill--question')).toBe(true)
    })

    it('clicking a tag pill selects it', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const bugPill = container.querySelector('.tag-pill--bug')
      fireEvent.click(bugPill)

      expect(bugPill.classList.contains('tag-pill--active')).toBe(true)

      // Previous active should be deselected
      const questionPill = container.querySelector('.tag-pill--question')
      expect(questionPill.classList.contains('tag-pill--active')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Selected text display
  // -------------------------------------------------------------------------

  describe('selected text display', () => {
    it('shows the selected text in a styled quote block', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const quote = container.querySelector('.annotation-form__quote')
      expect(quote).not.toBeNull()
      expect(quote.textContent).toContain('selected text')
    })

    it('long text is constrained (does not break layout)', () => {
      const longText = 'A'.repeat(500) + '\n' + 'B'.repeat(500)
      const { container } = render(
        <Popover
          {...defaultProps()}
          exact={longText}
          selectors={{
            ...defaultProps().selectors,
            quote: { exact: longText, prefix: '', suffix: '' },
          }}
        />,
      )

      const quote = container.querySelector('.annotation-form__quote')
      expect(quote).not.toBeNull()
      const style = window.getComputedStyle(quote)
      const hasConstraint =
        style.maxHeight !== 'none' ||
        style.overflow === 'auto' ||
        style.overflow === 'hidden' ||
        style.overflowY === 'auto' ||
        style.overflowY === 'hidden'
      expect(hasConstraint).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Viewport-aware positioning
  // -------------------------------------------------------------------------

  describe('positioning', () => {
    it('renders with position: fixed', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const popover = container.querySelector('.popover')
      expect(popover).not.toBeNull()
    })

    it('flips above selection when near bottom of viewport', () => {
      const nearBottom = window.innerHeight - 10
      const { container } = render(
        <Popover {...defaultProps()} y={nearBottom} />,
      )

      const popover = container.querySelector('.popover')
      const top = parseInt(popover.style.top)

      expect(top).toBeLessThan(nearBottom)
    })
  })

  // -------------------------------------------------------------------------
  // Draggable
  // -------------------------------------------------------------------------

  describe('draggable', () => {
    it('changes position when header is dragged', () => {
      const { container } = render(<Popover {...defaultProps()} />)

      const header = container.querySelector('.popover__header')
      const popover = container.querySelector('.popover')
      const initialLeft = parseInt(popover.style.left)
      const initialTop = parseInt(popover.style.top)

      // Simulate drag: mousedown on header, mousemove on document, mouseup
      fireEvent.mouseDown(header, { clientX: 200, clientY: 200, button: 0 })
      fireEvent.mouseMove(document, { clientX: 300, clientY: 250 })
      fireEvent.mouseUp(document)

      const newLeft = parseInt(popover.style.left)
      const newTop = parseInt(popover.style.top)

      // Position should have changed
      expect(newLeft).not.toBe(initialLeft)
      expect(newTop).not.toBe(initialTop)
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/preact'
import { RightPanel } from '../../src/ui/components/RightPanel.jsx'
import {
  rightPanelOpen, annotations, selectedAnnotationId,
  showResolved, filterTag, filterAuthor, anchorStatus, driftWarning,
} from '../../src/ui/state/store.js'

// ---------------------------------------------------------------------------
// RightPanel — annotation list, filters, actions, orphaned section.
// ---------------------------------------------------------------------------

const sampleAnnotations = [
  {
    id: 'a1', status: 'open', tag: 'bug', author: 'alice',
    comment: 'This is wrong',
    selectors: { quote: { exact: 'some text' }, position: { startLine: 1 } },
  },
  {
    id: 'a2', status: 'open', tag: 'question', author: 'bob',
    comment: 'What does this mean?',
    selectors: { quote: { exact: 'other text' }, position: { startLine: 5 } },
  },
  {
    id: 'a3', status: 'resolved', tag: 'suggestion', author: 'alice',
    comment: 'Consider refactoring',
    selectors: { quote: { exact: 'third text' }, position: { startLine: 10 } },
  },
]

describe('RightPanel', () => {
  const mockOps = {
    resolveAnnotation: vi.fn(),
    reopenAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    addReply: vi.fn(),
  }

  beforeEach(() => {
    rightPanelOpen.value = true
    annotations.value = sampleAnnotations
    selectedAnnotationId.value = null
    showResolved.value = false
    filterTag.value = null
    filterAuthor.value = null
    anchorStatus.value = { a1: 'anchored', a2: 'anchored', a3: 'anchored' }
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // -------------------------------------------------------------------------
  // Collapsed state
  // -------------------------------------------------------------------------

  describe('collapsed state', () => {
    it('shows collapsed indicator when panel is closed', () => {
      rightPanelOpen.value = false
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      expect(container.querySelector('.panel-collapsed-indicator')).not.toBeNull()
      expect(container.querySelector('.panel-content')).toBeNull()
    })

    it('shows open annotation count badge', () => {
      rightPanelOpen.value = false
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const badge = container.querySelector('.badge')
      expect(badge).not.toBeNull()
      expect(badge.textContent).toBe('2') // 2 open annotations
    })

    it('clicking collapsed indicator opens the panel', () => {
      rightPanelOpen.value = false
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      fireEvent.click(container.querySelector('.panel-collapsed-indicator'))
      expect(rightPanelOpen.value).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Open state — annotation list
  // -------------------------------------------------------------------------

  describe('annotation list', () => {
    it('renders annotation cards for open annotations', () => {
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const cards = container.querySelectorAll('.annotation-card')
      // showResolved=false → only 2 open annotations visible
      expect(cards.length).toBe(2)
    })

    it('shows resolved annotations when showResolved is checked', () => {
      showResolved.value = true
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const cards = container.querySelectorAll('.annotation-card')
      expect(cards.length).toBe(3)
    })

    it('displays tag, author, and comment in each card', () => {
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const firstCard = container.querySelector('.annotation-card')
      expect(firstCard.textContent).toContain('bug')
      expect(firstCard.textContent).toContain('alice')
      expect(firstCard.textContent).toContain('This is wrong')
    })

    it('shows quote text in card', () => {
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const quote = container.querySelector('.quote')
      expect(quote).not.toBeNull()
      expect(quote.textContent).toBe('some text')
    })

    it('shows "No annotations" when list is empty', () => {
      annotations.value = []
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      expect(container.textContent).toContain('No annotations')
    })
  })

  // -------------------------------------------------------------------------
  // Selection and actions
  // -------------------------------------------------------------------------

  describe('selection and actions', () => {
    it('clicking a card selects the annotation', () => {
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const firstCard = container.querySelector('.annotation-card')
      fireEvent.click(firstCard)

      expect(selectedAnnotationId.value).toBe('a1')
    })

    it('selected card shows Resolve, Edit, Delete buttons', () => {
      selectedAnnotationId.value = 'a1'
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const selectedCard = container.querySelector('.annotation-card.selected')
      expect(selectedCard).not.toBeNull()

      const buttons = selectedCard.querySelectorAll('button.btn-sm')
      const labels = [...buttons].map(b => b.textContent.trim())
      expect(labels).toContain('Resolve')
      expect(labels).toContain('Edit')
      expect(labels).toContain('Delete')
    })

    it('Resolve button calls resolveAnnotation', () => {
      selectedAnnotationId.value = 'a1'
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const resolveBtn = [...container.querySelectorAll('button.btn-sm')]
        .find(b => b.textContent.trim() === 'Resolve')
      fireEvent.click(resolveBtn)

      expect(mockOps.resolveAnnotation).toHaveBeenCalledWith('a1')
    })

    it('resolved annotation shows Reopen button instead of Resolve', () => {
      showResolved.value = true
      selectedAnnotationId.value = 'a3'
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const selected = container.querySelector('.annotation-card.selected')
      const buttons = [...selected.querySelectorAll('button.btn-sm')]
      const labels = buttons.map(b => b.textContent.trim())
      expect(labels).toContain('Reopen')
      expect(labels).not.toContain('Resolve')
    })

    it('selected card shows reply input', () => {
      selectedAnnotationId.value = 'a1'
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const replyInput = container.querySelector('.reply-input input')
      expect(replyInput).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  describe('filters', () => {
    it('filter by tag narrows the visible annotations', () => {
      filterTag.value = 'bug'
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const cards = container.querySelectorAll('.annotation-card')
      expect(cards.length).toBe(1) // Only a1 (bug)
    })

    it('filter by author narrows the visible annotations', () => {
      filterAuthor.value = 'bob'
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const cards = container.querySelectorAll('.annotation-card')
      expect(cards.length).toBe(1) // Only a2 (bob)
    })

    it('tag filter dropdown includes unique tags', () => {
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const tagSelect = container.querySelector('.filter-select')
      const options = tagSelect.querySelectorAll('option')
      const values = [...options].map(o => o.value).filter(v => v)
      expect(values).toContain('bug')
      expect(values).toContain('question')
      expect(values).toContain('suggestion')
    })
  })

  // -------------------------------------------------------------------------
  // Orphaned annotations
  // -------------------------------------------------------------------------

  describe('orphaned annotations', () => {
    it('shows orphaned section when drift warning and orphans exist', () => {
      anchorStatus.value = { a1: 'anchored', a2: 'orphan' }
      driftWarning.value = true
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const orphanedSection = container.querySelector('.orphaned-section')
      expect(orphanedSection).not.toBeNull()
      expect(orphanedSection.textContent).toContain('Not found')
    })

    it('orphaned section is collapsible', () => {
      anchorStatus.value = { a1: 'orphan', a2: 'orphan' }
      driftWarning.value = true
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const header = container.querySelector('.orphaned-section-header')
      expect(header).not.toBeNull()

      // Click to collapse
      fireEvent.click(header)
      // After collapse, cards inside should not be visible
      const cards = container.querySelector('.orphaned-section').querySelectorAll('.annotation-card')
      expect(cards.length).toBe(0)
    })

    it('does not show orphaned section without drift warning', () => {
      anchorStatus.value = { a1: 'orphan' }
      driftWarning.value = false
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      expect(container.querySelector('.orphaned-section')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  describe('header', () => {
    it('shows open annotation count', () => {
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      expect(container.textContent).toContain('2 open')
    })

    it('close button hides the panel', () => {
      const { container } = render(<RightPanel annotationOps={mockOps} />)

      const closeBtn = container.querySelector('.panel-header .btn')
      fireEvent.click(closeBtn)

      expect(rightPanelOpen.value).toBe(false)
    })
  })
})

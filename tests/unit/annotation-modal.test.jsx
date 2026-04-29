import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { AnnotationModal } from '../../src/ui/components/AnnotationModal.jsx'
import { modalAnnotationId, modalOpenMode, annotations, author } from '../../src/ui/state/store.js'

afterEach(() => { cleanup(); modalAnnotationId.value = null; modalOpenMode.value = null })

function setup(anns, mode = 'edit', currentId = 'a1') {
  annotations.value = anns
  author.value = 'me'
  modalAnnotationId.value = currentId
  modalOpenMode.value = mode
}

const makeOps = () => ({
  updateAnnotation: vi.fn(),
  addReply: vi.fn(),
  editReply: vi.fn(),
  deleteReply: vi.fn(),
  deleteAnnotation: vi.fn(),
  resolveAnnotation: vi.fn(),
})

describe('AnnotationModal', () => {
  it('renders nothing when modalAnnotationId is null', () => {
    modalAnnotationId.value = null
    const { container } = render(<AnnotationModal annotationOps={makeOps()} />)
    expect(container.querySelector('.annotation-modal')).toBeNull()
  })

  it('renders quote, root comment, and replies when open', () => {
    const ann = {
      id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'root comment',
      selectors: { quote: { exact: 'quoted text' } },
      replies: [{ id: 'r1', author: 'other', comment: 'first reply', created_at: '' }],
    }
    setup([ann], 'edit')
    const { getByText } = render(<AnnotationModal annotationOps={makeOps()} />)
    expect(getByText('quoted text')).toBeTruthy()
    expect(getByText('first reply')).toBeTruthy()
  })

  it('clicking backdrop with empty draft closes modal', () => {
    const ann = { id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'c', selectors: { quote: { exact: 'q' } }, replies: [] }
    setup([ann], 'reply')
    const { container } = render(<AnnotationModal annotationOps={makeOps()} />)
    fireEvent.click(container.querySelector('.annotation-modal__backdrop'))
    expect(modalAnnotationId.value).toBe(null)
  })

  it('ESC closes modal', () => {
    const ann = { id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'c', selectors: { quote: { exact: 'q' } }, replies: [] }
    setup([ann], 'edit')
    render(<AnnotationModal annotationOps={makeOps()} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(modalAnnotationId.value).toBe(null)
  })

  it('dirty reply textarea prompts confirm on backdrop click', () => {
    const ann = { id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'c', selectors: { quote: { exact: 'q' } }, replies: [] }
    setup([ann], 'reply')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = render(<AnnotationModal annotationOps={makeOps()} />)
    const ta = container.querySelector('.annotation-modal__footer textarea')
    fireEvent.input(ta, { target: { value: 'half-written' } })
    fireEvent.click(container.querySelector('.annotation-modal__backdrop'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(modalAnnotationId.value).toBe('a1')
    confirmSpy.mockRestore()
  })

  it('Ctrl+Enter in footer calls addReply and clears draft', () => {
    const ann = { id: 'a1', tag: 'question', status: 'open', author: 'me', comment: 'c', selectors: { quote: { exact: 'q' } }, replies: [] }
    setup([ann], 'reply')
    const ops = makeOps()
    const { container } = render(<AnnotationModal annotationOps={ops} />)
    const ta = container.querySelector('.annotation-modal__footer textarea')
    fireEvent.input(ta, { target: { value: 'my reply' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(ops.addReply).toHaveBeenCalledWith('a1', 'my reply')
  })
})

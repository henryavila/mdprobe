import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { ReplyItem } from '../../src/ui/components/ReplyItem.jsx'

afterEach(() => cleanup())

const reply = {
  id: 'r1', author: 'alice', comment: 'hello', created_at: '2026-04-24T10:00:00Z',
}

describe('ReplyItem', () => {
  it('renders author and comment', () => {
    const { getByText } = render(<ReplyItem reply={reply} canEdit={true} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(getByText('alice')).toBeTruthy()
    expect(getByText('hello')).toBeTruthy()
  })

  it('hides Edit/Delete when canEdit is false', () => {
    const { container } = render(<ReplyItem reply={reply} canEdit={false} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(container.querySelector('.reply__actions')).toBeNull()
  })

  it('clicking Edit switches to inline form and Save calls onEdit', () => {
    const onEdit = vi.fn()
    const { getByText, container } = render(<ReplyItem reply={reply} canEdit={true} onEdit={onEdit} onDelete={vi.fn()} />)
    fireEvent.click(getByText('Edit'))
    const ta = container.querySelector('textarea')
    expect(ta.value).toBe('hello')
    fireEvent.input(ta, { target: { value: 'updated' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(onEdit).toHaveBeenCalledWith('r1', 'updated')
  })

  it('clicking Delete prompts and calls onDelete on confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDelete = vi.fn()
    const { getByText } = render(<ReplyItem reply={reply} canEdit={true} onEdit={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(getByText('Delete'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(onDelete).toHaveBeenCalledWith('r1')
    confirmSpy.mockRestore()
  })
})

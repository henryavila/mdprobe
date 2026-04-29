import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/preact'
import { ReplyList } from '../../src/ui/components/ReplyList.jsx'

afterEach(() => cleanup())

describe('ReplyList', () => {
  it('renders nothing when replies is empty', () => {
    const { container } = render(<ReplyList replies={[]} currentAuthor="me" onEditReply={vi.fn()} onDeleteReply={vi.fn()} />)
    expect(container.querySelector('.reply-list')).toBeNull()
  })

  it('renders the separator with count when replies exist', () => {
    const replies = [{ id: 'a', author: 'x', comment: 'hi', created_at: '' }]
    const { getByText } = render(<ReplyList replies={replies} currentAuthor="me" onEditReply={vi.fn()} onDeleteReply={vi.fn()} />)
    expect(getByText('Replies (1)')).toBeTruthy()
  })

  it('only exposes edit/delete to the reply author', () => {
    const replies = [
      { id: 'a', author: 'me', comment: 'mine' },
      { id: 'b', author: 'other', comment: 'theirs' },
    ]
    const { container } = render(<ReplyList replies={replies} currentAuthor="me" onEditReply={vi.fn()} onDeleteReply={vi.fn()} />)
    const items = container.querySelectorAll('[data-reply-id]')
    expect(items[0].querySelector('.reply__actions')).not.toBeNull()
    expect(items[1].querySelector('.reply__actions')).toBeNull()
  })
})

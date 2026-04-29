import { ReplyItem } from './ReplyItem.jsx'

export function ReplyList({ replies, currentAuthor, onEditReply, onDeleteReply }) {
  if (!replies || replies.length === 0) return null
  return (
    <div class="reply-list">
      <div class="reply-list__separator">Replies ({replies.length})</div>
      {replies.map(r => (
        <ReplyItem
          key={r.id}
          reply={r}
          canEdit={r.author === currentAuthor}
          onEdit={onEditReply}
          onDelete={onDeleteReply}
        />
      ))}
    </div>
  )
}

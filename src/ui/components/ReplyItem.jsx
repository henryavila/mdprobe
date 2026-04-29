import { useState } from 'preact/hooks'
import { AnnotationForm } from './AnnotationForm.jsx'

export function ReplyItem({ reply, canEdit, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div class="reply reply--editing">
        <AnnotationForm
          mode="reply"
          annotation={reply}
          onSave={({ comment }) => { onEdit(reply.id, comment); setEditing(false) }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div class="reply" data-reply-id={reply.id}>
      <div class="reply__head">
        <span class="reply__author">{reply.author}</span>
        <span class="reply__time">{formatTime(reply.created_at)}</span>
        {canEdit && (
          <span class="reply__actions">
            <button type="button" class="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" class="btn btn--danger btn--sm" onClick={() => {
              if (window.confirm('Delete this reply?')) onDelete(reply.id)
            }}>Delete</button>
          </span>
        )}
      </div>
      <div class="reply__body">{reply.comment}</div>
    </div>
  )
}

function formatTime(isoString) {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch { return isoString }
}

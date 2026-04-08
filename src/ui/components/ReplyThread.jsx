export function ReplyThread({ replies }) {
  if (!replies || replies.length === 0) return null

  return (
    <div style="margin-top: 8px">
      {replies.map((reply, i) => (
        <div key={i} class="reply">
          <div class="author">{reply.author}</div>
          <div class="text">{reply.comment}</div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px">
            {formatTime(reply.created_at)}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatTime(isoString) {
  if (!isoString) return ''
  try {
    const date = new Date(isoString)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
           ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return isoString
  }
}

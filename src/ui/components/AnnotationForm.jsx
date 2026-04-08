import { useState } from 'preact/hooks'

const TAGS = [
  { value: 'question', label: 'Question' },
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'nitpick', label: 'Nitpick' },
]

export function AnnotationForm({ annotation, selectors, exact, onSave, onCancel }) {
  const isEdit = !!annotation
  const [comment, setComment] = useState(annotation?.comment || '')
  const [tag, setTag] = useState(annotation?.tag || 'question')

  function handleSubmit(e) {
    e.preventDefault()
    if (!comment.trim()) return

    if (isEdit) {
      onSave({ comment: comment.trim(), tag })
    } else {
      onSave({ selectors, comment: comment.trim(), tag })
    }
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit(e)
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <form class="annotation-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown} onClick={e => e.stopPropagation()}>
      {exact && (
        <div class="annotation-form__quote">
          {exact}
        </div>
      )}

      <div class="annotation-form__tags">
        {TAGS.map(t => (
          <button
            key={t.value}
            type="button"
            class={`tag-pill tag-pill--${t.value}${tag === t.value ? ' tag-pill--active' : ''}`}
            onClick={() => setTag(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onInput={e => setComment(e.target.value)}
        placeholder="Add your comment... (Ctrl+Enter to save)"
        autoFocus
      />

      <div class="annotation-form__actions">
        <span class="annotation-form__hint">Ctrl+Enter to save · Esc to close</span>
        <button type="button" class="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" class="btn btn--primary" disabled={!comment.trim()}>
          {isEdit ? 'Save' : 'Annotate'}
        </button>
      </div>
    </form>
  )
}

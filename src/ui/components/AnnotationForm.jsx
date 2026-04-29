import { useState, useRef, useEffect } from 'preact/hooks'

const TAGS = [
  { value: 'question', label: 'Question' },
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'nitpick', label: 'Nitpick' },
]

export function AnnotationForm({
  mode = 'create',
  annotation = null,
  selectors = null,
  exact = null,
  onSave,
  onCancel,
}) {
  const isEdit = mode === 'edit'
  const isReply = mode === 'reply'
  const [comment, setComment] = useState(annotation?.comment || '')
  const [tag, setTag] = useState(annotation?.tag || 'question')
  const textareaRef = useRef(null)

  useEffect(() => {
    window.getSelection()?.removeAllRanges()
    textareaRef.current?.focus()
  }, [])

  function handleSubmit(e) {
    e?.preventDefault?.()
    if (!comment.trim()) return
    if (isReply) onSave({ comment: comment.trim() })
    else if (isEdit) onSave({ comment: comment.trim(), tag })
    else onSave({ selectors, comment: comment.trim(), tag })
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit(e)
    if (e.key === 'Escape') onCancel()
  }

  return (
    <form class={`annotation-form annotation-form--${mode}`} onSubmit={handleSubmit} onKeyDown={handleKeyDown} onClick={e => e.stopPropagation()}>
      {!isReply && exact && (
        <div class="annotation-form__quote">{exact}</div>
      )}

      {!isReply && (
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
      )}

      <textarea
        ref={textareaRef}
        value={comment}
        onInput={e => setComment(e.target.value)}
        placeholder={isReply ? 'Write a reply... (Ctrl+Enter to send)' : 'Add your comment... (Ctrl+Enter to save)'}
      />

      <div class="annotation-form__actions">
        <span class="annotation-form__hint">Ctrl+Enter · Esc</span>
        <button type="button" class="btn btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" class="btn btn--primary" disabled={!comment.trim()}>
          {isReply ? 'Send' : isEdit ? 'Save' : 'Annotate'}
        </button>
      </div>
    </form>
  )
}

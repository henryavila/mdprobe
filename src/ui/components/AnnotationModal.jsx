import { useEffect, useRef, useState } from 'preact/hooks'
import { annotations, modalAnnotationId, modalOpenMode, author, closeAnnotationModal } from '../state/store.js'
import { AnnotationForm } from './AnnotationForm.jsx'
import { ReplyList } from './ReplyList.jsx'

export function AnnotationModal({ annotationOps }) {
  const id = modalAnnotationId.value
  if (!id) return null
  const ann = annotations.value.find(a => a.id === id)
  if (!ann) return null
  return <AnnotationModalDialog ann={ann} annotationOps={annotationOps} />
}

function AnnotationModalDialog({ ann, annotationOps }) {
  const mode = modalOpenMode.value
  const [editingRoot, setEditingRoot] = useState(mode === 'edit')
  const [draft, setDraft] = useState('')
  const footerTextareaRef = useRef(null)
  const lastFocusRef = useRef(null)

  useEffect(() => {
    lastFocusRef.current = document.activeElement
    function onKey(e) { if (e.key === 'Escape') tryClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      lastFocusRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    if (mode === 'reply') footerTextareaRef.current?.focus?.()
  }, [mode])

  function tryClose() {
    if (draft.trim() && !window.confirm('Discard draft?')) return
    closeAnnotationModal()
  }

  function handleBackdropClick(e) {
    if (e.target.classList.contains('annotation-modal__backdrop')) tryClose()
  }

  function handleSaveRoot({ comment, tag }) {
    annotationOps.updateAnnotation(ann.id, { comment, tag })
    setEditingRoot(false)
  }

  function handleSendReply() {
    const text = draft.trim()
    if (!text) return
    annotationOps.addReply(ann.id, text)
    setDraft('')
  }

  function handleKeyDownFooter(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSendReply()
  }

  const isAuthor = ann.author === author.value

  return (
    <div class="annotation-modal__backdrop" onClick={handleBackdropClick}>
      <div class="annotation-modal" role="dialog" aria-modal="true">
        <header class="annotation-modal__header">
          <span class="annotation-modal__title">
            Discussion · <span class="annotation-modal__author">{ann.author}</span>
            <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
          </span>
          <button type="button" class="btn btn--ghost" aria-label="Close" onClick={tryClose}>×</button>
        </header>

        <div class="annotation-modal__body">
          {ann.selectors?.quote?.exact && (
            <div class="annotation-modal__quote">{ann.selectors.quote.exact}</div>
          )}

          <section class="annotation-modal__root">
            <div class="annotation-modal__root-head">
              <span>{ann.author}</span>
              {isAuthor && !editingRoot && (
                <button type="button" class="btn btn--ghost btn--sm" onClick={() => setEditingRoot(true)}>Edit</button>
              )}
            </div>
            {editingRoot ? (
              <AnnotationForm
                mode="edit"
                annotation={ann}
                onSave={handleSaveRoot}
                onCancel={() => setEditingRoot(false)}
              />
            ) : (
              <div class="annotation-modal__root-body">{ann.comment}</div>
            )}
          </section>

          <ReplyList
            replies={ann.replies || []}
            currentAuthor={author.value}
            onEditReply={annotationOps.editReply}
            onDeleteReply={annotationOps.deleteReply}
          />
        </div>

        <footer class="annotation-modal__footer">
          <textarea
            ref={footerTextareaRef}
            value={draft}
            onInput={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDownFooter}
            placeholder="Write a reply... (Ctrl+Enter to send)"
          />
          <button type="button" class="btn btn--primary" disabled={!draft.trim()} onClick={handleSendReply}>
            Send
          </button>
        </footer>
      </div>
    </div>
  )
}

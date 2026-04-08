import { useState } from 'preact/hooks'
import { rightPanelOpen, filteredAnnotations, selectedAnnotationId, showResolved,
         filterTag, filterAuthor, uniqueTags, uniqueAuthors, openAnnotations } from '../state/store.js'
import { AnnotationForm } from './AnnotationForm.jsx'
import { ReplyThread } from './ReplyThread.jsx'

export function RightPanel({ annotationOps }) {
  const isCollapsed = !rightPanelOpen.value
  const [editingId, setEditingId] = useState(null)

  function handleAnnotationClick(ann) {
    selectedAnnotationId.value = ann.id
    // Scroll to highlight in content
    const highlight = document.querySelector(`[data-highlight-id="${ann.id}"]`)
    highlight?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <aside class={`right-panel ${isCollapsed ? 'collapsed' : ''}`}>
      {isCollapsed ? (
        <div class="panel-collapsed-indicator" onClick={() => rightPanelOpen.value = true}>
          <span>💬</span>
          <span class="shortcut-key">]</span>
          {openAnnotations.value.length > 0 && (
            <span class="badge">{openAnnotations.value.length}</span>
          )}
        </div>
      ) : (
        <div class="panel-content">
          {/* Header */}
          <div class="panel-header" style="padding: 12px; display: flex; justify-content: space-between; align-items: center">
            <span style="font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted)">
              Annotations ({openAnnotations.value.length} open)
            </span>
            <button class="btn btn-sm btn-ghost" onClick={() => rightPanelOpen.value = false}>×</button>
          </div>

          {/* Filters */}
          <div style="padding: 0 12px 8px; display: flex; gap: 6px; flex-wrap: wrap">
            <select
              class="filter-select"
              value={filterTag.value || ''}
              onChange={e => filterTag.value = e.target.value || null}
              style="padding: 3px 6px; font-size: 11px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary)"
            >
              <option value="">All tags</option>
              {uniqueTags.value.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <select
              value={filterAuthor.value || ''}
              onChange={e => filterAuthor.value = e.target.value || null}
              style="padding: 3px 6px; font-size: 11px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary)"
            >
              <option value="">All authors</option>
              {uniqueAuthors.value.map(a => <option key={a} value={a}>{a}</option>)}
            </select>

            <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); cursor: pointer">
              <input type="checkbox" checked={showResolved.value} onChange={e => showResolved.value = e.target.checked} />
              Show resolved
            </label>
          </div>

          {/* Annotation list */}
          <div style="overflow-y: auto; padding: 0 8px; flex: 1">
            {filteredAnnotations.value.length === 0 ? (
              <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px">
                No annotations
              </div>
            ) : (
              filteredAnnotations.value.map(ann => (
                <div
                  key={ann.id}
                  data-annotation-id={ann.id}
                  class={`annotation-card ${selectedAnnotationId.value === ann.id ? 'selected' : ''} ${ann.status === 'resolved' ? 'resolved' : ''}`}
                  onClick={() => handleAnnotationClick(ann)}
                >
                  {/* Tag + Author + Time */}
                  <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px">
                    <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
                    <span style="font-size: 11px; color: var(--text-muted)">{ann.author}</span>
                    {ann.status === 'resolved' && <span style="font-size: 10px; color: var(--status-approved)">✓ resolved</span>}
                  </div>

                  {/* Quote */}
                  {ann.selectors?.quote?.exact && (
                    <div class="quote">{ann.selectors.quote.exact}</div>
                  )}

                  {/* Comment */}
                  <div style="font-size: 13px; margin-top: 4px">{ann.comment}</div>

                  {/* Actions (when selected) */}
                  {selectedAnnotationId.value === ann.id && (
                    <div style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap">
                      {ann.status === 'open' ? (
                        <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); annotationOps.resolveAnnotation(ann.id) }}>
                          Resolve
                        </button>
                      ) : (
                        <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); annotationOps.reopenAnnotation(ann.id) }}>
                          Reopen
                        </button>
                      )}
                      <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); setEditingId(ann.id) }}>
                        Edit
                      </button>
                      <button class="btn btn-sm btn-danger" onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('Delete this annotation?')) annotationOps.deleteAnnotation(ann.id)
                      }}>
                        Delete
                      </button>
                    </div>
                  )}

                  {/* Edit form */}
                  {editingId === ann.id && (
                    <AnnotationForm
                      annotation={ann}
                      onSave={(data) => {
                        annotationOps.updateAnnotation(ann.id, data)
                        setEditingId(null)
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  )}

                  {/* Replies */}
                  {ann.replies?.length > 0 && (
                    <ReplyThread replies={ann.replies} />
                  )}

                  {/* Reply input (when selected) */}
                  {selectedAnnotationId.value === ann.id && (
                    <ReplyInput annotationId={ann.id} onReply={annotationOps.addReply} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

function ReplyInput({ annotationId, onReply }) {
  const [text, setText] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (text.trim()) {
      onReply(annotationId, text.trim())
      setText('')
    }
  }

  return (
    <form class="reply-input" onSubmit={handleSubmit} onClick={e => e.stopPropagation()}>
      <input
        type="text"
        value={text}
        onInput={e => setText(e.target.value)}
        placeholder="Reply..."
      />
      <button type="submit" class="btn btn-sm btn-primary" disabled={!text.trim()}>Reply</button>
    </form>
  )
}

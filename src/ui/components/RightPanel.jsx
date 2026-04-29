import { useState } from 'preact/hooks'
import { rightPanelOpen, filteredAnnotations, selectedAnnotationId, showResolved,
         filterTag, filterAuthor, uniqueTags, uniqueAuthors, openAnnotations,
         anchoredAnnotations, orphanedAnnotations, driftWarning, openAnnotationModal,
         driftedAnnotations, orphanedAnnotationsV2, liveAnchors } from '../state/store.js'

export function RightPanel({ annotationOps }) {
  const isCollapsed = !rightPanelOpen.value

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
              Annotations ({openAnnotations.value.length} open
              {driftedAnnotations.value.length > 0 && ` · ${driftedAnnotations.value.length} drifted`}
              {orphanedAnnotationsV2.value.length > 0 && ` · ${orphanedAnnotationsV2.value.length} orphan`})
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
            {anchoredAnnotations.value.length === 0 && orphanedAnnotations.value.length === 0 &&
             driftedAnnotations.value.length === 0 && orphanedAnnotationsV2.value.length === 0 ? (
              <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px">
                No annotations
              </div>
            ) : (
              <>
                {anchoredAnnotations.value.length === 0 && orphanedAnnotations.value.length === 0 && filteredAnnotations.value.length > 0 ? (
                  <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px">
                    No annotations
                  </div>
                ) : (
                  anchoredAnnotations.value.map(ann => (
                    <AnnotationCard
                      key={ann.id}
                      ann={ann}
                      isSelected={selectedAnnotationId.value === ann.id}
                      onClick={() => handleAnnotationClick(ann)}
                      annotationOps={annotationOps}
                    />
                  ))
                )}

                {driftWarning.value && orphanedAnnotations.value.length > 0 && (
                  <OrphanedSection
                    annotations={orphanedAnnotations.value}
                    selectedAnnotationId={selectedAnnotationId.value}
                    onSelect={(ann) => { selectedAnnotationId.value = ann.id }}
                    annotationOps={annotationOps}
                  />
                )}

                {driftedAnnotations.value.length > 0 && (
                  <DriftedSection annotations={driftedAnnotations.value} annotationOps={annotationOps} />
                )}
                {orphanedAnnotationsV2.value.length > 0 && (
                  <OrphanV2Section annotations={orphanedAnnotationsV2.value} annotationOps={annotationOps} />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

function AnnotationCard({ ann, isSelected, onClick, annotationOps, orphaned = false }) {
  return (
    <div
      data-annotation-id={ann.id}
      class={`annotation-card ${isSelected ? 'selected' : ''} ${ann.status === 'resolved' ? 'resolved' : ''} ${orphaned ? 'orphaned' : ''}`}
      onClick={onClick}
    >
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px">
        <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
        <span style="font-size: 11px; color: var(--text-muted)">{ann.author}</span>
        {ann.status === 'resolved' && <span style="font-size: 10px; color: var(--status-approved)">✓ resolved</span>}
        {orphaned && <span style="font-size: 10px; color: var(--tag-bug)">not found</span>}
        {ann.replies?.length > 0 && (
          <span style="font-size: 10px; color: var(--text-muted); margin-left: auto">
            {ann.replies.length} {ann.replies.length === 1 ? 'reply' : 'replies'}
          </span>
        )}
      </div>

      {ann.selectors?.quote?.exact && (
        <div class="quote">{ann.selectors.quote.exact}</div>
      )}

      <div style="font-size: 13px; margin-top: 4px">{ann.comment}</div>

      {isSelected && (
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
          <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); openAnnotationModal(ann.id, 'edit') }}>
            Edit
          </button>
          <button class="btn btn-sm" onClick={(e) => { e.stopPropagation(); openAnnotationModal(ann.id, 'reply') }}>
            Reply
          </button>
          <button class="btn btn-sm btn-danger" onClick={(e) => {
            e.stopPropagation()
            if (confirm('Delete this annotation?')) annotationOps.deleteAnnotation(ann.id)
          }}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function OrphanedSection({ annotations, selectedAnnotationId, onSelect, annotationOps }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div class="orphaned-section">
      <div class="orphaned-section-header" onClick={() => setCollapsed(c => !c)}>
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>Not found ({annotations.length})</span>
      </div>
      {!collapsed && annotations.map(ann => (
        <AnnotationCard
          key={ann.id}
          ann={ann}
          isSelected={selectedAnnotationId === ann.id}
          onClick={() => onSelect(ann)}
          annotationOps={annotationOps}
          orphaned
        />
      ))}
    </div>
  )
}

function DriftedSection({ annotations, annotationOps }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div class="orphaned-section drifted-section">
      <div class="orphaned-section-header" onClick={() => setCollapsed(c => !c)}>
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>Drifted ({annotations.length}) — texto pode ter mudado</span>
      </div>
      {!collapsed && annotations.map(ann => (
        <div key={ann.id} class="annotation-card drifted">
          <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
          <span style="margin-left: 6px; font-size: 11px;">{ann.author}</span>
          <div class="quote">{ann.quote?.exact}</div>
          <div style="font-size: 13px; margin-top: 4px">{ann.comment}</div>
          <div style="margin-top: 6px; display: flex; gap: 6px">
            <button class="btn btn-sm" onClick={() => {
              const live = liveAnchors.value[ann.id]
              if (live) annotationOps.acceptDrift(ann.id, live.range, live.contextHash)
            }}>Aceitar nova localização</button>
            <button class="btn btn-sm btn-danger" onClick={() => {
              if (confirm('Descartar esta anotação?')) annotationOps.deleteAnnotation(ann.id)
            }}>Descartar</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function OrphanV2Section({ annotations, annotationOps }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div class="orphaned-section">
      <div class="orphaned-section-header" onClick={() => setCollapsed(c => !c)}>
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>Não localizadas ({annotations.length})</span>
      </div>
      {!collapsed && annotations.map(ann => (
        <div key={ann.id} class="annotation-card orphaned">
          <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
          <span style="margin-left: 6px; font-size: 11px;">{ann.author}</span>
          <blockquote class="quote">{ann.quote?.exact || '(quote missing)'}</blockquote>
          <div style="font-size: 13px; margin-top: 4px">{ann.comment}</div>
          <div style="margin-top: 6px; display: flex; gap: 6px">
            <button class="btn btn-sm btn-danger" onClick={() => {
              if (confirm('Descartar esta anotação órfã?')) annotationOps.deleteAnnotation(ann.id)
            }}>Descartar</button>
          </div>
        </div>
      ))}
    </div>
  )
}


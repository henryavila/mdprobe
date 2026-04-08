import { leftPanelOpen, files, currentFile, currentToc, openAnnotations, sections } from '../state/store.js'

export function LeftPanel({ onFileSelect }) {
  const isCollapsed = !leftPanelOpen.value

  // Count open annotations whose startLine falls within this section's range
  function annotationsInSection(sectionIndex) {
    const toc = currentToc.value
    const section = toc[sectionIndex]
    if (!section) return 0
    const startLine = section.line
    // End line is the start of the next same-or-higher level section, or Infinity
    let endLine = Infinity
    for (let i = sectionIndex + 1; i < toc.length; i++) {
      if (toc[i].level <= section.level) {
        endLine = toc[i].line
        break
      }
    }
    return openAnnotations.value.filter(a => {
      const line = a.selectors?.position?.startLine
      return line != null && line >= startLine && line < endLine
    }).length
  }

  return (
    <aside class={`left-panel ${isCollapsed ? 'collapsed' : ''}`}>
      {isCollapsed ? (
        <div class="panel-collapsed-indicator" onClick={() => leftPanelOpen.value = true}>
          <span>&#9776;</span>
          <span class="shortcut-key">[</span>
          {openAnnotations.value.length > 0 && (
            <span class="badge">{openAnnotations.value.length}</span>
          )}
        </div>
      ) : (
        <div class="panel-content">
          <div class="panel-header" style="padding: 12px; display: flex; justify-content: space-between; align-items: center">
            <span style="font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted)">
              Files & TOC
            </span>
            <button class="btn btn-sm btn-ghost" onClick={() => leftPanelOpen.value = false}>&times;</button>
          </div>

          {/* Files section */}
          {files.value.length > 1 && (
            <div style="padding: 0 8px 8px">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); padding: 4px 4px 6px; font-weight: 600">Files</div>
              {files.value.map(f => {
                const path = f.path || f
                const label = f.label || path.replace('.md', '')
                const isActive = path === currentFile.value
                return (
                  <div
                    key={path}
                    class={`file-item ${isActive ? 'active' : ''}`}
                    onClick={() => onFileSelect(path)}
                  >
                    <span class="icon">{'\uD83D\uDCC4'}</span>
                    <span>{label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* TOC section */}
          <div style="padding: 0 8px">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); padding: 4px 4px 6px; font-weight: 600">Sections</div>
            {currentToc.value.length === 0 ? (
              <div style="padding: 8px; color: var(--text-muted); font-size: 13px">No sections</div>
            ) : (
              currentToc.value.map((entry, i) => {
                const count = annotationsInSection(i)
                const sec = sections.value.find(s => s.heading === entry.heading && s.level === entry.level)
                const statusDot = sec?.status === 'approved' ? 'dot-approved'
                  : sec?.status === 'rejected' ? 'dot-rejected' : ''
                return (
                  <div
                    key={i}
                    class={`toc-item level-${entry.level}`}
                    onClick={() => {
                      const el = document.querySelector(`[data-source-line="${entry.line}"]`)
                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                  >
                    {statusDot && <span class={`toc-dot ${statusDot}`} />}
                    {entry.heading}
                    {count > 0 && <span class="badge" style="margin-left: 6px">{count}</span>}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

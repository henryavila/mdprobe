import { useState } from 'preact/hooks'
import { currentFile } from '../state/store.js'

export function ExportMenu() {
  const [open, setOpen] = useState(false)

  async function handleExport(format) {
    setOpen(false)
    const file = currentFile.value
    if (!file) return

    try {
      const res = await fetch(`/api/export?path=${encodeURIComponent(file)}&format=${format}`)
      if (!res.ok) throw new Error(await res.text())

      if (format === 'report') {
        // Open in new tab
        const text = await res.text()
        const blob = new Blob([text], { type: 'text/markdown' })
        window.open(URL.createObjectURL(blob))
      } else {
        // Download file
        const blob = await res.blob()
        const ext = { inline: '.reviewed.md', json: '.annotations.json', sarif: '.annotations.sarif' }[format]
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = file.replace('.md', ext)
        a.click()
      }
    } catch (err) {
      console.error('Export failed:', err)
      alert(`Export failed: ${err.message}`)
    }
  }

  return (
    <div style="position: relative">
      <button class="btn btn-sm" onClick={() => setOpen(!open)}>
        Export
      </button>
      {open && (
        <>
          <div style="position: fixed; inset: 0; z-index: 90" onClick={() => setOpen(false)} />
          <div style="position: absolute; right: 0; top: 100%; margin-top: 4px; z-index: 100; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); min-width: 180px; overflow: hidden">
            <button class="export-option" onClick={() => handleExport('report')}>
              Review Report (.md)
            </button>
            <button class="export-option" onClick={() => handleExport('inline')}>
              Inline Comments (.md)
            </button>
            <button class="export-option" onClick={() => handleExport('json')}>
              JSON (.json)
            </button>
            <button class="export-option" onClick={() => handleExport('sarif')}>
              SARIF (.sarif)
            </button>
          </div>
        </>
      )}
    </div>
  )
}

import { render } from 'preact'
import { useState, useEffect, useCallback } from 'preact/hooks'
import { useWebSocket } from './hooks/useWebSocket.js'
import { useKeyboard } from './hooks/useKeyboard.js'
import { useTheme } from './hooks/useTheme.js'
import { useAnnotations } from './hooks/useAnnotations.js'
import { useClientLibs } from './hooks/useClientLibs.js'
import { files, currentFile, currentHtml, currentToc, author, reviewMode,
         leftPanelOpen, rightPanelOpen, openAnnotations, sectionStats, driftWarning,
         orphanedAnnotations } from './state/store.js'
import { LeftPanel } from './components/LeftPanel.jsx'
import { RightPanel } from './components/RightPanel.jsx'
import { Content } from './components/Content.jsx'
import { ThemePicker } from './components/ThemePicker.jsx'
import { ExportMenu } from './components/ExportMenu.jsx'
import './styles/themes.css'

function App() {
  const [showHelp, setShowHelp] = useState(false)
  const ws = useWebSocket()
  const { setTheme, themes } = useTheme()
  const annotationOps = useAnnotations()
  useClientLibs()

  useKeyboard({ onShowHelp: () => setShowHelp(v => !v) })

  // Close help modal on Escape
  useEffect(() => {
    if (!showHelp) return
    function handleEsc(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowHelp(false)
      }
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [showHelp])

  // Fetch initial data
  useEffect(() => {
    fetch('/api/files').then(r => r.json()).then(data => {
      files.value = data
      if (data.length === 0) return

      // Deep link: check if URL pathname matches a file
      const pathname = window.location.pathname
      let target = null
      if (pathname && pathname !== '/') {
        const cleaned = pathname.replace(/^\//, '')
        target = data.find(f => {
          const fp = f.path || f
          return fp === cleaned ||
            fp === cleaned.split('/').pop() ||
            (f.absPath && f.absPath.endsWith('/' + cleaned))
        })
      }

      const selected = target ? (target.path || target) : (data[0].path || data[0])
      handleFileSelect(selected)
    })

    fetch('/api/config').then(r => r.json()).then(data => {
      author.value = data.author || 'anonymous'
    })

    // Check review mode
    fetch('/api/review/status').then(r => r.json()).then(data => {
      if (data.mode === 'once') reviewMode.value = true
    }).catch(() => {})
  }, [])

  function handleFileSelect(filePath) {
    currentFile.value = filePath
    fetch(`/api/file?path=${encodeURIComponent(filePath)}`).then(r => r.json()).then(d => {
      currentHtml.value = d.html
      currentToc.value = d.toc || []
    })
    annotationOps.fetchAnnotations(filePath)
  }

  return (
    <>
      {/* Header */}
      <header class="header">
        <h1>mdProbe</h1>
        <span class="header-file">{currentFile.value || 'No file selected'}</span>
        <div style="flex: 1" />
        {sectionStats.value.total > 0 && (reviewMode.value || sectionStats.value.reviewed > 0) && (
          <div class="progress-info">
            <span>{sectionStats.value.reviewed}/{sectionStats.value.total} sections reviewed</span>
            <div class="progress-bar" style="width: 100px">
              <div class="fill" style={`width: ${(sectionStats.value.reviewed / sectionStats.value.total) * 100}%`} />
            </div>
          </div>
        )}
        <ExportMenu />
        <ThemePicker themes={themes} onSelect={setTheme} />
        {reviewMode.value && <button class="btn btn-primary btn-sm" onClick={async () => {
          try {
            await fetch('/api/review/finish', { method: 'POST' })
          } catch { /* server will close */ }
        }}>Finish Review</button>}
      </header>

      {/* Drift warning banner */}
      {driftWarning.value && (
        <div class="drift-banner">
          {orphanedAnnotations.value.length > 0
            ? `File modified — ${orphanedAnnotations.value.length} annotation(s) not found`
            : 'File modified since last review. Some annotations may be misaligned.'}
          <button class="btn btn-sm" style="margin-left: 8px" onClick={() => driftWarning.value = false}>Dismiss</button>
        </div>
      )}

      {/* Left Panel */}
      <LeftPanel onFileSelect={handleFileSelect} />

      {/* Content */}
      <Content annotationOps={annotationOps} />

      {/* Right Panel */}
      <RightPanel annotationOps={annotationOps} />

      {/* Status Bar */}
      <footer class="status-bar">
        <span>{openAnnotations.value.length} open</span>
        <span>Author: {author.value}</span>
        <span>Press ? for shortcuts</span>
      </footer>

      {/* Keyboard Shortcut Modal */}
      {showHelp && (
        <>
          <div class="shortcut-modal overlay" onClick={() => setShowHelp(false)} />
          <div class="shortcut-modal">
            <h3 style="margin-bottom: 12px">Keyboard Shortcuts</h3>
            {[
              ['[', 'Toggle left panel (Files/TOC)'],
              [']', 'Toggle right panel (Annotations)'],
              ['\\', 'Toggle both panels (focus mode)'],
              ['j', 'Next annotation'],
              ['k', 'Previous annotation'],
              ['r', 'Resolve selected annotation'],
              ['e', 'Edit selected annotation'],
              ['?', 'Show/hide this help'],
            ].map(([key, desc]) => (
              <div class="shortcut-row" key={key}>
                <span>{desc}</span>
                <span class="shortcut-key">{key}</span>
              </div>
            ))}
            <button class="btn btn-sm" style="margin-top: 12px" onClick={() => setShowHelp(false)}>Close</button>
          </div>
        </>
      )}
    </>
  )
}

render(<App />, document.getElementById('app'))

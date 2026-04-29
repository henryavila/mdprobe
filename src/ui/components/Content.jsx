import { useRef, useEffect, useState } from 'preact/hooks'
import { currentHtml, selectedAnnotationId, annotations, showResolved, sections,
         currentSource, currentMdast } from '../state/store.js'
import { Popover } from './Popover.jsx'
import { SectionApproval } from './SectionApproval.jsx'
import { createCssHighlightHighlighter } from '../highlighters/css-highlight-highlighter.js'
import { resolveClickedAnnotation } from '../click/resolver.js'
import { describe as describeRange } from '../../anchoring/v2/index.js'

export function Content({ annotationOps }) {
  const contentRef = useRef(null)
  const [popover, setPopover] = useState(null) // { x, y, selectors }
  const highlighterRef = useRef(null)
  if (!highlighterRef.current) highlighterRef.current = createCssHighlightHighlighter()

  // (A) Highlight sync — runs on annotations or content change
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const h = highlighterRef.current
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!el.isConnected) return
        h.sync(el, annotations.value, {
          source: currentSource.value,
          mdast: currentMdast.value,
        })
        h.setSelection(el, selectedAnnotationId.value)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [annotations.value, showResolved.value, currentHtml.value])

  // (B) Selection-only effect
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    highlighterRef.current.setSelection(el, selectedAnnotationId.value)
  }, [selectedAnnotationId.value])

  // (C) HTML reload — clear all
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    highlighterRef.current.clear(el)
  }, [currentHtml.value])

  // Inject SectionApproval buttons next to h2 headings
  useEffect(() => {
    const el = contentRef.current
    if (!el || sections.value.length === 0) return

    // Remove previous section-approval containers
    el.querySelectorAll('.section-approval-injected').forEach(n => n.remove())

    // Inject approval buttons on ALL heading levels that have a matching section
    el.querySelectorAll(':is(h1,h2,h3,h4,h5,h6)[data-source-line]').forEach(hEl => {
      const heading = hEl.textContent.trim()
      const section = sections.value.find(s => s.heading === heading)
      if (!section) return

      const computed = section.computed || section.status

      const container = document.createElement('span')
      container.className = 'section-approval-injected'

      const approveBtn = document.createElement('button')
      const approveClass = computed === 'approved' ? ' section-status approved'
        : computed === 'indeterminate' ? ' section-status indeterminate' : ''
      approveBtn.className = `btn btn-sm${approveClass}`
      approveBtn.textContent = computed === 'indeterminate' ? '\u2500' : '\u2713'
      approveBtn.title = computed === 'indeterminate' ? 'Partially approved — click to approve all' : 'Approve section'
      approveBtn.onclick = (e) => {
        e.stopPropagation()
        section.status === 'approved'
          ? annotationOps.resetSection(heading)
          : annotationOps.approveSection(heading)
      }

      const rejectBtn = document.createElement('button')
      rejectBtn.className = `btn btn-sm${computed === 'rejected' ? ' section-status rejected' : ''}`
      rejectBtn.textContent = '\u2717'
      rejectBtn.title = 'Reject section'
      rejectBtn.onclick = (e) => {
        e.stopPropagation()
        section.status === 'rejected'
          ? annotationOps.resetSection(heading)
          : annotationOps.rejectSection(heading)
      }

      const statusLabel = computed !== 'pending' ? computed : ''
      if (statusLabel) {
        const statusSpan = document.createElement('span')
        statusSpan.className = `section-status-label ${computed}`
        statusSpan.style.cssText = 'font-size: 10px; margin-left: 4px'
        statusSpan.textContent = statusLabel
        container.appendChild(statusSpan)
      }

      container.style.cssText = 'display: inline-flex; gap: 4px; margin-left: 8px; vertical-align: middle'
      container.insertBefore(rejectBtn, container.firstChild)
      container.insertBefore(approveBtn, container.firstChild)
      hEl.appendChild(container)
    })
  }, [currentHtml.value, sections.value])

  // Inject copy-to-clipboard buttons on code blocks
  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    // Remove previously injected toolbars
    el.querySelectorAll('.code-block-toolbar').forEach(n => n.remove())

    el.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code')
      if (!code) return
      // Skip mermaid and math blocks
      const classes = code.className || ''
      if (classes.includes('language-mermaid') || classes.includes('language-math')) return

      const toolbar = document.createElement('div')
      toolbar.className = 'code-block-toolbar'

      // Language label
      const langMatch = classes.match(/language-(\S+)/)
      if (langMatch) {
        const label = document.createElement('span')
        label.className = 'code-lang-label'
        label.textContent = langMatch[1]
        toolbar.appendChild(label)
      }

      // Copy button
      const btn = document.createElement('button')
      btn.className = 'copy-code-btn'
      btn.title = 'Copy code'
      btn.appendChild(createCopyIcon())

      btn.onclick = (e) => {
        e.stopPropagation()
        const text = code.textContent
        navigator.clipboard.writeText(text).then(() => {
          btn.classList.add('copied')
          btn.replaceChildren(createCheckIcon())
          setTimeout(() => {
            btn.classList.remove('copied')
            btn.replaceChildren(createCopyIcon())
          }, 2000)
        })
      }

      toolbar.appendChild(btn)
      pre.appendChild(toolbar)
    })
  }, [currentHtml.value])

  // ---------------------------------------------------------------------------
  // Copy-to-clipboard SVG icon helpers (DOM-only, no innerHTML)
  // ---------------------------------------------------------------------------
  function createCopyIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', '9'); rect.setAttribute('y', '9')
    rect.setAttribute('width', '13'); rect.setAttribute('height', '13')
    rect.setAttribute('rx', '2')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1')
    svg.append(rect, path)
    return svg
  }

  function createCheckIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
    polyline.setAttribute('points', '20 6 9 17 4 12')
    svg.appendChild(polyline)
    return svg
  }

  // Handle text selection for creating annotations
  function handleMouseUp(e) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.toString().trim() === '') return
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    let selectors
    try {
      selectors = describeRange(range, contentRef.current, currentSource.value, currentMdast.value)
    } catch {
      return
    }
    setPopover({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
      exact: selectors.quote.exact,
      selectors,
    })
  }

  // Click on annotation highlight -> select it (CSS Highlight API — no DOM marks)
  function handleContentClick(e) {
    const ann = resolveClickedAnnotation(e, contentRef.current, annotations.value)
    if (ann) {
      selectedAnnotationId.value = ann.id
    } else {
      selectedAnnotationId.value = null
    }
  }

  return (
    <main class="content-area-wrapper">
      <div
        class="content-area"
        ref={contentRef}
        onClick={handleContentClick}
        onMouseUp={handleMouseUp}
        dangerouslySetInnerHTML={{ __html: currentHtml.value || '' }}
      />

      {popover && (
        <Popover
          x={popover.x}
          y={popover.y}
          exact={popover.exact}
          selectors={popover.selectors}
          onSave={(data) => {
            annotationOps.createAnnotation(data)
            setPopover(null)
            window.getSelection()?.removeAllRanges()
          }}
          onCancel={() => {
            setPopover(null)
            window.getSelection()?.removeAllRanges()
          }}
        />
      )}
    </main>
  )
}

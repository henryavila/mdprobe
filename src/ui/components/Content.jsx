import { useRef, useEffect, useState } from 'preact/hooks'
import { currentHtml, selectedAnnotationId, annotations, showResolved } from '../state/store.js'
import { Popover } from './Popover.jsx'
import { SectionApproval } from './SectionApproval.jsx'
import { sections } from '../state/store.js'
import { getHighlighter } from '../highlighters/index.js'

export function Content({ annotationOps }) {
  const contentRef = useRef(null)
  const [popover, setPopover] = useState(null) // { x, y, selectors }
  const highlighterRef = useRef(null)
  const prevAnnsRef = useRef([])
  if (!highlighterRef.current) highlighterRef.current = getHighlighter()

  // (A) Highlight sync — diff-aware; does NOT depend on selection
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const h = highlighterRef.current
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        h.sync(el, annotations.value, {
          showResolved: showResolved.value,
          prevAnnotations: prevAnnsRef.current,
          selectedId: selectedAnnotationId.value,
        })
        prevAnnsRef.current = annotations.value
        h.setSelection(el, selectedAnnotationId.value)
      })
      return () => cancelAnimationFrame(raf2)
    })
    return () => cancelAnimationFrame(raf1)
  }, [annotations.value, showResolved.value])

  // (B) HTML changed — wipe prev snapshot so next sync rebuilds from scratch
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    highlighterRef.current.clear(el)
    prevAnnsRef.current = []
  }, [currentHtml.value])

  // (C) Selection — attribute-only, zero mark mutations
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    highlighterRef.current.setSelection(el, selectedAnnotationId.value)
  }, [selectedAnnotationId.value])

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

  /** Find the closest ancestor with data-source-line. */
  function findSourceLineParent(node, root) {
    let current = node.nodeType === 3 ? node.parentElement : node
    while (current && current !== root) {
      if (current.hasAttribute?.('data-source-line')) return current
      current = current.parentElement
    }
    return null
  }

  // Handle text selection for creating annotations
  function handleMouseUp(e) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
      return
    }

    const text = selection.toString()
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    // Find source line/column from data attributes
    const startNode = findSourceNode(range.startContainer)
    const endNode = findSourceNode(range.endContainer)

    if (startNode) {
      const startLine = parseInt(startNode.getAttribute('data-source-line'))
      const startCol = parseInt(startNode.getAttribute('data-source-col') || '1')
      const endLine = endNode ? parseInt(endNode.getAttribute('data-source-line')) : startLine

      // Calculate endColumn from the text content rather than relying on the
      // end element's data-source-col (which is the element's START column)
      let endCol
      const lines = text.split('\n')
      if (lines.length === 1) {
        endCol = startCol + text.length
      } else {
        // Multi-line: end column is the length of the last line + 1
        endCol = lines[lines.length - 1].length + 1
      }

      // Extract prefix/suffix from DOM context for disambiguation
      let prefix = ''
      let suffix = ''
      try {
        const prefixRange = document.createRange()
        prefixRange.setStart(startNode, 0)
        prefixRange.setEnd(range.startContainer, range.startOffset)
        prefix = prefixRange.toString().slice(-30)
      } catch { /* ignore range errors */ }
      try {
        const endEl = endNode || startNode
        const suffixRange = document.createRange()
        suffixRange.setStart(range.endContainer, range.endOffset)
        suffixRange.setEnd(endEl, endEl.childNodes.length)
        suffix = suffixRange.toString().slice(0, 30)
      } catch { /* ignore range errors */ }

      setPopover({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
        exact: text,
        selectors: {
          position: { startLine, startColumn: startCol, endLine, endColumn: endCol },
          quote: { exact: text, prefix, suffix }
        }
      })
    }
  }

  function findSourceNode(node) {
    let current = node.nodeType === 3 ? node.parentElement : node
    while (current && current !== contentRef.current) {
      if (current.hasAttribute?.('data-source-line')) return current
      current = current.parentElement
    }
    return null
  }

  // Click on annotation highlight -> select it
  function handleContentClick(e) {
    const highlight = e.target.closest('[data-highlight-id]')
    if (highlight) {
      selectedAnnotationId.value = highlight.getAttribute('data-highlight-id')
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

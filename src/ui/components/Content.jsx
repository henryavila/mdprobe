import { useRef, useEffect, useState } from 'preact/hooks'
import { currentHtml, selectedAnnotationId, annotations, showResolved } from '../state/store.js'
import { Popover } from './Popover.jsx'
import { SectionApproval } from './SectionApproval.jsx'
import { sections } from '../state/store.js'

export function Content({ annotationOps }) {
  const contentRef = useRef(null)
  const [popover, setPopover] = useState(null) // { x, y, selectors }
  const rafRef = useRef(null)

  // Inject annotation highlights into DOM after HTML renders.
  // Uses requestAnimationFrame to debounce rapid signal updates — multiple
  // annotations.value assignments (HTTP response + WS broadcast) collapse
  // into a single DOM manipulation pass per frame.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    // Cancel any pending highlight pass from a previous signal update
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    // Snapshot current values before the async rAF callback
    const currentAnns = annotations.value
    const currentShowResolved = showResolved.value
    const currentSelectedId = selectedAnnotationId.value

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      applyHighlights(el, currentAnns, currentShowResolved, currentSelectedId)
    })

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [currentHtml.value, annotations.value, showResolved.value, selectedAnnotationId.value])

  function applyHighlights(el, anns, resolved, selectedId) {
    // Remove previous highlights and normalize text nodes to prevent fragmentation
    el.querySelectorAll('mark[data-highlight-id]').forEach(mark => {
      const parent = mark.parentNode
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
      parent.removeChild(mark)
      parent.normalize()
    })

    // Get visible annotations
    const visibleAnns = resolved
      ? anns
      : anns.filter(a => a.status === 'open')

    for (const ann of visibleAnns) {
      const startLine = ann.selectors?.position?.startLine
      if (!startLine) continue

      const sourceEl = el.querySelector(`[data-source-line="${startLine}"]`)
      if (!sourceEl) continue

      const exact = ann.selectors?.quote?.exact
      if (!exact) continue

      const markClass = `annotation-highlight tag-${ann.tag}${ann.status === 'resolved' ? ' resolved' : ''}${selectedId === ann.id ? ' selected' : ''}`

      // Strategy 1: Try single-element exact match (fast path)
      if (trySingleElementHighlight(sourceEl, exact, ann.id, markClass)) continue

      // Strategy 2: Cross-element match — walk text nodes from sourceEl onwards
      const endLine = ann.selectors?.position?.endLine || startLine
      if (tryCrossElementHighlight(el, sourceEl, endLine, exact, ann.id, markClass)) continue

      // Strategy 3: Fallback — highlight all text in line range
      highlightLineRange(el, startLine, endLine, ann.id, markClass)
    }
  }

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

  // ---------------------------------------------------------------------------
  // Highlight helper functions
  // ---------------------------------------------------------------------------

  /** Try to highlight exact text within a single element. Returns true on success. */
  function trySingleElementHighlight(sourceEl, exact, id, className) {
    const walker = document.createTreeWalker(sourceEl, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(exact)
      if (idx === -1) continue
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + exact.length)
      const mark = document.createElement('mark')
      mark.setAttribute('data-highlight-id', id)
      mark.className = className
      try {
        range.surroundContents(mark)
      } catch {
        return false
      }
      return true
    }
    return false
  }

  /**
   * Highlight text that spans multiple elements.
   * Walk text nodes from sourceEl to endLine, concatenate, find match,
   * then wrap each matching portion in its own <mark>.
   */
  function tryCrossElementHighlight(contentEl, sourceEl, endLine, exact, id, className) {
    // Collect text nodes from sourceEl through endLine (skip whitespace-only nodes
    // that exist between block elements, e.g. \n between <ul> and <li>)
    const textNodes = []
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT)
    let node
    let collecting = false
    while ((node = walker.nextNode())) {
      if (!collecting && sourceEl.contains(node)) collecting = true
      if (!collecting) continue
      if (node.textContent.trim() === '') continue
      textNodes.push(node)
      // Stop after passing endLine element
      const parent = findSourceLineParent(node, contentEl)
      if (parent) {
        const line = parseInt(parent.getAttribute('data-source-line'))
        if (line > endLine) break
      }
    }
    if (textNodes.length === 0) return false

    // Build concatenated text with separator tracking
    // Browser selections across block elements include \n between them
    let concat = ''
    const nodeMap = [] // { node, startInConcat, endInConcat }
    for (let i = 0; i < textNodes.length; i++) {
      // Add a newline between text nodes from different block parents
      if (i > 0) {
        const prevParent = textNodes[i - 1].parentElement?.closest('[data-source-line]')
        const currParent = textNodes[i].parentElement?.closest('[data-source-line]')
        if (prevParent !== currParent) concat += '\n'
      }
      const start = concat.length
      concat += textNodes[i].textContent
      nodeMap.push({ node: textNodes[i], startInConcat: start, endInConcat: concat.length })
    }

    // Try exact match in the concatenated text
    let matchIdx = concat.indexOf(exact)

    // If not found, try with whitespace normalization
    if (matchIdx === -1) {
      const normalizedConcat = concat.replace(/\s+/g, ' ')
      const normalizedExact = exact.replace(/\s+/g, ' ')
      const normIdx = normalizedConcat.indexOf(normalizedExact)
      if (normIdx === -1) return false

      // Map normalized index back: highlight all nodes in range
      // Since normalization collapses whitespace, exact mapping is unreliable.
      // Fall back to highlighting all matching text nodes.
      for (const nm of nodeMap) {
        wrapTextNode(nm.node, 0, nm.node.textContent.length, id, className)
      }
      return true
    }

    const matchEnd = matchIdx + exact.length

    // Wrap matching portions in each text node
    for (const nm of nodeMap) {
      const overlapStart = Math.max(matchIdx, nm.startInConcat)
      const overlapEnd = Math.min(matchEnd, nm.endInConcat)
      if (overlapStart >= overlapEnd) continue

      const nodeStart = overlapStart - nm.startInConcat
      const nodeEnd = overlapEnd - nm.startInConcat
      wrapTextNode(nm.node, nodeStart, nodeEnd, id, className)
    }
    return true
  }

  /** Highlight all text nodes within elements between startLine and endLine. */
  function highlightLineRange(contentEl, startLine, endLine, id, className) {
    // Collect text nodes FIRST, then wrap — never mutate DOM during TreeWalker iteration
    const textNodes = []
    const els = contentEl.querySelectorAll('[data-source-line]')
    for (const e of els) {
      const line = parseInt(e.getAttribute('data-source-line'))
      if (line < startLine || line > endLine) continue
      // Skip nested elements with same data-source-line (parent already covers them)
      if (e.parentElement?.closest(`[data-source-line="${line}"]`)) continue
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        if (node.textContent.trim() === '') continue
        textNodes.push(node)
      }
    }
    for (const tn of textNodes) {
      wrapTextNode(tn, 0, tn.textContent.length, id, className)
    }
  }

  /** Wrap a portion of a text node in a <mark> element. */
  function wrapTextNode(textNode, start, end, id, className) {
    if (start >= end || start >= textNode.textContent.length) return
    try {
      const range = document.createRange()
      range.setStart(textNode, start)
      range.setEnd(textNode, Math.min(end, textNode.textContent.length))
      const mark = document.createElement('mark')
      mark.setAttribute('data-highlight-id', id)
      mark.className = className
      range.surroundContents(mark)
    } catch {
      // surroundContents can fail if range crosses element boundaries
    }
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
      const endCol = endNode ? parseInt(endNode.getAttribute('data-source-col') || '1') : startCol + text.length

      setPopover({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
        exact: text,
        selectors: {
          position: { startLine, startColumn: startCol, endLine, endColumn: endCol },
          quote: { exact: text, prefix: '', suffix: '' }
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

import { diffAnnotations } from '../diff/annotation-diff.js'

export function createMarkHighlighter() {
  return { sync, clear, setSelection }

  function sync(contentEl, annotations, { showResolved, prevAnnotations = [], selectedId = null }) {
    const { added, removed } = diffAnnotations(prevAnnotations, annotations, { showResolved })
    if (removed.length === 0 && added.length === 0) return

    if (removed.length > 0) removeMarks(contentEl, removed)
    if (added.length > 0) {
      const byId = new Map(annotations.map(a => [a.id, a]))
      for (const id of added) {
        const a = byId.get(id)
        if (a) injectMark(contentEl, a, selectedId)
      }
    }
  }

  function clear(contentEl) {
    const marks = contentEl.querySelectorAll('mark[data-highlight-id]')
    for (const mark of marks) unwrap(mark)
  }

  function setSelection(contentEl, annotationId) {
    const prev = contentEl.querySelectorAll('mark.is-selected')
    for (const m of prev) m.classList.remove('is-selected')
    if (annotationId == null) {
      contentEl.removeAttribute('data-selected')
      return
    }
    contentEl.setAttribute('data-selected', annotationId)
    const marks = contentEl.querySelectorAll(`mark[data-highlight-id="${CSS.escape(annotationId)}"]`)
    for (const m of marks) m.classList.add('is-selected')
  }
}

function removeMarks(contentEl, ids) {
  for (const id of ids) {
    const marks = contentEl.querySelectorAll(`mark[data-highlight-id="${CSS.escape(id)}"]`)
    for (const mark of marks) unwrap(mark)
  }
}

function unwrap(mark) {
  const parent = mark.parentNode
  if (!parent) return
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
  parent.removeChild(mark)
}

function injectMark(contentEl, ann, selectedId) {
  const startLine = ann.selectors?.position?.startLine
  if (!startLine) return
  const sourceEl = contentEl.querySelector(`[data-source-line="${startLine}"]`)
  if (!sourceEl) return
  const exact = ann.selectors?.quote?.exact
  if (!exact) return

  const selClass = selectedId === ann.id ? ' is-selected' : ''
  const markClass = `annotation-highlight tag-${ann.tag}${ann.status === 'resolved' ? ' resolved' : ''}${selClass}`

  if (trySingleElement(sourceEl, exact, ann.id, markClass)) return
  const endLine = ann.selectors?.position?.endLine || startLine
  if (tryCrossElement(contentEl, sourceEl, endLine, exact, ann.id, markClass)) return
  highlightLineRange(contentEl, startLine, endLine, ann.id, markClass)
}

function collectTextNodes(root, result) {
  for (const child of root.childNodes) {
    if (child.nodeType === 3) {
      if (child.textContent.trim() !== '') result.push(child)
    } else if (child.nodeType === 1) {
      collectTextNodes(child, result)
    }
  }
}

function trySingleElement(sourceEl, exact, id, className) {
  const textNodes = []
  collectTextNodes(sourceEl, textNodes)
  for (const node of textNodes) {
    const idx = node.textContent.indexOf(exact)
    if (idx === -1) continue
    const range = document.createRange()
    range.setStart(node, idx)
    range.setEnd(node, idx + exact.length)
    const mark = document.createElement('mark')
    mark.setAttribute('data-highlight-id', id)
    mark.className = className
    try { range.surroundContents(mark); return true } catch { return false }
  }
  return false
}

function tryCrossElement(contentEl, sourceEl, endLine, exact, id, className) {
  const textNodes = []
  const els = contentEl.querySelectorAll('[data-source-line]')
  for (const e of els) {
    const line = parseInt(e.getAttribute('data-source-line'))
    if (line < parseInt(sourceEl.getAttribute('data-source-line'))) continue
    if (line > endLine) break
    if (e.parentElement?.closest(`[data-source-line="${line}"]`)) continue
    collectTextNodes(e, textNodes)
  }
  if (textNodes.length === 0) return false

  let concat = ''
  const nodeMap = []
  for (let i = 0; i < textNodes.length; i++) {
    if (i > 0) {
      const prevLine = textNodes[i - 1].parentElement?.closest('[data-source-line]')?.getAttribute('data-source-line')
      const currLine = textNodes[i].parentElement?.closest('[data-source-line]')?.getAttribute('data-source-line')
      if (prevLine !== currLine) concat += '\n'
    }
    const start = concat.length
    concat += textNodes[i].textContent
    nodeMap.push({ node: textNodes[i], startInConcat: start, endInConcat: concat.length })
  }

  let matchIdx = concat.indexOf(exact)
  if (matchIdx === -1) {
    let normConcat = ''
    const normMap = []
    for (let i = 0; i < textNodes.length; i++) {
      if (i > 0) {
        const prevLine = textNodes[i - 1].parentElement?.closest('[data-source-line]')?.getAttribute('data-source-line')
        const currLine = textNodes[i].parentElement?.closest('[data-source-line]')?.getAttribute('data-source-line')
        if (prevLine !== currLine) normConcat += ' '
      }
      const start = normConcat.length
      normConcat += textNodes[i].textContent.replace(/\s+/g, ' ')
      normMap.push({ node: textNodes[i], startInNorm: start, endInNorm: normConcat.length })
    }
    const normalizedExact = exact.replace(/\s+/g, ' ')
    const normIdx = normConcat.indexOf(normalizedExact)
    if (normIdx === -1) return false
    const normEnd = normIdx + normalizedExact.length
    for (const nm of normMap) {
      const s = Math.max(normIdx, nm.startInNorm)
      const e = Math.min(normEnd, nm.endInNorm)
      if (s >= e) continue
      wrapTextNode(nm.node, s - nm.startInNorm, e - nm.startInNorm, id, className)
    }
    return true
  }

  const matchEnd = matchIdx + exact.length
  for (const nm of nodeMap) {
    const s = Math.max(matchIdx, nm.startInConcat)
    const e = Math.min(matchEnd, nm.endInConcat)
    if (s >= e) continue
    wrapTextNode(nm.node, s - nm.startInConcat, e - nm.startInConcat, id, className)
  }
  return true
}

function highlightLineRange(contentEl, startLine, endLine, id, className) {
  const textNodes = []
  const els = contentEl.querySelectorAll('[data-source-line]')
  for (const e of els) {
    const line = parseInt(e.getAttribute('data-source-line'))
    if (line < startLine || line > endLine) continue
    if (e.parentElement?.closest(`[data-source-line="${line}"]`)) continue
    collectTextNodes(e, textNodes)
  }
  for (const tn of textNodes) wrapTextNode(tn, 0, tn.textContent.length, id, className)
}

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
  } catch { /* range crosses element boundaries */ }
}

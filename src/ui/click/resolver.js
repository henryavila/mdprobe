import { textOffsetWithinAncestor } from '../../anchoring/v2/index.js'

export function resolveClickedAnnotation(event, contentEl, annotations) {
  if (event.target?.tagName === 'A' && (event.ctrlKey || event.metaKey)) {
    return null
  }
  if (typeof document.caretPositionFromPoint !== 'function') return null
  const pos = document.caretPositionFromPoint(event.clientX, event.clientY)
  if (!pos) return null
  if (pos.offsetNode.nodeType !== Node.TEXT_NODE) return null

  let el = pos.offsetNode.parentElement
  while (el && el !== contentEl && !el.hasAttribute('data-source-start')) {
    el = el.parentElement
  }
  if (!el || el === contentEl) return null

  const sourceOffset = parseInt(el.dataset.sourceStart, 10) +
    textOffsetWithinAncestor(el, pos.offsetNode, pos.offset)

  const candidates = annotations.filter(a =>
    a.range && a.range.start <= sourceOffset && sourceOffset < a.range.end
  )
  if (candidates.length === 0) return null

  return candidates.reduce((a, b) =>
    new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b
  )
}

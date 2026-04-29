export function buildDomRanges(contentEl, start, end) {
  const result = []
  const elements = contentEl.querySelectorAll('[data-source-start]')
  for (const el of elements) {
    const elStart = parseInt(el.dataset.sourceStart, 10)
    const elEnd = parseInt(el.dataset.sourceEnd, 10)
    if (elEnd <= start || elStart >= end) continue

    // Skip this element if a direct child has the same source range.
    // This happens with <pre>/<code> pairs where both carry identical
    // data-source-start/end attributes from rehypeSourcePositions.
    // Prefer the innermost (child) element to avoid duplicate ranges.
    const hasSameRangeChild = el.querySelector(
      `[data-source-start="${el.dataset.sourceStart}"][data-source-end="${el.dataset.sourceEnd}"]`,
    )
    if (hasSameRangeChild) continue

    const localStart = Math.max(0, start - elStart)
    const localEnd = Math.min(elEnd - elStart, end - elStart)

    const range = createRangeAtTextOffsets(el, localStart, localEnd)
    if (range) result.push(range)
  }
  return result
}

function createRangeAtTextOffsets(ancestor, localStart, localEnd) {
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, null)
  let cumOffset = 0
  let startNode = null, startOffsetIn = 0
  let endNode = null, endOffsetIn = 0
  let node
  while ((node = walker.nextNode())) {
    const len = node.textContent.length
    const nodeStart = cumOffset
    const nodeEnd = cumOffset + len
    if (startNode == null && localStart >= nodeStart && localStart <= nodeEnd) {
      startNode = node
      startOffsetIn = localStart - nodeStart
    }
    if (localEnd >= nodeStart && localEnd <= nodeEnd) {
      endNode = node
      endOffsetIn = localEnd - nodeStart
      break
    }
    cumOffset = nodeEnd
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  try {
    range.setStart(startNode, startOffsetIn)
    range.setEnd(endNode, endOffsetIn)
  } catch {
    return null
  }
  return range
}

function levenshtein(a, b) {
  const dp = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) dp[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[b.length]
}

function nodeText(node) {
  if (node.type === 'text') return node.value
  if (!node.children) return ''
  return node.children.map(nodeText).join('')
}

export function findHeadingByText(mdast, headingText) {
  let exact = null
  let fuzzy = null
  let bestDist = Infinity
  for (const child of mdast.children) {
    if (child.type !== 'heading') continue
    const txt = nodeText(child).trim()
    if (txt === headingText) { exact = child; break }
    const d = levenshtein(txt, headingText)
    if (d <= 2 && d < bestDist) { fuzzy = child; bestDist = d }
  }
  return exact || fuzzy
}

export function paragraphsUnder(mdast, heading) {
  if (!heading) return []
  const result = []
  const startIdx = mdast.children.indexOf(heading)
  if (startIdx === -1) return result
  for (let i = startIdx + 1; i < mdast.children.length; i++) {
    const node = mdast.children[i]
    if (node.type === 'heading' && node.depth <= heading.depth) break
    if (node.type === 'paragraph') {
      result.push({
        node,
        index: result.length,
        text: nodeText(node),
        startOffset: node.position?.start?.offset ?? 0,
        endOffset: node.position?.end?.offset ?? 0,
      })
    }
  }
  return result
}

export function computeTreePath(mdast, offset) {
  let activeHeading = null
  let paragraphIndex = -1
  let containingParagraph = null

  for (const child of mdast.children) {
    const start = child.position?.start?.offset ?? 0
    const end = child.position?.end?.offset ?? 0

    if (child.type === 'heading') {
      if (start > offset) break
      activeHeading = child
      paragraphIndex = -1
    } else if (child.type === 'paragraph') {
      paragraphIndex++
      if (offset >= start && offset <= end) {
        containingParagraph = { node: child, index: paragraphIndex, text: nodeText(child), startOffset: start }
        break
      }
    }
  }

  if (containingParagraph == null) return null

  return {
    headingText: activeHeading ? nodeText(activeHeading).trim() : '',
    headingLevel: activeHeading ? activeHeading.depth : 0,
    paragraphIndex: containingParagraph.index,
    charOffsetInParagraph: offset - containingParagraph.startOffset,
  }
}

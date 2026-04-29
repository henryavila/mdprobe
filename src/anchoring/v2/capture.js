import { computeContextHash } from './schema.js'
import { computeTreePath } from './treepath.js'
import { extractKeywords } from './keywords.js'
import { fingerprint } from './fingerprint.js'

export function textOffsetWithinAncestor(ancestor, targetNode, targetOffset) {
  // Case 1: targetNode is an element node (not a text node).
  // targetOffset is a CHILD INDEX, not a char offset per the DOM Range spec.
  // We must sum the textContent of children[0..targetOffset-1].
  if (targetNode.nodeType === Node.ELEMENT_NODE) {
    let charOffset = 0
    const children = targetNode.childNodes
    for (let i = 0; i < targetOffset && i < children.length; i++) {
      charOffset += children[i].textContent?.length || 0
    }
    // If targetNode IS the ancestor, we are done.
    if (targetNode === ancestor) return charOffset
    // Otherwise, add the text content that precedes targetNode within ancestor.
    let offsetBeforeTarget = 0
    function walkBeforeTarget(node) {
      if (node === targetNode) return true // found — stop
      if (node.nodeType === Node.TEXT_NODE) {
        offsetBeforeTarget += node.textContent.length
        return false
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        for (const child of node.childNodes) {
          if (walkBeforeTarget(child)) return true
        }
      }
      return false
    }
    walkBeforeTarget(ancestor)
    return offsetBeforeTarget + charOffset
  }

  // Case 2: targetNode is a text node (the common case).
  // targetOffset is a char offset within that text node.
  if (targetNode === ancestor) return targetOffset // defensive: text node IS the ancestor (unusual)
  let offset = 0

  function walkNodes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === targetNode) return offset + targetOffset
      offset += node.textContent.length
      return null
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (const child of node.childNodes) {
        const result = walkNodes(child)
        if (result !== null) return result
      }
    }
    return null
  }

  return walkNodes(ancestor) ?? offset
}

function findSourceAnchor(node, contentEl) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  while (el && el !== contentEl) {
    if (el.hasAttribute && el.hasAttribute('data-source-start')) return el
    el = el.parentElement
  }
  return null
}

export function describe(range, contentEl, source, mdast = null) {
  const startAnchor = findSourceAnchor(range.startContainer, contentEl)
  const endAnchor = findSourceAnchor(range.endContainer, contentEl)
  if (!startAnchor || !endAnchor) {
    throw new Error('describe: could not find data-source-start ancestor')
  }

  const start = parseInt(startAnchor.dataset.sourceStart, 10) +
    textOffsetWithinAncestor(startAnchor, range.startContainer, range.startOffset)
  const end = parseInt(endAnchor.dataset.sourceStart, 10) +
    textOffsetWithinAncestor(endAnchor, range.endContainer, range.endOffset)

  const exact = source.slice(start, end)
  const prefix = source.slice(Math.max(0, start - 32), start)
  const suffix = source.slice(end, Math.min(source.length, end + 32))

  const result = {
    range: { start, end },
    quote: { exact, prefix, suffix },
    anchor: { contextHash: computeContextHash(prefix, exact, suffix) },
  }

  if (mdast) {
    const tp = computeTreePath(mdast, start)
    if (tp) {
      const paragraphText = source.slice(start - tp.charOffsetInParagraph, end)
      result.anchor.treePath = {
        headingText: tp.headingText,
        headingLevel: tp.headingLevel,
        paragraphIndex: tp.paragraphIndex,
        paragraphFingerprint: fingerprint(paragraphText),
        charOffsetInParagraph: tp.charOffsetInParagraph,
      }
    }
  }

  if (source) {
    result.anchor.keywords = extractKeywords(exact, source)
  }

  return result
}

import { computeContextHash } from './schema.js'
import { computeTreePath } from './treepath.js'
import { extractKeywords } from './keywords.js'
import { fingerprint } from './fingerprint.js'

export function textOffsetWithinAncestor(ancestor, targetNode, targetOffset) {
  if (targetNode === ancestor) return targetOffset
  let offset = 0

  function walkNodes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === targetNode) return offset + targetOffset
      offset += node.textContent.length
      return null
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (let child of node.childNodes) {
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

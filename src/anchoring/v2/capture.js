import { computeContextHash } from './schema.js'
import { computeTreePath } from './treepath.js'
import { extractKeywords } from './keywords.js'
import { fingerprint } from './fingerprint.js'
import { findSourceAnchor, pointToSourceOffset } from './dom-source-map.js'

/**
 * Translate a DOM point to an absolute markdown source offset.
 *
 * Kept as a named export for backwards compatibility with existing tests and
 * external callers. Internally delegates to `pointToSourceOffset` which is
 * aware of inline markdown wrappers (`<code>`, `<strong>`, `<em>`, `<a>`)
 * whose source span includes syntax characters that do NOT appear in the
 * rendered text.
 */
export function textOffsetWithinAncestor(ancestor, targetNode, targetOffset, source) {
  const abs = pointToSourceOffset(ancestor, targetNode, targetOffset, source)
  if (abs == null) return 0
  const ancStart = parseInt(ancestor.dataset.sourceStart, 10)
  return abs - ancStart
}

export function describe(range, contentEl, source, mdast = null) {
  const startAnchor = findSourceAnchor(range.startContainer, contentEl)
  const endAnchor = findSourceAnchor(range.endContainer, contentEl)
  if (!startAnchor || !endAnchor) {
    throw new Error('describe: could not find data-source-start ancestor')
  }

  const start = pointToSourceOffset(startAnchor, range.startContainer, range.startOffset, source)
  const end = pointToSourceOffset(endAnchor, range.endContainer, range.endOffset, source)
  if (start == null || end == null) {
    throw new Error('describe: could not compute source offsets for selection')
  }

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

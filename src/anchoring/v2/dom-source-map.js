// Helpers that translate between a DOM point (textNode + offset) and an
// absolute markdown source offset, in a way that is consistent with how the
// renderer emits `data-source-start` / `data-source-end` attributes.
//
// Why this exists
// ---------------
// The renderer (src/renderer.js) adds `data-source-start` / `data-source-end`
// to most elements. For inline wrappers (`<code>`, `<strong>`, `<em>`, ...),
// the source range INCLUDES the markdown syntax characters (the backticks,
// the `**`, the `[`). For block elements like `<li>`, `<h1>`, the range can
// also include leading marker characters (e.g. "- " or "# ").
//
// A naive implementation that does:
//     source_offset = ancestor.dataSourceStart + dom_text_offset_within(ancestor)
// is wrong as soon as the path between `ancestor` and the target crosses an
// inline element, because the syntax characters live in the source but NOT
// in the rendered text. The two cursors diverge.
//
// The helpers below walk the DOM tree maintaining BOTH cursors in lockstep:
//   - `textCursor` advances by `node.textContent.length` for each visited
//     text node;
//   - `sourceCursor` is re-synced whenever we enter or leave an element
//     that has `data-source-start`/`data-source-end`, using the size of its
//     source span instead of the size of its rendered text.
//
// This handles arbitrarily nested inline formatting and selections that span
// across inline elements within a single block.

const ASYMMETRIC_INLINE_TAGS = new Set(['a'])

function safeAttr(el, name) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null
  if (!el.hasAttribute || !el.hasAttribute(name)) return null
  const v = parseInt(el.getAttribute(name), 10)
  return Number.isFinite(v) ? v : null
}

function hasSourceAttrs(el) {
  return safeAttr(el, 'data-source-start') != null && safeAttr(el, 'data-source-end') != null
}

/**
 * Compute the number of source characters between `el.dataSourceStart` and
 * the first character of `el`'s rendered text content.
 *
 * Strategy:
 *   1. Prefer the deterministic clue: if the first child element of `el`
 *      itself has `data-source-start`, the gap between the two source-starts
 *      is exactly the opening pad.
 *   2. Otherwise, fall back to tag-specific markdown patterns when `source`
 *      is available (list markers like "- " / "1. ", heading markers like
 *      "## ", blockquote markers like "> "). For inline elements, derive
 *      the pad from the source/text length difference (symmetric for `<code>`,
 *      `<strong>`, `<em>`, ...; asymmetric for `<a>` which always opens with
 *      a single `[` or `<`).
 *   3. If nothing else applies, return 0. `<p>` and most plain text blocks
 *      have no leading syntax characters.
 *
 * The function is intentionally tolerant — when in doubt, we return 0
 * rather than a wrong guess. A 0 pad just means the cursor will be re-synced
 * later when we encounter the first descendant element with its own
 * `data-source-start`, so the only cases truly relying on this estimate are
 * block elements whose first child is a bare text node.
 */
export function getOpenPad(el, source) {
  if (!el || !hasSourceAttrs(el)) return 0
  const elStart = safeAttr(el, 'data-source-start')
  const elEnd = safeAttr(el, 'data-source-end')

  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && hasSourceAttrs(child)) {
      const childStart = safeAttr(child, 'data-source-start')
      if (childStart != null && childStart >= elStart) return childStart - elStart
      break
    }
    if (child.nodeType === Node.TEXT_NODE && child.textContent && child.textContent.length > 0) {
      break // first content is plain text — fall through to tag-based heuristic
    }
  }

  const tag = el.tagName ? el.tagName.toLowerCase() : ''
  const sourceLen = elEnd - elStart
  const textLen = el.textContent ? el.textContent.length : 0

  if (isInlineTag(tag)) {
    // `<code>` inside `<pre>` is a FENCED block (with ```/~~~ wrappers).
    // The symmetric inline formula does not apply — the opening fence is
    // not equal to the closing fence's length plus content padding.
    const parentTag = el.parentElement && el.parentElement.tagName
      ? el.parentElement.tagName.toLowerCase()
      : ''
    if (tag === 'code' && parentTag === 'pre') {
      if (!source) return 0
      const fenceSlice = source.slice(elStart, elStart + Math.min(sourceLen, 64))
      const fm = fenceSlice.match(/^(```+|~~~+)[^\n]*\n/)
      return fm ? fm[0].length : 0
    }
    if (ASYMMETRIC_INLINE_TAGS.has(tag)) return 1 // [text](url) and <autolink>
    const diff = sourceLen - textLen
    if (diff <= 0) return 0
    if (diff % 2 === 0) return diff / 2
    return Math.floor(diff / 2)
  }

  if (!source) return 0
  const sliceLen = Math.min(sourceLen, 32)
  const slice = source.slice(elStart, elStart + sliceLen)
  if (tag === 'li') {
    const m = slice.match(/^(\s*[-*+]\s+|\s*\d+[.)]\s+)/)
    return m ? m[0].length : 0
  }
  if (/^h[1-6]$/.test(tag)) {
    const m = slice.match(/^#+\s+/)
    return m ? m[0].length : 0
  }
  if (tag === 'blockquote') {
    const m = slice.match(/^>\s+/)
    return m ? m[0].length : 0
  }
  return 0
}

function isInlineTag(tag) {
  return tag === 'code' || tag === 'strong' || tag === 'em' || tag === 'a'
    || tag === 'del' || tag === 'sup' || tag === 'sub' || tag === 'mark'
    || tag === 'b' || tag === 'i' || tag === 'u' || tag === 'small'
    || tag === 'abbr' || tag === 'span'
}

/**
 * Source-position contribution of a DOM child, used to advance the cursor
 * when the child is NOT on the path to the target point.
 *
 * Elements with `data-source-start` contribute their full source span
 * (including markdown syntax). Text nodes contribute their textContent
 * length (they correspond to literal text in source).
 */
function sourceContribution(node) {
  if (!node) return 0
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.length
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (hasSourceAttrs(node)) {
      return safeAttr(node, 'data-source-end') - safeAttr(node, 'data-source-start')
    }
    let sum = 0
    for (const c of node.childNodes) sum += sourceContribution(c)
    return sum
  }
  return 0
}

/**
 * Translate a DOM point (node + offset) to an absolute markdown source offset.
 *
 * `anchor` is an ancestor of `targetNode` (or `targetNode` itself when it is
 * an element). It must carry `data-source-start`.
 *
 * Returns null if the target cannot be located within `anchor`.
 */
export function pointToSourceOffset(anchor, targetNode, targetOffset, source) {
  if (!anchor || !hasSourceAttrs(anchor)) return null
  const ancStart = safeAttr(anchor, 'data-source-start')

  if (targetNode === anchor) {
    if (targetNode.nodeType === Node.TEXT_NODE) return ancStart + targetOffset
    let cur = ancStart + getOpenPad(anchor, source)
    for (let i = 0; i < targetOffset && i < anchor.childNodes.length; i++) {
      cur += sourceContribution(anchor.childNodes[i])
    }
    return cur
  }

  let cursor = ancStart + getOpenPad(anchor, source)
  let found = null

  function walk(node) {
    if (found != null) return
    for (const child of node.childNodes) {
      if (found != null) return

      if (child === targetNode) {
        if (child.nodeType === Node.TEXT_NODE) {
          found = cursor + targetOffset
          return
        }
        // Element target — targetOffset is a DOM child index.
        let c = cursor
        if (hasSourceAttrs(child)) {
          c = safeAttr(child, 'data-source-start') + getOpenPad(child, source)
        }
        for (let i = 0; i < targetOffset && i < child.childNodes.length; i++) {
          c += sourceContribution(child.childNodes[i])
        }
        found = c
        return
      }

      if (child.nodeType === Node.TEXT_NODE) {
        cursor += child.textContent.length
        continue
      }

      if (child.nodeType === Node.ELEMENT_NODE) {
        const containsTarget = child.contains ? child.contains(targetNode) : false
        if (containsTarget) {
          if (hasSourceAttrs(child)) {
            cursor = safeAttr(child, 'data-source-start') + getOpenPad(child, source)
          }
          walk(child)
          return
        }
        if (hasSourceAttrs(child)) {
          cursor = safeAttr(child, 'data-source-end')
        } else {
          cursor += child.textContent ? child.textContent.length : 0
        }
      }
    }
  }

  walk(anchor)
  return found
}

/**
 * Find the deepest element ancestor (including `node` if it is an element)
 * that has `data-source-start`. Stops at `contentEl` (exclusive).
 */
export function findSourceAnchor(node, contentEl) {
  let el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  while (el && el !== contentEl) {
    if (el.hasAttribute && el.hasAttribute('data-source-start')) return el
    el = el.parentElement
  }
  return null
}

/**
 * Build a DOM Range covering the source-offset interval [localStart, localEnd]
 * (relative to `block.dataSourceStart`) inside `block`.
 *
 * Walks descendants of `block`, tracking BOTH the rendered-text cursor and
 * the source-relative cursor. When the source-relative cursor crosses
 * `localStart`/`localEnd` inside a text node, the corresponding text-node
 * offset is recorded as the range boundary.
 */
export function buildRangeInBlock(block, localStart, localEnd, source) {
  if (!block || !hasSourceAttrs(block)) return null
  let cursor = getOpenPad(block, source)
  let startNode = null, startOffsetIn = 0
  let endNode = null, endOffsetIn = 0
  let lastText = null

  function visit(node) {
    if (endNode != null) return
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent.length
      const ns = cursor
      const ne = cursor + len
      lastText = node
      if (startNode == null && localStart >= ns && localStart <= ne) {
        startNode = node
        startOffsetIn = localStart - ns
      }
      if (localEnd >= ns && localEnd <= ne) {
        endNode = node
        endOffsetIn = localEnd - ns
        return
      }
      cursor = ne
      return
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node !== block && hasSourceAttrs(node)) {
        const elStart = safeAttr(node, 'data-source-start')
        const elEnd = safeAttr(node, 'data-source-end')
        const blockStart = safeAttr(block, 'data-source-start')
        cursor = (elStart - blockStart) + getOpenPad(node, source)
        for (const c of node.childNodes) {
          visit(c)
          if (endNode != null) return
        }
        cursor = elEnd - blockStart
        return
      }
      for (const c of node.childNodes) {
        visit(c)
        if (endNode != null) return
      }
    }
  }

  for (const c of block.childNodes) {
    visit(c)
    if (endNode != null) break
  }

  // The selection ends past this block's content — clamp to the last text.
  if (startNode && !endNode && lastText) {
    endNode = lastText
    endOffsetIn = lastText.textContent.length
  }
  // The selection starts before this block's content — clamp to first text.
  if (!startNode && endNode) {
    let firstText = null
    function findFirst(n) {
      if (firstText) return
      if (n.nodeType === Node.TEXT_NODE) { firstText = n; return }
      if (n.nodeType === Node.ELEMENT_NODE) {
        for (const c of n.childNodes) { findFirst(c); if (firstText) return }
      }
    }
    findFirst(block)
    if (firstText) {
      startNode = firstText
      startOffsetIn = 0
    }
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

/**
 * Return the list of `[data-source-start]` elements inside `contentEl` that
 * have no other `[data-source-start]` ancestor (still inside `contentEl`).
 * These are the canonical "top-level" blocks that own their entire rendered
 * subtree.
 */
export function topLevelSourceBlocks(contentEl) {
  const out = []
  const all = contentEl.querySelectorAll('[data-source-start]')
  for (const el of all) {
    let p = el.parentElement
    let hasAnc = false
    while (p && p !== contentEl) {
      if (p.hasAttribute && p.hasAttribute('data-source-start')) { hasAnc = true; break }
      p = p.parentElement
    }
    if (!hasAnc) out.push(el)
  }
  return out
}

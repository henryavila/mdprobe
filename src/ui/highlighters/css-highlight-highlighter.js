import { locate, buildDomRanges } from '../../anchoring/v2/index.js'

const TAG_COLORS = {
  question:   [137, 180, 250],
  bug:        [243, 139, 168],
  suggestion: [166, 227, 161],
  nitpick:    [249, 226, 175],
}

function tagColor(tag, alpha) {
  const c = TAG_COLORS[tag] || TAG_COLORS.question
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`
}

const CSS_HIGHLIGHTS_SUPPORTED =
  typeof CSS !== 'undefined' && typeof CSS.highlights !== 'undefined' && CSS.highlights !== null

export function createCssHighlightHighlighter() {
  const registry = new Map()
  let styleEl = null

  function ensureStyle() {
    if (styleEl) return styleEl
    styleEl = document.createElement('style')
    styleEl.id = 'mdprobe-highlight-rules'
    document.head.appendChild(styleEl)
    return styleEl
  }

  function upsertRule(ann, state) {
    const sheet = ensureStyle().sheet
    if (!sheet) return
    const ruleSelector = `::highlight(ann-${ann.id})`
    const alpha = state === 'drifted' ? 0.40 : 0.25
    const bg = tagColor(ann.tag, alpha)
    const decoration = state === 'drifted' ? 'text-decoration: underline 2px dashed #f9a;' : ''
    const ruleText = `${ruleSelector} { background-color: ${bg}; ${decoration} }`
    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      if (sheet.cssRules[i].cssText.startsWith(ruleSelector)) sheet.deleteRule(i)
    }
    sheet.insertRule(ruleText, sheet.cssRules.length)
  }

  function removeRule(id) {
    const sheet = styleEl?.sheet
    if (!sheet) return
    const ruleSelector = `::highlight(ann-${id})`
    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      if (sheet.cssRules[i].cssText.startsWith(ruleSelector)) sheet.deleteRule(i)
    }
  }

  function syncOne(id, contentEl, annotations, source, mdast) {
    const ann = annotations.find(a => a.id === id)
    if (!ann) return null
    const r = locate(ann, source, mdast)
    if (r.state === 'orphan' || !r.range) {
      removeOne(id)
      return r
    }
    const ranges = buildDomRanges(contentEl, r.range.start, r.range.end)
    if (ranges.length === 0) {
      removeOne(id)
      return { state: 'orphan', score: 0 }
    }
    if (CSS_HIGHLIGHTS_SUPPORTED) {
      const h = new Highlight(...ranges)
      h.priority = new Date(ann.created_at).getTime()
      const name = `ann-${ann.id}`
      CSS.highlights.set(name, h)
      registry.set(id, { highlight: h, ranges, state: r.state, name, ann })
    } else {
      // No CSS Highlight API support — store ranges for potential fallback
      registry.set(id, { highlight: null, ranges, state: r.state, name: `ann-${ann.id}`, ann })
    }
    upsertRule(ann, r.state)
    return r
  }

  function removeOne(id) {
    const entry = registry.get(id)
    if (!entry) return
    if (CSS_HIGHLIGHTS_SUPPORTED) CSS.highlights.delete(entry.name)
    registry.delete(id)
    removeRule(id)
  }

  function sync(contentEl, annotations, opts) {
    const { source, mdast } = opts
    const incomingIds = new Set(annotations.map(a => a.id))
    for (const id of [...registry.keys()]) {
      if (!incomingIds.has(id)) removeOne(id)
    }
    const states = {}
    for (const ann of annotations) {
      const r = syncOne(ann.id, contentEl, annotations, source, mdast)
      if (r) states[ann.id] = r.state
    }
    return states
  }

  function clear(contentEl) {
    for (const id of [...registry.keys()]) removeOne(id)
  }

  function setSelection(contentEl, annotationId) {
    if (!CSS_HIGHLIGHTS_SUPPORTED) return
    CSS.highlights.delete('ann-selected')
    if (annotationId == null) return
    const entry = registry.get(annotationId)
    if (!entry) return
    const sel = new Highlight(...entry.ranges)
    sel.priority = Number.MAX_SAFE_INTEGER
    CSS.highlights.set('ann-selected', sel)
  }

  return { sync, syncOne, clear, setSelection }
}

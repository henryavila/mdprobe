// @vitest-environment happy-dom
//
// Reproduction tests for the highlight bug reported on 2026-05-15:
//   "When I select text on a list item that contains inline code, the
//    highlight is rendered on totally different characters than the ones
//    I selected."
//
// Scenario: a markdown list item like:
//   - `area_notification_deadlines` (extensão cross-área: acknowledgment_of_receipt, ...)
//
// renders to HTML approximately as:
//   <li data-source-start=A data-source-end=B>
//     <code data-source-start=C data-source-end=D>area_notification_deadlines</code>
//     (extensão cross-área: ...)
//   </li>
//
// where A < C < D < B and the substring source[A..B] includes the markdown
// syntax characters (the list marker "- " and the surrounding backticks).
//
// The CAPTURE side (describe) computes a source offset by combining
// `data-source-start` of the deepest ancestor with `data-source-start`
// + a RENDERED-text offset within that ancestor. The RENDER side
// (buildDomRanges) treats source offsets as rendered-text offsets within
// each ancestor element. Both sides are symmetrically wrong: they ignore
// the markdown-syntax characters that exist in the source but NOT in the
// rendered text content. The result is highlights that drift off by the
// number of syntax characters between the block ancestor's data-source-start
// and the selection.

import { describe as vDescribe, it, expect, beforeEach } from 'vitest'
import { render } from '../../src/renderer.js'
import { describe as captureSelection } from '../../src/anchoring/v2/capture.js'
import { buildDomRanges } from '../../src/anchoring/v2/build-ranges.js'

const SAMPLE_MD = [
  '# Onda 3 — Plano',
  '',
  '## Sessão 1',
  '',
  '2. **Migrations (6 tabelas novas)**:',
  '   - `area_notification_configs` (config + flags)',
  '   - `area_notification_templates` (unificada: id, area_id)',
  '   - `area_notifications` (core: id, area_id, template_id)',
  '   - `area_notification_geadf_data` (extensão área: provider_name)',
  '   - `area_notification_gereg_data` (extensão área: situation_id)',
  '   - `area_notification_deadlines` (extensão cross-área: acknowledgment_of_receipt, extended_date, marked_as_overdue, resolved_at)',
  '',
].join('\n')

function setupDom(html) {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

function findLiContainingCodeText(root, codeText) {
  const codes = root.querySelectorAll('code')
  for (const c of codes) {
    if (c.textContent === codeText) {
      // Walk up to the LI
      let el = c
      while (el && el.tagName !== 'LI') el = el.parentElement
      return { li: el, code: c }
    }
  }
  return null
}

function getFirstTextDescendant(node) {
  if (node.nodeType === Node.TEXT_NODE) return node
  for (const c of node.childNodes) {
    const t = getFirstTextDescendant(c)
    if (t) return t
  }
  return null
}

vDescribe('highlight bug: inline elements inside list items', () => {
  let root, source, codeEl, liEl, codeText, trailingText

  beforeEach(() => {
    source = SAMPLE_MD
    const { html } = render(source)
    root = setupDom(html)
    const found = findLiContainingCodeText(root, 'area_notification_deadlines')
    if (!found) throw new Error('test setup: did not find code element')
    codeEl = found.code
    liEl = found.li
    codeText = getFirstTextDescendant(codeEl)
    // The trailing text node " (extensão cross-área: ...)" is a sibling
    // of <code> inside <li>.
    trailingText = null
    for (const c of liEl.childNodes) {
      if (c.nodeType === Node.TEXT_NODE && c.textContent.includes('extensão')) {
        trailingText = c
        break
      }
    }
    if (!trailingText) throw new Error('test setup: did not find trailing text')
  })

  it('source positions of li and code are as expected for the rendered html', () => {
    const liStart = parseInt(liEl.dataset.sourceStart, 10)
    const liEnd = parseInt(liEl.dataset.sourceEnd, 10)
    const codeStart = parseInt(codeEl.dataset.sourceStart, 10)
    const codeEnd = parseInt(codeEl.dataset.sourceEnd, 10)
    // Sanity: source[liStart] is '-', source[codeStart] is '`', code text
    // is the literal between the backticks, code text length is 27.
    expect(source[liStart]).toBe('-')
    expect(source[codeStart]).toBe('`')
    expect(source.slice(codeStart + 1, codeEnd - 1)).toBe('area_notification_deadlines')
    expect(codeEl.textContent.length).toBe(27)
    // The block source span (between liStart and liEnd) contains "- " + "`...`"
    // before the rendered text resumes — i.e., 4 syntax characters total for
    // this list item: "- " (2) + 2 backticks (2).
    const blockSourceLen = liEnd - liStart
    const blockRenderedLen = liEl.textContent.length
    expect(blockSourceLen - blockRenderedLen).toBe(4)
  })

  it('user selects from start of code text to end of trailing text → describe should yield correct source positions', () => {
    // Simulate user click+drag selection: anchor at start of code text,
    // focus at end of trailing text.
    const range = document.createRange()
    range.setStart(codeText, 0)
    range.setEnd(trailingText, trailingText.textContent.length)

    const result = captureSelection(range, root, source)

    // EXPECTED: start points to "a" of "area_notification_deadlines" (the
    //           first char of rendered text), end points to AFTER the final
    //           ")" of the trailing text (last char of rendered text).
    //
    // i.e. exact should be the rendered text of the <li> verbatim.
    const liStart = parseInt(liEl.dataset.sourceStart, 10)
    const codeStart = parseInt(codeEl.dataset.sourceStart, 10)
    const codeEnd = parseInt(codeEl.dataset.sourceEnd, 10)
    const liEnd = parseInt(liEl.dataset.sourceEnd, 10)

    // The "a" of "area" lives at source[codeStart + 1] (skip the opening
    // backtick). The closing ")" lives at source[liEnd - 1].
    const expectedStart = codeStart + 1
    const expectedEnd = liEnd

    // What describe currently returns vs. what is correct.
    expect(result.range.start).toBe(expectedStart)
    expect(result.range.end).toBe(expectedEnd)

    // The exact string captured should match what source contains at those
    // positions, which is the literal text the user selected.
    expect(source.slice(result.range.start, result.range.end))
      .toBe('area_notification_deadlines` (extensão cross-área: acknowledgment_of_receipt, extended_date, marked_as_overdue, resolved_at)')
    // Note: source DOES include the closing backtick — describe captures a
    // contiguous source range and exact reflects that. The DOM range, however,
    // covers only the rendered (non-syntax) characters.
  })

  it('buildDomRanges with correct source positions reconstructs a range covering exactly the selected text', () => {
    const codeStart = parseInt(codeEl.dataset.sourceStart, 10)
    const liEnd = parseInt(liEl.dataset.sourceEnd, 10)
    // Use the canonical source positions for "from 'a' of area to ')' inclusive".
    const ranges = buildDomRanges(root, codeStart + 1, liEnd, source)
    expect(ranges.length).toBeGreaterThan(0)
    const combined = ranges.map(r => r.toString()).join('')
    // What the user actually selected (rendered text, no markdown syntax).
    expect(combined).toBe('area_notification_deadlines (extensão cross-área: acknowledgment_of_receipt, extended_date, marked_as_overdue, resolved_at)')
  })

  it('selection that starts mid-code and ends mid-trailing-text is captured correctly', () => {
    // Mid-code through mid-trailing-text — the kind of selection a user
    // makes when double-click+drag from "deadlines" through "marked".
    const codeStart = parseInt(codeEl.dataset.sourceStart, 10)
    const liStart = parseInt(liEl.dataset.sourceStart, 10)
    const range = document.createRange()
    // "lines" in code (offset 22..27 inside code's text)
    range.setStart(codeText, 22)
    // "marked" position inside trailing text. Find it.
    const trailingFull = trailingText.textContent
    const markedIdx = trailingFull.indexOf('marked')
    range.setEnd(trailingText, markedIdx + 'marked'.length)

    const result = captureSelection(range, root, source)
    const captured = source.slice(result.range.start, result.range.end)
    // Whatever exact captured, it must contain the literal user-selected
    // characters from the rendered text (in order). Spaces and the closing
    // backtick may appear in the captured substring because source includes
    // them, but the human-readable content must round-trip.
    expect(captured.replace(/`/g, '')).toBe('lines (extensão cross-área: acknowledgment_of_receipt, extended_date, marked')

    // Round-trip: buildDomRanges with these positions must produce a DOM
    // range covering exactly the originally selected text.
    const ranges = buildDomRanges(root, result.range.start, result.range.end, source)
    expect(ranges.length).toBeGreaterThan(0)
    const combined = ranges.map(r => r.toString()).join('')
    expect(combined).toBe('lines (extensão cross-área: acknowledgment_of_receipt, extended_date, marked')
  })

  it('regression: describe then buildDomRanges round-trip gives back the same DOM text the user selected', () => {
    // Anchor at start of code text → focus at end of trailing text.
    const range = document.createRange()
    range.setStart(codeText, 0)
    range.setEnd(trailingText, trailingText.textContent.length)

    const captured = captureSelection(range, root, source)
    const ranges = buildDomRanges(root, captured.range.start, captured.range.end, source)

    expect(ranges.length).toBeGreaterThan(0)
    const combined = ranges.map(r => r.toString()).join('')
    // Whatever describe computed, the round-trip should still highlight
    // exactly what the user selected (a + rendered text, no markdown syntax).
    const userSelectedText = 'area_notification_deadlines (extensão cross-área: acknowledgment_of_receipt, extended_date, marked_as_overdue, resolved_at)'
    expect(combined).toBe(userSelectedText)
  })
})

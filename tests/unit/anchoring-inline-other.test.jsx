// @vitest-environment happy-dom
//
// Companion to anchoring-inline-bug.test.jsx — exercises the same DOM-to-
// source mapping with the OTHER common inline wrappers (`**bold**`,
// `[text](url)`) and with a selection that genuinely spans two blocks.

import { describe as vDescribe, it, expect, beforeEach } from 'vitest'
import { render } from '../../src/renderer.js'
import { describe as captureSelection } from '../../src/anchoring/v2/capture.js'
import { buildDomRanges } from '../../src/anchoring/v2/build-ranges.js'

function setupDom(html) {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

function getFirstTextDescendant(node) {
  if (node.nodeType === Node.TEXT_NODE) return node
  for (const c of node.childNodes) {
    const t = getFirstTextDescendant(c)
    if (t) return t
  }
  return null
}

vDescribe('bold / em inside paragraphs', () => {
  const source = 'Hello **bold** world and *italic* tail.\n'
  let root

  beforeEach(() => {
    const { html } = render(source)
    root = setupDom(html)
  })

  it('selection from "ello" to "world" round-trips correctly', () => {
    const p = root.querySelector('p')
    const helloTextNode = p.firstChild // "Hello "
    // After <strong> is the text " world and "
    let afterStrongText = null
    for (const c of p.childNodes) {
      if (c.nodeType === Node.TEXT_NODE && c.textContent.includes('world')) {
        afterStrongText = c
        break
      }
    }
    expect(afterStrongText).not.toBeNull()

    const range = document.createRange()
    // start at offset 1 inside "Hello " → the "e"
    range.setStart(helloTextNode, 1)
    // end after "world" inside " world and "
    const wIdx = afterStrongText.textContent.indexOf('world')
    range.setEnd(afterStrongText, wIdx + 'world'.length)

    const result = captureSelection(range, root, source)
    const captured = source.slice(result.range.start, result.range.end)
    expect(captured).toBe('ello **bold** world')

    // Round-trip back through buildDomRanges — the rendered text covered
    // must be exactly what the user selected (no markdown syntax leaks
    // into the visible highlight).
    const ranges = buildDomRanges(root, result.range.start, result.range.end, source)
    expect(ranges.length).toBeGreaterThan(0)
    const combined = ranges.map(r => r.toString()).join('')
    expect(combined).toBe('ello bold world')
  })

  it('selection inside <strong> alone resolves to source offsets stripping the `**`', () => {
    const strong = root.querySelector('strong')
    const t = getFirstTextDescendant(strong)
    const range = document.createRange()
    range.setStart(t, 0)
    range.setEnd(t, 4)

    const result = captureSelection(range, root, source)
    expect(source.slice(result.range.start, result.range.end)).toBe('bold')

    const ranges = buildDomRanges(root, result.range.start, result.range.end, source)
    expect(ranges.length).toBeGreaterThan(0)
    expect(ranges.map(r => r.toString()).join('')).toBe('bold')
  })
})

vDescribe('inline link [text](url)', () => {
  const source = 'See the [docs](https://example.com/x) please.\n'
  let root

  beforeEach(() => {
    const { html } = render(source)
    root = setupDom(html)
  })

  it('selection across the link captures source verbatim and round-trips to rendered text', () => {
    const p = root.querySelector('p')
    const firstText = p.firstChild // "See the "
    let afterLinkText = null
    for (const c of p.childNodes) {
      if (c.nodeType === Node.TEXT_NODE && c.textContent.includes('please')) {
        afterLinkText = c
        break
      }
    }
    const range = document.createRange()
    range.setStart(firstText, 'See '.length) // start of "the"
    range.setEnd(afterLinkText, afterLinkText.textContent.indexOf('please') + 'please'.length)

    const result = captureSelection(range, root, source)
    expect(source.slice(result.range.start, result.range.end))
      .toBe('the [docs](https://example.com/x) please')

    const ranges = buildDomRanges(root, result.range.start, result.range.end, source)
    expect(ranges.length).toBeGreaterThan(0)
    // Rendered text: link's text content is "docs"; url/parens are not visible.
    expect(ranges.map(r => r.toString()).join('')).toBe('the docs please')
  })
})

vDescribe('cross-block selection', () => {
  const source = 'First paragraph here.\n\nSecond paragraph with `code` inside.\n'
  let root

  beforeEach(() => {
    const { html } = render(source)
    root = setupDom(html)
  })

  it('selection that starts in para 1 and ends in para 2 produces correct source range and per-block DOM ranges', () => {
    const paras = root.querySelectorAll('p')
    expect(paras.length).toBe(2)
    const t1 = paras[0].firstChild // "First paragraph here."
    // Locate the text node containing "Second"
    let t2 = null
    for (const c of paras[1].childNodes) {
      if (c.nodeType === Node.TEXT_NODE && c.textContent.includes('Second')) {
        t2 = c
        break
      }
    }
    expect(t2).not.toBeNull()
    const range = document.createRange()
    range.setStart(t1, 'First '.length) // start of "paragraph"
    range.setEnd(t2, t2.textContent.indexOf('paragraph') + 'paragraph'.length) // end after second "paragraph"

    const result = captureSelection(range, root, source)
    const captured = source.slice(result.range.start, result.range.end)
    expect(captured.startsWith('paragraph here.')).toBe(true)
    expect(captured.endsWith('Second paragraph')).toBe(true)

    // Two DOM ranges, one per block.
    const ranges = buildDomRanges(root, result.range.start, result.range.end, source)
    expect(ranges.length).toBe(2)
    const combined = ranges.map(r => r.toString()).join('||')
    expect(combined).toContain('paragraph here.')
    expect(combined).toContain('Second paragraph')
  })
})

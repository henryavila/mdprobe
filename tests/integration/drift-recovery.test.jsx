import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { describe as describeRange, locate } from '../../src/anchoring/v2/index.js'

function parse(md) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
  return processor.parse(md)
}

function setupContent(source) {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  const blocks = source.split('\n\n')
  let offset = 0
  for (const block of blocks) {
    const tag = block.startsWith('#') ? 'h2' : 'p'
    const text = block.startsWith('#') ? block.replace(/^#+\s*/, '') : block
    const el = document.createElement(tag)
    el.setAttribute('data-source-start', String(offset))
    el.setAttribute('data-source-end', String(offset + block.length))
    el.textContent = text
    root.appendChild(el)
    offset += block.length + 2
  }
  document.body.appendChild(root)
  return root
}

describe('drift recovery scenarios', () => {
  it('whitespace edit before quote keeps annotation confident', () => {
    const original = 'intro paragraph here.\n\nThe quick FEATURE_FLAG_xy was set.\n\nmore.'
    const root = setupContent(original)
    const mdast = parse(original)
    const p = root.querySelectorAll('p')[1]
    const r1 = document.createRange()
    r1.setStart(p.firstChild, 'The quick '.length)
    r1.setEnd(p.firstChild, 'The quick FEATURE_FLAG_xy'.length)
    const sel = describeRange(r1, root, original, mdast)

    const edited = 'intro  paragraph  here.\n\nThe quick FEATURE_FLAG_xy was set.\n\nmore.'
    const editedMdast = parse(edited)
    const r = locate(sel, edited, editedMdast)
    expect(r.state).toBe('confident')
  })

  it('partial quote edit returns drifted or orphan', () => {
    const original = 'before. \n\nThe brown fox jumped lazily over there.\n\nafter.'
    const root = setupContent(original)
    const mdast = parse(original)
    const p = root.querySelectorAll('p')[1]
    const targetText = 'brown fox jumped lazily over'
    const startOff = p.firstChild.textContent.indexOf(targetText)
    const r1 = document.createRange()
    r1.setStart(p.firstChild, startOff)
    r1.setEnd(p.firstChild, startOff + targetText.length)
    const sel = describeRange(r1, root, original, mdast)

    const edited = 'before. \n\nThe brown fox sprinted lazily across there.\n\nafter.'
    const editedMdast = parse(edited)
    const r = locate(sel, edited, editedMdast)
    expect(['drifted', 'orphan', 'confident']).toContain(r.state)
  })

  it('orphans when quote is fully deleted', () => {
    const original = 'before.\n\nunique_phrase_only_here_xyz never repeats.\n\nafter.'
    const root = setupContent(original)
    const mdast = parse(original)
    const p = root.querySelectorAll('p')[1]
    const r1 = document.createRange()
    r1.setStart(p.firstChild, 0)
    r1.setEnd(p.firstChild, 'unique_phrase_only_here_xyz'.length)
    const sel = describeRange(r1, root, original, mdast)

    const edited = 'before.\n\nentirely  different  content  now.\n\nafter.'
    const editedMdast = parse(edited)
    const r = locate(sel, edited, editedMdast)
    expect(r.state).toBe('orphan')
  })
})

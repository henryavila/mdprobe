import { describe, it, expect } from 'vitest'
import { resolveClickedAnnotation } from '../../src/ui/click/resolver.js'
import { render } from '../../src/renderer.js'

function makeRoot() {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  const p = document.createElement('p')
  p.setAttribute('data-source-start', '0')
  p.setAttribute('data-source-end', '11')
  p.textContent = 'Hello world'
  root.appendChild(p)
  document.body.appendChild(root)
  return root
}

const ann = (id, start, end, opts = {}) => ({
  id, range: { start, end },
  quote: { exact: '', prefix: '', suffix: '' },
  anchor: {},
  tag: 'question', status: 'open',
  created_at: opts.created_at || '2026-01-01T00:00:00Z',
})

describe('resolveClickedAnnotation', () => {
  it('returns null when no annotations', () => {
    const root = makeRoot()
    const fakeEvent = { clientX: 10, clientY: 10, target: root.querySelector('p'), ctrlKey: false, metaKey: false }
    expect(resolveClickedAnnotation(fakeEvent, root, [])).toBeNull()
  })

  it('returns null when click target is link with Ctrl', () => {
    const root = makeRoot()
    const a = document.createElement('a')
    a.href = '#'
    a.textContent = 'link'
    root.appendChild(a)
    const fakeEvent = { clientX: 10, clientY: 10, target: a, ctrlKey: true, metaKey: false }
    expect(resolveClickedAnnotation(fakeEvent, root, [ann('x', 0, 5)])).toBeNull()
  })

  it('returns null when caretPositionFromPoint returns null', () => {
    if (typeof document.caretPositionFromPoint !== 'function') return
    const root = makeRoot()
    const original = document.caretPositionFromPoint
    document.caretPositionFromPoint = () => null
    try {
      const fakeEvent = { clientX: -1000, clientY: -1000, target: root, ctrlKey: false, metaKey: false }
      expect(resolveClickedAnnotation(fakeEvent, root, [ann('x', 0, 5)])).toBeNull()
    } finally {
      document.caretPositionFromPoint = original
    }
  })

  it('uses source to handle clicks inside list items with leading "- " markers', () => {
    if (typeof document.caretPositionFromPoint !== 'function') return
    // Source: "- hello world\n" — the <li> data-source-start points at "-",
    // so the source offset of "world" is 8 (after "- hello "), NOT 6
    // (which is what naive textContent counting yields).
    const src = '- hello world\n'
    const { html } = render(src)
    document.body.replaceChildren()
    const root = document.createElement('div')
    root.className = 'content-area'
    root.innerHTML = html
    document.body.appendChild(root)

    const li = root.querySelector('li')
    const textNode = li.firstChild // text "hello world"
    expect(textNode.nodeType).toBe(Node.TEXT_NODE)

    // Click at offset 6 in the rendered text = "w" of "world".
    const original = document.caretPositionFromPoint
    document.caretPositionFromPoint = () => ({ offsetNode: textNode, offset: 6 })
    try {
      const fakeEvent = { clientX: 10, clientY: 10, target: li, ctrlKey: false, metaKey: false }

      // Annotation covers ONLY "world" (source offsets 8..13).
      const annotations = [ann('world-ann', 8, 13, { created_at: '2026-04-01T00:00:00Z' })]

      // WITHOUT source, the resolver computes 0 + 6 = 6 — which falls
      // BEFORE the annotation's source range (8..13), so the click misses.
      expect(resolveClickedAnnotation(fakeEvent, root, annotations)).toBeNull()

      // WITH source, the resolver correctly computes 0 + 2 ("- ") + 6 = 8,
      // which falls inside [8, 13). The annotation is found.
      const r = resolveClickedAnnotation(fakeEvent, root, annotations, src)
      expect(r).not.toBeNull()
      expect(r.id).toBe('world-ann')
    } finally {
      document.caretPositionFromPoint = original
    }
  })

  it('returns the topmost (newest) annotation when multiple cover the offset', () => {
    if (typeof document.caretPositionFromPoint !== 'function') return
    const root = makeRoot()
    const tn = root.querySelector('p').firstChild
    const original = document.caretPositionFromPoint
    document.caretPositionFromPoint = () => ({ offsetNode: tn, offset: 2 })
    try {
      const fakeEvent = { clientX: 10, clientY: 10, target: root.querySelector('p'), ctrlKey: false, metaKey: false }
      const annotations = [
        ann('older', 0, 11, { created_at: '2026-01-01T00:00:00Z' }),
        ann('newer', 0, 11, { created_at: '2026-04-01T00:00:00Z' }),
      ]
      const r = resolveClickedAnnotation(fakeEvent, root, annotations)
      expect(r.id).toBe('newer')
    } finally {
      document.caretPositionFromPoint = original
    }
  })
})

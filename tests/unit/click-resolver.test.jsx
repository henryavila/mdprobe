import { describe, it, expect } from 'vitest'
import { resolveClickedAnnotation } from '../../src/ui/click/resolver.js'

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

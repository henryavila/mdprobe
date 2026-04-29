import { describe, it, expect } from 'vitest'
import { render } from '../../src/renderer.js'

describe('renderer source-offset attributes', () => {
  it('emits data-source-start and data-source-end on block elements', () => {
    const md = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n'
    const { html } = render(md)
    expect(html).toMatch(/<h1[^>]+data-source-start="0"/)
    expect(html).toMatch(/data-source-end="\d+"/)
  })

  it('emits data-source-start on inline elements with position metadata', () => {
    const md = 'Plain **bold** text.'
    const { html } = render(md)
    expect(html).toMatch(/<strong[^>]+data-source-start=/)
  })

  it('preserves data-source-line', () => {
    const md = 'first\n\nsecond\n'
    const { html } = render(md)
    expect(html).toMatch(/data-source-line="1"/)
    expect(html).toMatch(/data-source-line="3"/)
  })
})

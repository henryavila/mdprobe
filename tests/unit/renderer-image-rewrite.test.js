import { describe, it, expect } from 'vitest'
import { render } from '../../src/renderer.js'

describe('image src rewriting', () => {
  it('rewrites relative img src to /api/asset when mdPath provided', () => {
    const md = '![logo](image.png)'
    const { html } = render(md, { mdPath: '/home/user/docs/spec.md' })
    expect(html).toMatch(/src="\/api\/asset\?path=/)
    // The encoded path should resolve to /home/user/docs/image.png
    expect(html).toMatch(/path=%2Fhome%2Fuser%2Fdocs%2Fimage\.png/)
  })

  it('rewrites img src nested in subdirectories', () => {
    const md = '![alt](../assets/image.png)'
    const { html } = render(md, { mdPath: '/home/user/docs/sub/spec.md' })
    expect(html).toMatch(/src="\/api\/asset\?path=/)
    expect(html).toMatch(/path=%2Fhome%2Fuser%2Fdocs%2Fassets%2Fimage\.png/)
  })

  it('leaves absolute URLs untouched', () => {
    const md = '![alt](https://cdn.example.com/image.png)'
    const { html } = render(md, { mdPath: '/home/user/spec.md' })
    expect(html).toMatch(/src="https:\/\/cdn\.example\.com\/image\.png"/)
  })

  it('leaves protocol-relative URLs untouched', () => {
    const md = '![alt](//cdn.example.com/image.png)'
    const { html } = render(md, { mdPath: '/home/user/spec.md' })
    expect(html).toMatch(/src="\/\/cdn\.example\.com\/image\.png"/)
  })

  it('leaves data URLs untouched', () => {
    const md = '![alt](data:image/png;base64,iVBOR...)'
    const { html } = render(md, { mdPath: '/home/user/spec.md' })
    expect(html).toMatch(/src="data:image\/png;base64,iVBOR/)
  })

  it('leaves server-absolute paths untouched', () => {
    const md = '![alt](/static/image.png)'
    const { html } = render(md, { mdPath: '/home/user/spec.md' })
    expect(html).toMatch(/src="\/static\/image\.png"/)
  })

  it('skips plugin entirely when mdPath is not provided', () => {
    const md = '![alt](image.png)'
    const { html } = render(md)
    // Should keep relative path as-is — backward compat
    expect(html).toMatch(/src="image\.png"/)
  })
})

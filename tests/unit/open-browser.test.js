import { describe, it, expect } from 'vitest'

describe('open-browser', () => {
  it('exports openBrowser function', async () => {
    const mod = await import('../../src/open-browser.js')
    expect(typeof mod.openBrowser).toBe('function')
  })
})

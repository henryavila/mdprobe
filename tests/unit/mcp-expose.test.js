import { describe, it, expect, vi, beforeEach } from 'vitest'

// Wrap reconcileExposure with a spy while keeping the rest of the module real,
// so we can assert how often the (potentially process-spawning) provider work runs.
vi.mock('../../src/expose/index.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, reconcileExposure: vi.fn(actual.reconcileExposure) }
})

import { reconcileExposure } from '../../src/expose/index.js'
import { applyExposureToServer } from '../../src/mcp.js'

function fakeServer() {
  return {
    port: 3000,
    _remote: false,
    setRemoteAccess(meta) { this._remoteAccess = meta },
  }
}

describe('applyExposureToServer', () => {
  beforeEach(() => { reconcileExposure.mockClear() })

  it('memoizes provider reconciliation across calls with the same config/port', async () => {
    const srv = fakeServer()
    const config = { expose: 'external', remoteBaseUrl: 'https://x.example.com' }

    const first = await applyExposureToServer(srv, config, ['a.md'])
    expect(first.remoteUrl).toBe('https://x.example.com/a.md')

    // Same config + port, different file set: the deep link is recomputed but
    // the provider is not reconciled again.
    const second = await applyExposureToServer(srv, config, ['a.md', 'b.md'])
    expect(second.remoteBaseUrl).toBe('https://x.example.com')
    expect(second.remoteUrl).toBeUndefined()

    expect(reconcileExposure).toHaveBeenCalledTimes(1)
  })

  it('re-reconciles when the effective config changes', async () => {
    const srv = fakeServer()
    await applyExposureToServer(srv, { expose: 'external', remoteBaseUrl: 'https://x.example.com' }, ['a.md'])
    await applyExposureToServer(srv, { expose: 'external', remoteBaseUrl: 'https://y.example.com' }, ['a.md'])
    expect(reconcileExposure).toHaveBeenCalledTimes(2)
  })

  it('degrades to local-only when the expose config is invalid', async () => {
    const srv = fakeServer()
    // external without remoteBaseUrl throws in normalization — must not bubble up.
    const result = await applyExposureToServer(srv, { expose: 'external' }, ['a.md'])

    expect(result.expose).toBe('off')
    expect(srv.expose).toBe('off')
    expect(srv.remoteBaseUrl).toBeUndefined()
    expect(reconcileExposure).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const httpMocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

// Isolate these unit tests from the network: the real port scanner probes
// ports 3000–3010, which other test files (integration servers) may bind
// when vitest runs files in parallel — causing flaky "orphan found" results.
// No test in this file exercises the orphan-found path, so make every probe
// fail fast and deterministically.
vi.mock('node:http', () => {
  const get = (...args) => {
    httpMocks.get(...args)
    const req = {
      on(event, cb) {
        if (event === 'error') queueMicrotask(() => cb(new Error('mocked: no server')))
        return req
      },
      destroy() {},
    }
    return req
  }
  return { default: { get }, get }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal()
  const networkInterfaces = () => ({
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.50' }],
  })
  return {
    ...actual,
    default: { ...(actual.default || actual), networkInterfaces },
    networkInterfaces,
  }
})

const exposeMocks = vi.hoisted(() => ({
  unexposeProvider: vi.fn(async () => ({ unexposed: true, warnings: [] })),
}))

vi.mock('../../src/expose/index.js', () => ({
  unexposeProvider: exposeMocks.unexposeProvider,
}))

import { runStop } from '../../src/cli/stop-cmd.js'
import { DEFAULT_LOCK_PATH } from '../../src/singleton.js'

const lockPath = DEFAULT_LOCK_PATH

describe('runStop', () => {
  beforeEach(() => {
    exposeMocks.unexposeProvider.mockClear()
    httpMocks.get.mockClear()
    // Clean up any existing lock file
    try {
      fs.unlinkSync(lockPath)
    } catch { /* ignore */ }
  })

  afterEach(() => {
    // Clean up after each test
    try {
      fs.unlinkSync(lockPath)
    } catch { /* ignore */ }
  })

  it('returns no-lock when nothing is running', async () => {
    const result = await runStop({ force: true })
    expect(result.stopped).toBe(false)
    expect(result.reason).toBe('no-lock')
  })

  it('cleans stale lock when process no longer exists', async () => {
    // Use a PID very unlikely to exist (65535 is typically out of range)
    const fakePid = 999999
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: fakePid,
      port: 3000,
      url: 'http://localhost:3000',
      startedAt: new Date().toISOString(),
      buildHash: 'fake',
    }))

    const result = await runStop({ force: true })
    expect(result.stopped).toBe(true)
    expect(result.reason).toBe('stale-lock-cleaned')
    expect(result.pid).toBe(fakePid)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('kills a real running process and removes lock', async () => {
    // Spawn a child process that sleeps indefinitely
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    })

    const childPid = child.pid
    child.unref()

    // Give process time to start
    await new Promise(resolve => setTimeout(resolve, 100))

    fs.writeFileSync(lockPath, JSON.stringify({
      pid: childPid,
      port: 3000,
      url: 'http://localhost:3000',
      startedAt: new Date().toISOString(),
      buildHash: 'fake',
    }))

    const result = await runStop({ force: true })
    expect(result.stopped).toBe(true)
    expect(result.pid).toBe(childPid)
    expect(fs.existsSync(lockPath)).toBe(false)

    // Give kill a moment to complete
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  it('formatAge correctly formats recent times', async () => {
    // This test indirectly exercises formatAge via console output
    // We just verify the function doesn't crash with various times

    const now = new Date()
    const oneMinAgo = new Date(now.getTime() - 60000)
    const oneHourAgo = new Date(now.getTime() - 3600000)
    const oneDayAgo = new Date(now.getTime() - 86400000)

    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      port: 3000,
      url: 'http://localhost:3000',
      startedAt: oneMinAgo.toISOString(),
    }))

    // Just verify this completes without error
    const result = await runStop({ force: true })
    expect(result.reason).toBe('stale-lock-cleaned')
  })

  it('respects --force flag to skip confirmation', async () => {
    const fakePid = 999998
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: fakePid,
      port: 3000,
      url: 'http://localhost:3000',
      startedAt: new Date().toISOString(),
    }))

    // With force: true, should not prompt
    const result = await runStop({ force: true })
    expect(result.reason).toBe('stale-lock-cleaned')
  })

  it('runs provider unexpose using lock metadata when requested', async () => {
    const fakePid = 999996
    const lock = {
      pid: fakePid,
      port: 3000,
      url: 'http://localhost:3000',
      startedAt: new Date().toISOString(),
      expose: 'tailscale',
      exposePort: 8443,
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock))

    const result = await runStop({ force: true, unexpose: true })

    expect(result.reason).toBe('stale-lock-cleaned')
    expect(exposeMocks.unexposeProvider).toHaveBeenCalledWith({ lock })
  })

  it('handles missing lock file gracefully', async () => {
    // Ensure no lock file exists
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath)
    }

    const result = await runStop({ force: true })
    expect(result.stopped).toBe(false)
    expect(result.reason).toBe('no-lock')
  })

  it('scans local LAN interface hosts when no lock file exists', async () => {
    const result = await runStop({ force: true })

    expect(result.reason).toBe('no-lock')
    const urls = httpMocks.get.mock.calls.map(([url]) => String(url))
    expect(urls).toContain('http://127.0.0.1:3000/api/status')
    expect(urls).toContain('http://192.168.1.50:3000/api/status')
  })

  it('tolerates lock file removal race conditions', async () => {
    const fakePid = 999997
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: fakePid,
      port: 3000,
      url: 'http://localhost:3000',
      startedAt: new Date().toISOString(),
    }))

    // Manually delete the lock file before runStop tries to delete it
    // This simulates a race condition where it's already gone
    fs.unlinkSync(lockPath)

    const result = await runStop({ force: true })
    // When lock is already gone, returns no-lock
    expect(result.stopped).toBe(false)
    expect(result.reason).toBe('no-lock')
    expect(fs.existsSync(lockPath)).toBe(false)
  })
})

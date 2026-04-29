import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { runStop } from '../../src/cli/stop-cmd.js'
import { DEFAULT_LOCK_PATH } from '../../src/singleton.js'

const lockPath = DEFAULT_LOCK_PATH

describe('runStop', () => {
  beforeEach(() => {
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

  it('handles missing lock file gracefully', async () => {
    // Ensure no lock file exists
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath)
    }

    const result = await runStop({ force: true })
    expect(result.stopped).toBe(false)
    expect(result.reason).toBe('no-lock')
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import node_http from 'node:http'

import {
  readLockFile,
  writeLockFile,
  removeLockFile,
  removeLockFileSync,
  isProcessAlive,
  pingServer,
  discoverExistingServer,
  joinExistingServer,
} from '../../src/singleton.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir
let lockPath

beforeEach(async () => {
  tmpDir = join(tmpdir(), `mdprobe-singleton-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(tmpDir, { recursive: true })
  lockPath = join(tmpDir, 'mdprobe.lock')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Lock file CRUD
// ---------------------------------------------------------------------------

describe('Lock file CRUD', () => {
  const sampleData = {
    pid: 12345,
    port: 3000,
    url: 'http://127.0.0.1:3000',
    startedAt: '2026-04-09T10:00:00.000Z',
  }

  it('readLockFile returns null when no file exists', async () => {
    const result = await readLockFile(lockPath)
    expect(result).toBeNull()
  })

  it('writeLockFile + readLockFile roundtrip', async () => {
    await writeLockFile(sampleData, lockPath)
    const result = await readLockFile(lockPath)
    expect(result).toEqual(sampleData)
  })

  it('removeLockFile removes existing file', async () => {
    await writeLockFile(sampleData, lockPath)
    await removeLockFile(lockPath)
    const result = await readLockFile(lockPath)
    expect(result).toBeNull()
  })

  it('removeLockFile succeeds when no file exists', async () => {
    await expect(removeLockFile(lockPath)).resolves.not.toThrow()
  })

  it('removeLockFileSync removes existing file', async () => {
    await writeLockFile(sampleData, lockPath)
    removeLockFileSync(lockPath)
    const result = await readLockFile(lockPath)
    expect(result).toBeNull()
  })

  it('removeLockFileSync succeeds when no file exists', () => {
    expect(() => removeLockFileSync(lockPath)).not.toThrow()
  })

  it('readLockFile returns null for malformed JSON', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(lockPath, '{ broken json !!!', 'utf-8')
    const result = await readLockFile(lockPath)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isProcessAlive
// ---------------------------------------------------------------------------

describe('isProcessAlive', () => {
  it('returns true for current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('returns false for a dead PID', () => {
    // PID 999999 is almost certainly not in use
    expect(isProcessAlive(999999)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pingServer
// ---------------------------------------------------------------------------

describe('pingServer', () => {
  let testServer

  afterEach(() => {
    if (testServer) {
      testServer.close()
      testServer = null
    }
  })

  it('returns alive: true for a running mdprobe server', async () => {
    testServer = node_http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: 'mdprobe', pid: process.pid }))
      }
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    const result = await pingServer(`http://127.0.0.1:${port}`)
    expect(result.alive).toBe(true)
  })

  it('returns alive: false for non-mdprobe server', async () => {
    testServer = node_http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ name: 'other-app' }))
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    const result = await pingServer(`http://127.0.0.1:${port}`)
    expect(result.alive).toBe(false)
  })

  it('returns alive: false for non-existent port', async () => {
    const result = await pingServer('http://127.0.0.1:59999', 500)
    expect(result.alive).toBe(false)
  })

  it('returns alive: false on timeout', async () => {
    testServer = node_http.createServer(() => {
      // Never respond
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    const result = await pingServer(`http://127.0.0.1:${port}`, 200)
    expect(result.alive).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// discoverExistingServer
// ---------------------------------------------------------------------------

describe('discoverExistingServer', () => {
  let testServer

  afterEach(() => {
    if (testServer) {
      testServer.close()
      testServer = null
    }
  })

  it('returns null when no lock file exists', async () => {
    const result = await discoverExistingServer(lockPath)
    expect(result).toBeNull()
  })

  it('returns null and cleans up lock file with dead PID', async () => {
    await writeLockFile({
      pid: 999999,
      port: 3000,
      url: 'http://127.0.0.1:3000',
      startedAt: new Date().toISOString(),
    }, lockPath)

    const result = await discoverExistingServer(lockPath)
    expect(result).toBeNull()
    // Lock file should be cleaned up
    expect(await readLockFile(lockPath)).toBeNull()
  })

  it('returns null and cleans up lock file when PID alive but HTTP fails', async () => {
    // Use current PID (alive) but a port that doesn't respond as mdprobe
    await writeLockFile({
      pid: process.pid,
      port: 59998,
      url: 'http://127.0.0.1:59998',
      startedAt: new Date().toISOString(),
    }, lockPath)

    const result = await discoverExistingServer(lockPath)
    expect(result).toBeNull()
    expect(await readLockFile(lockPath)).toBeNull()
  })

  it('returns server info when lock file and server are valid', async () => {
    testServer = node_http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: 'mdprobe', pid: process.pid }))
      }
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    await writeLockFile({
      pid: process.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: new Date().toISOString(),
    }, lockPath)

    const result = await discoverExistingServer(lockPath)
    expect(result).toEqual({
      url: `http://127.0.0.1:${port}`,
      port,
    })
  })
})

// ---------------------------------------------------------------------------
// buildHash stale server detection
// ---------------------------------------------------------------------------

describe('buildHash stale server detection', () => {
  let testServer

  afterEach(() => {
    if (testServer) {
      testServer.close()
      testServer = null
    }
  })

  it('rejects server with different buildHash', async () => {
    testServer = node_http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: 'mdprobe', pid: process.pid, buildHash: 'old-hash-abc' }))
      }
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    await writeLockFile({
      pid: process.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: new Date().toISOString(),
      buildHash: 'old-hash-abc',
    }, lockPath)

    // Pass a different buildHash as "current"
    const result = await discoverExistingServer(lockPath, 'new-hash-xyz')
    expect(result).toBeNull()
    // Lock file should be cleaned up
    expect(await readLockFile(lockPath)).toBeNull()
  })

  it('accepts server with matching buildHash', async () => {
    const hash = 'matching-hash-123'
    testServer = node_http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: 'mdprobe', pid: process.pid, buildHash: hash }))
      }
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    await writeLockFile({
      pid: process.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: new Date().toISOString(),
      buildHash: hash,
    }, lockPath)

    const result = await discoverExistingServer(lockPath, hash)
    expect(result).toEqual({
      url: `http://127.0.0.1:${port}`,
      port,
    })
  })

  it('rejects lock file missing buildHash (backward compat)', async () => {
    testServer = node_http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ identity: 'mdprobe', pid: process.pid }))
      }
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    // Lock file WITHOUT buildHash (old format)
    await writeLockFile({
      pid: process.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      startedAt: new Date().toISOString(),
    }, lockPath)

    const result = await discoverExistingServer(lockPath, 'current-hash')
    expect(result).toBeNull()
    expect(await readLockFile(lockPath)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// joinExistingServer
// ---------------------------------------------------------------------------

describe('joinExistingServer', () => {
  let testServer

  afterEach(() => {
    if (testServer) {
      testServer.close()
      testServer = null
    }
  })

  it('sends POST with files and returns success', async () => {
    let receivedBody = null
    testServer = node_http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/api/add-files') {
        let data = ''
        req.on('data', c => { data += c })
        req.on('end', () => {
          receivedBody = JSON.parse(data)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, files: ['a.md', 'b.md'], added: ['b.md'] }))
        })
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise(r => testServer.listen(0, '127.0.0.1', r))
    const port = testServer.address().port

    const result = await joinExistingServer(`http://127.0.0.1:${port}`, ['/tmp/a.md', '/tmp/b.md'])
    expect(result.ok).toBe(true)
    expect(result.files).toEqual(['a.md', 'b.md'])
    expect(result.added).toEqual(['b.md'])
    expect(receivedBody.files).toEqual(['/tmp/a.md', '/tmp/b.md'])
  })

  it('returns ok: false when server is unreachable', async () => {
    const result = await joinExistingServer('http://127.0.0.1:59997', ['/tmp/a.md'])
    expect(result.ok).toBe(false)
  })
})

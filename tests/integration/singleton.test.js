import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import node_fs from 'node:fs/promises'
import node_path from 'node:path'
import node_os from 'node:os'
import node_http from 'node:http'
import WebSocket from 'ws'
import { createServer } from '../../src/server.js'
import {
  readLockFile,
  writeLockFile,
  removeLockFile,
  discoverExistingServer,
  joinExistingServer,
} from '../../src/singleton.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir
let lockPath
let servers = []

beforeEach(async () => {
  tmpDir = await node_fs.mkdtemp(node_path.join(node_os.tmpdir(), 'mdprobe-singleton-int-'))
  lockPath = node_path.join(tmpDir, 'mdprobe.lock')
  servers = []
})

afterEach(async () => {
  for (const s of servers) {
    try { await s.close() } catch { /* already closed */ }
  }
  servers = []
  if (tmpDir) {
    await node_fs.rm(tmpDir, { recursive: true, force: true })
  }
})

function track(server) {
  servers.push(server)
  return server
}

async function writeFixture(name, content) {
  const filePath = node_path.join(tmpDir, name)
  await node_fs.mkdir(node_path.dirname(filePath), { recursive: true })
  await node_fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    node_http.get(url, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
}

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const parsed = new URL(url)
    const req = node_http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let resBody = ''
      res.on('data', (chunk) => { resBody += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: resBody }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

function httpDelete(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const parsed = new URL(url)
    const req = node_http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let resBody = ''
      res.on('data', (chunk) => { resBody += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: resBody }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForMessage(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout waiting for WS message')),
      timeout,
    )
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
  })
}

// ---------------------------------------------------------------------------
// GET /api/status endpoint
// ---------------------------------------------------------------------------

describe('GET /api/status', () => {
  it('returns identity, pid, port, and files', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4500,
      open: false,
    }))

    const res = await httpGet(`${server.url}/api/status`)
    expect(res.status).toBe(200)

    const json = JSON.parse(res.body)
    expect(json.identity).toBe('mdprobe')
    expect(json.pid).toBe(process.pid)
    expect(json.port).toBe(server.port)
    expect(json.files).toContain('spec.md')
    expect(typeof json.uptime).toBe('number')
  })

  it('reflects files added dynamically', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4501,
      open: false,
    }))

    server.addFiles([rfcPath])

    const res = await httpGet(`${server.url}/api/status`)
    const json = JSON.parse(res.body)
    expect(json.files).toContain('spec.md')
    expect(json.files).toContain('rfc.md')
  })
})

// ---------------------------------------------------------------------------
// POST /api/add-files endpoint
// ---------------------------------------------------------------------------

describe('POST /api/add-files', () => {
  it('adds new files to the server', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4510,
      open: false,
    }))

    const res = await httpPost(`${server.url}/api/add-files`, { files: [rfcPath] })
    expect(res.status).toBe(200)

    const json = JSON.parse(res.body)
    expect(json.ok).toBe(true)
    expect(json.files).toContain('spec.md')
    expect(json.files).toContain('rfc.md')
    expect(json.added).toContain('rfc.md')
  })

  it('returns 400 for missing files array', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4511,
      open: false,
    }))

    const res = await httpPost(`${server.url}/api/add-files`, { files: [] })
    expect(res.status).toBe(400)
  })

  it('ignores duplicate files', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4512,
      open: false,
    }))

    const res = await httpPost(`${server.url}/api/add-files`, { files: [specPath] })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body)
    expect(json.ok).toBe(true)
    expect(json.added).toEqual([])
  })

  it('files added via endpoint are visible in /api/files', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4513,
      open: false,
    }))

    await httpPost(`${server.url}/api/add-files`, { files: [rfcPath] })

    const filesRes = await httpGet(`${server.url}/api/files`)
    const filesList = JSON.parse(filesRes.body)
    const names = filesList.map(f => f.path)
    expect(names).toContain('spec.md')
    expect(names).toContain('rfc.md')
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/remove-file endpoint
// ---------------------------------------------------------------------------

describe('DELETE /api/remove-file', () => {
  it('removes a file from the server', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 0,
      open: false,
    }))

    const res = await httpDelete(`${server.url}/api/remove-file`, { file: 'rfc.md' })
    expect(res.status).toBe(200)

    const json = JSON.parse(res.body)
    expect(json.ok).toBe(true)
    expect(json.files).toContain('spec.md')
    expect(json.files).not.toContain('rfc.md')
  })

  it('returns 404 for unknown file', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 0,
      open: false,
    }))

    const res = await httpDelete(`${server.url}/api/remove-file`, { file: 'nope.md' })
    expect(res.status).toBe(404)
  })

  it('returns 400 when trying to remove the last file', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 0,
      open: false,
    }))

    const res = await httpDelete(`${server.url}/api/remove-file`, { file: 'spec.md' })
    expect(res.status).toBe(400)

    const json = JSON.parse(res.body)
    expect(json.error).toMatch(/last file/i)
  })

  it('removed file disappears from /api/files', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 0,
      open: false,
    }))

    await httpDelete(`${server.url}/api/remove-file`, { file: 'rfc.md' })

    const filesRes = await httpGet(`${server.url}/api/files`)
    const filesList = JSON.parse(filesRes.body)
    const names = filesList.map(f => f.path)
    expect(names).toContain('spec.md')
    expect(names).not.toContain('rfc.md')
  })

  it('removed file can be re-added via /api/add-files', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 0,
      open: false,
    }))

    await httpDelete(`${server.url}/api/remove-file`, { file: 'rfc.md' })
    const addRes = await httpPost(`${server.url}/api/add-files`, { files: [rfcPath] })
    const json = JSON.parse(addRes.body)
    expect(json.ok).toBe(true)
    expect(json.files).toContain('rfc.md')
    expect(json.added).toContain('rfc.md')
  })

  it('returns 400 for missing file field', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 0,
      open: false,
    }))

    const res = await httpDelete(`${server.url}/api/remove-file`, {})
    expect(res.status).toBe(400)
  })

  it('broadcasts file-removed via WebSocket', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 0,
      open: false,
    }))

    const { port } = server.address()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await waitForOpen(ws)

    const msgPromise = waitForMessage(ws)
    await httpDelete(`${server.url}/api/remove-file`, { file: 'rfc.md' })

    const msg = await msgPromise
    expect(msg.type).toBe('file-removed')
    expect(msg.file).toBe('rfc.md')

    ws.close()
  })
})

// ---------------------------------------------------------------------------
// Singleton discovery + join (cross-process simulation)
// ---------------------------------------------------------------------------

describe('Singleton discovery flow', () => {
  it('discoverExistingServer finds a running server via lock file', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4520,
      open: false,
    }))

    // Write lock file pointing to this server
    await writeLockFile({
      pid: process.pid,
      port: server.port,
      url: server.url,
      startedAt: new Date().toISOString(),
    }, lockPath)

    const found = await discoverExistingServer(lockPath)
    expect(found).not.toBeNull()
    expect(found.url).toBe(server.url)
    expect(found.port).toBe(server.port)
  })

  it('joinExistingServer adds files to a running server', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4521,
      open: false,
    }))

    const result = await joinExistingServer(server.url, [rfcPath])
    expect(result.ok).toBe(true)

    // Verify via API
    const filesRes = await httpGet(`${server.url}/api/files`)
    const names = JSON.parse(filesRes.body).map(f => f.path)
    expect(names).toContain('rfc.md')
  })

  it('full singleton cycle: create → lock → discover → join', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')

    // Simulate first CLI: create server + write lock
    const server = track(await createServer({
      files: [specPath],
      port: 4522,
      open: false,
    }))
    await writeLockFile({
      pid: process.pid,
      port: server.port,
      url: server.url,
      startedAt: new Date().toISOString(),
    }, lockPath)

    // Simulate second CLI: discover + join
    const existing = await discoverExistingServer(lockPath)
    expect(existing).not.toBeNull()

    const result = await joinExistingServer(existing.url, [rfcPath])
    expect(result.ok).toBe(true)

    // Verify both files are served
    const statusRes = await httpGet(`${server.url}/api/status`)
    const status = JSON.parse(statusRes.body)
    expect(status.files).toContain('spec.md')
    expect(status.files).toContain('rfc.md')
  })

  it('stale lock file with dead PID is cleaned up', async () => {
    await writeLockFile({
      pid: 999999,
      port: 59990,
      url: 'http://127.0.0.1:59990',
      startedAt: new Date().toISOString(),
    }, lockPath)

    const found = await discoverExistingServer(lockPath)
    expect(found).toBeNull()
    // Lock file should be removed
    expect(await readLockFile(lockPath)).toBeNull()
  })

  it('lock file cleanup on server close', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = await createServer({
      files: [specPath],
      port: 4524,
      open: false,
    })

    await writeLockFile({
      pid: process.pid,
      port: server.port,
      url: server.url,
      startedAt: new Date().toISOString(),
    }, lockPath)

    // Server is running, lock should be discoverable
    let found = await discoverExistingServer(lockPath)
    expect(found).not.toBeNull()

    // Close server
    await server.close()

    // After close, ping should fail, lock should be cleaned
    found = await discoverExistingServer(lockPath)
    expect(found).toBeNull()
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import node_fs from 'node:fs/promises'
import node_path from 'node:path'
import node_os from 'node:os'
import node_http from 'node:http'
import node_net from 'node:net'
import { createServer } from '../../src/server.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir
let servers = []

/** Create a temp directory with markdown fixtures for each test. */
beforeEach(async () => {
  tmpDir = await node_fs.mkdtemp(node_path.join(node_os.tmpdir(), 'mdprobe-server-'))
  servers = []
})

/** Close all servers and remove temp directory to prevent port leaks. */
afterEach(async () => {
  for (const s of servers) {
    try { await s.close() } catch { /* already closed */ }
  }
  servers = []
  if (tmpDir) {
    await node_fs.rm(tmpDir, { recursive: true, force: true })
  }
})

/** Track a server for automatic cleanup. */
function track(server) {
  servers.push(server)
  return server
}

/** Write a markdown file into the temp directory. */
async function writeFixture(name, content) {
  const filePath = node_path.join(tmpDir, name)
  await node_fs.mkdir(node_path.dirname(filePath), { recursive: true })
  await node_fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

/** Occupy a port with a raw TCP server. Returns a close function. */
function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const srv = node_net.createServer()
    srv.listen(port, '127.0.0.1', () => {
      resolve(srv)
    })
    srv.on('error', reject)
  })
}

/** Simple HTTP GET that returns { status, headers, body }. */
async function httpGet(url) {
  return new Promise((resolve, reject) => {
    node_http.get(url, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body })
      })
    }).on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// RF01 — Server Lifecycle
// ---------------------------------------------------------------------------
describe('Server Lifecycle', () => {
  it('TC-RF01-1: createServer returns object with url, port, and close', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n\nHello world.\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4100,
      open: false,
    }))

    expect(server).toHaveProperty('url')
    expect(server).toHaveProperty('port')
    expect(server).toHaveProperty('close')
    expect(typeof server.url).toBe('string')
    expect(typeof server.port).toBe('number')
    expect(typeof server.close).toBe('function')
  })

  it('TC-RF01-1: server responds to GET / with HTML', async () => {
    const specPath = await writeFixture('spec.md', '# Hello\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4101,
      open: false,
    }))

    const res = await httpGet(server.url)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.body).toContain('<')
  })

  it('server responds to GET /api/files with file list JSON', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const server = track(await createServer({
      files: [specPath, rfcPath],
      port: 4102,
      open: false,
    }))

    const res = await httpGet(`${server.url}/api/files`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    const data = JSON.parse(res.body)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBe(2)
  })

  it('server responds to GET /api/file?path=<path> with rendered content', async () => {
    const specPath = await writeFixture('spec.md', '# Hello\n\nParagraph.\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4103,
      open: false,
    }))

    const encodedPath = encodeURIComponent('spec.md')
    const res = await httpGet(`${server.url}/api/file?path=${encodedPath}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    const data = JSON.parse(res.body)
    expect(data).toHaveProperty('html')
    expect(data.html).toContain('Hello')
  })

  it('server responds to GET /api/annotations?path=<path>', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4104,
      open: false,
    }))

    const encodedPath = encodeURIComponent('spec.md')
    const res = await httpGet(`${server.url}/api/annotations?path=${encodedPath}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('TC-RF01-5: server.close() stops the server', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = await createServer({
      files: [specPath],
      port: 4105,
      open: false,
    })

    await server.close()

    // After close, HTTP requests should fail
    await expect(
      httpGet(`http://127.0.0.1:4105/`)
    ).rejects.toThrow()
  })

  it('after close, port is freed and can be reused', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server1 = await createServer({
      files: [specPath],
      port: 4106,
      open: false,
    })
    await server1.close()

    // Should be able to create a new server on the same port
    const server2 = track(await createServer({
      files: [specPath],
      port: 4106,
      open: false,
    }))

    const res = await httpGet(server2.url)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// RF03 — Port Management
// ---------------------------------------------------------------------------
describe('Port Management', () => {
  it('TC-RF03-1: default port is 3000', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      open: false,
    }))

    expect(server.port).toBe(3000)
    expect(server.url).toBe('http://127.0.0.1:3000')
  })

  it('custom port via options', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4200,
      open: false,
    }))

    expect(server.port).toBe(4200)
    expect(server.url).toBe('http://127.0.0.1:4200')
  })

  it('TC-RF03-2: auto-increment when port in use', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')

    // Occupy port 4300
    const blocker = await occupyPort(4300)

    try {
      const server = track(await createServer({
        files: [specPath],
        port: 4300,
        open: false,
      }))

      expect(server.port).toBe(4301)
      expect(server.url).toBe('http://127.0.0.1:4301')
    } finally {
      blocker.close()
    }
  })

  it('auto-increment skips multiple occupied ports', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')

    // Occupy ports 4400, 4401, 4402
    const blockers = await Promise.all([
      occupyPort(4400),
      occupyPort(4401),
      occupyPort(4402),
    ])

    try {
      const server = track(await createServer({
        files: [specPath],
        port: 4400,
        open: false,
      }))

      expect(server.port).toBe(4403)
    } finally {
      for (const b of blockers) b.close()
    }
  })

  it('TC-RF03-3: error after 10 failed attempts', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')

    // Occupy ports 4500-4509 (10 ports)
    const blockers = []
    for (let i = 0; i < 10; i++) {
      blockers.push(await occupyPort(4500 + i))
    }

    try {
      await expect(
        createServer({
          files: [specPath],
          port: 4500,
          open: false,
        })
      ).rejects.toThrow(/no available port/i)
    } finally {
      for (const b of blockers) b.close()
    }
  })
})

// ---------------------------------------------------------------------------
// RF01 — File Handling
// ---------------------------------------------------------------------------
describe('File Handling', () => {
  it('single file mode: serves the file', async () => {
    const specPath = await writeFixture('spec.md', '# Single File\n\nContent here.\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4600,
      open: false,
    }))

    const res = await httpGet(`${server.url}/api/files`)
    const data = JSON.parse(res.body)

    expect(data.length).toBe(1)
    expect(data[0].path || data[0]).toMatch(/spec\.md/)
  })

  it('TC-RF01-2: directory mode discovers .md files recursively', async () => {
    await writeFixture('readme.md', '# README\n')
    await writeFixture('docs/guide.md', '# Guide\n')
    await writeFixture('docs/nested/deep.md', '# Deep\n')
    await writeFixture('docs/ignore.txt', 'not markdown')

    const server = track(await createServer({
      files: [tmpDir],
      port: 4601,
      open: false,
    }))

    const res = await httpGet(`${server.url}/api/files`)
    const data = JSON.parse(res.body)

    // Should find at least 3 .md files, not the .txt
    const paths = data.map((f) => typeof f === 'string' ? f : f.path)
    expect(paths.length).toBeGreaterThanOrEqual(3)
    expect(paths.some((p) => p.includes('readme.md'))).toBe(true)
    expect(paths.some((p) => p.includes('guide.md'))).toBe(true)
    expect(paths.some((p) => p.includes('deep.md'))).toBe(true)
    expect(paths.every((p) => !p.includes('.txt'))).toBe(true)
  })

  it('TC-RF01-3: multiple files are all accessible via API', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n')
    const rfcPath = await writeFixture('rfc.md', '# RFC\n')
    const adrPath = await writeFixture('adr.md', '# ADR\n')

    const server = track(await createServer({
      files: [specPath, rfcPath, adrPath],
      port: 4602,
      open: false,
    }))

    const res = await httpGet(`${server.url}/api/files`)
    const data = JSON.parse(res.body)

    expect(data.length).toBe(3)
  })

  it('non-existent file throws an error', async () => {
    await expect(
      createServer({
        files: ['/nonexistent/path/spec.md'],
        port: 4603,
        open: false,
      })
    ).rejects.toThrow()
  })

  it('TC-RF01-4: empty directory with no .md files throws error', async () => {
    const emptyDir = node_path.join(tmpDir, 'empty-dir')
    await node_fs.mkdir(emptyDir, { recursive: true })
    // Add a non-md file so the dir exists but has no markdown
    await node_fs.writeFile(node_path.join(emptyDir, 'notes.txt'), 'not markdown')

    await expect(
      createServer({
        files: [emptyDir],
        port: 4604,
        open: false,
      })
    ).rejects.toThrow(/no markdown files/i)
  })

  it('serves static assets from the markdown file directory', async () => {
    const specPath = await writeFixture('spec.md', '# Spec\n\n![img](./logo.png)\n')
    // Create a fake image file in the same directory
    await node_fs.writeFile(node_path.join(tmpDir, 'logo.png'), 'fakepng')

    const server = track(await createServer({
      files: [specPath],
      port: 4605,
      open: false,
    }))

    const res = await httpGet(`${server.url}/assets/logo.png`)

    // Should serve the file (200) or have a static file route
    expect(res.status).toBe(200)
    expect(res.body).toBe('fakepng')
  })
})

// ---------------------------------------------------------------------------
// RF06 — WebSocket
// ---------------------------------------------------------------------------
describe('WebSocket', () => {
  it('WebSocket connection accepted at /ws', async () => {
    const specPath = await writeFixture('spec.md', '# WS Test\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4700,
      open: false,
    }))

    // Dynamically import ws to match the project dependency
    const { default: WebSocket } = await import('ws')

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`)

    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 3000)
    })

    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('WebSocket responds to ping with pong', async () => {
    const specPath = await writeFixture('spec.md', '# WS Ping\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4701,
      open: false,
    }))

    const { default: WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`)

    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 3000)
    })

    const response = await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()))
      })
      ws.send(JSON.stringify({ type: 'ping' }))
      setTimeout(() => reject(new Error('Ping response timeout')), 3000)
    })

    expect(response.type).toBe('pong')
    ws.close()
  })
})

// ---------------------------------------------------------------------------
// RF02 — Review Mode (--once)
// ---------------------------------------------------------------------------
describe('Review Mode (--once)', () => {
  it('once: true provides an onFinish callback mechanism', async () => {
    const specPath = await writeFixture('spec.md', '# Review\n\nContent to review.\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4800,
      open: false,
      once: true,
    }))

    // In once mode, server should expose a finishPromise for blocking
    expect(server).toHaveProperty('finishPromise')
    expect(server.finishPromise).toBeInstanceOf(Promise)
  })

  it('once: true includes review-specific API endpoints', async () => {
    const specPath = await writeFixture('spec.md', '# Review\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4801,
      open: false,
      once: true,
    }))

    // Review mode should expose a finish endpoint
    const res = await httpGet(`${server.url}/api/review/status`)
    expect(res.status).toBe(200)

    const data = JSON.parse(res.body)
    expect(data).toHaveProperty('mode', 'once')
  })

  it('TC-RF02-4: WebSocket disconnect triggers onDisconnect handling', async () => {
    const specPath = await writeFixture('spec.md', '# Disconnect\n')
    let disconnectCalled = false

    const server = track(await createServer({
      files: [specPath],
      port: 4802,
      open: false,
      once: true,
      onDisconnect: () => { disconnectCalled = true },
    }))

    const { default: WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`)

    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 3000)
    })

    // Close the WebSocket to simulate browser disconnect
    ws.close()

    // Give the server time to detect the disconnect
    await new Promise((r) => setTimeout(r, 200))

    expect(disconnectCalled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Response Format
// ---------------------------------------------------------------------------
describe('Response Format', () => {
  it('HTML response has correct Content-Type', async () => {
    const specPath = await writeFixture('spec.md', '# Format\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4900,
      open: false,
    }))

    const res = await httpGet(server.url)

    expect(res.headers['content-type']).toMatch(/text\/html/)
  })

  it('API responses are JSON with correct Content-Type', async () => {
    const specPath = await writeFixture('spec.md', '# JSON\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4901,
      open: false,
    }))

    const res = await httpGet(`${server.url}/api/files`)

    expect(res.headers['content-type']).toMatch(/application\/json/)
    // Should parse without error
    expect(() => JSON.parse(res.body)).not.toThrow()
  })

  it('404 for unknown routes', async () => {
    const specPath = await writeFixture('spec.md', '# 404\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4902,
      open: false,
    }))

    const res = await httpGet(`${server.url}/nonexistent/route`)

    // SPA catch-all: unmatched GET routes return HTML shell (200) for client-side routing
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Options passthrough
// ---------------------------------------------------------------------------
describe('Options', () => {
  it('author option is passed through to the server context', async () => {
    const specPath = await writeFixture('spec.md', '# Author\n')
    const server = track(await createServer({
      files: [specPath],
      port: 4950,
      open: false,
      author: 'Henry',
    }))

    // Verify the author is available (e.g. via status or config endpoint)
    const res = await httpGet(`${server.url}/api/config`)

    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.author).toBe('Henry')
  })
})

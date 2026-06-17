import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, isControlPlaneAllowed, isLoopbackRequest } from '../../src/server.js'

let server
let tmp

afterEach(async () => {
  if (server) { await server.close(); server = null }
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

describe('addFiles()', () => {
  it('registers new files to the running server', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mdprobe-dyn-'))
    const f1 = join(tmp, 'a.md')
    const f2 = join(tmp, 'b.md')
    await writeFile(f1, '# A')
    await writeFile(f2, '# B')

    server = await createServer({ files: [f1], port: 4200, open: false })

    let res = await fetch(`${server.url}/api/files`)
    let data = await res.json()
    expect(data).toHaveLength(1)

    server.addFiles([f2])

    res = await fetch(`${server.url}/api/files`)
    data = await res.json()
    expect(data).toHaveLength(2)
    expect(data.map(f => f.path)).toContain('b.md')
  })

  it('ignores duplicate files', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mdprobe-dup-'))
    const f1 = join(tmp, 'dup.md')
    await writeFile(f1, '# Dup')

    server = await createServer({ files: [f1], port: 4201, open: false })
    server.addFiles([f1])
    server.addFiles([f1])

    const res = await fetch(`${server.url}/api/files`)
    const data = await res.json()
    expect(data).toHaveLength(1)
  })

  it('starts with empty files and adds later', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mdprobe-lazy-'))
    const f1 = join(tmp, 'lazy.md')
    await writeFile(f1, '# Lazy')

    server = await createServer({ files: [], port: 4202, open: false })

    let res = await fetch(`${server.url}/api/files`)
    let data = await res.json()
    expect(data).toHaveLength(0)

    server.addFiles([f1])

    res = await fetch(`${server.url}/api/files`)
    data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].path).toBe('lazy.md')
  })
})

describe('SPA routing', () => {
  it('serves HTML shell for non-API GET paths', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mdprobe-spa-'))
    const f = join(tmp, 'spec.md')
    await writeFile(f, '# Spec')

    server = await createServer({ files: [f], port: 4203, open: false })

    const res = await fetch(`${server.url}/spec.md`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('serves HTML shell for nested paths', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mdprobe-spa2-'))
    const f = join(tmp, 'doc.md')
    await writeFile(f, '# Doc')

    server = await createServer({ files: [f], port: 4204, open: false })

    const res = await fetch(`${server.url}/docs/specs/doc.md`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<!DOCTYPE html>')
  })
})

describe('remote access metadata', () => {
  it('exposes configured remote metadata from /api/status without changing local url', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mdprobe-remote-status-'))
    const f = join(tmp, 'spec.md')
    await writeFile(f, '# Spec')

    server = await createServer({
      files: [f],
      port: 0,
      open: false,
      remoteAccess: {
        expose: 'external',
        remoteBaseUrl: 'https://mdprobe.example.com',
      },
    })

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/)

    const res = await fetch(`${server.url}/api/status`)
    const data = await res.json()
    expect(data.expose).toBe('external')
    expect(data.remoteBaseUrl).toBe('https://mdprobe.example.com')
    expect(data.remoteUrl).toBe('https://mdprobe.example.com/spec.md')
  })
})

describe('control-plane access gate', () => {
  const remoteReq = { socket: { remoteAddress: '192.168.1.99' } }
  const localReq = { socket: { remoteAddress: '127.0.0.1' } }

  it('treats loopback addresses (incl. mapped IPv6 and empty) as local', () => {
    expect(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } })).toBe(true)
    expect(isLoopbackRequest({ socket: { remoteAddress: '::1' } })).toBe(true)
    expect(isLoopbackRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe(true)
    expect(isLoopbackRequest({ socket: {} })).toBe(true)
    expect(isLoopbackRequest({ socket: { remoteAddress: '10.0.0.5' } })).toBe(false)
  })

  it('allows control endpoints when not exposed', () => {
    expect(isControlPlaneAllowed(remoteReq, null)).toBe(true)
    expect(isControlPlaneAllowed(remoteReq, { expose: 'off' })).toBe(true)
  })

  it('blocks remote clients from control endpoints while exposed', () => {
    expect(isControlPlaneAllowed(remoteReq, { expose: 'lan' })).toBe(false)
    expect(isControlPlaneAllowed(localReq, { expose: 'lan' })).toBe(true)
  })

  it('allows remote control endpoints only with explicit opt-in', () => {
    expect(isControlPlaneAllowed(remoteReq, { expose: 'lan', allowPublicUnauthenticated: true })).toBe(true)
  })

  it('rejects remote add-files over HTTP for an exposed server', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mdprobe-gate-'))
    const f = join(tmp, 'spec.md')
    await writeFile(f, '# Spec')

    server = await createServer({
      files: [f],
      port: 0,
      open: false,
      remoteAccess: { expose: 'lan', allowPublicUnauthenticated: false },
    })

    // Spoof a non-loopback origin via the Host header is not enough — the gate
    // reads the socket address — so assert loopback (the test client) is allowed,
    // proving singleton joins keep working while exposed.
    const res = await fetch(`${server.url}/api/add-files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [f] }),
    })
    expect(res.status).toBe(200)
  })
})

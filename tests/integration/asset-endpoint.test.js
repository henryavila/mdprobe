import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../../src/server.js'

let tmpDir, server
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdprobe-asset-'))
  fs.writeFileSync(path.join(tmpDir, 'doc.md'), '# Hi\n\n![](image.png)\n')
  fs.writeFileSync(path.join(tmpDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))  // PNG header
})
afterEach(async () => {
  if (server) await server.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('/api/asset', () => {
  it('serves a file inside the registered dir', async () => {
    server = await createServer({ files: [path.join(tmpDir, 'doc.md')], port: 0, open: false, author: 'test' })
    const imgPath = path.join(tmpDir, 'image.png')
    const res = await fetch(`${server.url}/api/asset?path=${encodeURIComponent(imgPath)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  it('returns 403 for paths outside registered dirs', async () => {
    server = await createServer({ files: [path.join(tmpDir, 'doc.md')], port: 0, open: false, author: 'test' })
    const res = await fetch(`${server.url}/api/asset?path=${encodeURIComponent('/etc/passwd')}`)
    expect(res.status).toBe(403)
  })

  it('returns 404 for nonexistent files in allowed dirs', async () => {
    server = await createServer({ files: [path.join(tmpDir, 'doc.md')], port: 0, open: false, author: 'test' })
    const fakePath = path.join(tmpDir, 'nope.png')
    const res = await fetch(`${server.url}/api/asset?path=${encodeURIComponent(fakePath)}`)
    expect(res.status).toBe(404)
  })

  it('returns 400 when path query param is missing', async () => {
    server = await createServer({ files: [path.join(tmpDir, 'doc.md')], port: 0, open: false, author: 'test' })
    const res = await fetch(`${server.url}/api/asset`)
    expect(res.status).toBe(400)
  })
})

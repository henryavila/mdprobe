import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import node_fs from 'node:fs/promises'
import node_path from 'node:path'
import node_os from 'node:os'
import node_http from 'node:http'
import { createServer } from '../../src/server.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir
let server
let servers = []

beforeEach(async () => {
  tmpDir = await node_fs.mkdtemp(node_path.join(node_os.tmpdir(), 'mdprobe-api-'))
  servers = []
})

afterEach(async () => {
  for (const s of servers) {
    try { await s.close() } catch {}
  }
  servers = []
  if (tmpDir) await node_fs.rm(tmpDir, { recursive: true, force: true })
})

function track(s) { servers.push(s); return s }

async function writeFixture(name, content) {
  const fp = node_path.join(tmpDir, name)
  await node_fs.writeFile(fp, content, 'utf-8')
  return fp
}

function httpRequest(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url)
    const req = node_http.request({
      hostname: opts.hostname,
      port: opts.port,
      path: opts.pathname + opts.search,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => resolve({ status: res.statusCode, body: data, json: () => JSON.parse(data) }))
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// ---------------------------------------------------------------------------
// POST /api/annotations — Annotation CRUD
// ---------------------------------------------------------------------------
describe('POST /api/annotations', () => {
  let baseUrl

  beforeEach(async () => {
    await writeFixture('spec.md', '# Spec\n\n## Requirements\n\n- **RF01:** Validate inputs\n  - email validated\n')
    server = track(await createServer({ files: [node_path.join(tmpDir, 'spec.md')], port: 5100, open: false }))
    baseUrl = server.url
  })

  it('POST add creates annotation and returns updated list', async () => {
    const res = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: {
        selectors: {
          position: { startLine: 5, startColumn: 11, endLine: 5, endColumn: 26 },
          quote: { exact: 'Validate inputs', prefix: '- **RF01:** ', suffix: '\n' },
        },
        comment: 'Which inputs?',
        tag: 'question',
        author: 'Henry',
      },
    })

    expect(res.status).toBe(200)
    const json = res.json()
    expect(json.annotations).toBeDefined()
    expect(json.annotations.length).toBe(1)
    expect(json.annotations[0].comment).toBe('Which inputs?')
    expect(json.annotations[0].tag).toBe('question')
    expect(json.annotations[0].status).toBe('open')
    expect(json.annotations[0].author).toBe('Henry')
    expect(json.annotations[0].id).toBeDefined()
  })

  it('YAML sidecar file is created on disk after add', async () => {
    await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: {
        selectors: { position: { startLine: 5 } },
        comment: 'test',
        tag: 'bug',
        author: 'Alice',
      },
    })

    const sidecarPath = node_path.join(tmpDir, 'spec.annotations.yaml')
    const stat = await node_fs.stat(sidecarPath)
    expect(stat.isFile()).toBe(true)

    const content = await node_fs.readFile(sidecarPath, 'utf-8')
    expect(content).toContain('version:')
    expect(content).toContain('comment: test')
  })

  it('POST resolve changes annotation status', async () => {
    // First create
    const addRes = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: {
        selectors: { position: { startLine: 5 } },
        comment: 'fix this',
        tag: 'bug',
        author: 'Alice',
      },
    })
    const id = addRes.json().annotations[0].id

    // Then resolve
    const res = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'resolve',
      data: { id },
    })

    expect(res.status).toBe(200)
    const ann = res.json().annotations.find(a => a.id === id)
    expect(ann.status).toBe('resolved')
  })

  it('POST reopen changes status back to open', async () => {
    const addRes = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: { selectors: { position: { startLine: 5 } }, comment: 'c', tag: 'bug', author: 'A' },
    })
    const id = addRes.json().annotations[0].id

    await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md', action: 'resolve', data: { id },
    })

    const res = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md', action: 'reopen', data: { id },
    })

    expect(res.status).toBe(200)
    expect(res.json().annotations.find(a => a.id === id).status).toBe('open')
  })

  it('POST update changes comment and tag', async () => {
    const addRes = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: { selectors: { position: { startLine: 5 } }, comment: 'original', tag: 'bug', author: 'A' },
    })
    const id = addRes.json().annotations[0].id

    const res = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'update',
      data: { id, comment: 'updated comment', tag: 'suggestion' },
    })

    expect(res.status).toBe(200)
    const ann = res.json().annotations.find(a => a.id === id)
    expect(ann.comment).toBe('updated comment')
    expect(ann.tag).toBe('suggestion')
  })

  it('POST delete removes annotation', async () => {
    const addRes = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: { selectors: { position: { startLine: 5 } }, comment: 'to delete', tag: 'nitpick', author: 'A' },
    })
    const id = addRes.json().annotations[0].id

    const res = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md', action: 'delete', data: { id },
    })

    expect(res.status).toBe(200)
    expect(res.json().annotations.length).toBe(0)
  })

  it('POST reply adds reply to annotation', async () => {
    const addRes = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: { selectors: { position: { startLine: 5 } }, comment: 'question', tag: 'question', author: 'Alice' },
    })
    const id = addRes.json().annotations[0].id

    const res = await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'reply',
      data: { id, author: 'Bob', comment: 'Answered' },
    })

    expect(res.status).toBe(200)
    const ann = res.json().annotations.find(a => a.id === id)
    expect(ann.replies.length).toBe(1)
    expect(ann.replies[0].author).toBe('Bob')
    expect(ann.replies[0].comment).toBe('Answered')
  })

  it('GET after POST returns persisted annotations', async () => {
    await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: { selectors: { position: { startLine: 5 } }, comment: 'persisted', tag: 'bug', author: 'A' },
    })

    const res = await httpRequest(`${baseUrl}/api/annotations?path=spec.md`)
    expect(res.status).toBe(200)
    const json = res.json()
    expect(json.annotations.length).toBe(1)
    expect(json.annotations[0].comment).toBe('persisted')
  })
})

// ---------------------------------------------------------------------------
// POST /api/sections — Section approval
// ---------------------------------------------------------------------------
describe('POST /api/sections', () => {
  let baseUrl

  beforeEach(async () => {
    await writeFixture('spec.md', '# Spec\n\n## Requirements\n\nContent.\n\n## Edge Cases\n\nMore content.\n')
    server = track(await createServer({ files: [node_path.join(tmpDir, 'spec.md')], port: 5200, open: false }))
    baseUrl = server.url

    // Create initial sidecar with sections (need at least one annotation to create sidecar)
    await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: { selectors: { position: { startLine: 3 } }, comment: 'init', tag: 'bug', author: 'A' },
    })
  })

  it('POST approve sets section status to approved', async () => {
    const res = await httpRequest(`${baseUrl}/api/sections`, 'POST', {
      file: 'spec.md', action: 'approve', heading: 'Requirements',
    })

    expect(res.status).toBe(200)
    const section = res.json().sections.find(s => s.heading === 'Requirements')
    expect(section.status).toBe('approved')
  })

  it('POST reject sets section status to rejected', async () => {
    const res = await httpRequest(`${baseUrl}/api/sections`, 'POST', {
      file: 'spec.md', action: 'reject', heading: 'Edge Cases',
    })

    expect(res.status).toBe(200)
    const section = res.json().sections.find(s => s.heading === 'Edge Cases')
    expect(section.status).toBe('rejected')
  })

  it('POST approveAll approves all sections', async () => {
    const res = await httpRequest(`${baseUrl}/api/sections`, 'POST', {
      file: 'spec.md', action: 'approveAll',
    })

    expect(res.status).toBe(200)
    for (const s of res.json().sections) {
      expect(s.status).toBe('approved')
    }
  })

  it('POST clearAll resets all sections to pending', async () => {
    await httpRequest(`${baseUrl}/api/sections`, 'POST', {
      file: 'spec.md', action: 'approveAll',
    })

    const res = await httpRequest(`${baseUrl}/api/sections`, 'POST', {
      file: 'spec.md', action: 'clearAll',
    })

    expect(res.status).toBe(200)
    for (const s of res.json().sections) {
      expect(s.status).toBe('pending')
    }
  })
})

// ---------------------------------------------------------------------------
// GET /api/export — Export
// ---------------------------------------------------------------------------
describe('GET /api/export', () => {
  let baseUrl

  beforeEach(async () => {
    await writeFixture('spec.md', '# Spec\n\n## Req\n\n- Item\n')
    server = track(await createServer({ files: [node_path.join(tmpDir, 'spec.md')], port: 5300, open: false }))
    baseUrl = server.url

    // Create an annotation for export
    await httpRequest(`${baseUrl}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: { selectors: { position: { startLine: 5 } }, comment: 'check this', tag: 'bug', author: 'Henry' },
    })
  })

  it('GET /api/export?path=spec.md&format=report returns markdown report', async () => {
    const res = await httpRequest(`${baseUrl}/api/export?path=spec.md&format=report`)

    expect(res.status).toBe(200)
    expect(res.body).toContain('spec.md')
    expect(res.body).toContain('check this')
  })

  it('GET /api/export?path=spec.md&format=json returns JSON', async () => {
    const res = await httpRequest(`${baseUrl}/api/export?path=spec.md&format=json`)

    expect(res.status).toBe(200)
    const json = res.json()
    expect(json.annotations.length).toBe(1)
  })

  it('GET /api/export?path=spec.md&format=sarif returns SARIF', async () => {
    const res = await httpRequest(`${baseUrl}/api/export?path=spec.md&format=sarif`)

    expect(res.status).toBe(200)
    const json = res.json()
    expect(json.version).toBe('2.1.0')
    expect(json.runs[0].results.length).toBe(1)
  })

  it('GET /api/export?path=spec.md&format=inline returns inline markdown', async () => {
    const res = await httpRequest(`${baseUrl}/api/export?path=spec.md&format=inline`)

    expect(res.status).toBe(200)
    expect(res.body).toContain('# Spec')
    expect(res.body).toContain('<!--')
  })

  it('GET /api/export without annotations returns error or empty report', async () => {
    await writeFixture('empty.md', '# Empty\n')
    const s2 = track(await createServer({ files: [node_path.join(tmpDir, 'empty.md')], port: 5301, open: false }))

    const res = await httpRequest(`${s2.url}/api/export?path=empty.md&format=report`)
    // Should still work, just show "no annotations"
    expect(res.status).toBe(200)
    expect(res.body.toLowerCase()).toMatch(/no annotations/i)
  })

  // ---------------------------------------------------------------------------
  // POST /api/broadcast — forward WebSocket broadcasts from remote MCP
  // ---------------------------------------------------------------------------

  it('POST /api/broadcast forwards message to WebSocket clients', async () => {
    await writeFixture('broadcast-test.md', '# Broadcast\n\nHello')
    const s = track(await createServer({ files: [node_path.join(tmpDir, 'broadcast-test.md')], port: 0, open: false }))

    // Connect a WebSocket client
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`)
    const messages = []
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
      setTimeout(() => reject(new Error('WS connect timeout')), 3000)
    })
    ws.on('message', data => messages.push(JSON.parse(data.toString())))

    // POST a broadcast message (simulating remote MCP proxy)
    const broadcastRes = await httpRequest(`${s.url}/api/broadcast`, 'POST', {
      type: 'annotations',
      file: 'broadcast-test.md',
      annotations: [{ id: 'bcast1', status: 'open', tag: 'bug', comment: 'from remote' }],
      sections: [],
    })

    expect(broadcastRes.status).toBe(200)

    // Give WebSocket time to receive
    await new Promise(r => setTimeout(r, 100))
    ws.close()

    const annMsg = messages.find(m => m.type === 'annotations')
    expect(annMsg).toBeDefined()
    expect(annMsg.annotations[0].id).toBe('bcast1')
  })
})

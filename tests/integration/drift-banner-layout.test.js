import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import node_fs from 'node:fs/promises'
import node_path from 'node:path'
import node_os from 'node:os'
import node_http from 'node:http'
import { createServer } from '../../src/server.js'

// ---------------------------------------------------------------------------
// Drift banner layout integration test
//
// Root cause: #app grid had grid-template-rows: 48px 1fr 32px (3 rows).
// When drift-banner appeared as a 4th grid child, it stole the 1fr row,
// pushing content to implicit 0px rows. Entire page appeared solid blue.
//
// This test reproduces the REAL scenario:
// 1. Start server with a .md file
// 2. Create an annotation (establishes source_hash in YAML sidecar)
// 3. Modify the .md file (hash changes → drift detected)
// 4. Verify drift=true in API response
// 5. Verify the served CSS handles the drift banner correctly
// ---------------------------------------------------------------------------

let tmpDir
let servers = []

beforeEach(async () => {
  tmpDir = await node_fs.mkdtemp(node_path.join(node_os.tmpdir(), 'mdprobe-drift-'))
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

describe('Drift banner layout (integration)', () => {
  it('drift detection triggers when file changes after annotation, and CSS handles the banner', async () => {
    // Step 1: Create server with a .md file
    const mdPath = await writeFixture('spec.md', '# Spec\n\n## Section A\n\nOriginal content.\n')
    const server = track(await createServer({
      files: [mdPath],
      port: 5200,
      open: false,
    }))

    // Step 2: Create an annotation (this saves source_hash in YAML sidecar)
    const addRes = await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'spec.md',
      action: 'add',
      data: {
        selectors: {
          position: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 17 },
          quote: { exact: 'Original content', prefix: '', suffix: '' },
        },
        comment: 'Test annotation',
        tag: 'question',
        author: 'Tester',
      },
    })
    expect(addRes.status).toBe(200)

    // Step 3: Modify the .md file (changes the hash → drift)
    await node_fs.writeFile(mdPath, '# Spec\n\n## Section A\n\nModified content — different hash.\n', 'utf-8')
    // Wait for chokidar to detect
    await new Promise(r => setTimeout(r, 300))

    // Step 4: Verify drift is detected via API
    const annRes = await httpRequest(`${server.url}/api/annotations?path=spec.md`)
    const annData = annRes.json()
    expect(annData.drift).toBeTruthy()

    // Step 5: Verify CSS served by the server handles drift banner
    // Fetch the HTML shell to find the CSS asset path
    const htmlRes = await httpRequest(`${server.url}/`)
    const cssMatch = htmlRes.body.match(/href="(\/assets\/[^"]+\.css)"/)
    expect(cssMatch).toBeTruthy()

    const cssRes = await httpRequest(`${server.url}${cssMatch[1]}`)
    expect(cssRes.status).toBe(200)
    const css = cssRes.body

    // The grid must have 4 rows (header + drift-banner + content + footer)
    const gridRowsMatch = css.match(/grid-template-rows:\s*([^;}]+)/)
    expect(gridRowsMatch).toBeTruthy()
    const rowTracks = gridRowsMatch[1].trim().split(/\s+/)
    expect(rowTracks.length).toBeGreaterThanOrEqual(4)

    // drift-banner must have explicit grid-row placement
    const driftSection = css.match(/\.drift-banner\s*\{([^}]+)\}/)
    expect(driftSection).toBeTruthy()
    expect(driftSection[1]).toContain('grid-row')

    // content-area-wrapper must have explicit grid-row placement
    const contentSection = css.match(/\.content-area-wrapper\s*\{([^}]+)\}/)
    expect(contentSection).toBeTruthy()
    expect(contentSection[1]).toContain('grid-row')

    // The content grid-row must be AFTER the drift-banner grid-row
    const driftRow = driftSection[1].match(/grid-row:\s*(\d+)/)
    const contentRow = contentSection[1].match(/grid-row:\s*(\d+)/)
    expect(driftRow).toBeTruthy()
    expect(contentRow).toBeTruthy()
    expect(Number(contentRow[1])).toBeGreaterThan(Number(driftRow[1]))
  })

  it('drift response includes anchorStatus with orphan when annotated text is deleted', async () => {
    const mdPath = await writeFixture('orphan.md', '# Orphan Test\n\nThis exact text will be annotated.\n\nAnother paragraph.\n')
    const server = track(await createServer({
      files: [mdPath],
      port: 5210,
      open: false,
    }))

    const addRes = await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'orphan.md',
      action: 'add',
      data: {
        selectors: {
          position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 40 },
          quote: { exact: 'This exact text will be annotated.', prefix: '', suffix: '' },
        },
        comment: 'Test',
        tag: 'bug',
        author: 'Tester',
      },
    })
    expect(addRes.status).toBe(200)
    const annotationId = addRes.json().annotations[0].id

    await node_fs.writeFile(mdPath, '# Orphan Test\n\nCompletely different content now.\n\nAnother paragraph.\n', 'utf-8')
    await new Promise(r => setTimeout(r, 300))

    const annRes = await httpRequest(`${server.url}/api/annotations?path=orphan.md`)
    const data = annRes.json()

    expect(data.drift).toBeTruthy()
    expect(typeof data.drift).toBe('object')
    expect(data.drift.anchorStatus).toBeDefined()
    expect(data.drift.anchorStatus[annotationId]).toBe('orphan')
  })

  it('drift response shows anchored status when text is moved but still present', async () => {
    const mdPath = await writeFixture('moved.md', '# Moved Test\n\nOriginal text here.\n')
    const server = track(await createServer({
      files: [mdPath],
      port: 5211,
      open: false,
    }))

    const addRes = await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'moved.md',
      action: 'add',
      data: {
        selectors: {
          position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 20 },
          quote: { exact: 'Original text here.', prefix: '', suffix: '' },
        },
        comment: 'Test',
        tag: 'question',
        author: 'Tester',
      },
    })
    expect(addRes.status).toBe(200)
    const annotationId = addRes.json().annotations[0].id

    await node_fs.writeFile(mdPath, '# Moved Test\n\nNew line 1.\n\nNew line 2.\n\nOriginal text here.\n', 'utf-8')
    await new Promise(r => setTimeout(r, 300))

    const annRes = await httpRequest(`${server.url}/api/annotations?path=moved.md`)
    const data = annRes.json()

    expect(data.drift).toBeTruthy()
    expect(typeof data.drift).toBe('object')
    expect(data.drift.anchorStatus[annotationId]).toBe('anchored')
  })

  it('WebSocket broadcasts drift with anchorStatus when file changes', async () => {
    const mdPath = await writeFixture('ws-drift.md', '# WS Test\n\nAnnotated text here.\n')
    const server = track(await createServer({
      files: [mdPath],
      port: 5212,
      open: false,
    }))

    // Add annotation
    await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'ws-drift.md',
      action: 'add',
      data: {
        selectors: {
          position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 22 },
          quote: { exact: 'Annotated text here.', prefix: '', suffix: '' },
        },
        comment: 'WS test',
        tag: 'bug',
        author: 'Tester',
      },
    })

    // Connect WebSocket and listen for drift message
    const WebSocket = (await import('ws')).default
    const ws = new WebSocket(`ws://127.0.0.1:5212/ws`)
    const messages = []

    await new Promise((resolve) => { ws.on('open', resolve) })
    ws.on('message', (data) => { messages.push(JSON.parse(data.toString())) })

    // Modify file — delete annotated text to create orphan
    await node_fs.writeFile(mdPath, '# WS Test\n\nTotally different content.\n', 'utf-8')

    // Wait for debounce + processing
    await new Promise(r => setTimeout(r, 500))

    ws.close()

    // Find drift message
    const driftMsg = messages.find(m => m.type === 'drift')
    expect(driftMsg).toBeDefined()
    expect(driftMsg.anchorStatus).toBeDefined()
    // The annotation's text was deleted → orphan
    const statuses = Object.values(driftMsg.anchorStatus)
    expect(statuses).toContain('orphan')
  })

  it('layout is correct when there is no drift (no banner in DOM)', async () => {
    // Start server, do NOT create annotations → no sidecar → no drift
    const mdPath = await writeFixture('clean.md', '# Clean\n\nNo annotations here.\n')
    const server = track(await createServer({
      files: [mdPath],
      port: 5201,
      open: false,
    }))

    // No drift detected
    const annRes = await httpRequest(`${server.url}/api/annotations?path=clean.md`)
    const annData = annRes.json()
    expect(annData.drift).toBeFalsy()

    // CSS grid still has 4 rows — the auto row for drift-banner collapses to 0
    const htmlRes = await httpRequest(`${server.url}/`)
    const cssMatch = htmlRes.body.match(/href="(\/assets\/[^"]+\.css)"/)
    const cssRes = await httpRequest(`${server.url}${cssMatch[1]}`)
    const gridRowsMatch = cssRes.body.match(/grid-template-rows:\s*([^;}]+)/)
    const rowTracks = gridRowsMatch[1].trim().split(/\s+/)

    // 4 rows: 48px auto 1fr 32px — the auto row collapses when banner absent
    expect(rowTracks).toEqual(['48px', 'auto', '1fr', '32px'])
  })

  it('no drift field when file has no annotations', async () => {
    const mdPath = await writeFixture('nodrift.md', '# No Drift\n\nClean file.\n')
    const server = track(await createServer({
      files: [mdPath],
      port: 5213,
      open: false,
    }))

    const res = await httpRequest(`${server.url}/api/annotations?path=nodrift.md`)
    const data = res.json()

    expect(data.drift).toBeFalsy()
  })

  it('drift object is truthy for backward compatibility', async () => {
    const mdPath = await writeFixture('compat.md', '# Compat\n\nSome text.\n')
    const server = track(await createServer({
      files: [mdPath],
      port: 5214,
      open: false,
    }))

    await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'compat.md',
      action: 'add',
      data: {
        selectors: {
          position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 10 },
          quote: { exact: 'Some text.', prefix: '', suffix: '' },
        },
        comment: 'Test',
        tag: 'bug',
        author: 'Tester',
      },
    })

    await node_fs.writeFile(mdPath, '# Compat\n\nChanged.\n', 'utf-8')
    await new Promise(r => setTimeout(r, 300))

    const res = await httpRequest(`${server.url}/api/annotations?path=compat.md`)
    const data = res.json()

    // Object is truthy — backward compatible with `if (data.drift)`
    expect(data.drift).toBeTruthy()
    expect(typeof data.drift).toBe('object')
  })
})

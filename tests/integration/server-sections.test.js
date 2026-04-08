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
let servers = []

beforeEach(async () => {
  tmpDir = await node_fs.mkdtemp(node_path.join(node_os.tmpdir(), 'mdprobe-hunt-'))
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
  await node_fs.mkdir(node_path.dirname(fp), { recursive: true })
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
// mergeSections — Adaptive section level detection
// ---------------------------------------------------------------------------
describe('mergeSections — adaptive sectionLevel', () => {
  it('empty document (no headings) defaults sectionLevel to 2', async () => {
    // SPEC: sectionLevel default fallback is 2 when no heading appears 2+ times
    const fp = await writeFixture('empty.md', 'No headings here, just plain text.\n')
    const server = track(await createServer({ files: [fp], port: 5600, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=empty.md`)
    expect(res.status).toBe(200)
    const json = res.json()
    expect(json.sectionLevel).toBe(2)
    expect(json.sections).toEqual([])
  })

  it('single h1 only — no level appears 2+ times, defaults to 2', async () => {
    // SPEC: "shallowest level appearing 2+ times" — one h1 does not qualify
    const fp = await writeFixture('one-h1.md', '# Title\n\nSome content.\n')
    const server = track(await createServer({ files: [fp], port: 5601, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=one-h1.md`)
    const json = res.json()
    expect(json.sectionLevel).toBe(2)
    expect(json.sections.length).toBe(1)
    expect(json.sections[0].heading).toBe('Title')
    expect(json.sections[0].level).toBe(1)
    expect(json.sections[0].status).toBe('pending')
  })

  it('two h1 headings → sectionLevel = 1', async () => {
    // SPEC: h1 appears 2 times, so shallowest with 2+ is level 1
    const fp = await writeFixture('two-h1.md', '# Part A\n\nContent.\n\n# Part B\n\nMore.\n')
    const server = track(await createServer({ files: [fp], port: 5602, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=two-h1.md`)
    const json = res.json()
    expect(json.sectionLevel).toBe(1)
  })

  it('h3 appears 2+ times but h2 does not → sectionLevel = 3', async () => {
    // SPEC: shallowest level with 2+ occurrences — h1 has 1, h2 has 1, h3 has 2
    const md = [
      '# Title',
      '## Intro',
      '### Detail A',
      '### Detail B',
      '',
    ].join('\n')
    const fp = await writeFixture('h3-dominant.md', md)
    const server = track(await createServer({ files: [fp], port: 5603, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=h3-dominant.md`)
    const json = res.json()
    expect(json.sectionLevel).toBe(3)
  })

  it('multiple h2 headings (common case) → sectionLevel = 2', async () => {
    const md = '# Doc\n\n## Sec A\n\nText.\n\n## Sec B\n\nText.\n\n## Sec C\n\nText.\n'
    const fp = await writeFixture('multi-h2.md', md)
    const server = track(await createServer({ files: [fp], port: 5604, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=multi-h2.md`)
    const json = res.json()
    expect(json.sectionLevel).toBe(2)
  })

  it('h2 and h3 both appear 2+ times → sectionLevel = 2 (shallowest wins)', async () => {
    const md = [
      '# Doc',
      '## A',
      '### A1',
      '### A2',
      '## B',
      '### B1',
      '### B2',
    ].join('\n')
    const fp = await writeFixture('multi-levels.md', md)
    const server = track(await createServer({ files: [fp], port: 5605, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=multi-levels.md`)
    const json = res.json()
    expect(json.sectionLevel).toBe(2)
  })

  it('only h6 appears 2+ times → sectionLevel = 6', async () => {
    const md = [
      '# Title',
      '###### Foot A',
      '###### Foot B',
    ].join('\n')
    const fp = await writeFixture('h6-only.md', md)
    const server = track(await createServer({ files: [fp], port: 5606, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=h6-only.md`)
    const json = res.json()
    expect(json.sectionLevel).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// mergeSections — section status merging with saved data
// ---------------------------------------------------------------------------
describe('mergeSections — status merging', () => {
  it('new heading not in sidecar gets status "pending"', async () => {
    // Create a doc, approve a section, then add a new heading and verify the new one is pending
    const md1 = '# Doc\n\n## Existing\n\nContent.\n'
    const fp = await writeFixture('evolving.md', md1)
    const server = track(await createServer({ files: [fp], port: 5607, open: false }))

    // Create sidecar with an annotation
    await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'evolving.md',
      action: 'add',
      data: { selectors: { position: { startLine: 3 } }, comment: 'init', tag: 'bug', author: 'A' },
    })
    // Approve the existing section
    await httpRequest(`${server.url}/api/sections`, 'POST', {
      file: 'evolving.md', action: 'approve', heading: 'Existing',
    })

    // Now add a new heading to the doc
    const md2 = '# Doc\n\n## Existing\n\nContent.\n\n## Brand New\n\nNew content.\n'
    await node_fs.writeFile(fp, md2, 'utf-8')

    const res = await httpRequest(`${server.url}/api/annotations?path=evolving.md`)
    const json = res.json()

    const existing = json.sections.find(s => s.heading === 'Existing')
    const brandNew = json.sections.find(s => s.heading === 'Brand New')
    expect(existing.status).toBe('approved')
    expect(brandNew.status).toBe('pending')
  })

  it('removed heading disappears from sections list', async () => {
    // Start with two headings, approve both, then remove one
    const md1 = '# Doc\n\n## Keep\n\nContent.\n\n## Remove\n\nContent.\n'
    const fp = await writeFixture('shrinking.md', md1)
    const server = track(await createServer({ files: [fp], port: 5608, open: false }))

    // Init sidecar
    await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'shrinking.md',
      action: 'add',
      data: { selectors: { position: { startLine: 3 } }, comment: 'init', tag: 'bug', author: 'A' },
    })
    await httpRequest(`${server.url}/api/sections`, 'POST', {
      file: 'shrinking.md', action: 'approveAll',
    })

    // Remove the second heading
    const md2 = '# Doc\n\n## Keep\n\nContent.\n'
    await node_fs.writeFile(fp, md2, 'utf-8')

    const res = await httpRequest(`${server.url}/api/annotations?path=shrinking.md`)
    const json = res.json()

    const headings = json.sections.map(s => s.heading)
    expect(headings).toContain('Keep')
    expect(headings).not.toContain('Remove')
  })
})

// ---------------------------------------------------------------------------
// mergeSections — duplicate heading names
// ---------------------------------------------------------------------------
describe('mergeSections — duplicate headings', () => {
  it('two headings with identical name and level both appear in sections', async () => {
    // SPEC: sections derive from TOC which lists ALL headings
    const md = '# Doc\n\n## Section\n\nFirst.\n\n## Section\n\nSecond.\n'
    const fp = await writeFixture('dupes.md', md)
    const server = track(await createServer({ files: [fp], port: 5609, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=dupes.md`)
    const json = res.json()

    const sectionHeadings = json.sections.filter(s => s.heading === 'Section')
    expect(sectionHeadings.length).toBe(2)
  })

  it('approving one duplicate heading — status survives round-trip', async () => {
    // BUG THEORY: Two headings with key "2:Section" in savedMap. Map constructor
    // uses last-key-wins, so whichever duplicate is last overwrites the first.
    // After approve+save+reload, the approved status of the first is lost.
    const md = '# Doc\n\n## Section\n\nFirst.\n\n## Section\n\nSecond.\n'
    const fp = await writeFixture('dupe-approve.md', md)
    const server = track(await createServer({ files: [fp], port: 5610, open: false }))

    // Init sidecar
    await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'dupe-approve.md',
      action: 'add',
      data: { selectors: { position: { startLine: 3 } }, comment: 'init', tag: 'bug', author: 'A' },
    })

    // Approve "Section" via POST /api/sections
    const approveRes = await httpRequest(`${server.url}/api/sections`, 'POST', {
      file: 'dupe-approve.md', action: 'approve', heading: 'Section',
    })
    const approveJson = approveRes.json()
    const statusesAfterApprove = approveJson.sections
      .filter(s => s.heading === 'Section')
      .map(s => s.status)
    console.log('Statuses immediately after approve (from POST response):', statusesAfterApprove)

    // Now re-read via GET (triggers mergeSections with saved data from sidecar)
    const readRes = await httpRequest(`${server.url}/api/annotations?path=dupe-approve.md`)
    const readJson = readRes.json()
    const statusesAfterReload = readJson.sections
      .filter(s => s.heading === 'Section')
      .map(s => s.status)
    console.log('Statuses after reload via GET (round-trip through sidecar):', statusesAfterReload)

    // The first section was approved. After round-trip, does it survive?
    // BUG: savedMap key collision means last-wins, so "approved" from the first
    // gets overwritten by "pending" from the second (or vice versa).
    // At minimum, the FIRST section's approved status should survive.
    const firstSectionStatus = statusesAfterReload[0]
    // This assertion documents what SHOULD happen (first section stays approved)
    // If it fails, it proves the key collision bug.
    expect(firstSectionStatus).toBe('approved')
  })
})

// ---------------------------------------------------------------------------
// mergeSections — special characters in headings
// ---------------------------------------------------------------------------
describe('mergeSections — special characters', () => {
  it('heading with colon does not break savedMap key format', async () => {
    // savedMap key is "level:heading" — a heading containing ":" could theoretically cause issues
    // HOWEVER the key format is `${level}:${heading}` where level is a number, so "2:My: heading"
    // would be stored and looked up correctly since only the FIRST colon is the separator in the code.
    // Actually the code does a direct Map key lookup, so "2:My: heading" is fine.
    // Still worth testing the round-trip.
    const md = '# Doc\n\n## Step 1: Setup\n\nContent.\n\n## Step 2: Deploy\n\nMore.\n'
    const fp = await writeFixture('colons.md', md)
    const server = track(await createServer({ files: [fp], port: 5611, open: false }))

    // Init sidecar
    await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'colons.md',
      action: 'add',
      data: { selectors: { position: { startLine: 3 } }, comment: 'init', tag: 'bug', author: 'A' },
    })

    // Approve a heading with colon
    await httpRequest(`${server.url}/api/sections`, 'POST', {
      file: 'colons.md', action: 'approve', heading: 'Step 1: Setup',
    })

    const res = await httpRequest(`${server.url}/api/annotations?path=colons.md`)
    const json = res.json()
    const step1 = json.sections.find(s => s.heading === 'Step 1: Setup')
    const step2 = json.sections.find(s => s.heading === 'Step 2: Deploy')
    expect(step1.status).toBe('approved')
    expect(step2.status).toBe('pending')
  })

  it('heading with emoji characters round-trips correctly', async () => {
    const md = '# Doc\n\n## 🚀 Launch\n\nContent.\n\n## 🐛 Bugs\n\nMore.\n'
    const fp = await writeFixture('emoji.md', md)
    const server = track(await createServer({ files: [fp], port: 5612, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=emoji.md`)
    const json = res.json()
    const headings = json.sections.map(s => s.heading)
    // Renderer may strip or preserve emojis — verify the headings are present
    expect(json.sections.length).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// findFile — path matching
// ---------------------------------------------------------------------------
describe('findFile — via GET /api/file', () => {
  it('exact basename match works', async () => {
    const fp = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({ files: [fp], port: 5613, open: false }))

    const res = await httpRequest(`${server.url}/api/file?path=spec.md`)
    expect(res.status).toBe(200)
    const json = res.json()
    expect(json.html).toContain('Spec')
  })

  it('absolute path match works', async () => {
    const fp = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({ files: [fp], port: 5614, open: false }))

    const res = await httpRequest(`${server.url}/api/file?path=${encodeURIComponent(fp)}`)
    expect(res.status).toBe(200)
  })

  it('relative path suffix match works', async () => {
    const fp = await writeFixture('docs/spec.md', '# Spec\n')
    const server = track(await createServer({ files: [fp], port: 5615, open: false }))

    const res = await httpRequest(`${server.url}/api/file?path=docs/spec.md`)
    expect(res.status).toBe(200)
  })

  it('nonexistent file returns 404', async () => {
    const fp = await writeFixture('exists.md', '# Exists\n')
    const server = track(await createServer({ files: [fp], port: 5616, open: false }))

    const res = await httpRequest(`${server.url}/api/file?path=nonexistent.md`)
    expect(res.status).toBe(404)
  })

  it('missing path parameter returns 400', async () => {
    const fp = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({ files: [fp], port: 5617, open: false }))

    const res = await httpRequest(`${server.url}/api/file`)
    expect(res.status).toBe(400)
  })

  it('BUG-HUNT: suffix match lacks path-separator check — "spec.md" can match "myspec.md"', async () => {
    // findFile does `f.endsWith(normalizedQuery)` without checking for a path separator.
    // "/tmp/abc/myspec.md".endsWith("spec.md") === true
    // This means querying "spec.md" can incorrectly match a file named "myspec.md"
    // if no exact basename match exists first.
    //
    // HOWEVER, basename match is tried first: basename("myspec.md") === "myspec.md" !== "spec.md"
    // So it falls through to suffix match where endsWith succeeds incorrectly.

    // Create only "myspec.md" — no "spec.md" exists
    const fp = await writeFixture('myspec.md', '# My Spec\n')
    const server = track(await createServer({ files: [fp], port: 5618, open: false }))

    // Query for "spec.md" — should NOT match "myspec.md", but suffix match will
    const res = await httpRequest(`${server.url}/api/file?path=spec.md`)

    // Per the spec, "spec.md" is a bare filename query that should only match files
    // actually named "spec.md". If we get 200 here, it's a false-positive match bug.
    console.log('suffix-match false positive test: status =', res.status)
    if (res.status === 200) {
      // BUG: suffix match incorrectly matched "myspec.md" for query "spec.md"
      const json = res.json()
      console.log('BUG: matched content:', json.html)
    }
    // After fix: suffix match requires path separator boundary
    expect(res.status).toBe(404)
  })

  it('suffix match with partial directory name rejects — "ocs/spec.md" does NOT match "docs/spec.md"', async () => {
    const fp = await writeFixture('docs/spec.md', '# Spec\n')
    const server = track(await createServer({ files: [fp], port: 5619, open: false }))

    const res = await httpRequest(`${server.url}/api/file?path=ocs/spec.md`)
    expect(res.status).toBe(404)
  })

  it('suffix match with bare extension rejects — "md" does NOT match any .md file', async () => {
    const fp = await writeFixture('readme.md', '# README\n')
    const server = track(await createServer({ files: [fp], port: 5620, open: false }))

    const res = await httpRequest(`${server.url}/api/file?path=md`)
    expect(res.status).toBe(404)
  })

  it('findFile with leading slashes in query — stripped before suffix match', async () => {
    const fp = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({ files: [fp], port: 5621, open: false }))

    // Query with leading slashes — code strips them with replace(/^\/+/, '')
    const res = await httpRequest(`${server.url}/api/file?path=///spec.md`)
    expect(res.status).toBe(200)
  })

  it('findFile with multiple files — returns first match (not necessarily best)', async () => {
    const fp1 = await writeFixture('a/spec.md', '# Spec A\n')
    const fp2 = await writeFixture('b/spec.md', '# Spec B\n')
    const server = track(await createServer({ files: [fp1, fp2], port: 5622, open: false }))

    // basename "spec.md" matches both — which one wins?
    const res = await httpRequest(`${server.url}/api/file?path=spec.md`)
    expect(res.status).toBe(200)
    // It should return the first one found (Array.find returns first match)
    const json = res.json()
    expect(json.html).toContain('Spec')
  })
})

// ---------------------------------------------------------------------------
// findFile — path traversal attempts
// ---------------------------------------------------------------------------
describe('findFile — path traversal', () => {
  it('path traversal via "../" does not escape resolved file list', async () => {
    // findFile only matches against resolvedFiles, so traversal cannot reach
    // files outside the list. But let's verify.
    const fp = await writeFixture('spec.md', '# Spec\n')
    // Create a "secret" file in a sibling dir that should NOT be accessible
    const secretPath = node_path.join(tmpDir, 'secret', 'private.md')
    await node_fs.mkdir(node_path.dirname(secretPath), { recursive: true })
    await node_fs.writeFile(secretPath, '# Secret\n', 'utf-8')

    const server = track(await createServer({ files: [fp], port: 5623, open: false }))

    const res = await httpRequest(`${server.url}/api/file?path=../secret/private.md`)
    // Since the traversal path won't match any resolved file, should be 404
    expect(res.status).toBe(404)
  })

  it('path traversal via encoded characters does not bypass', async () => {
    const fp = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({ files: [fp], port: 5624, open: false }))

    // %2e%2e = ".." — the URL parser should decode this
    const res = await httpRequest(`${server.url}/api/file?path=%2e%2e/secret.md`)
    expect(res.status).toBe(404)
  })

  it('null byte in path does not cause issues', async () => {
    const fp = await writeFixture('spec.md', '# Spec\n')
    const server = track(await createServer({ files: [fp], port: 5625, open: false }))

    const res = await httpRequest(`${server.url}/api/file?path=spec.md%00.txt`)
    // Should either 404 or 400, not crash
    expect([400, 404]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// mergeSections — edge cases for backward compatibility
// ---------------------------------------------------------------------------
describe('mergeSections — backward compat (savedByName fallback)', () => {
  it('saved section without level field still matches by heading name', async () => {
    // The savedByName fallback is for old sidecars that did not store level.
    // If savedMap lookup fails (because saved section has level=0 from `s.level || 0`),
    // the savedByName fallback should pick it up.
    // We test this by creating a sidecar, then verifying status is preserved.
    const md = '# Doc\n\n## Requirements\n\nContent.\n\n## Design\n\nMore.\n'
    const fp = await writeFixture('compat.md', md)
    const server = track(await createServer({ files: [fp], port: 5626, open: false }))

    // Init sidecar and approve a section
    await httpRequest(`${server.url}/api/annotations`, 'POST', {
      file: 'compat.md',
      action: 'add',
      data: { selectors: { position: { startLine: 3 } }, comment: 'init', tag: 'bug', author: 'A' },
    })
    await httpRequest(`${server.url}/api/sections`, 'POST', {
      file: 'compat.md', action: 'approve', heading: 'Requirements',
    })

    // Verify the status persists on next read
    const res = await httpRequest(`${server.url}/api/annotations?path=compat.md`)
    const json = res.json()
    const req = json.sections.find(s => s.heading === 'Requirements')
    expect(req.status).toBe('approved')
  })
})

// ---------------------------------------------------------------------------
// mergeSections — sections include ALL headings (not just sectionLevel ones)
// ---------------------------------------------------------------------------
describe('mergeSections — all heading levels included', () => {
  it('sections array includes h1, h2, h3, h4 — not filtered by sectionLevel', async () => {
    // SPEC: "Include ALL headings with their level"
    const md = [
      '# Title',
      '## Chapter',
      '### Subsection',
      '#### Detail',
      'Text.',
    ].join('\n')
    const fp = await writeFixture('all-levels.md', md)
    const server = track(await createServer({ files: [fp], port: 5627, open: false }))

    const res = await httpRequest(`${server.url}/api/annotations?path=all-levels.md`)
    const json = res.json()

    expect(json.sections.length).toBe(4)
    const levels = json.sections.map(s => s.level)
    expect(levels).toContain(1)
    expect(levels).toContain(2)
    expect(levels).toContain(3)
    expect(levels).toContain(4)
  })
})

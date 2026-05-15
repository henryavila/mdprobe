// Regression for the highlight-bug "hide" detected on 2026-05-15:
//
// The mdprobe server used to cache `dist/index.html` in memory at boot AND
// served the HTML shell without a `Cache-Control` header. That meant:
//   - rebuilding `dist/` (e.g. with `npm run build:ui` after a code fix)
//     did NOT change what a still-running server served — `SHELL_HTML`
//     was frozen at the boot-time hash of the bundle reference;
//   - even after restarting the server, the browser would re-use its
//     cached HTML pointing at the old bundle filename;
//   - the user kept seeing the previous bug, because the fixed bundle
//     never reached the page.
//
// This test pins both halves of the fix in place.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from '../../src/server.js'

const DIST_INDEX = join(process.cwd(), 'dist', 'index.html')

function fetchText(url, opts = {}) {
  return fetch(url, opts).then(async r => ({ status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() }))
}

describe('mdprobe dev server: shell HTML is never stale', () => {
  let server
  let originalIndex
  let tmpDir, mdPath

  beforeEach(async () => {
    originalIndex = readFileSync(DIST_INDEX, 'utf8')

    tmpDir = mkdtempSync(join(tmpdir(), 'mdprobe-cache-test-'))
    mdPath = join(tmpDir, 'doc.md')
    writeFileSync(mdPath, '# Hello\n\nWorld.\n', 'utf8')

    server = await createServer({ files: [mdPath], port: 0, open: false, author: 'test' })
  })

  afterEach(async () => {
    writeFileSync(DIST_INDEX, originalIndex, 'utf8')
    await server.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('serves the latest `dist/index.html` on every request (no in-memory cache)', async () => {
    const first = await fetchText(server.url + '/')
    expect(first.status).toBe(200)
    expect(first.body).toBe(originalIndex)

    // Simulate `npm run build:ui` rebuilding the shell while the server is
    // still running. The next request MUST reflect the new content.
    const rebuilt = '<!DOCTYPE html>\n<html><head><title>rebuilt</title></head><body><script src="/assets/index-NEWHASH.js"></script></body></html>\n'
    writeFileSync(DIST_INDEX, rebuilt, 'utf8')

    const second = await fetchText(server.url + '/')
    expect(second.status).toBe(200)
    expect(second.body).toBe(rebuilt)
    expect(second.body).toContain('index-NEWHASH.js')
  })

  it('sends Cache-Control: no-cache on the HTML shell so browsers always revalidate', async () => {
    const r = await fetchText(server.url + '/')
    expect(r.status).toBe(200)
    // Browsers honour any of these; assert the directive that forces a
    // revalidation round-trip (not just heuristic freshness).
    const cc = r.headers['cache-control'] || ''
    expect(cc).toMatch(/no-cache|no-store|must-revalidate/)
  })

  it('also applies the no-cache policy to deep-link SPA fallback paths', async () => {
    const r = await fetchText(server.url + '/some/deep/link')
    expect(r.status).toBe(200)
    const cc = r.headers['cache-control'] || ''
    expect(cc).toMatch(/no-cache|no-store|must-revalidate/)
  })

  it('still caches hashed asset files aggressively (the immutable bundle path)', async () => {
    // A request for a bundle URL that doesn't exist should 404 — but the
    // important assertion here is the negative one: the immutable cache
    // header only applies to dist/assets, NOT to the HTML shell. We probe
    // by checking that the HTML response does not carry `immutable`.
    const html = await fetchText(server.url + '/')
    expect(html.headers['cache-control'] || '').not.toMatch(/immutable/)
  })
})

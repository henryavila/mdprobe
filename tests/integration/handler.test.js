import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer } from 'node:http'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createHandler } from '../../src/handler.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir
let sampleMdPath
let missingMdPath

/**
 * Start an HTTP server with the given handler and return { server, baseUrl }.
 * Listens on a random available port.
 */
function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
    server.on('error', reject)
  })
}

function close(server) {
  return new Promise((resolve) => {
    if (!server) return resolve()
    server.close(resolve)
  })
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  tmpDir = join(tmpdir(), `mdprobe-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(tmpDir, { recursive: true })

  sampleMdPath = join(tmpDir, 'spec.md')
  missingMdPath = join(tmpDir, 'nonexistent.md')

  await writeFile(sampleMdPath, '# Spec Title\n\nSome content with **bold** text.\n\n## Section\n\n- item 1\n- item 2\n', 'utf8')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ===========================================================================
// RF20 -- Handler (library mode API)
// ===========================================================================

// ---------------------------------------------------------------------------
// Basic handler
// ---------------------------------------------------------------------------

describe('Basic handler', () => {
  it('createHandler returns a function', () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
    })

    expect(typeof handler).toBe('function')
  })

  it('handler function accepts (req, res) signature', () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
    })

    // function.length is the number of declared parameters
    expect(handler.length).toBe(2)
  })

  it('handler serves HTML for resolved file path', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(baseUrl)
      expect(res.status).toBe(200)

      const contentType = res.headers.get('content-type')
      expect(contentType).toMatch(/text\/html/)

      const body = await res.text()
      expect(body.length).toBeGreaterThan(0)
    } finally {
      await close(server)
    }
  })

  it('handler serves file picker when listFiles provided', async () => {
    const handler = createHandler({
      listFiles: () => [
        { id: '001', path: sampleMdPath, label: 'spec' },
      ],
      basePath: '/',
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(baseUrl)
      expect(res.status).toBe(200)

      const body = await res.text()
      expect(body).toMatch(/text\/html/)
      // File picker should list available files
      expect(body).toContain('spec')
    } finally {
      await close(server)
    }
  })
})

// ---------------------------------------------------------------------------
// resolveFile
// ---------------------------------------------------------------------------

describe('resolveFile', () => {
  it('TC-RF20-1: resolves to valid .md returns 200 with HTML content', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(baseUrl)
      expect(res.status).toBe(200)

      const body = await res.text()
      // Rendered HTML should contain the heading from the markdown
      expect(body).toContain('Spec Title')
    } finally {
      await close(server)
    }
  })

  it('TC-RF20-4: resolves to nonexistent .md returns 404 with error message', async () => {
    const handler = createHandler({
      resolveFile: () => missingMdPath,
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(baseUrl)
      expect(res.status).toBe(404)

      const body = await res.text()
      expect(body).toMatch(/not found|no such file|does not exist/i)
    } finally {
      await close(server)
    }
  })

  it('resolveFile receives the request object (can read params)', async () => {
    const resolveFile = vi.fn(() => sampleMdPath)

    const handler = createHandler({ resolveFile })

    const { server, baseUrl } = await listen(handler)
    try {
      await fetch(`${baseUrl}/review?file=spec.md`)

      expect(resolveFile).toHaveBeenCalledTimes(1)
      const reqArg = resolveFile.mock.calls[0][0]
      expect(reqArg).toBeDefined()
      expect(reqArg.url).toContain('/review?file=spec.md')
    } finally {
      await close(server)
    }
  })
})

// ---------------------------------------------------------------------------
// listFiles
// ---------------------------------------------------------------------------

describe('listFiles', () => {
  it('TC-RF20-2: returns file list with expected structure', async () => {
    const files = [
      { id: '001', path: sampleMdPath, label: 'spec' },
      { id: '002', path: join(tmpDir, 'other.md'), label: 'other' },
    ]

    const handler = createHandler({
      listFiles: () => files,
      basePath: '/',
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(baseUrl)
      expect(res.status).toBe(200)

      const body = await res.text()
      // Should list the file labels
      expect(body).toContain('spec')
      expect(body).toContain('other')
    } finally {
      await close(server)
    }
  })

  it('not provided disables file picker (single file mode)', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
      // no listFiles
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(baseUrl)
      expect(res.status).toBe(200)

      const body = await res.text()
      // Should render the markdown directly, not a picker
      expect(body).toContain('Spec Title')
    } finally {
      await close(server)
    }
  })
})

// ---------------------------------------------------------------------------
// basePath
// ---------------------------------------------------------------------------

describe('basePath', () => {
  it('only handles requests matching basePath prefix', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
      basePath: '/review',
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(`${baseUrl}/review`)
      expect(res.status).toBe(200)
    } finally {
      await close(server)
    }
  })

  it('request outside basePath returns 404 or passes through', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
      basePath: '/review',
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(`${baseUrl}/other-path`)
      expect(res.status).toBe(404)
    } finally {
      await close(server)
    }
  })

  it('default basePath is /', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
      // no basePath specified
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const res = await fetch(baseUrl)
      // Should respond at root — default basePath is '/'
      expect(res.status).toBe(200)
    } finally {
      await close(server)
    }
  })
})

// ---------------------------------------------------------------------------
// onComplete
// ---------------------------------------------------------------------------

describe('onComplete', () => {
  it('TC-RF20-3: callback invoked when review finished', async () => {
    const onComplete = vi.fn()

    const handler = createHandler({
      resolveFile: () => sampleMdPath,
      onComplete,
    })

    const { server, baseUrl } = await listen(handler)
    try {
      // POST to the complete endpoint to simulate finishing a review
      const res = await fetch(`${baseUrl}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: sampleMdPath,
          annotations: 5,
          open: 2,
          resolved: 3,
        }),
      })

      expect(res.status).toBeLessThan(400)
      expect(onComplete).toHaveBeenCalledTimes(1)
    } finally {
      await close(server)
    }
  })

  it('result contains file, annotations, open, resolved', async () => {
    const onComplete = vi.fn()

    const handler = createHandler({
      resolveFile: () => sampleMdPath,
      onComplete,
    })

    const { server, baseUrl } = await listen(handler)
    try {
      const payload = {
        file: sampleMdPath,
        annotations: 10,
        open: 4,
        resolved: 6,
      }

      await fetch(`${baseUrl}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      expect(onComplete).toHaveBeenCalledTimes(1)

      const result = onComplete.mock.calls[0][0]
      expect(result).toHaveProperty('file')
      expect(result).toHaveProperty('annotations')
      expect(result).toHaveProperty('open')
      expect(result).toHaveProperty('resolved')
      expect(typeof result.file).toBe('string')
      expect(typeof result.annotations).toBe('number')
      expect(typeof result.open).toBe('number')
      expect(typeof result.resolved).toBe('number')
    } finally {
      await close(server)
    }
  })
})

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

describe('Static assets', () => {
  it('serves CSS for the UI', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
    })

    const { server, baseUrl } = await listen(handler)
    try {
      // The handler should serve at least one CSS resource
      const res = await fetch(`${baseUrl}/assets/style.css`)
      // Could be 200 or bundled into HTML — at minimum, the main page includes CSS
      if (res.status === 200) {
        const contentType = res.headers.get('content-type')
        expect(contentType).toMatch(/css/)
      } else {
        // CSS is embedded in the HTML page
        const mainRes = await fetch(baseUrl)
        const html = await mainRes.text()
        expect(html).toMatch(/<style|<link[^>]+\.css/)
      }
    } finally {
      await close(server)
    }
  })

  it('serves API endpoints under basePath', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
      basePath: '/review',
    })

    const { server, baseUrl } = await listen(handler)
    try {
      // API endpoints should be accessible under the basePath
      const res = await fetch(`${baseUrl}/review/api/annotations`, {
        method: 'GET',
      })
      // Expect a valid response (200 or 404-with-json), not a connection error
      expect([200, 204, 404]).toContain(res.status)
    } finally {
      await close(server)
    }
  })
})

// ---------------------------------------------------------------------------
// Integration with http.createServer
// ---------------------------------------------------------------------------

describe('Integration with http.createServer', () => {
  it('can mount handler in a standard Node.js server', async () => {
    const handler = createHandler({
      resolveFile: () => sampleMdPath,
    })

    // createServer accepts a standard (req, res) handler
    const server = createServer(handler)

    const started = await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        resolve({ port })
      })
      server.on('error', reject)
    })

    try {
      const res = await fetch(`http://127.0.0.1:${started.port}`)
      expect(res.status).toBe(200)
    } finally {
      await close(server)
    }
  })

  it('multiple handlers can coexist on different basePaths', async () => {
    const handlerA = createHandler({
      resolveFile: () => sampleMdPath,
      basePath: '/docs',
    })

    // Create a second markdown file for handler B
    const otherMdPath = join(tmpDir, 'other.md')
    await writeFile(otherMdPath, '# Other Doc\n\nDifferent content.\n', 'utf8')

    const handlerB = createHandler({
      resolveFile: () => otherMdPath,
      basePath: '/specs',
    })

    // Compose handlers in a single server
    const compositeHandler = (req, res) => {
      if (req.url.startsWith('/docs')) {
        return handlerA(req, res)
      }
      if (req.url.startsWith('/specs')) {
        return handlerB(req, res)
      }
      res.writeHead(404)
      res.end('Not found')
    }

    const { server, baseUrl } = await listen(compositeHandler)
    try {
      const resA = await fetch(`${baseUrl}/docs`)
      expect(resA.status).toBe(200)
      const bodyA = await resA.text()
      expect(bodyA).toContain('Spec Title')

      const resB = await fetch(`${baseUrl}/specs`)
      expect(resB.status).toBe(200)
      const bodyB = await resB.text()
      expect(bodyB).toContain('Other Doc')
    } finally {
      await close(server)
    }
  })
})

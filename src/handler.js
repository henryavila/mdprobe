import { readFile } from 'node:fs/promises'
import { render } from './renderer.js'

// ---------------------------------------------------------------------------
// Embedded CSS for the review UI
// ---------------------------------------------------------------------------
const EMBEDDED_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #24292f; }
  h1, h2, h3 { border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
  pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  code { font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: .5rem; text-align: left; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  ul.file-list { list-style: none; padding: 0; }
  ul.file-list li { padding: .5rem 0; border-bottom: 1px solid #eee; }
`

// ---------------------------------------------------------------------------
// Helper: wrap rendered HTML in a full page shell
// ---------------------------------------------------------------------------
function htmlPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>${escapeHtml(title)}</title>
<style>${EMBEDDED_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// Helper: collect POST body
// ---------------------------------------------------------------------------
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates an HTTP request handler for the mdprobe review UI.
 *
 * @param {object} options
 * @param {function} [options.resolveFile] - (req) => string  Resolves a file path from the request
 * @param {function} [options.listFiles]   - () => Array<{id, path, label}>  Lists available files
 * @param {string}   [options.basePath='/'] - URL prefix the handler owns
 * @param {string}   [options.author]      - Default author name
 * @param {function} [options.onComplete]  - Callback receiving {file, annotations, open, resolved}
 * @returns {function(req, res): void}
 */
export function createHandler(options = {}) {
  const {
    resolveFile,
    listFiles,
    basePath = '/',
    author,
    onComplete,
  } = options

  // Normalise basePath: remove trailing slash (unless it IS just '/')
  const base = basePath === '/' ? '' : basePath.replace(/\/+$/, '')

  return function handler(req, res) {
    // Parse the URL
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    // ----- basePath guard -----
    // If basePath is '/' (base === ''), everything matches.
    // Otherwise, pathname must equal base or start with base + '/'.
    if (base !== '') {
      if (pathname !== base && !pathname.startsWith(base + '/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
        return
      }
    }

    // Sub-path relative to basePath
    let subPath
    if (base === '') {
      subPath = pathname
    } else {
      subPath = pathname.slice(base.length) || '/'
    }

    // Ensure subPath starts with '/'
    if (!subPath.startsWith('/')) {
      subPath = '/' + subPath
    }

    // ----- Route: static assets -----
    if (subPath === '/assets/style.css' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/css' })
      res.end(EMBEDDED_CSS)
      return
    }

    // ----- Route: GET /api/files -----
    if (subPath === '/api/files' && req.method === 'GET') {
      if (listFiles) {
        const files = listFiles()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(files))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('[]')
      }
      return
    }

    // ----- Route: GET /api/annotations -----
    if (subPath === '/api/annotations' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('[]')
      return
    }

    // ----- Route: POST /api/complete -----
    if (subPath === '/api/complete' && req.method === 'POST') {
      collectBody(req).then((bodyStr) => {
        let data
        try {
          data = bodyStr ? JSON.parse(bodyStr) : {}
        } catch {
          data = {}
        }

        if (onComplete) {
          const result = {
            file: typeof data.file === 'string' ? data.file : '',
            annotations: typeof data.annotations === 'number' ? data.annotations : 0,
            open: typeof data.open === 'number' ? data.open : 0,
            resolved: typeof data.resolved === 'number' ? data.resolved : 0,
          }
          onComplete(result)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }).catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Bad request' }))
      })
      return
    }

    // ----- Route: GET / (root) -----
    if (subPath === '/' && req.method === 'GET') {
      if (listFiles) {
        // File picker mode
        const files = listFiles()
        const listHtml = files.map((f) => {
          const href = (base || '') + '/' + f.id
          const label = f.label || f.path || f.id
          return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`
        }).join('\n')

        const body = htmlPage('mdprobe - Files', `<h1>Files</h1>\n<ul class="file-list">\n${listHtml}\n</ul>`)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(body)
        return
      }

      // Single-file mode via resolveFile
      if (resolveFile) {
        const filePath = resolveFile(req)
        readFile(filePath, 'utf-8').then((content) => {
          const { html } = render(content)
          const body = htmlPage('mdprobe', html)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(body)
        }).catch(() => {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('File not found')
        })
        return
      }

      // Nothing configured
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(htmlPage('mdprobe', '<p>No files configured.</p>'))
      return
    }

    // ----- Route: GET /<anything> ---- resolve file by id/path -----
    if (req.method === 'GET' && !subPath.startsWith('/api/') && !subPath.startsWith('/assets/')) {
      if (resolveFile) {
        const filePath = resolveFile(req)
        readFile(filePath, 'utf-8').then((content) => {
          const { html } = render(content)
          const body = htmlPage('mdprobe', html)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(body)
        }).catch(() => {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('File not found')
        })
        return
      }
    }

    // ----- 404 fallback -----
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
}

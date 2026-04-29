import node_http from 'node:http'
import node_fs from 'node:fs/promises'
import node_path from 'node:path'
import node_net from 'node:net'
import { URL } from 'node:url'
import { WebSocketServer } from 'ws'
import { watch } from 'chokidar'
import { render } from './renderer.js'
import { AnnotationFile, computeSectionStatus } from './annotations.js'
import { detectDrift } from './hash.js'
import { reanchorAll } from './anchoring.js'
import { createLogger } from './telemetry.js'

const tel = createLogger('server')

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the `files` option into a list of absolute markdown file paths.
 *
 * - If a single directory is given, recursively discover all `.md` files.
 * - If individual files are given, verify they exist on disk.
 *
 * @param {string[]} files - Array of file paths or a single-element array with a directory
 * @returns {Promise<string[]>} Resolved absolute paths
 */
async function resolveFiles(files) {
  if (!files || files.length === 0) {
    throw new Error('No files specified')
  }

  const resolved = []

  for (const entry of files) {
    const abs = node_path.resolve(entry)
    let stat
    try {
      stat = await node_fs.stat(abs)
    } catch {
      throw new Error(`File or directory not found: ${entry}`)
    }

    if (stat.isDirectory()) {
      const discovered = await discoverMarkdownFiles(abs)
      if (discovered.length === 0) {
        throw new Error(`No markdown files found in ${entry}`)
      }
      resolved.push(...discovered)
    } else if (stat.isFile()) {
      resolved.push(abs)
    } else {
      throw new Error(`Not a file or directory: ${entry}`)
    }
  }

  if (resolved.length === 0) {
    throw new Error('No markdown files found')
  }

  return resolved
}

/**
 * Recursively discover all `.md` files under a directory.
 *
 * @param {string} dir - Absolute directory path
 * @returns {Promise<string[]>} Absolute paths of discovered markdown files
 */
async function discoverMarkdownFiles(dir) {
  const entries = await node_fs.readdir(dir, { withFileTypes: true, recursive: true })
  const mdFiles = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      // Node 20+ provides parentPath; older versions use path
      const parent = entry.parentPath || entry.path
      mdFiles.push(node_path.join(parent, entry.name))
    }
  }
  return mdFiles.sort()
}

// ---------------------------------------------------------------------------
// Port management
// ---------------------------------------------------------------------------

/**
 * Check whether a port on 127.0.0.1 is available.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = node_net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Find an available port starting from `startPort`, trying up to `maxAttempts`
 * consecutive ports.
 *
 * @param {number} startPort
 * @param {number} [maxAttempts=10]
 * @returns {Promise<number>}
 */
async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(
    `No available port found (tried ${startPort}–${startPort + maxAttempts - 1})`,
  )
}

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
}

/**
 * Get the MIME type for a file extension.
 *
 * @param {string} ext - File extension including the leading dot
 * @returns {string}
 */
function getMimeType(ext) {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream'
}

// ---------------------------------------------------------------------------
// JSON and HTML response helpers
// ---------------------------------------------------------------------------

/**
 * Send a JSON response.
 *
 * @param {node_http.ServerResponse} res
 * @param {number} statusCode
 * @param {*} data
 */
function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Send an HTML response.
 *
 * @param {node_http.ServerResponse} res
 * @param {number} statusCode
 * @param {string} html
 */
function sendHTML(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  })
  res.end(html)
}

/**
 * Send a 404 Not Found response.
 *
 * @param {node_http.ServerResponse} res
 */
function send404(res) {
  sendJSON(res, 404, { error: 'Not Found' })
}

/**
 * Read and parse JSON request body.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// UI HTML — serve built Preact app if available, fallback to minimal shell
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'

const DIST_DIR = new URL('../dist', import.meta.url).pathname
const DIST_INDEX = node_path.join(DIST_DIR, 'index.html')

let SHELL_HTML
try {
  if (existsSync(DIST_INDEX)) {
    SHELL_HTML = readFileSync(DIST_INDEX, 'utf-8')
  }
} catch { /* fallback below */ }

if (!SHELL_HTML) {
  SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mdProbe</title>
</head>
<body>
  <div id="app"><p style="padding:40px;font-family:sans-serif">mdProbe — run <code>npm run build:ui</code> to build the UI</p></div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

/**
 * Create and start the mdprobe development server.
 *
 * @param {object} options
 * @param {string[]} options.files - File paths or a directory path
 * @param {number}  [options.port=3000] - Preferred port
 * @param {boolean} [options.open=true] - Open browser on start
 * @param {boolean} [options.once=false] - One-shot review mode
 * @param {string}  [options.author] - Reviewer author name
 * @param {Function} [options.onDisconnect] - Called when a WebSocket client disconnects
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>, onFinish?: Function}>}
 */
export async function createServer(options) {
  const {
    files,
    port: preferredPort = 3000,
    open = true,
    once = false,
    author,
    onDisconnect,
    buildHash,
  } = options

  // 1. Resolve files (allow empty array for lazy MCP mode)
  const resolvedFiles = (files && files.length > 0) ? await resolveFiles(files) : []

  // Base directory for static asset serving — use the directory of the first file or cwd
  const assetBaseDir = resolvedFiles.length > 0
    ? node_path.dirname(resolvedFiles[0])
    : process.cwd()

  // 2. Find an available port
  let actualPort = await findAvailablePort(preferredPort)
  if (actualPort !== preferredPort) {
    tel.log('port_search', { requested: preferredPort, chosen: actualPort })
  }

  // 3. Build route handler (onFinish is set below for --once mode)
  let onFinishCallback = null
  // broadcastToAll and addFiles are defined below; forward-ref via closure
  let broadcastFn = () => {}
  let addFilesFn = () => {}
  let removeFileFn = () => {}
  const handleRequest = createRequestHandler({
    resolvedFiles,
    assetBaseDir,
    once,
    author,
    port: actualPort,
    buildHash: buildHash || null,
    getOnFinish: () => onFinishCallback,
    broadcast: (msg) => broadcastFn(msg),
    addFiles: (paths) => addFilesFn(paths),
    removeFile: (basename) => removeFileFn(basename),
  })

  // 4. Create HTTP server
  const httpServer = node_http.createServer(handleRequest)

  // 5. Attach WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', (ws) => {
    tel.log('ws_connect', { clientCount: wss.clients.size })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
      } catch (err) {
        tel.log('error', { fn: 'ws.onMessage', error: err.message })
      }
    })

    ws.on('close', () => {
      tel.log('ws_disconnect', { clientCount: wss.clients.size })
      if (typeof onDisconnect === 'function') {
        onDisconnect()
      }
    })
  })

  // 6. Start listening
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(actualPort, '127.0.0.1', () => {
      httpServer.removeListener('error', reject)
      resolve()
    })
  })
  // When port 0 is requested, resolve the OS-assigned port
  if (actualPort === 0) {
    actualPort = httpServer.address().port
  }
  tel.log('listen', { port: actualPort, url: `http://127.0.0.1:${actualPort}`, fileCount: resolvedFiles.length })

  // 7. Set up file watcher for live reload
  const watchDirs = new Set(resolvedFiles.map((f) => node_path.dirname(f)))
  const watchPaths = [...watchDirs]

  const watcher = watch(watchPaths, {
    ignored: (path, stats) => {
      // Allow directories through (so we can watch recursively)
      if (!stats || stats.isDirectory()) return false
      // Only watch .md files
      return !path.endsWith('.md')
    },
    ignoreInitial: true,
    persistent: true,
    depth: 10,
  })

  // Debounce: collect changes and broadcast after 100ms quiet period
  const debounceTimers = new Map()

  function broadcastToAll(message) {
    const data = JSON.stringify(message)
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(data)
      }
    }
  }
  broadcastFn = broadcastToAll
  addFilesFn = (newPaths) => {
    for (const p of newPaths) {
      const abs = node_path.resolve(p)
      if (!resolvedFiles.includes(abs)) {
        resolvedFiles.push(abs)
        watcher.add(node_path.dirname(abs))
        broadcastToAll({ type: 'file-added', file: node_path.basename(abs) })
      }
    }
  }

  removeFileFn = (basename) => {
    const idx = resolvedFiles.findIndex(f => node_path.basename(f) === basename)
    if (idx === -1) return { found: false }
    if (resolvedFiles.length <= 1) return { lastFile: true }

    const absPath = resolvedFiles[idx]
    resolvedFiles.splice(idx, 1)

    // Clear any pending debounce timer for this file
    for (const [timerPath, timer] of debounceTimers.entries()) {
      if (node_path.basename(timerPath) === basename) {
        clearTimeout(timer)
        debounceTimers.delete(timerPath)
      }
    }

    // Unwatch directory if no other files reference it
    const dir = node_path.dirname(absPath)
    const dirStillNeeded = resolvedFiles.some(f => node_path.dirname(f) === dir)
    if (!dirStillNeeded) {
      watcher.unwatch(dir)
    }

    broadcastToAll({ type: 'file-removed', file: basename })
    return { found: true, removed: basename }
  }

  watcher.on('change', (filePath) => {
    if (!filePath.endsWith('.md')) return
    const fileName = node_path.basename(filePath)

    // Clear existing timer for this file
    if (debounceTimers.has(filePath)) {
      clearTimeout(debounceTimers.get(filePath))
    }

    debounceTimers.set(filePath, setTimeout(async () => {
      debounceTimers.delete(filePath)
      try {
        const content = await node_fs.readFile(filePath, 'utf-8')
        const rendered = render(content)
        broadcastToAll({
          type: 'update',
          file: fileName,
          html: rendered.html,
          toc: rendered.toc,
        })

        // Check for drift and broadcast anchor status
        const sidecarPath = filePath.replace(/\.md$/, '.annotations.yaml')
        try {
          const drift = await detectDrift(sidecarPath, filePath)
          if (drift.drifted) {
            const af = await AnnotationFile.load(sidecarPath)
            const anns = af.toJSON().annotations
            const anchorResults = reanchorAll(anns, content)
            broadcastToAll({
              type: 'drift',
              warning: true,
              file: fileName,
              anchorStatus: Object.fromEntries(
                [...anchorResults].map(([id, r]) => [id, r.status === 'orphan' ? 'orphan' : 'anchored'])
              ),
            })
          }
        } catch (err) { if (err.code !== 'ENOENT') tel.log('error', { fn: 'watcher.driftCheck', error: err.message }) }
      } catch (err) {
        broadcastToAll({
          type: 'error',
          file: fileName,
          message: err.message,
        })
      }
    }, 100))
  })

  watcher.on('add', (filePath) => {
    if (!filePath.endsWith('.md')) return
    const fileName = node_path.basename(filePath)
    // Don't fire for initial files
    broadcastToAll({ type: 'file-added', file: fileName })
  })

  watcher.on('unlink', (filePath) => {
    if (!filePath.endsWith('.md')) return
    const fileName = node_path.basename(filePath)
    broadcastToAll({ type: 'file-removed', file: fileName })
  })

  // 8. Build return object
  // Expose address() for compatibility with tests that call server.address()
  const serverObj = {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    address: () => httpServer.address(),
    addFiles: addFilesFn,
    getFiles: () => resolvedFiles.map(f => node_path.basename(f)),
    broadcast: (msg) => broadcastToAll(msg),
    removeFile: (basename) => removeFileFn(basename),
    close: (cb) => {
      // Clear all debounce timers
      for (const timer of debounceTimers.values()) clearTimeout(timer)
      debounceTimers.clear()

      // Stop file watcher
      watcher.close()

      // Close all WebSocket connections
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close()

      if (cb) {
        httpServer.close(cb)
      } else {
        return new Promise((resolve) => httpServer.close(resolve))
      }
    },
  }

  if (once) {
    // Create a promise that resolves when the user clicks "Finish Review"
    let finishResolve
    serverObj.finishPromise = new Promise(resolve => { finishResolve = resolve })
    onFinishCallback = (result) => { finishResolve(result) }
  }

  return serverObj
}

// ---------------------------------------------------------------------------
// Request handler factory
// ---------------------------------------------------------------------------

/**
 * Create the HTTP request handler with access to resolved state.
 *
 * @param {object} ctx
 * @param {string[]} ctx.resolvedFiles
 * @param {string} ctx.assetBaseDir
 * @param {boolean} ctx.once
 * @param {string} [ctx.author]
 * @returns {(req: node_http.IncomingMessage, res: node_http.ServerResponse) => void}
 */
function createRequestHandler({ resolvedFiles, assetBaseDir, once, author, port, buildHash, getOnFinish, broadcast, addFiles, removeFile }) {
  return async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
      const pathname = parsedUrl.pathname

      // GET /
      if (req.method === 'GET' && pathname === '/') {
        return sendHTML(res, 200, SHELL_HTML)
      }

      // GET /api/files — deduplicate by basename (first occurrence wins)
      if (req.method === 'GET' && pathname === '/api/files') {
        const seen = new Set()
        const fileList = []
        for (const absPath of resolvedFiles) {
          const base = node_path.basename(absPath)
          if (!seen.has(base)) {
            seen.add(base)
            fileList.push({ path: base, absPath, label: node_path.basename(absPath, '.md') })
          }
        }
        return sendJSON(res, 200, fileList)
      }

      // GET /api/file?path=<path>
      if (req.method === 'GET' && pathname === '/api/file') {
        const queryPath = parsedUrl.searchParams.get('path')
        if (!queryPath) {
          return sendJSON(res, 400, { error: 'Missing ?path= parameter' })
        }
        const match = findFile(resolvedFiles, queryPath)
        if (!match) {
          return sendJSON(res, 404, { error: `File not found: ${queryPath}` })
        }
        const content = await node_fs.readFile(match, 'utf-8')
        const rendered = render(content)
        return sendJSON(res, 200, {
          html: rendered.html,
          toc: rendered.toc,
          frontmatter: rendered.frontmatter,
        })
      }

      // GET /api/source?path=<path> — return raw markdown source
      if (req.method === 'GET' && pathname === '/api/source') {
        const queryPath = parsedUrl.searchParams.get('path')
        if (!queryPath) {
          return sendJSON(res, 400, { error: 'Missing ?path= parameter' })
        }
        const match = findFile(resolvedFiles, queryPath)
        if (!match) {
          return sendJSON(res, 404, { error: `File not found: ${queryPath}` })
        }
        const text = await node_fs.readFile(match, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
        return res.end(text)
      }

      // GET /api/annotations?path=<path>
      if (req.method === 'GET' && pathname === '/api/annotations') {
        const queryPath = parsedUrl.searchParams.get('path')
        if (!queryPath) {
          return sendJSON(res, 400, { error: 'Missing ?path= parameter' })
        }
        const match = findFile(resolvedFiles, queryPath)
        if (!match) {
          return sendJSON(res, 404, { error: `File not found: ${queryPath}` })
        }
        // Attempt to load the sidecar annotation file
        const sidecarPath = match.replace(/\.md$/, '.annotations.yaml')
        let savedSections = []
        let json
        try {
          const af = await AnnotationFile.load(sidecarPath)
          json = af.toJSON()
          savedSections = json.sections || []
          // Check for drift and re-anchor annotations
          try {
            const drift = await detectDrift(sidecarPath, match)
            if (drift.drifted) {
              const content = await node_fs.readFile(match, 'utf8')
              const anchorResults = reanchorAll(json.annotations, content)
              json.drift = {
                anchorStatus: Object.fromEntries(
                  [...anchorResults].map(([id, r]) => [id, r.status === 'orphan' ? 'orphan' : 'anchored'])
                )
              }
            }
          } catch (err) { if (err.code !== 'ENOENT') tel.log('error', { fn: 'annotations.driftCheck', error: err.message }) }
        } catch {
          // No sidecar or unreadable
          json = {
            version: 1,
            source: node_path.basename(match),
            source_hash: null,
            sections: [],
            annotations: [],
          }
        }
        // Always derive sections from current document headings
        const merged = await mergeSections(match, savedSections)
        json.sections = computeSectionStatus(merged.sections)
        json.sectionLevel = merged.sectionLevel
        return sendJSON(res, 200, json)
      }

      // POST /api/annotations — CRUD operations
      if (req.method === 'POST' && pathname === '/api/annotations') {
        const body = await readBody(req)
        const { file: fileName, action, data } = body
        const match = findFile(resolvedFiles, fileName)
        if (!match) return sendJSON(res, 404, { error: `File not found: ${fileName}` })

        const sidecarPath = match.replace(/\.md$/, '.annotations.yaml')
        let af
        try {
          af = await AnnotationFile.load(sidecarPath)
        } catch {
          const { hashContent } = await import('./hash.js')
          const content = await node_fs.readFile(match, 'utf-8')
          af = AnnotationFile.create(node_path.basename(match), `sha256:${hashContent(content)}`)
        }
        // Sync sections with current document headings
        const mergedAnn = await mergeSections(match, af.sections || [])
        af.sections = mergedAnn.sections

        switch (action) {
          case 'add':
            af.add(data)
            break
          case 'resolve':
            af.resolve(data.id)
            break
          case 'reopen':
            af.reopen(data.id)
            break
          case 'update':
            if (data.comment) af.updateComment(data.id, data.comment)
            if (data.tag) af.updateTag(data.id, data.tag)
            break
          case 'delete':
            af.delete(data.id)
            break
          case 'reply':
            af.addReply(data.id, { author: data.author, comment: data.comment })
            break
          case 'editReply':
            af.editReply(data.id, data.replyId, data.comment)
            break
          case 'deleteReply':
            af.deleteReply(data.id, data.replyId)
            break
          default:
            return sendJSON(res, 400, { error: `Unknown action: ${action}` })
        }

        await af.save(sidecarPath)
        const annJson = af.toJSON()
        annJson.sections = computeSectionStatus(annJson.sections || [])
        annJson.sectionLevel = mergedAnn.sectionLevel
        if (broadcast) {
          broadcast({
            type: 'annotations',
            file: node_path.basename(match),
            annotations: annJson.annotations,
            sections: annJson.sections,
          })
        }
        return sendJSON(res, 200, annJson)
      }

      // POST /api/sections — section approval
      if (req.method === 'POST' && pathname === '/api/sections') {
        const body = await readBody(req)
        const { file: fileName, action, heading } = body
        const match = findFile(resolvedFiles, fileName)
        if (!match) return sendJSON(res, 404, { error: `File not found: ${fileName}` })

        const sidecarPath = match.replace(/\.md$/, '.annotations.yaml')
        let af
        try {
          af = await AnnotationFile.load(sidecarPath)
        } catch {
          const { hashContent } = await import('./hash.js')
          const content = await node_fs.readFile(match, 'utf-8')
          af = AnnotationFile.create(node_path.basename(match), `sha256:${hashContent(content)}`)
        }
        // Sync sections with current document headings
        const mergedSec = await mergeSections(match, af.sections || [])
        af.sections = mergedSec.sections

        switch (action) {
          case 'approve':
            af.approveSection(heading)
            break
          case 'reject':
            af.rejectSection(heading)
            break
          case 'reset':
            af.resetSection(heading)
            break
          case 'approveAll':
            af.approveAll()
            break
          case 'clearAll':
            af.clearAll()
            break
          default:
            return sendJSON(res, 400, { error: `Unknown section action: ${action}` })
        }

        await af.save(sidecarPath)
        const sectionsResult = computeSectionStatus(af.sections)
        if (broadcast) {
          broadcast({
            type: 'annotations',
            file: node_path.basename(match),
            annotations: af.toJSON().annotations,
            sections: sectionsResult,
          })
        }
        return sendJSON(res, 200, { sections: sectionsResult, sectionLevel: mergedSec.sectionLevel })
      }

      // GET /api/export — export annotations
      if (req.method === 'GET' && pathname === '/api/export') {
        const queryPath = parsedUrl.searchParams.get('path')
        const format = parsedUrl.searchParams.get('format')
        if (!queryPath) return sendJSON(res, 400, { error: 'Missing ?path= parameter' })
        const match = findFile(resolvedFiles, queryPath)
        if (!match) return sendJSON(res, 404, { error: `File not found: ${queryPath}` })

        const { exportReport, exportInline, exportJSON, exportSARIF } = await import('./export.js')
        const sourceContent = await node_fs.readFile(match, 'utf-8')

        const sidecarPath = match.replace(/\.md$/, '.annotations.yaml')
        let af
        try {
          af = await AnnotationFile.load(sidecarPath)
        } catch {
          af = AnnotationFile.create(node_path.basename(match), '')
        }

        switch (format) {
          case 'report': {
            const report = exportReport(af, sourceContent)
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
            return res.end(report)
          }
          case 'inline': {
            const inline = exportInline(af, sourceContent)
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
            return res.end(inline)
          }
          case 'json': {
            const json = exportJSON(af)
            return sendJSON(res, 200, json)
          }
          case 'sarif': {
            const sarif = exportSARIF(af, queryPath)
            return sendJSON(res, 200, sarif)
          }
          default:
            return sendJSON(res, 400, { error: `Unknown export format: ${format}` })
        }
      }

      // GET /api/config
      if (req.method === 'GET' && pathname === '/api/config') {
        return sendJSON(res, 200, { author: author || 'anonymous' })
      }

      // GET /api/status — identity check for singleton discovery
      if (req.method === 'GET' && pathname === '/api/status') {
        return sendJSON(res, 200, {
          identity: 'mdprobe',
          pid: process.pid,
          port,
          files: resolvedFiles.map(f => node_path.basename(f)),
          uptime: process.uptime(),
          buildHash,
        })
      }

      // POST /api/add-files — add files from another process (singleton join)
      if (req.method === 'POST' && pathname === '/api/add-files') {
        const body = await readBody(req)
        const { files: newFiles } = body
        if (!Array.isArray(newFiles) || newFiles.length === 0) {
          return sendJSON(res, 400, { error: 'Missing or empty files array' })
        }
        const before = resolvedFiles.length
        addFiles(newFiles)
        const added = resolvedFiles.slice(before).map(f => node_path.basename(f))
        return sendJSON(res, 200, {
          ok: true,
          files: resolvedFiles.map(f => node_path.basename(f)),
          added,
        })
      }

      // POST /api/broadcast — forward a WebSocket broadcast from a remote MCP process
      if (req.method === 'POST' && pathname === '/api/broadcast') {
        const body = await readBody(req)
        if (!body || !body.type) {
          return sendJSON(res, 400, { error: 'Missing message type' })
        }
        broadcast(body)
        return sendJSON(res, 200, { ok: true })
      }

      // DELETE /api/remove-file — remove a file from the server
      if (req.method === 'DELETE' && pathname === '/api/remove-file') {
        const body = await readBody(req)
        const { file } = body
        if (!file || typeof file !== 'string') {
          return sendJSON(res, 400, { error: 'Missing or invalid file field' })
        }
        const result = removeFile(file)
        if (result.lastFile) {
          return sendJSON(res, 400, { error: 'Cannot remove the last file' })
        }
        if (!result.found) {
          return sendJSON(res, 404, { error: `File not found: ${file}` })
        }
        return sendJSON(res, 200, {
          ok: true,
          files: resolvedFiles.map(f => node_path.basename(f)),
        })
      }

      // GET /api/review/status
      if (req.method === 'GET' && pathname === '/api/review/status') {
        return sendJSON(res, 200, { mode: once ? 'once' : null })
      }

      // POST /api/review/finish — signal that review is complete (--once mode)
      if (req.method === 'POST' && pathname === '/api/review/finish') {
        if (!once) return sendJSON(res, 400, { error: 'Not in review mode' })
        // Collect annotation file paths
        const yamlPaths = []
        for (const f of resolvedFiles) {
          const sidecar = f.replace(/\.md$/, '.annotations.yaml')
          try {
            await node_fs.stat(sidecar)
            yamlPaths.push(sidecar)
          } catch { /* no sidecar — expected for files without annotations */ }
        }
        const onFinish = getOnFinish()
        if (typeof onFinish === 'function') {
          onFinish({ files: resolvedFiles, yamlPaths })
        }
        return sendJSON(res, 200, { status: 'finished', yamlPaths })
      }

      // GET /assets/*  — serve built UI assets first, then markdown file assets
      if (req.method === 'GET' && pathname.startsWith('/assets/')) {
        const relativePath = pathname.slice('/assets/'.length)
        // Prevent directory traversal
        const normalized = node_path.normalize(relativePath)
        if (normalized.startsWith('..') || node_path.isAbsolute(normalized)) {
          return send404(res)
        }

        // Try built UI assets (dist/assets/) first
        const distPath = node_path.join(DIST_DIR, 'assets', normalized)
        try {
          const data = await node_fs.readFile(distPath)
          const ext = node_path.extname(distPath)
          res.writeHead(200, {
            'Content-Type': getMimeType(ext),
            'Content-Length': data.length,
            'Cache-Control': 'public, max-age=31536000, immutable',
          })
          return res.end(data)
        } catch {
          // Fall through to markdown assets
        }

        // Try markdown directory assets (images, etc.)
        const filePath = node_path.join(assetBaseDir, normalized)
        try {
          const data = await node_fs.readFile(filePath)
          const ext = node_path.extname(filePath)
          res.writeHead(200, {
            'Content-Type': getMimeType(ext),
            'Content-Length': data.length,
          })
          return res.end(data)
        } catch {
          return send404(res)
        }
      }

      // SPA catch-all: serve HTML shell for any unmatched GET path
      // This enables deep linking — client reads pathname to auto-select file
      if (req.method === 'GET') {
        return sendHTML(res, 200, SHELL_HTML)
      }

      // Fallback — 404
      send404(res)
    } catch (err) {
      // Unexpected error
      sendJSON(res, 500, { error: err.message })
    }
  }
}

// ---------------------------------------------------------------------------
// File matching helper
// ---------------------------------------------------------------------------

/**
 * Derive current sections from the markdown TOC headings and merge with saved
 * approval statuses from the sidecar.  This ensures sections always reflect
 * the current document, even when headings have been added or removed.
 *
 * @param {string} mdPath - Absolute path to the markdown file
 * @param {Array<{heading: string, level: number, status: string}>} [savedSections]
 * @returns {Promise<{sections: Array, sectionLevel: number}>}
 */
async function mergeSections(mdPath, savedSections = []) {
  const content = await node_fs.readFile(mdPath, 'utf-8')
  const { toc } = render(content)

  // Match saved sections to current TOC by position order.
  // For each TOC entry, consume the first matching saved section (same heading+level).
  // This correctly handles duplicate headings by preserving their order.
  const savedPool = savedSections.map(s => ({ ...s })) // shallow copy to consume

  const sections = toc.map(h => {
    const idx = savedPool.findIndex(s => s.heading === h.heading && (s.level == null || s.level === h.level))
    let status = 'pending'
    if (idx !== -1) {
      status = savedPool[idx].status || 'pending'
      savedPool.splice(idx, 1) // consume this match
    }
    return { heading: h.heading, level: h.level, status }
  })

  // Adaptive section level: shallowest level appearing 2+ times
  const levelCounts = new Map()
  for (const h of toc) {
    levelCounts.set(h.level, (levelCounts.get(h.level) || 0) + 1)
  }
  let sectionLevel = 2 // default fallback
  for (let lvl = 1; lvl <= 6; lvl++) {
    if ((levelCounts.get(lvl) || 0) >= 2) {
      sectionLevel = lvl
      break
    }
  }

  return { sections, sectionLevel }
}

/**
 * Find a resolved file matching a query path.
 *
 * The query may be:
 *   - a bare filename:  `spec.md`
 *   - a relative path:  `docs/spec.md`
 *   - an absolute path: `/tmp/.../spec.md`
 *
 * @param {string[]} resolvedFiles - Absolute file paths
 * @param {string} queryPath - Path from the query string
 * @returns {string|null} Matched absolute path, or null
 */
function findFile(resolvedFiles, queryPath) {
  // Try exact absolute match first
  const absQuery = node_path.resolve(queryPath)
  const exactMatch = resolvedFiles.find((f) => f === absQuery)
  if (exactMatch) return exactMatch

  // Try matching by basename
  const baseMatch = resolvedFiles.find(
    (f) => node_path.basename(f) === queryPath,
  )
  if (baseMatch) return baseMatch

  // Try matching by path suffix (relative path match)
  // Require path separator boundary to prevent partial matches (e.g., "spec.md" matching "myspec.md")
  const normalizedQuery = queryPath.replace(/^\/+/, '')
  const suffixMatch = resolvedFiles.find(
    (f) => f.endsWith('/' + normalizedQuery) || f === normalizedQuery,
  )
  if (suffixMatch) return suffixMatch

  return null
}

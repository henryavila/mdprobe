import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { resolve, basename, dirname, join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from './server.js'
import { openBrowser } from './open-browser.js'
import { AnnotationFile } from './annotations.js'
import { getConfig } from './config.js'
import { hashContent } from './hash.js'
import { discoverExistingServer, joinExistingServer, writeLockFile, computeBuildHash } from './singleton.js'
import { createLogger } from './telemetry.js'
const tel = createLogger('mcp')

let httpServerPromise = null

async function getOrCreateServer(port = 3000) {
  if (!httpServerPromise) {
    const buildHash = await computeBuildHash()

    const existing = await discoverExistingServer(undefined, buildHash)
    if (existing) {
      httpServerPromise = Promise.resolve({
        url: existing.url,
        port: existing.port,
        addFiles: (paths) => joinExistingServer(existing.url, paths),
        getFiles: () => [],
        broadcast: () => {},
        close: async () => {},
        _remote: true,
      })
    } else {
      httpServerPromise = createServer({ files: [], port, open: false, buildHash }).then(async (srv) => {
        await writeLockFile({
          pid: process.pid,
          port: srv.port,
          url: srv.url,
          startedAt: new Date().toISOString(),
          buildHash,
        })
        return srv
      })
    }
    const srv = await httpServerPromise
    tel.log('server_create', { mode: srv._remote ? 'remote' : 'new', port: srv.port, url: srv.url })
  }
  return httpServerPromise
}

function buildUrl(port, urlStyle, filePath) {
  const host = urlStyle === 'mdprobe.localhost' ? 'mdprobe.localhost' : 'localhost'
  const suffix = filePath ? '/' + filePath : ''
  return `http://${host}:${port}${suffix}`
}

export function validateViewParams(params) {
  const hasPaths = Array.isArray(params.paths) && params.paths.length > 0
  const hasContent = typeof params.content === 'string' && params.content.length > 0

  if (hasPaths && hasContent) {
    return { error: 'Cannot provide both paths and content. Use one or the other.' }
  }
  if (!hasPaths && !hasContent) {
    return { error: 'Either paths or content must be provided.' }
  }
  return { mode: hasPaths ? 'paths' : 'content' }
}

export function generateContentFilename(content) {
  const hash = hashContent(content).slice(0, 8)
  return join(tmpdir(), 'mdprobe', `draft-${hash}.md`)
}

export async function saveContentToFile(content, filename) {
  const absPath = resolve(filename)
  await mkdir(dirname(absPath), { recursive: true })
  await writeFile(absPath, content, 'utf-8')
  return { savedTo: absPath }
}

export async function startMcpServer() {
  const config = await getConfig()
  const author = config.author || 'Agent'
  const urlStyle = config.urlStyle || 'localhost'

  const server = new McpServer({
    name: 'mdProbe',
    version: '0.2.0',
  })

  server.registerTool('mdprobe_view', {
    description: 'Preview and open content in the browser for human review or validation. Call this BEFORE asking for feedback on any content >20 lines — findings, specs, plans, analysis, docs, or any long output. Renders markdown with syntax highlighting, tables, Mermaid diagrams, and LaTeX math.',
    inputSchema: z.object({
      paths: z.array(z.string()).optional().describe('Paths to .md files (relative or absolute)'),
      content: z.string().optional().describe('Raw markdown content to save and open'),
      filename: z.string().optional().describe('Filename to save content to (auto-generated if omitted)'),
      open: z.boolean().optional().default(true).describe('Auto-open browser'),
    }),
  }, async (params) => {
    tel.log('tool_call', { tool: 'mdprobe_view', hasContent: !!params.content, hasPaths: !!params.paths?.length, open: params.open })
    const validation = validateViewParams(params)
    if (validation.error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: validation.error }) }],
        isError: true,
      }
    }

    const srv = await getOrCreateServer()
    let resolved
    let savedTo

    if (validation.mode === 'content') {
      const filename = params.filename || generateContentFilename(params.content)
      const result = await saveContentToFile(params.content, filename)
      savedTo = result.savedTo
      resolved = [savedTo]
    } else {
      resolved = params.paths.map(p => resolve(p))
    }

    srv.addFiles(resolved)

    const url = resolved.length === 1
      ? buildUrl(srv.port, urlStyle, basename(resolved[0]))
      : buildUrl(srv.port, urlStyle)
    if (params.open) {
      tel.log('browser_open', { url })
      await openBrowser(url).catch((err) => { tel.log('error', { fn: 'openBrowser', error: err.message }) })
    } else {
      tel.log('browser_skip', { url })
    }

    const response = { url, files: resolved.map(p => basename(p)) }
    if (savedTo) response.savedTo = savedTo

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
    }
  })

  server.registerTool('mdprobe_annotations', {
    description: 'Read annotations for a file after human review',
    inputSchema: z.object({
      path: z.string().describe('Path to .md file'),
    }),
  }, async ({ path }) => {
    tel.log('tool_call', { tool: 'mdprobe_annotations', path })
    const resolved = resolve(path)
    const sidecarPath = resolved.replace(/\.md$/, '.annotations.yaml')

    let af
    try {
      af = await AnnotationFile.load(sidecarPath)
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          source: basename(resolved),
          sections: [],
          annotations: [],
          summary: { total: 0, open: 0, resolved: 0, bugs: 0, questions: 0, suggestions: 0, nitpicks: 0 },
        }) }],
      }
    }

    const json = af.toJSON()
    const summary = {
      total: json.annotations.length,
      open: af.getOpen().length,
      resolved: af.getResolved().length,
      bugs: af.getByTag('bug').length,
      questions: af.getByTag('question').length,
      suggestions: af.getByTag('suggestion').length,
      nitpicks: af.getByTag('nitpick').length,
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ ...json, summary }) }],
    }
  })

  server.registerTool('mdprobe_update', {
    description: 'Update annotations — resolve, reopen, reply, create, delete',
    inputSchema: z.object({
      path: z.string().describe('Path to .md file'),
      actions: z.array(z.object({
        action: z.enum(['resolve', 'reopen', 'reply', 'add', 'delete']),
        id: z.string().optional(),
        comment: z.string().optional(),
        tag: z.enum(['bug', 'question', 'suggestion', 'nitpick']).optional(),
        selectors: z.any().optional(),
      })).describe('Batch operations'),
    }),
  }, async ({ path, actions }) => {
    tel.log('tool_call', { tool: 'mdprobe_update', path, actionCount: actions?.length })
    const resolved = resolve(path)
    const sidecarPath = resolved.replace(/\.md$/, '.annotations.yaml')

    let af
    try {
      af = await AnnotationFile.load(sidecarPath)
    } catch {
      // Fix #2: wrap readFile in try/catch for missing source files
      let content
      try {
        content = await readFile(resolved, 'utf-8')
      } catch {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `File not found: ${path}` }) }],
          isError: true,
        }
      }
      af = AnnotationFile.create(basename(resolved), `sha256:${hashContent(content)}`)
    }

    for (const act of actions) {
      switch (act.action) {
        case 'resolve': af.resolve(act.id); break
        case 'reopen': af.reopen(act.id); break
        case 'reply': af.addReply(act.id, { author, comment: act.comment }); break
        case 'add': af.add({ selectors: act.selectors, comment: act.comment, tag: act.tag, author }); break
        case 'delete': af.delete(act.id); break
      }
    }

    await af.save(sidecarPath)

    // Fix #6: broadcast via WebSocket if HTTP server is running
    const srv = await httpServerPromise
    if (srv?.broadcast) {
      srv.broadcast({
        type: 'annotations',
        file: basename(resolved),
        annotations: af.toJSON().annotations,
        sections: af.toJSON().sections,
      })
    }

    const json = af.toJSON()
    return {
      content: [{ type: 'text', text: JSON.stringify({
        updated: actions.length,
        annotations: json.annotations,
        summary: { total: json.annotations.length, open: af.getOpen().length, resolved: af.getResolved().length },
      }) }],
    }
  })

  // Fix #5: include files field in status response
  server.registerTool('mdprobe_status', {
    description: 'Returns current MCP server state',
    inputSchema: z.object({}),
  }, async () => {
    tel.log('tool_call', { tool: 'mdprobe_status' })
    if (!httpServerPromise) {
      return { content: [{ type: 'text', text: JSON.stringify({ running: false }) }] }
    }
    const srv = await httpServerPromise
    return {
      content: [{ type: 'text', text: JSON.stringify({
        running: true,
        url: srv.url,
        files: srv.getFiles?.() ?? [],
      }) }],
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  tel.log('start', { author, urlStyle })
}

// For testing: expose internals
export { getOrCreateServer, buildUrl }
export function _resetServer() { httpServerPromise = null }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { resolve, basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createServer } from './server.js'
import { openBrowser } from './open-browser.js'
import { AnnotationFile } from './annotations.js'
import { getConfig } from './config.js'
import { hashContent } from './hash.js'

// Fix #1: Use a Promise to prevent race conditions in concurrent calls
let httpServerPromise = null

async function getOrCreateServer(port = 3000) {
  if (!httpServerPromise) {
    httpServerPromise = createServer({ files: [], port, open: false })
  }
  return httpServerPromise
}

function buildUrl(port, urlStyle, filePath) {
  const host = urlStyle === 'mdprobe.localhost' ? 'mdprobe.localhost' : 'localhost'
  const suffix = filePath ? '/' + filePath : ''
  return `http://${host}:${port}${suffix}`
}

export async function startMcpServer() {
  const config = await getConfig()
  const author = config.author || 'Agent'
  const urlStyle = config.urlStyle || 'localhost'

  const server = new McpServer({
    name: 'mdprobe',
    version: '0.2.0',
  })

  server.registerTool('mdprobe_view', {
    description: 'Open markdown files in the browser for viewing or review',
    inputSchema: z.object({
      paths: z.array(z.string()).describe('Paths to .md files (relative or absolute)'),
      open: z.boolean().optional().default(true).describe('Auto-open browser'),
    }),
  }, async ({ paths, open }) => {
    const srv = await getOrCreateServer()
    const resolved = paths.map(p => resolve(p))
    srv.addFiles(resolved)

    // Fix #7: single-file URL includes file path; multi-file returns base URL
    const url = resolved.length === 1
      ? buildUrl(srv.port, urlStyle, basename(resolved[0]))
      : buildUrl(srv.port, urlStyle)
    if (open) await openBrowser(url).catch(() => {})

    return {
      content: [{ type: 'text', text: JSON.stringify({ url, files: resolved.map(p => basename(p)) }) }],
    }
  })

  server.registerTool('mdprobe_annotations', {
    description: 'Read annotations for a file after human review',
    inputSchema: z.object({
      path: z.string().describe('Path to .md file'),
    }),
  }, async ({ path }) => {
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
}

// For testing: expose internals
export { getOrCreateServer, buildUrl }
export function _resetServer() { httpServerPromise = null }

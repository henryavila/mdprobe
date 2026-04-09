import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, mkdir, rm, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'

// Test buildUrl directly
import { buildUrl } from '../../src/mcp.js'

describe('buildUrl()', () => {
  it('builds localhost URL', () => {
    expect(buildUrl(3000, 'localhost')).toBe('http://localhost:3000')
  })

  it('builds mdprobe.localhost URL', () => {
    expect(buildUrl(3000, 'mdprobe.localhost')).toBe('http://mdprobe.localhost:3000')
  })

  it('appends file path', () => {
    expect(buildUrl(3000, 'localhost', 'spec.md')).toBe('http://localhost:3000/spec.md')
  })
})

describe('MCP tool handlers (via HTTP API)', () => {
  // Instead of testing via stdio, we test the underlying logic
  // by importing the annotation and server modules directly
  let tmp

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  })

  it('mdprobe_annotations returns empty for non-existent sidecar', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-ann-'))
    const mdFile = join(tmp, 'test.md')
    await writeFile(mdFile, '# Test')

    // Simulate what mdprobe_annotations does
    const { AnnotationFile } = await import('../../src/annotations.js')
    const sidecarPath = mdFile.replace(/\.md$/, '.annotations.yaml')

    let result
    try {
      await AnnotationFile.load(sidecarPath)
    } catch {
      result = {
        source: 'test.md',
        sections: [],
        annotations: [],
        summary: { total: 0, open: 0, resolved: 0, bugs: 0, questions: 0, suggestions: 0, nitpicks: 0 },
      }
    }

    expect(result.source).toBe('test.md')
    expect(result.summary.total).toBe(0)
  })

  it('mdprobe_annotations returns structured data with summary', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-ann2-'))
    const mdFile = join(tmp, 'spec.md')
    await writeFile(mdFile, '# Spec\n\nContent here')

    const { AnnotationFile } = await import('../../src/annotations.js')
    const { hashContent } = await import('../../src/hash.js')
    const content = await readFile(mdFile, 'utf-8')
    const af = AnnotationFile.create('spec.md', `sha256:${hashContent(content)}`)

    af.add({ selectors: { position: { startLine: 1 } }, comment: 'Bug here', tag: 'bug', author: 'Henry' })
    af.add({ selectors: { position: { startLine: 2 } }, comment: 'Question?', tag: 'question', author: 'Henry' })
    af.add({ selectors: { position: { startLine: 3 } }, comment: 'Suggestion', tag: 'suggestion', author: 'Agent' })

    const sidecarPath = mdFile.replace(/\.md$/, '.annotations.yaml')
    await af.save(sidecarPath)

    // Reload and check
    const loaded = await AnnotationFile.load(sidecarPath)
    const json = loaded.toJSON()
    const summary = {
      total: json.annotations.length,
      open: loaded.getOpen().length,
      resolved: loaded.getResolved().length,
      bugs: loaded.getByTag('bug').length,
      questions: loaded.getByTag('question').length,
      suggestions: loaded.getByTag('suggestion').length,
      nitpicks: loaded.getByTag('nitpick').length,
    }

    expect(summary.total).toBe(3)
    expect(summary.open).toBe(3)
    expect(summary.bugs).toBe(1)
    expect(summary.questions).toBe(1)
    expect(summary.suggestions).toBe(1)
    expect(summary.nitpicks).toBe(0)
  })

  it('mdprobe_update resolves annotations and adds replies', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-upd-'))
    const mdFile = join(tmp, 'doc.md')
    await writeFile(mdFile, '# Doc')

    const { AnnotationFile } = await import('../../src/annotations.js')
    const { hashContent } = await import('../../src/hash.js')
    const content = await readFile(mdFile, 'utf-8')
    const af = AnnotationFile.create('doc.md', `sha256:${hashContent(content)}`)

    const ann = af.add({ selectors: { position: { startLine: 1 } }, comment: 'Fix this', tag: 'bug', author: 'Henry' })
    const sidecarPath = mdFile.replace(/\.md$/, '.annotations.yaml')
    await af.save(sidecarPath)

    // Simulate mdprobe_update actions
    const loaded = await AnnotationFile.load(sidecarPath)
    const actions = [
      { action: 'reply', id: ann.id, comment: 'Fixed in latest commit' },
      { action: 'resolve', id: ann.id },
    ]
    const author = 'Agent'

    for (const act of actions) {
      switch (act.action) {
        case 'resolve': loaded.resolve(act.id); break
        case 'reply': loaded.addReply(act.id, { author, comment: act.comment }); break
      }
    }
    await loaded.save(sidecarPath)

    // Verify
    const final = await AnnotationFile.load(sidecarPath)
    const resolved = final.getResolved()
    expect(resolved).toHaveLength(1)
    expect(resolved[0].replies).toHaveLength(1)
    expect(resolved[0].replies[0].comment).toBe('Fixed in latest commit')
    expect(resolved[0].replies[0].author).toBe('Agent')
  })

  it('mdprobe_update creates new annotations', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-add-'))
    const mdFile = join(tmp, 'new.md')
    await writeFile(mdFile, '# New\n\nSome content')

    const { AnnotationFile } = await import('../../src/annotations.js')
    const { hashContent } = await import('../../src/hash.js')
    const content = await readFile(mdFile, 'utf-8')
    const af = AnnotationFile.create('new.md', `sha256:${hashContent(content)}`)
    const sidecarPath = mdFile.replace(/\.md$/, '.annotations.yaml')
    await af.save(sidecarPath)

    // Simulate add action
    const loaded = await AnnotationFile.load(sidecarPath)
    loaded.add({
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 12 }, quote: { exact: 'Some content' } },
      comment: 'Is this correct?',
      tag: 'question',
      author: 'Agent',
    })
    await loaded.save(sidecarPath)

    const final = await AnnotationFile.load(sidecarPath)
    expect(final.annotations).toHaveLength(1)
    expect(final.annotations[0].tag).toBe('question')
    expect(final.annotations[0].author).toBe('Agent')
  })

  it('mdprobe_update deletes annotations', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-del-'))
    const mdFile = join(tmp, 'del.md')
    await writeFile(mdFile, '# Del')

    const { AnnotationFile } = await import('../../src/annotations.js')
    const { hashContent } = await import('../../src/hash.js')
    const content = await readFile(mdFile, 'utf-8')
    const af = AnnotationFile.create('del.md', `sha256:${hashContent(content)}`)
    const ann = af.add({ selectors: { position: { startLine: 1 } }, comment: 'Delete me', tag: 'nitpick', author: 'Agent' })
    const sidecarPath = mdFile.replace(/\.md$/, '.annotations.yaml')
    await af.save(sidecarPath)

    const loaded = await AnnotationFile.load(sidecarPath)
    loaded.delete(ann.id)
    await loaded.save(sidecarPath)

    const final = await AnnotationFile.load(sidecarPath)
    expect(final.annotations).toHaveLength(0)
  })
})

describe('mdprobe_view content parameter validation', () => {
  let tmp

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  })

  it('saves content to filename and returns savedTo path', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-content-'))
    const filename = join(tmp, 'draft.md')
    const content = '# Draft\n\nThis is a test draft with enough content.'

    const { saveContentToFile } = await import('../../src/mcp.js')
    const result = await saveContentToFile(content, filename)

    expect(result.savedTo).toBe(resolve(filename))
    const saved = await readFile(filename, 'utf-8')
    expect(saved).toBe(content)
  })

  it('returns error when content provided without filename', async () => {
    const { validateViewParams } = await import('../../src/mcp.js')
    const result = validateViewParams({ content: '# Hello' })
    expect(result.error).toMatch(/filename.*required/i)
  })

  it('returns error when both paths and content provided', async () => {
    const { validateViewParams } = await import('../../src/mcp.js')
    const result = validateViewParams({ paths: ['a.md'], content: '# Hello', filename: 'b.md' })
    expect(result.error).toMatch(/cannot.*both/i)
  })

  it('returns error when neither paths nor content provided', async () => {
    const { validateViewParams } = await import('../../src/mcp.js')
    const result = validateViewParams({})
    expect(result.error).toMatch(/either.*paths.*content/i)
  })

  it('tool description contains semantic review trigger', async () => {
    const mcpSource = await readFile(join(__dirname, '../../src/mcp.js'), 'utf-8')
    expect(mcpSource).toContain('BEFORE asking for feedback')
    expect(mcpSource).toContain('findings, specs, plans, analysis')
  })

  it('tool description leads with use case verb (preview/open)', async () => {
    const mcpSource = await readFile(join(__dirname, '../../src/mcp.js'), 'utf-8')
    // mdprobe_view description must lead with Preview, not "Open content for human review"
    expect(mcpSource).toMatch(/description:\s*'Preview/)
  })

  it('overwrites existing file with content', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mcp-overwrite-'))
    const filename = join(tmp, 'existing.md')
    await writeFile(filename, '# Old content')

    const { saveContentToFile } = await import('../../src/mcp.js')
    await saveContentToFile('# New content', filename)

    const saved = await readFile(filename, 'utf-8')
    expect(saved).toBe('# New content')
  })
})

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

describe('generateContentFilename()', () => {
  it('generates a filename in os.tmpdir()/mdprobe/', async () => {
    const { generateContentFilename } = await import('../../src/mcp.js')
    const result = generateContentFilename('# Hello World')
    expect(result).toMatch(/^.*[/\\]mdprobe[/\\]draft-[a-f0-9]{8}\.md$/)
  })

  it('is deterministic — same content produces same filename', async () => {
    const { generateContentFilename } = await import('../../src/mcp.js')
    const a = generateContentFilename('# Same content')
    const b = generateContentFilename('# Same content')
    expect(a).toBe(b)
  })

  it('different content produces different filename', async () => {
    const { generateContentFilename } = await import('../../src/mcp.js')
    const a = generateContentFilename('# Content A')
    const b = generateContentFilename('# Content B')
    expect(a).not.toBe(b)
  })

  it('uses first 8 chars of hash', async () => {
    const { generateContentFilename } = await import('../../src/mcp.js')
    const { hashContent } = await import('../../src/hash.js')
    const content = '# Test hash length'
    const expectedHash = hashContent(content).slice(0, 8)
    const result = generateContentFilename(content)
    expect(result).toContain(`draft-${expectedHash}.md`)
  })
})

describe('normalizeContentFilename()', () => {
  it('appends .md when filename has no extension', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('revisao-pendencias-consolidada')
    expect(result).toMatch(/revisao-pendencias-consolidada\.md$/)
  })

  it('keeps .md when already present', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('analysis.md')
    expect(result).not.toMatch(/\.md\.md$/)
    expect(result).toMatch(/analysis\.md$/)
  })

  it('moves bare filename to tmpdir/mdprobe/', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('my-draft')
    expect(result).toMatch(/[/\\]mdprobe[/\\]my-draft\.md$/)
    expect(result).not.toContain(process.cwd())
  })

  it('moves bare filename with .md to tmpdir/mdprobe/', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('spec.md')
    expect(result).toMatch(/[/\\]mdprobe[/\\]spec\.md$/)
  })

  it('preserves absolute path as-is (only appends .md if needed)', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('/home/user/docs/report')
    expect(result).toBe('/home/user/docs/report.md')
  })

  it('preserves absolute path with .md untouched', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('/home/user/docs/report.md')
    expect(result).toBe('/home/user/docs/report.md')
  })

  it('preserves relative path with directory components', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('docs/spec')
    expect(result).toBe('docs/spec.md')
  })

  it('handles .markdown extension as valid (no double extension)', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('notes.markdown')
    expect(result).toMatch(/notes\.markdown$/)
    expect(result).not.toMatch(/\.md$/)
  })

  it('handles filename with dots but no md extension', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('v2.1-release-notes')
    expect(result).toMatch(/v2\.1-release-notes\.md$/)
  })

  it('handles filename ending with .mdx', async () => {
    const { normalizeContentFilename } = await import('../../src/mcp.js')
    const result = normalizeContentFilename('component.mdx')
    expect(result).toMatch(/component\.mdx$/)
    expect(result).not.toMatch(/\.md$/)
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

  it('accepts content without filename (auto-generates)', async () => {
    const { validateViewParams } = await import('../../src/mcp.js')
    const result = validateViewParams({ content: '# Hello' })
    expect(result.error).toBeUndefined()
    expect(result.mode).toBe('content')
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

  it('saves content with auto-generated filename to tmpdir', async () => {
    const { saveContentToFile, generateContentFilename } = await import('../../src/mcp.js')
    const content = '# Auto-generated filename test'
    const autoFilename = generateContentFilename(content)
    const result = await saveContentToFile(content, autoFilename)

    expect(result.savedTo).toBe(resolve(autoFilename))
    const saved = await readFile(autoFilename, 'utf-8')
    expect(saved).toBe(content)

    // Cleanup
    await rm(autoFilename, { force: true })
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

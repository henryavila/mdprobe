import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILL_PATH = join(__dirname, '../../skills/mdprobe/SKILL.md')

describe('SKILL.md content validation', () => {
  let content

  it('loads SKILL.md', async () => {
    content = await readFile(SKILL_PATH, 'utf-8')
    expect(content).toBeTruthy()
  })

  it('frontmatter description contains BEFORE trigger', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    const frontmatter = content.split('---')[1]
    expect(frontmatter).toContain('BEFORE')
    expect(frontmatter).toMatch(/feedback|review/i)
  })

  it('contains anti-pattern section', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    expect(content).toMatch(/anti.?pattern/i)
    expect(content).toContain('NEVER present')
  })

  it('contains decision rule for >20 lines', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    expect(content).toMatch(/>\s*20\s*lines/i)
    expect(content).toMatch(/mdprobe_view/i)
  })

  it('contains Rule 8 for content parameter', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    expect(content).toContain('Rule 8')
    expect(content).toContain('content')
    expect(content).toMatch(/format.*markdown/i)
  })

  it('covers all content types, not just .md files', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    expect(content).toMatch(/findings|analysis|validation/i)
  })

  it('Rule 1 does NOT auto-trigger on every .md mention (caused unwanted server launches)', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    // "Whenever you mention a .md file" caused the AI to call mdprobe_view
    // for every .md file reference, even during routine edits
    expect(content).not.toMatch(/whenever you mention/i)
  })

  it('Rule 1 still triggers for files the human should read (core purpose)', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    // Must keep the proactive behavior: open files the human should READ
    expect(content).toMatch(/human.*(should|needs to) read|produce.*present.*deliver/i)
  })

  it('frontmatter description leads with use case, not mechanism', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    const frontmatter = content.split('---')[1]
    // Description must start with an action verb (Preview/Visualize/Review), not a noun
    expect(frontmatter).toMatch(/description:\s*(?:>-?\s*)?Preview|Visualize|Review/i)
  })

  it('frontmatter contains trigger keywords for discoverability', async () => {
    content = content ?? await readFile(SKILL_PATH, 'utf-8')
    const frontmatter = content.split('---')[1]
    expect(frontmatter).toMatch(/preview/i)
    expect(frontmatter).toMatch(/visualize/i)
    expect(frontmatter).toMatch(/validate/i)
  })
})

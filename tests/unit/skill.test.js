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
})

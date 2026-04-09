import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { exportReport, exportInline, exportJSON, exportSARIF } from '../../src/export.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = join(__dirname, '..', 'fixtures')

const sampleMd = readFileSync(join(fixtures, 'sample.md'), 'utf-8')

// ---------------------------------------------------------------------------
// Mock AnnotationFile — mirrors the shape expected by production code
// ---------------------------------------------------------------------------

function createMockAnnotationFile() {
  return {
    source: 'sample.md',
    sourceHash: 'sha256:abc123',
    version: 1,
    annotations: [
      {
        id: 'a1b2c3',
        selectors: {
          position: { startLine: 5, startColumn: 11, endLine: 5, endColumn: 52 },
          quote: { exact: 'O sistema valida todos os inputs', prefix: '- **RF01:** ', suffix: '\n  - ✓' },
        },
        comment: 'Quais inputs? Precisa especificar campos',
        tag: 'question',
        status: 'open',
        author: 'Henry',
        created_at: '2026-04-06T12:00:00Z',
        updated_at: '2026-04-06T12:00:00Z',
        replies: [
          { author: 'Maria', comment: 'email, nome, telefone', created_at: '2026-04-06T12:05:00Z' },
        ],
      },
      {
        id: 'g7h8i9',
        selectors: {
          position: { startLine: 12, startColumn: 5, endLine: 12, endColumn: 30 },
          quote: { exact: 'mensagem de erro genérica', prefix: '  - ✓ ', suffix: '\n  - ✓' },
        },
        comment: 'Sugestão: mensagem específica por campo',
        tag: 'suggestion',
        status: 'resolved',
        author: 'Maria',
        created_at: '2026-04-06T13:00:00Z',
        updated_at: '2026-04-06T14:00:00Z',
        replies: [],
      },
    ],
    sections: [
      { heading: 'Requisitos Funcionais', status: 'approved' },
      { heading: 'Edge Cases', status: 'pending' },
    ],
    toJSON() {
      return {
        version: this.version,
        source: this.source,
        source_hash: this.sourceHash,
        annotations: this.annotations,
        sections: this.sections,
      }
    },
  }
}

function createEmptyAnnotationFile() {
  return {
    source: 'empty-review.md',
    sourceHash: 'sha256:def456',
    version: 1,
    annotations: [],
    sections: [],
    toJSON() {
      return {
        version: this.version,
        source: this.source,
        source_hash: this.sourceHash,
        annotations: this.annotations,
        sections: this.sections,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// RF19 — Export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// exportReport
// ---------------------------------------------------------------------------

describe('exportReport()', () => {
  let af

  beforeEach(() => {
    af = createMockAnnotationFile()
  })

  it('TC-RF19-1: returns a valid markdown string', () => {
    const result = exportReport(af, sampleMd)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('contains a title/header with the source filename', () => {
    const result = exportReport(af, sampleMd)
    // Should include something like "# Review Report: sample.md" or similar header
    expect(result).toMatch(/#+\s.*sample\.md/)
  })

  it('contains summary section with total, open, and resolved counts', () => {
    const result = exportReport(af, sampleMd)
    // Total annotations = 2, open = 1, resolved = 1
    expect(result).toMatch(/2/)  // total
    expect(result).toMatch(/1/)  // open or resolved count
    expect(result).toMatch(/open/i)
    expect(result).toMatch(/resolved/i)
  })

  it('lists annotations grouped by section', () => {
    const result = exportReport(af, sampleMd)
    expect(result).toContain('Requisitos Funcionais')
    expect(result).toContain('Edge Cases')
  })

  it('each annotation shows tag, quote, comment, author, and status', () => {
    const result = exportReport(af, sampleMd)
    // First annotation
    expect(result).toContain('question')
    expect(result).toContain('O sistema valida todos os inputs')
    expect(result).toContain('Quais inputs? Precisa especificar campos')
    expect(result).toContain('Henry')
    expect(result).toContain('open')
    // Second annotation
    expect(result).toContain('suggestion')
    expect(result).toContain('Maria')
  })

  it('shows replies under each annotation', () => {
    const result = exportReport(af, sampleMd)
    expect(result).toContain('email, nome, telefone')
  })

  it('shows section approval status', () => {
    const result = exportReport(af, sampleMd)
    expect(result).toMatch(/approved/i)
    expect(result).toMatch(/pending/i)
  })

  it('resolved annotations are included but marked as resolved', () => {
    const result = exportReport(af, sampleMd)
    expect(result).toContain('mensagem de erro genérica')
    expect(result).toMatch(/resolved/i)
  })

  it('TC-RF19-6: empty annotations produces "No annotations" message', () => {
    const empty = createEmptyAnnotationFile()
    const result = exportReport(empty, sampleMd)
    expect(result).toMatch(/no annotations/i)
  })

  it('report is human-readable (contains markdown formatting, not raw JSON)', () => {
    const result = exportReport(af, sampleMd)
    // Should contain markdown formatting elements (headers, bullets, etc.)
    expect(result).toMatch(/[#\-*>]/)
    // Should NOT look like raw JSON
    expect(result).not.toMatch(/^\s*\{/)
    expect(result).not.toMatch(/^\s*\[/)
  })
})

// ---------------------------------------------------------------------------
// exportInline
// ---------------------------------------------------------------------------

describe('exportInline()', () => {
  let af

  beforeEach(() => {
    af = createMockAnnotationFile()
  })

  it('TC-RF19-2: returns a markdown string with HTML comments at annotation positions', () => {
    const result = exportInline(af, sampleMd)
    expect(typeof result).toBe('string')
    expect(result).toContain('<!--')
    expect(result).toContain('-->')
  })

  it('preserves original markdown text', () => {
    const result = exportInline(af, sampleMd)
    // Key content from sample.md must still be present
    expect(result).toContain('# Sample Spec')
    expect(result).toContain('## Requisitos Funcionais')
    expect(result).toContain('O sistema valida todos os inputs')
    expect(result).toContain('## Edge Cases')
    expect(result).toContain('## Conclusão')
  })

  it('inserts HTML comments with tag and comment text', () => {
    const result = exportInline(af, sampleMd)
    // Format: <!-- [tag] comment -->
    expect(result).toMatch(/<!--\s*\[question\].*Quais inputs/s)
  })

  it('multiple annotations produce multiple comments', () => {
    const result = exportInline(af, sampleMd)
    const commentMatches = result.match(/<!--.*?-->/gs)
    expect(commentMatches).not.toBeNull()
    expect(commentMatches.length).toBeGreaterThanOrEqual(2)
  })

  it('comments are placed near the annotated text (after the line)', () => {
    const result = exportInline(af, sampleMd)
    const lines = result.split('\n')

    // Find the line with the first annotated text (line 5 in original: RF01)
    const rf01Idx = lines.findIndex((l) => l.includes('O sistema valida todos os inputs'))
    expect(rf01Idx).toBeGreaterThanOrEqual(0)

    // The comment should appear shortly after that line (within a few lines)
    const commentIdx = lines.findIndex(
      (l, i) => i > rf01Idx && l.includes('<!--') && l.includes('question'),
    )
    expect(commentIdx).toBeGreaterThan(rf01Idx)
    expect(commentIdx - rf01Idx).toBeLessThanOrEqual(3)
  })

  it('resolved annotations are marked with [RESOLVED] prefix', () => {
    const result = exportInline(af, sampleMd)
    expect(result).toMatch(/<!--\s*\[RESOLVED\]\s*\[suggestion\]/s)
  })

  it('original markdown is not corrupted (still valid markdown structure)', () => {
    const result = exportInline(af, sampleMd)
    // All original headings still present in order
    const headingOrder = ['# Sample Spec', '## Requisitos Funcionais', '## Edge Cases', '## Conclusão']
    let lastIdx = -1
    for (const h of headingOrder) {
      const idx = result.indexOf(h)
      expect(idx).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }
  })

  it('empty annotations returns original markdown unchanged', () => {
    const empty = createEmptyAnnotationFile()
    const result = exportInline(empty, sampleMd)
    expect(result).toBe(sampleMd)
  })
})

// ---------------------------------------------------------------------------
// exportJSON
// ---------------------------------------------------------------------------

describe('exportJSON()', () => {
  let af

  beforeEach(() => {
    af = createMockAnnotationFile()
  })

  it('TC-RF19-3: returns a valid JSON object with all annotations', () => {
    const result = exportJSON(af)
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
    expect(result).not.toBeNull()
  })

  it('has version, source, and source_hash fields', () => {
    const result = exportJSON(af)
    expect(result).toHaveProperty('version', 1)
    expect(result).toHaveProperty('source', 'sample.md')
    expect(result).toHaveProperty('source_hash')
    expect(typeof result.source_hash).toBe('string')
  })

  it('has annotations array with all fields', () => {
    const result = exportJSON(af)
    expect(Array.isArray(result.annotations)).toBe(true)
    expect(result.annotations).toHaveLength(2)
  })

  it('has sections array', () => {
    const result = exportJSON(af)
    expect(Array.isArray(result.sections)).toBe(true)
    expect(result.sections).toHaveLength(2)
    expect(result.sections[0]).toHaveProperty('heading', 'Requisitos Funcionais')
    expect(result.sections[0]).toHaveProperty('status', 'approved')
  })

  it('annotations include selectors, comment, tag, status, author, timestamps, and replies', () => {
    const result = exportJSON(af)
    const ann = result.annotations[0]

    expect(ann).toHaveProperty('selectors')
    expect(ann.selectors).toHaveProperty('position')
    expect(ann.selectors).toHaveProperty('quote')
    expect(ann).toHaveProperty('comment')
    expect(ann).toHaveProperty('tag')
    expect(ann).toHaveProperty('status')
    expect(ann).toHaveProperty('author')
    expect(ann).toHaveProperty('created_at')
    expect(ann).toHaveProperty('updated_at')
    expect(ann).toHaveProperty('replies')
    expect(Array.isArray(ann.replies)).toBe(true)
  })

  it('roundtrip: JSON can be stringified and parsed back', () => {
    const result = exportJSON(af)
    const str = JSON.stringify(result)
    const parsed = JSON.parse(str)

    expect(parsed.version).toBe(result.version)
    expect(parsed.source).toBe(result.source)
    expect(parsed.annotations).toHaveLength(result.annotations.length)
  })

  it('empty annotations returns valid JSON with empty array', () => {
    const empty = createEmptyAnnotationFile()
    const result = exportJSON(empty)

    expect(result).toHaveProperty('version')
    expect(result).toHaveProperty('source')
    expect(Array.isArray(result.annotations)).toBe(true)
    expect(result.annotations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// exportSARIF
// ---------------------------------------------------------------------------

describe('exportSARIF()', () => {
  let af
  const sourceFilePath = 'docs/sample.md'

  beforeEach(() => {
    af = createMockAnnotationFile()
  })

  it('TC-RF19-4: returns an object conforming to SARIF 2.1.0 schema', () => {
    const result = exportSARIF(af, sourceFilePath)
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('has $schema pointing to SARIF schema URL', () => {
    const result = exportSARIF(af, sourceFilePath)
    expect(result.$schema).toMatch(/sarif.*schema/i)
  })

  it('has version "2.1.0"', () => {
    const result = exportSARIF(af, sourceFilePath)
    expect(result.version).toBe('2.1.0')
  })

  it('has runs array with at least one run', () => {
    const result = exportSARIF(af, sourceFilePath)
    expect(Array.isArray(result.runs)).toBe(true)
    expect(result.runs.length).toBeGreaterThanOrEqual(1)
  })

  it('run has tool with name "mdProbe"', () => {
    const result = exportSARIF(af, sourceFilePath)
    const run = result.runs[0]
    expect(run).toHaveProperty('tool')
    expect(run.tool).toHaveProperty('driver')
    expect(run.tool.driver).toHaveProperty('name', 'mdProbe')
  })

  it('run has results array', () => {
    const result = exportSARIF(af, sourceFilePath)
    const run = result.runs[0]
    expect(Array.isArray(run.results)).toBe(true)
  })

  it('each result has ruleId matching tag', () => {
    const result = exportSARIF(af, sourceFilePath)
    const results = result.runs[0].results

    // Only open annotations should appear (resolved excluded)
    const ruleIds = results.map((r) => r.ruleId)
    expect(ruleIds).toContain('question')
  })

  it('each result has message.text containing the comment', () => {
    const result = exportSARIF(af, sourceFilePath)
    const results = result.runs[0].results

    const questionResult = results.find((r) => r.ruleId === 'question')
    expect(questionResult).toBeDefined()
    expect(questionResult.message).toHaveProperty('text')
    expect(questionResult.message.text).toContain('Quais inputs? Precisa especificar campos')
  })

  it('each result has locations array with physical location', () => {
    const result = exportSARIF(af, sourceFilePath)
    const results = result.runs[0].results

    for (const res of results) {
      expect(Array.isArray(res.locations)).toBe(true)
      expect(res.locations.length).toBeGreaterThanOrEqual(1)
      expect(res.locations[0]).toHaveProperty('physicalLocation')
    }
  })

  it('physical location has artifactLocation.uri matching source file', () => {
    const result = exportSARIF(af, sourceFilePath)
    const loc = result.runs[0].results[0].locations[0].physicalLocation

    expect(loc).toHaveProperty('artifactLocation')
    expect(loc.artifactLocation).toHaveProperty('uri', sourceFilePath)
  })

  it('physical location has region with startLine, startColumn, endLine, endColumn', () => {
    const result = exportSARIF(af, sourceFilePath)
    const loc = result.runs[0].results[0].locations[0].physicalLocation

    expect(loc).toHaveProperty('region')
    expect(loc.region).toHaveProperty('startLine')
    expect(loc.region).toHaveProperty('startColumn')
    expect(loc.region).toHaveProperty('endLine')
    expect(loc.region).toHaveProperty('endColumn')
    expect(typeof loc.region.startLine).toBe('number')
    expect(typeof loc.region.startColumn).toBe('number')
  })

  it('region values match the annotation selectors', () => {
    const result = exportSARIF(af, sourceFilePath)
    const questionResult = result.runs[0].results.find((r) => r.ruleId === 'question')
    const region = questionResult.locations[0].physicalLocation.region

    expect(region.startLine).toBe(5)
    expect(region.startColumn).toBe(11)
    expect(region.endLine).toBe(5)
    expect(region.endColumn).toBe(52)
  })

  it('level mapping: bug->error, question->note, suggestion->warning, nitpick->note', () => {
    // Add a bug and nitpick annotation for thorough level testing
    af.annotations.push(
      {
        id: 'bug01',
        selectors: {
          position: { startLine: 8, startColumn: 1, endLine: 8, endColumn: 40 },
          quote: { exact: 'telefone sem validação no MVP', prefix: '  - ✗ ', suffix: '\n' },
        },
        comment: 'This is a bug — MVP should validate phone',
        tag: 'bug',
        status: 'open',
        author: 'Henry',
        created_at: '2026-04-06T15:00:00Z',
        updated_at: '2026-04-06T15:00:00Z',
        replies: [],
      },
      {
        id: 'nit01',
        selectors: {
          position: { startLine: 18, startColumn: 1, endLine: 18, endColumn: 20 },
          quote: { exact: 'texto final', prefix: 'o **', suffix: '** com' },
        },
        comment: 'Typo: should be "texto finalizado"',
        tag: 'nitpick',
        status: 'open',
        author: 'Henry',
        created_at: '2026-04-06T16:00:00Z',
        updated_at: '2026-04-06T16:00:00Z',
        replies: [],
      },
    )

    const result = exportSARIF(af, sourceFilePath)
    const results = result.runs[0].results

    const bugResult = results.find((r) => r.ruleId === 'bug')
    expect(bugResult).toBeDefined()
    expect(bugResult.level).toBe('error')

    const questionResult = results.find((r) => r.ruleId === 'question')
    expect(questionResult).toBeDefined()
    expect(questionResult.level).toBe('note')

    const nitpickResult = results.find((r) => r.ruleId === 'nitpick')
    expect(nitpickResult).toBeDefined()
    expect(nitpickResult.level).toBe('note')

    // Suggestion is resolved, so it may be excluded. If included, verify level.
    const suggestionResult = results.find((r) => r.ruleId === 'suggestion')
    if (suggestionResult) {
      expect(suggestionResult.level).toBe('warning')
    }
  })

  it('resolved annotations are excluded from results (or marked differently)', () => {
    const result = exportSARIF(af, sourceFilePath)
    const results = result.runs[0].results

    // The resolved suggestion annotation should be excluded from SARIF results
    const resolvedIds = results.filter((r) => r.ruleId === 'suggestion')
    // Either excluded entirely or has a suppression marker
    if (resolvedIds.length > 0) {
      // If included, must have a suppression indicator per SARIF spec
      for (const r of resolvedIds) {
        expect(r.suppressions).toBeDefined()
        expect(Array.isArray(r.suppressions)).toBe(true)
        expect(r.suppressions.length).toBeGreaterThan(0)
      }
    } else {
      // Excluded is also valid
      expect(resolvedIds).toHaveLength(0)
    }
  })

  it('empty annotations produces valid SARIF with empty results', () => {
    const empty = createEmptyAnnotationFile()
    const result = exportSARIF(empty, sourceFilePath)

    expect(result.version).toBe('2.1.0')
    expect(Array.isArray(result.runs)).toBe(true)
    expect(result.runs.length).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(result.runs[0].results)).toBe(true)
    expect(result.runs[0].results).toHaveLength(0)
  })

  it('tool driver has version and informationUri', () => {
    const result = exportSARIF(af, sourceFilePath)
    const driver = result.runs[0].tool.driver

    expect(driver).toHaveProperty('version')
    expect(typeof driver.version).toBe('string')
    expect(driver).toHaveProperty('informationUri')
    expect(typeof driver.informationUri).toBe('string')
  })
})

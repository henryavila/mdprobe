import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv from 'ajv'

const SCHEMA_PATH = resolve(import.meta.dirname, '../../schema.json')

describe('schema.json', () => {
  let schema
  let ajv
  let validate

  beforeAll(async () => {
    const raw = await readFile(SCHEMA_PATH, 'utf8')
    schema = JSON.parse(raw)
    ajv = new Ajv({ allErrors: true, strict: false })
    validate = ajv.compile(schema)
  })

  describe('TC-RF22-1: schema file integrity', () => {
    it('schema.json exists and is readable', async () => {
      const raw = await readFile(SCHEMA_PATH, 'utf8')
      expect(raw.length).toBeGreaterThan(0)
    })

    it('schema.json is valid JSON', async () => {
      const raw = await readFile(SCHEMA_PATH, 'utf8')
      expect(() => JSON.parse(raw)).not.toThrow()
    })

    it('schema is a valid JSON Schema (compiles without error)', () => {
      // If beforeAll succeeded, the schema compiled. Verify the validate function exists.
      expect(typeof validate).toBe('function')
    })
  })

  describe('TC-RF22-2: valid annotation objects pass validation', () => {
    it('minimal valid annotation file passes', () => {
      const doc = {
        version: 1,
        source: 'spec.md',
        source_hash: 'sha256:abc123',
        annotations: [],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })

    it('complete annotation file with all fields passes', () => {
      const doc = {
        version: 1,
        source: 'spec.md',
        source_hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sections: [
          { heading: 'Requisitos Funcionais', status: 'approved' },
          { heading: 'Edge Cases', status: 'pending' },
        ],
        annotations: [
          {
            id: 'a1b2c3',
            selectors: {
              position: {
                startLine: 5,
                startColumn: 11,
                endLine: 5,
                endColumn: 52,
              },
              quote: {
                exact: 'O sistema valida todos os inputs',
                prefix: '- **RF01:** ',
                suffix: '\n  - input',
              },
            },
            comment: 'Quais inputs? Precisa especificar campos',
            tag: 'question',
            status: 'open',
            author: 'Henry',
            created_at: '2026-04-06T12:00:00Z',
            updated_at: '2026-04-06T12:00:00Z',
            replies: [
              {
                author: 'Maria',
                comment: 'email, nome, telefone',
                created_at: '2026-04-06T12:05:00Z',
              },
            ],
          },
        ],
      }
      const valid = validate(doc)
      if (!valid) {
        // Surface errors for debugging if this unexpectedly fails
        expect(validate.errors).toBeNull()
      }
      expect(valid).toBe(true)
    })

    it('annotation file without sections passes', () => {
      const doc = {
        version: 1,
        source: 'no-headings.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'x1',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
              quote: { exact: 'some text', prefix: '', suffix: '' },
            },
            comment: 'A note',
            tag: 'bug',
            status: 'open',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })

    it('annotation with empty replies array passes', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:def',
        annotations: [
          {
            id: 'r1',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'test', prefix: '', suffix: '' },
            },
            comment: 'No replies yet',
            tag: 'nitpick',
            status: 'open',
            author: 'Tester',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })
  })

  describe('TC-RF22-3: invalid annotation objects fail validation', () => {
    it('rejects status value "fixed" (not in enum)', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'inv1',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'text', prefix: '', suffix: '' },
            },
            comment: 'test',
            tag: 'bug',
            status: 'fixed',  // invalid — only open, resolved allowed
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })

    it('rejects invalid tag value "critical"', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'inv2',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'text', prefix: '', suffix: '' },
            },
            comment: 'test',
            tag: 'critical',  // invalid — only bug, question, suggestion, nitpick
            status: 'open',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })
  })

  describe('required fields', () => {
    it('rejects missing version field', () => {
      const doc = {
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })

    it('rejects missing source field', () => {
      const doc = {
        version: 1,
        source_hash: 'sha256:abc',
        annotations: [],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })

    it('rejects annotation missing id', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            // id missing
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'text', prefix: '', suffix: '' },
            },
            comment: 'test',
            tag: 'bug',
            status: 'open',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })

    it('rejects annotation missing comment', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'mc1',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'text', prefix: '', suffix: '' },
            },
            // comment missing
            tag: 'bug',
            status: 'open',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })

    it('rejects annotation missing tag', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'mt1',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'text', prefix: '', suffix: '' },
            },
            comment: 'test',
            // tag missing
            status: 'open',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })

    it('rejects annotation missing status', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'ms1',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'text', prefix: '', suffix: '' },
            },
            comment: 'test',
            tag: 'bug',
            // status missing
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })
  })

  describe('enum values', () => {
    it('accepts all valid tag values', () => {
      const validTags = ['bug', 'question', 'suggestion', 'nitpick']
      for (const tag of validTags) {
        const doc = {
          version: 1,
          source: 'test.md',
          source_hash: 'sha256:abc',
          annotations: [
            {
              id: `tag-${tag}`,
              selectors: {
                position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
                quote: { exact: 'text', prefix: '', suffix: '' },
              },
              comment: 'test',
              tag,
              status: 'open',
              author: 'Dev',
              created_at: '2026-04-06T10:00:00Z',
              updated_at: '2026-04-06T10:00:00Z',
              replies: [],
            },
          ],
        }
        const valid = validate(doc)
        expect(valid, `tag "${tag}" should be valid`).toBe(true)
      }
    })

    it('accepts all valid annotation status values', () => {
      const validStatuses = ['open', 'resolved']
      for (const status of validStatuses) {
        const doc = {
          version: 1,
          source: 'test.md',
          source_hash: 'sha256:abc',
          annotations: [
            {
              id: `status-${status}`,
              selectors: {
                position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
                quote: { exact: 'text', prefix: '', suffix: '' },
              },
              comment: 'test',
              tag: 'bug',
              status,
              author: 'Dev',
              created_at: '2026-04-06T10:00:00Z',
              updated_at: '2026-04-06T10:00:00Z',
              replies: [],
            },
          ],
        }
        const valid = validate(doc)
        expect(valid, `status "${status}" should be valid`).toBe(true)
      }
    })

    it('rejects invalid tag "warning"', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'bad-tag',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'text', prefix: '', suffix: '' },
            },
            comment: 'test',
            tag: 'warning',
            status: 'open',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })

    it('rejects invalid status "closed"', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'bad-status',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
              quote: { exact: 'text', prefix: '', suffix: '' },
            },
            comment: 'test',
            tag: 'bug',
            status: 'closed',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })
  })

  describe('selectors structure', () => {
    it('validates position with startLine, startColumn, endLine, endColumn', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'pos1',
            selectors: {
              position: { startLine: 10, startColumn: 3, endLine: 12, endColumn: 45 },
              quote: { exact: 'multiline selection', prefix: 'before ', suffix: ' after' },
            },
            comment: 'test',
            tag: 'suggestion',
            status: 'open',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })

    it('validates quote with exact, prefix, suffix', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        annotations: [
          {
            id: 'q1',
            selectors: {
              position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 20 },
              quote: {
                exact: 'the selected text here',
                prefix: '30 chars of context before...',
                suffix: '30 chars of context after....',
              },
            },
            comment: 'test',
            tag: 'question',
            status: 'open',
            author: 'Dev',
            created_at: '2026-04-06T10:00:00Z',
            updated_at: '2026-04-06T10:00:00Z',
            replies: [],
          },
        ],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })
  })

  describe('sections validation', () => {
    it('accepts valid section status "approved"', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        sections: [{ heading: 'Introduction', status: 'approved' }],
        annotations: [],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })

    it('accepts valid section status "rejected"', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        sections: [{ heading: 'Bad Section', status: 'rejected' }],
        annotations: [],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })

    it('accepts valid section status "pending"', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        sections: [{ heading: 'Unreviewed', status: 'pending' }],
        annotations: [],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })

    it('rejects invalid section status "done"', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        sections: [{ heading: 'Test', status: 'done' }],
        annotations: [],
      }
      const valid = validate(doc)
      expect(valid).toBe(false)
    })

    it('validates multiple sections', () => {
      const doc = {
        version: 1,
        source: 'test.md',
        source_hash: 'sha256:abc',
        sections: [
          { heading: 'Requirements', status: 'approved' },
          { heading: 'Design', status: 'rejected' },
          { heading: 'Testing', status: 'pending' },
        ],
        annotations: [],
      }
      const valid = validate(doc)
      expect(valid).toBe(true)
    })
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import node_fs from 'node:fs/promises'
import node_path from 'node:path'
import node_os from 'node:os'
import node_url from 'node:url'

import { AnnotationFile } from '../../src/annotations.js'

const __dirname = node_path.dirname(node_url.fileURLToPath(import.meta.url))
const FIXTURES = node_path.resolve(__dirname, '..', 'fixtures')
const SAMPLE_YAML = node_path.join(FIXTURES, 'sample.annotations.yaml')
const INVALID_YAML = node_path.join(FIXTURES, 'invalid.annotations.yaml')

let tmpDir

beforeEach(async () => {
  tmpDir = await node_fs.mkdtemp(node_path.join(node_os.tmpdir(), 'mdprobe-test-'))
})

afterEach(async () => {
  if (tmpDir) {
    await node_fs.rm(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// AnnotationFile.create()
// ---------------------------------------------------------------------------
describe('AnnotationFile.create()', () => {
  it('creates with correct version, source, sourceHash, and empty arrays', () => {
    const file = AnnotationFile.create('spec.md', 'sha256:abc123')

    expect(file.version).toBe(1)
    expect(file.source).toBe('spec.md')
    expect(file.sourceHash).toBe('sha256:abc123')
    expect(file.annotations).toEqual([])
    expect(file.sections).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// AnnotationFile.load()
// ---------------------------------------------------------------------------
describe('AnnotationFile.load()', () => {
  it('TC-RF21-1: loads YAML fixture and returns an instance with annotations', async () => {
    const file = await AnnotationFile.load(SAMPLE_YAML)

    expect(file).toBeInstanceOf(AnnotationFile)
    expect(file.annotations.length).toBe(3)
  })

  it('TC-RF17-2: loaded file has source, version, and source_hash', async () => {
    const file = await AnnotationFile.load(SAMPLE_YAML)

    expect(file.source).toBe('sample.md')
    expect(file.version).toBe(1)
    expect(file.sourceHash).toMatch(/^sha256:/)
  })

  it('loads all annotation fields: selectors, comment, tag, status, author, timestamps', async () => {
    const file = await AnnotationFile.load(SAMPLE_YAML)
    const ann = file.getById('a1b2c3')

    expect(ann.selectors).toBeDefined()
    expect(ann.selectors.position.startLine).toBe(5)
    expect(ann.selectors.quote.exact).toBe('O sistema valida todos os inputs do formulário')
    expect(ann.comment).toBe('Quais inputs? Precisa especificar campos')
    expect(ann.tag).toBe('question')
    expect(ann.status).toBe('open')
    expect(ann.author).toBe('Henry')
    expect(ann.created_at).toBeDefined()
    expect(ann.updated_at).toBeDefined()
  })

  it('loads sections from YAML', async () => {
    const file = await AnnotationFile.load(SAMPLE_YAML)

    expect(file.sections.length).toBe(2)
    expect(file.sections[0]).toEqual({ heading: 'Requisitos Funcionais', status: 'approved' })
    expect(file.sections[1]).toEqual({ heading: 'Edge Cases', status: 'pending' })
  })

  it('TC-RF17-3: invalid YAML throws error with line number info', async () => {
    await expect(AnnotationFile.load(INVALID_YAML))
      .rejects.toThrow(/line/i)
  })

  it('file not found throws an error', async () => {
    await expect(AnnotationFile.load('/nonexistent/path.annotations.yaml'))
      .rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// add()
// ---------------------------------------------------------------------------
describe('add()', () => {
  let file

  beforeEach(() => {
    file = AnnotationFile.create('spec.md', 'sha256:abc')
  })

  it('generates a unique string id for each annotation', () => {
    const base = { selectors: { position: { startLine: 1 } }, comment: 'c', tag: 'bug', author: 'A' }
    file.add(base)
    file.add({ ...base, comment: 'c2' })

    expect(file.annotations).toHaveLength(2)
    const [a, b] = file.annotations
    expect(typeof a.id).toBe('string')
    expect(a.id.length).toBeGreaterThan(0)
    expect(a.id).not.toBe(b.id)
  })

  it('sets created_at, updated_at to now and status to open', () => {
    const before = new Date()
    file.add({
      selectors: { position: { startLine: 1 } },
      comment: 'Test',
      tag: 'bug',
      author: 'Alice',
    })
    const after = new Date()

    const ann = file.annotations[0]
    const created = new Date(ann.created_at)

    expect(ann.status).toBe('open')
    expect(created.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(created.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(new Date(ann.updated_at).getTime()).toBe(created.getTime())
  })

  it('accepts all valid tags: bug, question, suggestion, nitpick', () => {
    for (const tag of ['bug', 'question', 'suggestion', 'nitpick']) {
      const f = AnnotationFile.create('s.md', 'sha256:x')
      f.add({ selectors: { position: { startLine: 1 } }, comment: 'c', tag, author: 'A' })
      expect(f.annotations[0].tag).toBe(tag)
    }
  })

  it('TC-RF21-3: invalid tag throws error', () => {
    expect(() =>
      file.add({
        selectors: { position: { startLine: 1 } },
        comment: 'c',
        tag: 'critical',
        author: 'A',
      })
    ).toThrow(/invalid tag/i)
  })

  it('missing required fields (comment, selectors) throws', () => {
    const base = { selectors: { position: { startLine: 1 } }, comment: 'c', tag: 'bug', author: 'A' }

    expect(() => file.add({ ...base, comment: undefined })).toThrow()
    expect(() => file.add({ ...base, selectors: undefined })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// resolve / reopen
// ---------------------------------------------------------------------------
describe('resolve() and reopen()', () => {
  let file

  beforeEach(() => {
    file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 1 } },
      comment: 'needs fix',
      tag: 'bug',
      author: 'Alice',
    })
  })

  it('TC-RF14-2: resolve sets status to resolved and updates updated_at', () => {
    const id = file.annotations[0].id
    const before = file.getById(id).updated_at
    file.resolve(id)

    const ann = file.getById(id)
    expect(ann.status).toBe('resolved')
    expect(new Date(ann.updated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(before).getTime())
  })

  it('TC-RF14-3: reopen sets status to open and updates updated_at', () => {
    const id = file.annotations[0].id
    file.resolve(id)
    const afterResolve = file.getById(id).updated_at
    file.reopen(id)

    const ann = file.getById(id)
    expect(ann.status).toBe('open')
    expect(new Date(ann.updated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(afterResolve).getTime())
  })

  it('resolve already resolved is idempotent', () => {
    const id = file.annotations[0].id
    file.resolve(id)
    expect(() => file.resolve(id)).not.toThrow()
    expect(file.getById(id).status).toBe('resolved')
  })

  it('TC-RF21-4: resolve nonexistent id throws', () => {
    expect(() => file.resolve('nonexistent-id'))
      .toThrow(/not found/i)
  })
})

// ---------------------------------------------------------------------------
// updateComment / updateTag
// ---------------------------------------------------------------------------
describe('updateComment() and updateTag()', () => {
  let file, id

  beforeEach(() => {
    file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 1 } },
      comment: 'original comment',
      tag: 'bug',
      author: 'Alice',
    })
    id = file.annotations[0].id
  })

  it('updateComment changes comment and updates updated_at', () => {
    const before = file.getById(id).updated_at
    file.updateComment(id, 'revised comment')

    const ann = file.getById(id)
    expect(ann.comment).toBe('revised comment')
    expect(new Date(ann.updated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(before).getTime())
  })

  it('updateComment with empty string throws', () => {
    expect(() => file.updateComment(id, '')).toThrow()
  })

  it('TC-RF14-1: updateTag changes tag and updates updated_at', () => {
    const before = file.getById(id).updated_at
    file.updateTag(id, 'suggestion')

    const ann = file.getById(id)
    expect(ann.tag).toBe('suggestion')
    expect(new Date(ann.updated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(before).getTime())
  })

  it('TC-RF21-3: updateTag with invalid value throws', () => {
    expect(() => file.updateTag(id, 'critical'))
      .toThrow(/invalid tag/i)
  })
})

// ---------------------------------------------------------------------------
// delete()
// ---------------------------------------------------------------------------
describe('delete()', () => {
  it('TC-RF14-4: removes annotation from array', () => {
    const file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 1 } },
      comment: 'to be deleted',
      tag: 'bug',
      author: 'Alice',
    })

    const id = file.annotations[0].id
    file.delete(id)

    expect(file.annotations).toHaveLength(0)
  })

  it('delete nonexistent id throws', () => {
    const file = AnnotationFile.create('spec.md', 'sha256:abc')
    expect(() => file.delete('nonexistent-id')).toThrow(/not found/i)
  })
})

// ---------------------------------------------------------------------------
// addReply()
// ---------------------------------------------------------------------------
describe('addReply()', () => {
  let file, id

  beforeEach(() => {
    file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 1 } },
      comment: 'question',
      tag: 'question',
      author: 'Alice',
    })
    id = file.annotations[0].id
  })

  it('TC-RF15-1: adds a reply with author, comment, and created_at', () => {
    file.addReply(id, { author: 'Bob', comment: 'Noted' })

    const ann = file.getById(id)
    expect(ann.replies).toHaveLength(1)

    const reply = ann.replies[0]
    expect(reply.author).toBe('Bob')
    expect(reply.comment).toBe('Noted')
    expect(reply.created_at).toBeDefined()
  })

  it('TC-RF15-2: multiple replies are in chronological order', () => {
    file.addReply(id, { author: 'Bob', comment: 'First' })
    file.addReply(id, { author: 'Carol', comment: 'Second' })
    file.addReply(id, { author: 'Dave', comment: 'Third' })

    const replies = file.getById(id).replies
    expect(replies).toHaveLength(3)
    expect(replies[0].comment).toBe('First')
    expect(replies[1].comment).toBe('Second')
    expect(replies[2].comment).toBe('Third')

    for (let i = 1; i < replies.length; i++) {
      expect(new Date(replies[i].created_at).getTime())
        .toBeGreaterThanOrEqual(new Date(replies[i - 1].created_at).getTime())
    }
  })

  it('reply to nonexistent annotation throws', () => {
    expect(() =>
      file.addReply('no-such-id', { author: 'Bob', comment: 'Orphan' })
    ).toThrow(/not found/i)
  })
})

// ---------------------------------------------------------------------------
// Section approval
// ---------------------------------------------------------------------------
describe('Section approval', () => {
  let file

  beforeEach(() => {
    file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.sections.push(
      { heading: 'Introduction', status: 'pending' },
      { heading: 'Requirements', status: 'pending' },
      { heading: 'Edge Cases', status: 'pending' },
      { heading: 'API Design', status: 'pending' },
      { heading: 'Conclusion', status: 'pending' },
    )
  })

  it('TC-RF16-1: approveSection sets status to approved', () => {
    file.approveSection('Introduction')

    const section = file.sections.find(s => s.heading === 'Introduction')
    expect(section.status).toBe('approved')
  })

  it('TC-RF16-2: rejectSection sets status to rejected', () => {
    file.rejectSection('Requirements')

    const section = file.sections.find(s => s.heading === 'Requirements')
    expect(section.status).toBe('rejected')
  })

  it('resetSection sets status back to pending', () => {
    file.approveSection('Introduction')
    file.resetSection('Introduction')

    const section = file.sections.find(s => s.heading === 'Introduction')
    expect(section.status).toBe('pending')
  })

  it('TC-RF16-3: approveAll sets every section to approved', () => {
    file.approveAll()

    for (const section of file.sections) {
      expect(section.status).toBe('approved')
    }
  })

  it('clearAll sets every section to pending', () => {
    file.approveAll()
    file.clearAll()

    for (const section of file.sections) {
      expect(section.status).toBe('pending')
    }
  })

  it('TC-RF16-4: document without ## headings has empty sections', () => {
    const empty = AnnotationFile.create('no-headings.md', 'sha256:xyz')
    expect(empty.sections).toEqual([])
  })

  it('TC-RF16-5: mixed review state reports correct counts', () => {
    file.approveSection('Introduction')
    file.approveSection('Requirements')
    file.rejectSection('Edge Cases')

    const approved = file.sections.filter(s => s.status === 'approved')
    const rejected = file.sections.filter(s => s.status === 'rejected')
    const pending = file.sections.filter(s => s.status === 'pending')

    expect(approved).toHaveLength(2)
    expect(rejected).toHaveLength(1)
    expect(pending).toHaveLength(2)
  })

  it('section not found throws', () => {
    expect(() => file.approveSection('Nonexistent Section'))
      .toThrow()
  })

  // -------------------------------------------------------------------------
  // Tree cascade tests (sections with level)
  // -------------------------------------------------------------------------

  describe('tree cascade', () => {
    let tree

    beforeEach(() => {
      tree = AnnotationFile.create('spec.md', 'sha256:abc')
      tree.sections = [
        { heading: 'Spec', level: 1, status: 'pending' },
        { heading: 'Requisitos', level: 2, status: 'pending' },
        { heading: 'CLI', level: 3, status: 'pending' },
        { heading: 'Rendering', level: 3, status: 'pending' },
        { heading: 'Regras', level: 2, status: 'pending' },
        { heading: 'Edge Cases', level: 2, status: 'pending' },
      ]
    })

    it('approving parent cascades to all children', () => {
      tree.approveSection('Requisitos')

      expect(tree.sections[1].status).toBe('approved') // Requisitos
      expect(tree.sections[2].status).toBe('approved') // CLI (child)
      expect(tree.sections[3].status).toBe('approved') // Rendering (child)
      expect(tree.sections[4].status).toBe('pending')  // Regras (sibling, not affected)
      expect(tree.sections[5].status).toBe('pending')  // Edge Cases (sibling)
    })

    it('approving h1 cascades to all h2 and h3', () => {
      tree.approveSection('Spec')

      for (const s of tree.sections) {
        expect(s.status).toBe('approved')
      }
    })

    it('approving leaf does not affect parent or siblings', () => {
      tree.approveSection('CLI')

      expect(tree.sections[0].status).toBe('pending')  // Spec (h1)
      expect(tree.sections[1].status).toBe('pending')  // Requisitos (h2 parent)
      expect(tree.sections[2].status).toBe('approved') // CLI (approved)
      expect(tree.sections[3].status).toBe('pending')  // Rendering (sibling h3)
    })

    it('reject cascades to all children', () => {
      tree.rejectSection('Requisitos')

      expect(tree.sections[1].status).toBe('rejected') // Requisitos
      expect(tree.sections[2].status).toBe('rejected') // CLI (child)
      expect(tree.sections[3].status).toBe('rejected') // Rendering (child)
      expect(tree.sections[4].status).toBe('pending')  // Regras (sibling, not affected)
    })

    it('reject h1 cascades to all descendants', () => {
      tree.rejectSection('Spec')

      for (const s of tree.sections) {
        expect(s.status).toBe('rejected')
      }
    })

    it('reject cascade stops at sibling boundary', () => {
      tree.rejectSection('Requisitos')

      expect(tree.sections[4].status).toBe('pending')  // Regras (sibling)
      expect(tree.sections[5].status).toBe('pending')  // Edge Cases (sibling)
    })

    it('reset cascades to all children', () => {
      // Approve tree first, then reset parent
      tree.approveSection('Requisitos')
      tree.resetSection('Requisitos')

      expect(tree.sections[1].status).toBe('pending')  // Requisitos
      expect(tree.sections[2].status).toBe('pending')  // CLI (child)
      expect(tree.sections[3].status).toBe('pending')  // Rendering (child)
      expect(tree.sections[4].status).toBe('pending')  // Regras (sibling, untouched)
    })

    it('reset h1 cascades to all descendants', () => {
      tree.approveSection('Spec')  // approve everything
      tree.resetSection('Spec')    // reset everything

      for (const s of tree.sections) {
        expect(s.status).toBe('pending')
      }
    })

    it('reset cascade stops at sibling boundary', () => {
      tree.approveSection('Spec')       // approve all
      tree.resetSection('Requisitos')   // reset only Requisitos subtree

      expect(tree.sections[0].status).toBe('approved')  // Spec (parent, untouched)
      expect(tree.sections[1].status).toBe('pending')   // Requisitos (reset)
      expect(tree.sections[2].status).toBe('pending')   // CLI (child, reset)
      expect(tree.sections[3].status).toBe('pending')   // Rendering (child, reset)
      expect(tree.sections[4].status).toBe('approved')  // Regras (sibling, untouched)
      expect(tree.sections[5].status).toBe('approved')  // Edge Cases (sibling, untouched)
    })

    it('approve cascade stops at sibling boundary', () => {
      tree.approveSection('Requisitos')

      // Should stop before "Regras" (same level 2)
      expect(tree.sections[4].status).toBe('pending')
    })

    it('sections without level do not cascade', () => {
      const flat = AnnotationFile.create('flat.md', 'sha256:x')
      flat.sections = [
        { heading: 'A', status: 'pending' },
        { heading: 'B', status: 'pending' },
      ]
      flat.approveSection('A')

      expect(flat.sections[0].status).toBe('approved')
      expect(flat.sections[1].status).toBe('pending')
    })

    it('reject on flat sections (no level) does not cascade', () => {
      const flat = AnnotationFile.create('flat.md', 'sha256:x')
      flat.sections = [
        { heading: 'A', status: 'pending' },
        { heading: 'B', status: 'pending' },
      ]
      flat.rejectSection('A')

      expect(flat.sections[0].status).toBe('rejected')
      expect(flat.sections[1].status).toBe('pending')
    })

    // -----------------------------------------------------------------------
    // Indeterminate state computation
    // -----------------------------------------------------------------------

    it('computeStatus returns indeterminate when children have mixed statuses', () => {
      tree.approveSection('CLI')  // approve one child of Requisitos

      const result = tree.computeStatus()
      const reqStatus = result.find(s => s.heading === 'Requisitos')
      expect(reqStatus.computed).toBe('indeterminate')
    })

    it('computeStatus returns approved when all children are approved', () => {
      tree.approveSection('Requisitos')  // cascades to CLI + Rendering

      const result = tree.computeStatus()
      const reqStatus = result.find(s => s.heading === 'Requisitos')
      expect(reqStatus.computed).toBe('approved')
    })

    it('computeStatus returns pending when all children are pending', () => {
      const result = tree.computeStatus()
      const reqStatus = result.find(s => s.heading === 'Requisitos')
      expect(reqStatus.computed).toBe('pending')
    })

    it('computeStatus returns rejected when parent is rejected', () => {
      tree.rejectSection('Requisitos')

      const result = tree.computeStatus()
      const reqStatus = result.find(s => s.heading === 'Requisitos')
      expect(reqStatus.computed).toBe('rejected')
    })

    it('computeStatus propagates indeterminate up the tree', () => {
      tree.approveSection('CLI')  // one grandchild approved

      const result = tree.computeStatus()
      const specStatus = result.find(s => s.heading === 'Spec')
      expect(specStatus.computed).toBe('indeterminate')
    })

    it('computeStatus for leaf sections matches their own status', () => {
      tree.approveSection('CLI')

      const result = tree.computeStatus()
      const cliStatus = result.find(s => s.heading === 'CLI')
      expect(cliStatus.computed).toBe('approved')
    })
  })
})

// ---------------------------------------------------------------------------
// Query methods
// ---------------------------------------------------------------------------
describe('Query methods', () => {
  let file

  beforeEach(() => {
    file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({ selectors: { position: { startLine: 1 } }, comment: 'c1', tag: 'bug', author: 'Alice' })
    file.add({ selectors: { position: { startLine: 2 } }, comment: 'c2', tag: 'question', author: 'Bob' })
    file.add({ selectors: { position: { startLine: 3 } }, comment: 'c3', tag: 'bug', author: 'Alice' })

    const secondId = file.annotations[1].id
    file.resolve(secondId)
  })

  it('getById returns the correct annotation or throws', () => {
    const id = file.annotations[0].id
    const ann = file.getById(id)

    expect(ann.id).toBe(id)
    expect(ann.comment).toBe('c1')
    expect(() => file.getById('unknown')).toThrow(/not found/i)
  })

  it('getOpen returns only open annotations', () => {
    const open = file.getOpen()

    expect(open).toHaveLength(2)
    for (const ann of open) {
      expect(ann.status).toBe('open')
    }
  })

  it('getResolved returns only resolved annotations', () => {
    const resolved = file.getResolved()

    expect(resolved).toHaveLength(1)
    expect(resolved[0].status).toBe('resolved')
    expect(resolved[0].comment).toBe('c2')
  })

  it('getByTag filters correctly and returns empty for unused tag', () => {
    const bugs = file.getByTag('bug')

    expect(bugs).toHaveLength(2)
    for (const ann of bugs) {
      expect(ann.tag).toBe('bug')
    }
    expect(file.getByTag('nitpick')).toEqual([])
  })

  it('getByAuthor filters correctly and returns empty for unknown author', () => {
    const alice = file.getByAuthor('Alice')

    expect(alice).toHaveLength(2)
    for (const ann of alice) {
      expect(ann.author).toBe('Alice')
    }
    expect(file.getByAuthor('Unknown')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// toJSON()
// ---------------------------------------------------------------------------
describe('toJSON()', () => {
  it('returns a JSON-serializable object with all top-level and annotation fields', () => {
    const file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 5, endLine: 5 } },
      comment: 'detailed note',
      tag: 'suggestion',
      author: 'Bob',
    })

    const json = file.toJSON()

    expect(json.version).toBe(1)
    expect(json.source).toBe('spec.md')
    expect(json.source_hash).toBe('sha256:abc')
    expect(json.annotations).toHaveLength(1)
    expect(json.sections).toBeInstanceOf(Array)

    const ann = json.annotations[0]
    for (const key of ['id', 'selectors', 'comment', 'tag', 'status', 'author', 'created_at', 'updated_at', 'replies']) {
      expect(ann).toHaveProperty(key)
    }

    // Must round-trip through JSON without loss
    const roundtrip = JSON.parse(JSON.stringify(json))
    expect(roundtrip).toEqual(json)
  })
})

// ---------------------------------------------------------------------------
// toSARIF()
// ---------------------------------------------------------------------------
describe('toSARIF()', () => {
  it('returns a SARIF-shaped object with version and runs', () => {
    const file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 5 } },
      comment: 'a finding',
      tag: 'bug',
      author: 'Alice',
    })

    const sarif = file.toSARIF()

    expect(sarif.$schema).toBeDefined()
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs).toBeInstanceOf(Array)
    expect(sarif.runs.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// save() and load() roundtrip
// ---------------------------------------------------------------------------
describe('save() and load() roundtrip', () => {
  it('TC-RF17-1: first annotation creates YAML file on disk', async () => {
    const yamlPath = node_path.join(tmpDir, 'spec.annotations.yaml')
    const file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 1 } },
      comment: 'first',
      tag: 'bug',
      author: 'Alice',
    })

    await file.save(yamlPath)

    const stat = await node_fs.stat(yamlPath)
    expect(stat.isFile()).toBe(true)
  })

  it('TC-RF21-2: resolve + save writes resolved status to YAML', async () => {
    const yamlPath = node_path.join(tmpDir, 'spec.annotations.yaml')
    const file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 1 } },
      comment: 'fixme',
      tag: 'bug',
      author: 'Alice',
    })
    const id = file.annotations[0].id
    file.resolve(id)
    await file.save(yamlPath)

    const loaded = await AnnotationFile.load(yamlPath)
    expect(loaded.getById(id).status).toBe('resolved')
  })

  it('full roundtrip preserves annotations, replies, and sections', async () => {
    const yamlPath = node_path.join(tmpDir, 'roundtrip.annotations.yaml')
    const file = AnnotationFile.create('spec.md', 'sha256:roundtrip')

    file.add({
      selectors: {
        position: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 40 },
        quote: { exact: 'some text', prefix: '- ', suffix: '\n' },
      },
      comment: 'important note',
      tag: 'suggestion',
      author: 'Henry',
    })
    file.add({
      selectors: { position: { startLine: 10 } },
      comment: 'another note',
      tag: 'bug',
      author: 'Maria',
    })
    file.addReply(file.annotations[0].id, { author: 'Maria', comment: 'agreed' })
    file.resolve(file.annotations[1].id)

    file.sections.push(
      { heading: 'Intro', status: 'pending' },
      { heading: 'Body', status: 'pending' },
    )
    file.approveSection('Intro')

    await file.save(yamlPath)
    const loaded = await AnnotationFile.load(yamlPath)

    expect(loaded.source).toBe('spec.md')
    expect(loaded.sourceHash).toBe('sha256:roundtrip')
    expect(loaded.version).toBe(1)
    expect(loaded.annotations).toHaveLength(2)
    expect(loaded.annotations[0].comment).toBe('important note')
    expect(loaded.annotations[0].replies).toHaveLength(1)
    expect(loaded.annotations[0].replies[0].comment).toBe('agreed')
    expect(loaded.annotations[1].status).toBe('resolved')
    expect(loaded.sections).toHaveLength(2)
    expect(loaded.sections[0].status).toBe('approved')
    expect(loaded.sections[1].status).toBe('pending')
  })

  it('saved YAML is human-readable text, not minified JSON', async () => {
    const yamlPath = node_path.join(tmpDir, 'human.annotations.yaml')
    const file = AnnotationFile.create('spec.md', 'sha256:abc')
    file.add({
      selectors: { position: { startLine: 1 } },
      comment: 'hello',
      tag: 'bug',
      author: 'A',
    })
    await file.save(yamlPath)

    const content = await node_fs.readFile(yamlPath, 'utf-8')

    expect(content).toContain('version:')
    expect(content).toContain('source:')
    expect(content).not.toMatch(/^\s*\{/)
  })
})

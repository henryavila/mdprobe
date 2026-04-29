import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { migrateFile, needsMigration } from '../../src/anchoring/v2/migrate.js'

let tmpDir, mdPath, yamlPath

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdprobe-mig-'))
  mdPath = path.join(tmpDir, 'doc.md')
  yamlPath = path.join(tmpDir, 'doc.annotations.yaml')
  fs.writeFileSync(mdPath, 'Header\n\nThis is a test paragraph with some words.\n')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('needsMigration', () => {
  it('returns true for v1 yaml', () => {
    const yamlContent = yaml.dump({
      annotations: [{
        id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
        created_at: '2026-01-01T00:00:00Z',
        selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
      }],
    })
    fs.writeFileSync(yamlPath, yamlContent)
    expect(needsMigration(yamlPath)).toBe(true)
  })

  it('returns false for v2 yaml', () => {
    fs.writeFileSync(yamlPath, yaml.dump({ schema_version: 2, annotations: [] }))
    expect(needsMigration(yamlPath)).toBe(false)
  })

  it('returns false when file does not exist', () => {
    expect(needsMigration(path.join(tmpDir, 'nope.yaml'))).toBe(false)
  })
})

describe('migrateFile', () => {
  it('migrates a v1 yaml to v2 with .bak backup', () => {
    const v1 = {
      annotations: [{
        id: 'a1', author: 'me', tag: 'question', status: 'open', comment: 'why?',
        created_at: '2026-01-01T00:00:00Z',
        selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '\n', suffix: ' is' } },
      }],
    }
    fs.writeFileSync(yamlPath, yaml.dump(v1))

    const result = migrateFile(yamlPath, mdPath)
    expect(result.migrated).toBe(true)
    expect(result.count).toBe(1)
    expect(fs.existsSync(yamlPath + '.bak')).toBe(true)

    const after = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
    expect(after.schema_version).toBe(2)
    expect(after.annotations[0].range).toBeDefined()
    expect(after.annotations[0].range.start).toBeGreaterThan(0)
    expect(after.annotations[0].selectors).toBeUndefined()
  })

  it('returns migrated:false for already-v2 file', () => {
    fs.writeFileSync(yamlPath, yaml.dump({ schema_version: 2, annotations: [] }))
    const result = migrateFile(yamlPath, mdPath)
    expect(result.migrated).toBe(false)
  })

  it('dry-run does not write files', () => {
    const v1 = { annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
    }] }
    fs.writeFileSync(yamlPath, yaml.dump(v1))
    const sizeBefore = fs.statSync(yamlPath).size

    const result = migrateFile(yamlPath, mdPath, { dryRun: true })
    expect(result.migrated).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(fs.statSync(yamlPath).size).toBe(sizeBefore)
    expect(fs.existsSync(yamlPath + '.bak')).toBe(false)
  })
})

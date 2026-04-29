import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { AnnotationFile } from '../../src/annotations.js'

let tmpDir, mdPath, yamlPath

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdprobe-aut-'))
  mdPath = path.join(tmpDir, 'doc.md')
  yamlPath = path.join(tmpDir, 'doc.annotations.yaml')
  fs.writeFileSync(mdPath, 'Header\n\nThis is a test paragraph with some words.\n')
})
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

describe('auto-migration on AnnotationFile.load', () => {
  it('migrates a v1 file silently and writes .bak', async () => {
    const v1 = {
      annotations: [{
        id: 'a1', author: 'me', tag: 'question', status: 'open', comment: 'c',
        created_at: '2026-01-01T00:00:00Z',
        selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
      }],
    }
    fs.writeFileSync(yamlPath, yaml.dump(v1))

    await AnnotationFile.load(yamlPath)
    const after = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
    expect(after.schema_version).toBe(2)
    expect(after.annotations[0].range).toBeDefined()
    expect(fs.existsSync(yamlPath + '.bak')).toBe(true)
  })

  it('does not touch a v2 file', async () => {
    fs.writeFileSync(yamlPath, yaml.dump({ schema_version: 2, annotations: [] }))
    const before = fs.statSync(yamlPath).mtimeMs
    await AnnotationFile.load(yamlPath)
    const after = fs.statSync(yamlPath).mtimeMs
    expect(after).toBe(before)
    expect(fs.existsSync(yamlPath + '.bak')).toBe(false)
  })
})

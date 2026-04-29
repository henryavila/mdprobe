import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { runMigrate } from '../../src/cli/migrate-cmd.js'

let tmpDir
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdprobe-cli-'))
})
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

function writeV1(dir, name) {
  const md = path.join(dir, name + '.md')
  const yp = path.join(dir, name + '.annotations.yaml')
  fs.writeFileSync(md, 'Header\n\nThis is a test paragraph with some words.\n')
  fs.writeFileSync(yp, yaml.dump({
    annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
    }],
  }))
}

describe('runMigrate', () => {
  it('migrates a single file', () => {
    writeV1(tmpDir, 'doc')
    const stats = runMigrate(path.join(tmpDir, 'doc.md'), { dryRun: false })
    expect(stats.migrated).toBe(1)
    expect(stats.alreadyV2).toBe(0)
    expect(stats.errors).toBe(0)
  })

  it('walks a directory recursively', () => {
    writeV1(tmpDir, 'a')
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    writeV1(path.join(tmpDir, 'sub'), 'b')
    const stats = runMigrate(tmpDir, { dryRun: false })
    expect(stats.migrated).toBe(2)
  })

  it('dry-run reports without writing', () => {
    writeV1(tmpDir, 'doc')
    const stats = runMigrate(path.join(tmpDir, 'doc.md'), { dryRun: true })
    expect(stats.migrated).toBe(1)
    expect(fs.existsSync(path.join(tmpDir, 'doc.annotations.yaml.bak'))).toBe(false)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

import { hashContent, hashFile, detectDrift } from '../../src/hash.js'

// Helper: compute expected SHA-256 hex for a given string
function expectedSha256(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex')
}

describe('hashContent', () => {
  it('returns a 64-character lowercase hex string', () => {
    const result = hashContent('hello world')
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces correct SHA-256 for known input', () => {
    const result = hashContent('hello world')
    expect(result).toBe(expectedSha256('hello world'))
  })

  it('returns consistent results for identical input', () => {
    const a = hashContent('test content')
    const b = hashContent('test content')
    expect(a).toBe(b)
  })

  it('returns different hashes for different inputs', () => {
    const a = hashContent('input A')
    const b = hashContent('input B')
    expect(a).not.toBe(b)
  })

  it('handles empty string', () => {
    const result = hashContent('')
    expect(result).toBe(expectedSha256(''))
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  it('handles unicode content (café)', () => {
    const result = hashContent('café')
    expect(result).toBe(expectedSha256('café'))
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  it('handles unicode content (日本語)', () => {
    const result = hashContent('日本語テスト')
    expect(result).toBe(expectedSha256('日本語テスト'))
  })

  it('handles emoji content', () => {
    const result = hashContent('🎉🚀✅')
    expect(result).toBe(expectedSha256('🎉🚀✅'))
  })

  it('handles multiline content', () => {
    const content = 'line 1\nline 2\nline 3\n'
    const result = hashContent(content)
    expect(result).toBe(expectedSha256(content))
  })

  it('distinguishes between different line endings', () => {
    const unix = hashContent('line1\nline2')
    const windows = hashContent('line1\r\nline2')
    expect(unix).not.toBe(windows)
  })
})

describe('hashFile', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `mdprobe-hash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns a promise', () => {
    const filePath = join(tmpDir, 'test.md')
    // Write first so the file exists
    const p = writeFile(filePath, 'content').then(() => hashFile(filePath))
    expect(p).toBeInstanceOf(Promise)
  })

  it('reads file and returns SHA-256 hash', async () => {
    const content = '# Hello Markdown\n\nSome content here.'
    const filePath = join(tmpDir, 'test.md')
    await writeFile(filePath, content, 'utf8')

    const result = await hashFile(filePath)
    expect(result).toBe(expectedSha256(content))
  })

  it('matches hashContent for the same content', async () => {
    const content = 'identical content for both functions'
    const filePath = join(tmpDir, 'match.md')
    await writeFile(filePath, content, 'utf8')

    const fileHash = await hashFile(filePath)
    const contentHash = hashContent(content)
    expect(fileHash).toBe(contentHash)
  })

  it('hashes empty file correctly', async () => {
    const filePath = join(tmpDir, 'empty.md')
    await writeFile(filePath, '', 'utf8')

    const result = await hashFile(filePath)
    expect(result).toBe(expectedSha256(''))
  })

  it('hashes file with unicode content correctly', async () => {
    const content = 'café 日本語 🎉'
    const filePath = join(tmpDir, 'unicode.md')
    await writeFile(filePath, content, 'utf8')

    const result = await hashFile(filePath)
    expect(result).toBe(expectedSha256(content))
  })

  it('throws on nonexistent file', async () => {
    const filePath = join(tmpDir, 'does-not-exist.md')
    await expect(hashFile(filePath)).rejects.toThrow()
  })

  it('throws with ENOENT for nonexistent file', async () => {
    const filePath = join(tmpDir, 'missing.md')
    await expect(hashFile(filePath)).rejects.toThrow(/ENOENT|no such file/)
  })
})

describe('detectDrift', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `mdprobe-drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns an object with drifted, savedHash, and currentHash fields', async () => {
    const mdContent = '# Test Document\n'
    const mdPath = join(tmpDir, 'doc.md')
    await writeFile(mdPath, mdContent, 'utf8')

    const currentHash = expectedSha256(mdContent)
    const yamlContent = [
      'version: 1',
      'source: doc.md',
      `source_hash: sha256:${currentHash}`,
      'annotations: []',
    ].join('\n')
    const yamlPath = join(tmpDir, 'doc.annotations.yaml')
    await writeFile(yamlPath, yamlContent, 'utf8')

    const result = await detectDrift(yamlPath, mdPath)
    expect(result).toHaveProperty('drifted')
    expect(result).toHaveProperty('savedHash')
    expect(result).toHaveProperty('currentHash')
  })

  it('TC-RF18-1: hash match returns drifted: false', async () => {
    const mdContent = '# Unchanged Document\n\nContent stays the same.\n'
    const mdPath = join(tmpDir, 'stable.md')
    await writeFile(mdPath, mdContent, 'utf8')

    const hash = expectedSha256(mdContent)
    const yamlContent = [
      'version: 1',
      'source: stable.md',
      `source_hash: sha256:${hash}`,
      'annotations: []',
    ].join('\n')
    const yamlPath = join(tmpDir, 'stable.annotations.yaml')
    await writeFile(yamlPath, yamlContent, 'utf8')

    const result = await detectDrift(yamlPath, mdPath)
    expect(result.drifted).toBe(false)
    expect(result.savedHash).toBe(hash)
    expect(result.currentHash).toBe(hash)
  })

  it('TC-RF18-2: hash mismatch returns drifted: true', async () => {
    const originalContent = '# Original Content\n'
    const modifiedContent = '# Modified Content\n\nNew paragraph added.\n'
    const mdPath = join(tmpDir, 'changed.md')

    // YAML was saved with hash of original content
    const savedHash = expectedSha256(originalContent)
    const yamlContent = [
      'version: 1',
      'source: changed.md',
      `source_hash: sha256:${savedHash}`,
      'annotations: []',
    ].join('\n')
    const yamlPath = join(tmpDir, 'changed.annotations.yaml')
    await writeFile(yamlPath, yamlContent, 'utf8')

    // But the .md has been modified since
    await writeFile(mdPath, modifiedContent, 'utf8')

    const result = await detectDrift(yamlPath, mdPath)
    expect(result.drifted).toBe(true)
    expect(result.savedHash).toBe(savedHash)
    expect(result.currentHash).toBe(expectedSha256(modifiedContent))
    expect(result.savedHash).not.toBe(result.currentHash)
  })

  it('reads source_hash field from YAML correctly', async () => {
    const mdContent = 'simple content'
    const mdPath = join(tmpDir, 'simple.md')
    await writeFile(mdPath, mdContent, 'utf8')

    const hash = expectedSha256(mdContent)
    // YAML with extra fields that should not interfere
    const yamlContent = [
      'version: 1',
      'source: simple.md',
      `source_hash: sha256:${hash}`,
      'sections:',
      '  - heading: "Test"',
      '    status: pending',
      'annotations:',
      '  - id: abc123',
      '    comment: "test"',
      '    tag: bug',
      '    status: open',
    ].join('\n')
    const yamlPath = join(tmpDir, 'simple.annotations.yaml')
    await writeFile(yamlPath, yamlContent, 'utf8')

    const result = await detectDrift(yamlPath, mdPath)
    expect(result.drifted).toBe(false)
    expect(result.savedHash).toBe(hash)
  })

  it('detects drift when only whitespace changes in the md', async () => {
    const original = '# Title\n\nContent\n'
    const modified = '# Title\n\nContent\n\n'  // extra trailing newline
    const mdPath = join(tmpDir, 'whitespace.md')

    const savedHash = expectedSha256(original)
    const yamlContent = [
      'version: 1',
      'source: whitespace.md',
      `source_hash: sha256:${savedHash}`,
      'annotations: []',
    ].join('\n')
    const yamlPath = join(tmpDir, 'whitespace.annotations.yaml')
    await writeFile(yamlPath, yamlContent, 'utf8')
    await writeFile(mdPath, modified, 'utf8')

    const result = await detectDrift(yamlPath, mdPath)
    expect(result.drifted).toBe(true)
  })

  it('handles YAML without source_hash field gracefully', async () => {
    const mdContent = '# No Hash\n'
    const mdPath = join(tmpDir, 'nohash.md')
    await writeFile(mdPath, mdContent, 'utf8')

    const yamlContent = [
      'version: 1',
      'source: nohash.md',
      'annotations: []',
    ].join('\n')
    const yamlPath = join(tmpDir, 'nohash.annotations.yaml')
    await writeFile(yamlPath, yamlContent, 'utf8')

    // Should treat missing hash as drifted (no baseline to compare)
    const result = await detectDrift(yamlPath, mdPath)
    expect(result.drifted).toBe(true)
    expect(result.savedHash).toBeNull()
  })

  it('throws when YAML file does not exist', async () => {
    const mdPath = join(tmpDir, 'exists.md')
    await writeFile(mdPath, 'content', 'utf8')
    const yamlPath = join(tmpDir, 'nonexistent.annotations.yaml')

    await expect(detectDrift(yamlPath, mdPath)).rejects.toThrow()
  })

  it('throws when md file does not exist', async () => {
    const yamlContent = [
      'version: 1',
      'source: gone.md',
      'source_hash: sha256:abc123',
      'annotations: []',
    ].join('\n')
    const yamlPath = join(tmpDir, 'gone.annotations.yaml')
    await writeFile(yamlPath, yamlContent, 'utf8')
    const mdPath = join(tmpDir, 'gone.md')

    await expect(detectDrift(yamlPath, mdPath)).rejects.toThrow()
  })
})

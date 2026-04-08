import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findMarkdownFiles, extractFlag, hasFlag } from '../../src/cli-utils.js'

// ===========================================================================
// extractFlag — flag parsing with value extraction and array mutation
// ===========================================================================

describe('extractFlag', () => {
  it('extracts flag value and removes flag+value from args', () => {
    const args = ['file.md', '--port', '4000', '--once']
    const value = extractFlag(args, '--port')

    expect(value).toBe('4000')
    expect(args).toEqual(['file.md', '--once'])
  })

  it('returns true when flag exists but has no value', () => {
    const args = ['--port']
    const value = extractFlag(args, '--port')

    expect(value).toBe(true)
    expect(args).toEqual([])
  })

  it('returns true when flag is last and next arg starts with dash', () => {
    const args = ['--port', '--once']
    const value = extractFlag(args, '--port')

    // --once starts with -, so it's NOT consumed as a value
    expect(value).toBe(true)
    expect(args).toEqual(['--once'])
  })

  it('returns undefined when flag is not present', () => {
    const args = ['file.md', '--once']
    const value = extractFlag(args, '--port')

    expect(value).toBeUndefined()
    expect(args).toEqual(['file.md', '--once'])
  })

  it('handles flag at the beginning of args', () => {
    const args = ['--port', '8080', 'file.md']
    const value = extractFlag(args, '--port')

    expect(value).toBe('8080')
    expect(args).toEqual(['file.md'])
  })

  it('handles flag at the end of args with no following value', () => {
    const args = ['file.md', '--port']
    const value = extractFlag(args, '--port')

    expect(value).toBe(true)
    expect(args).toEqual(['file.md'])
  })

  it('only extracts the first occurrence', () => {
    const args = ['--port', '3000', '--port', '4000']
    const value = extractFlag(args, '--port')

    expect(value).toBe('3000')
    expect(args).toEqual(['--port', '4000'])
  })

  it('value "0" is extracted as string "0" (not falsy)', () => {
    const args = ['--port', '0']
    const value = extractFlag(args, '--port')

    expect(value).toBe('0')
  })

  it('value with spaces works when properly separated', () => {
    const args = ['--author', 'Henry Avila']
    const value = extractFlag(args, '--author')

    expect(value).toBe('Henry Avila')
  })
})

// ===========================================================================
// hasFlag — boolean flag detection with mutation
// ===========================================================================

describe('hasFlag', () => {
  it('returns true and removes flag when present', () => {
    const args = ['file.md', '--once', '--no-open']
    const result = hasFlag(args, '--once')

    expect(result).toBe(true)
    expect(args).toEqual(['file.md', '--no-open'])
  })

  it('returns false when flag is absent', () => {
    const args = ['file.md', '--port', '3000']
    const result = hasFlag(args, '--once')

    expect(result).toBe(false)
    expect(args).toEqual(['file.md', '--port', '3000'])
  })

  it('supports multiple aliases — matches first found', () => {
    const args = ['-h', 'file.md']
    const result = hasFlag(args, '--help', '-h')

    expect(result).toBe(true)
    expect(args).toEqual(['file.md'])
  })

  it('prefers first alias when both present', () => {
    const args = ['--help', '-h']
    const result = hasFlag(args, '--help', '-h')

    expect(result).toBe(true)
    // Only first match removed
    expect(args).toEqual(['-h'])
  })

  it('returns false for empty args', () => {
    const args = []
    expect(hasFlag(args, '--once')).toBe(false)
  })

  it('does not remove non-matching args', () => {
    const args = ['--version', 'file.md', '--once']
    hasFlag(args, '--once')

    expect(args).toContain('--version')
    expect(args).toContain('file.md')
    expect(args).not.toContain('--once')
  })
})

// ===========================================================================
// findMarkdownFiles — recursive .md discovery
// ===========================================================================

describe('findMarkdownFiles', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mdprobe-cli-utils-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('discovers .md files in a flat directory', () => {
    writeFileSync(join(tmpDir, 'readme.md'), '# Hi')
    writeFileSync(join(tmpDir, 'spec.md'), '# Spec')

    const files = findMarkdownFiles(tmpDir)

    expect(files).toHaveLength(2)
    expect(files[0]).toContain('readme.md')
    expect(files[1]).toContain('spec.md')
  })

  it('discovers .md files recursively in subdirectories', () => {
    const sub = join(tmpDir, 'docs', 'api')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(tmpDir, 'root.md'), '# Root')
    writeFileSync(join(sub, 'endpoints.md'), '# API')

    const files = findMarkdownFiles(tmpDir)

    expect(files).toHaveLength(2)
    expect(files.some(f => f.endsWith('root.md'))).toBe(true)
    expect(files.some(f => f.endsWith('endpoints.md'))).toBe(true)
  })

  it('ignores non-.md files', () => {
    writeFileSync(join(tmpDir, 'readme.md'), '# Hi')
    writeFileSync(join(tmpDir, 'readme.txt'), 'plain text')
    writeFileSync(join(tmpDir, 'app.js'), 'console.log()')
    writeFileSync(join(tmpDir, 'style.css'), 'body {}')
    writeFileSync(join(tmpDir, 'data.json'), '{}')

    const files = findMarkdownFiles(tmpDir)

    expect(files).toHaveLength(1)
    expect(files[0]).toContain('readme.md')
  })

  it('handles .MD extension (case-insensitive)', () => {
    writeFileSync(join(tmpDir, 'UPPER.MD'), '# Upper')
    writeFileSync(join(tmpDir, 'Mixed.Md'), '# Mixed')

    const files = findMarkdownFiles(tmpDir)

    expect(files).toHaveLength(2)
  })

  it('returns sorted paths', () => {
    writeFileSync(join(tmpDir, 'z-last.md'), '# Z')
    writeFileSync(join(tmpDir, 'a-first.md'), '# A')
    writeFileSync(join(tmpDir, 'm-middle.md'), '# M')

    const files = findMarkdownFiles(tmpDir)

    expect(files).toHaveLength(3)
    // Should be alphabetically sorted
    expect(files[0]).toContain('a-first.md')
    expect(files[2]).toContain('z-last.md')
  })

  it('returns empty array for empty directory', () => {
    const files = findMarkdownFiles(tmpDir)
    expect(files).toEqual([])
  })

  it('returns empty array for non-existent directory', () => {
    const files = findMarkdownFiles(join(tmpDir, 'does-not-exist'))
    expect(files).toEqual([])
  })

  it('returns absolute paths', () => {
    writeFileSync(join(tmpDir, 'doc.md'), '# Doc')

    const files = findMarkdownFiles(tmpDir)

    expect(files[0]).toMatch(/^\//)
    expect(files[0]).toContain(tmpDir)
  })

  it('does not include directories that end in .md', () => {
    const dirNamedMd = join(tmpDir, 'notes.md')
    mkdirSync(dirNamedMd)
    writeFileSync(join(dirNamedMd, 'actual.md'), '# Real file')

    const files = findMarkdownFiles(tmpDir)

    // Should only find the actual file, not the directory
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('actual.md')
  })

  it('handles deeply nested structures (3+ levels)', () => {
    const deep = join(tmpDir, 'a', 'b', 'c', 'd')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'deep.md'), '# Deep')
    writeFileSync(join(tmpDir, 'root.md'), '# Root')

    const files = findMarkdownFiles(tmpDir)

    expect(files).toHaveLength(2)
    expect(files.some(f => f.endsWith('deep.md'))).toBe(true)
  })
})

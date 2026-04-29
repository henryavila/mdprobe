import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'

import { readChangelogSection } from '../../src/changelog.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Per-test scratch dir holder. */
let scratchDir

beforeEach(() => {
  scratchDir = mkdtempSync(pathJoin(tmpdir(), 'mdprobe-changelog-test-'))
})

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true })
    scratchDir = null
  }
})

/**
 * Write a CHANGELOG.md inside the scratch dir and return the absolute path.
 * @param {string} contents
 * @returns {string}
 */
function writeChangelog(contents) {
  const file = pathJoin(scratchDir, 'CHANGELOG.md')
  writeFileSync(file, contents, 'utf-8')
  return file
}

// ---------------------------------------------------------------------------
// Well-formed sections
// ---------------------------------------------------------------------------

describe('readChangelogSection — well-formed sections', () => {
  it('parses a simple section with no date suffix', () => {
    const file = writeChangelog(
      [
        '# Changelog',
        '',
        '## [0.5.1]',
        '- bullet one',
        '- bullet two',
        '',
        '## [0.5.0]',
        '- older bullet',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('0.5.1', file)
    expect(result).toEqual({
      bullets: ['bullet one', 'bullet two'],
      truncated: false,
    })
  })

  it('matches a section header with a trailing date suffix', () => {
    const file = writeChangelog(
      [
        '# Changelog',
        '',
        '## [0.5.1] - 2026-04-30',
        '- bullet one',
        '- bullet two',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('0.5.1', file)
    expect(result).toEqual({
      bullets: ['bullet one', 'bullet two'],
      truncated: false,
    })
  })

  it('also accepts `* ` style bullets', () => {
    const file = writeChangelog(
      [
        '## [1.0.0]',
        '* star bullet one',
        '* star bullet two',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('1.0.0', file)
    expect(result).toEqual({
      bullets: ['star bullet one', 'star bullet two'],
      truncated: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Subheaders (### Added / ### Fixed / non-standard like ### Migration)
// ---------------------------------------------------------------------------

describe('readChangelogSection — subheaders', () => {
  it('flattens bullets across `### Added` / `### Fixed` subheaders, preserving order', () => {
    const file = writeChangelog(
      [
        '## [0.5.1] - 2026-04-30',
        '',
        '### Added',
        '- added one',
        '- added two',
        '',
        '### Fixed',
        '- fixed one',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('0.5.1', file)
    expect(result).toEqual({
      bullets: ['added one', 'added two', 'fixed one'],
      truncated: false,
    })
  })

  it('forgives non-standard subheaders like `### Migration` (treats any ### as skippable)', () => {
    const file = writeChangelog(
      [
        '## [0.5.0] - 2026-04-29',
        '',
        '### Added',
        '- added one',
        '',
        '### Migration',
        '- migration step one',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('0.5.0', file)
    expect(result).toEqual({
      bullets: ['added one', 'migration step one'],
      truncated: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Truncation at 6 bullets
// ---------------------------------------------------------------------------

describe('readChangelogSection — truncation', () => {
  it('returns the first 6 bullets and sets truncated=true when more exist', () => {
    const file = writeChangelog(
      [
        '## [2.0.0]',
        '- one',
        '- two',
        '- three',
        '- four',
        '- five',
        '- six',
        '- seven',
        '- eight',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('2.0.0', file)
    expect(result.bullets).toEqual(['one', 'two', 'three', 'four', 'five', 'six'])
    expect(result.truncated).toBe(true)
  })

  it('does not set truncated when bullet count is exactly 6', () => {
    const file = writeChangelog(
      [
        '## [2.0.0]',
        '- one',
        '- two',
        '- three',
        '- four',
        '- five',
        '- six',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('2.0.0', file)
    expect(result.bullets.length).toBe(6)
    expect(result.truncated).toBe(false)
  })

  it('truncation respects subheader flattening — combined count, not per-section', () => {
    const file = writeChangelog(
      [
        '## [2.0.0]',
        '### Added',
        '- a1',
        '- a2',
        '- a3',
        '- a4',
        '### Fixed',
        '- f1',
        '- f2',
        '- f3',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('2.0.0', file)
    expect(result.bullets).toEqual(['a1', 'a2', 'a3', 'a4', 'f1', 'f2'])
    expect(result.truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Failure modes — return null, never throw
// ---------------------------------------------------------------------------

describe('readChangelogSection — failure modes', () => {
  it('returns null when the requested version section is missing', () => {
    const file = writeChangelog(
      [
        '## [0.5.0]',
        '- only this version exists',
        '',
      ].join('\n')
    )

    expect(readChangelogSection('9.9.9', file)).toBeNull()
  })

  it('returns null when the changelog file does not exist (no throw)', () => {
    const missing = pathJoin(scratchDir, 'does-not-exist.md')
    expect(readChangelogSection('0.5.1', missing)).toBeNull()
  })

  it('returns null when the file has no `## ` headers at all', () => {
    const file = writeChangelog('just some prose without any headers\n- maybe a stray bullet\n')
    expect(readChangelogSection('0.5.1', file)).toBeNull()
  })

  it('returns null when the changelog path is not a string / undefined', () => {
    expect(readChangelogSection('0.5.1', undefined)).toBeNull()
    expect(readChangelogSection('0.5.1', null)).toBeNull()
  })

  it('returns null when version is missing', () => {
    const file = writeChangelog('## [0.5.1]\n- bullet\n')
    expect(readChangelogSection('', file)).toBeNull()
    expect(readChangelogSection(undefined, file)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Bullet text content — URLs, markdown links
// ---------------------------------------------------------------------------

describe('readChangelogSection — bullet content transformations', () => {
  it('preserves a bare https:// URL verbatim in bullet text', () => {
    const file = writeChangelog(
      [
        '## [0.5.1]',
        '- see https://example.com/foo for details',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('0.5.1', file)
    expect(result.bullets).toEqual(['see https://example.com/foo for details'])
  })

  it('rewrites markdown link `[foo](https://bar)` as `foo (https://bar)` for terminal readability', () => {
    const file = writeChangelog(
      [
        '## [0.5.1]',
        '- check [the docs](https://example.com/docs) for migration notes',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('0.5.1', file)
    expect(result.bullets).toEqual([
      'check the docs (https://example.com/docs) for migration notes',
    ])
  })

  it('rewrites multiple markdown links in a single bullet', () => {
    const file = writeChangelog(
      [
        '## [0.5.1]',
        '- see [one](https://a.com) and [two](https://b.com)',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('0.5.1', file)
    expect(result.bullets).toEqual([
      'see one (https://a.com) and two (https://b.com)',
    ])
  })
})

// ---------------------------------------------------------------------------
// Real-world fixture: parse the project's own CHANGELOG.md shape
// ---------------------------------------------------------------------------

describe('readChangelogSection — real-world Keep a Changelog shape', () => {
  it('parses a section with bold-prefixed bullets (matches v0.5.0 shape)', () => {
    const file = writeChangelog(
      [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '### Added',
        '- _Pending entries for the next release will be added here._',
        '',
        '## [0.5.0] - 2026-04-29',
        '',
        '### Added',
        '- **Char-precise highlighting**: annotations are anchored by UTF-16 char offsets.',
        '- **CSS Custom Highlight API rendering**: zero DOM mutation, GPU-accelerated.',
        '',
        '### Changed',
        '- **Schema v2** for `.annotations.yaml`: replaced by `range`.',
        '',
        '### Removed',
        '- Old mark-based renderer.',
        '',
        '### Migration',
        'Existing `.annotations.yaml` files are upgraded automatically on first load.',
        '',
        '[Unreleased]: https://github.com/henryavila/mdprobe/compare/v0.5.0...HEAD',
        '[0.5.0]: https://github.com/henryavila/mdprobe/releases/tag/v0.5.0',
        '',
      ].join('\n')
    )

    const result = readChangelogSection('0.5.0', file)
    expect(result).toEqual({
      bullets: [
        '**Char-precise highlighting**: annotations are anchored by UTF-16 char offsets.',
        '**CSS Custom Highlight API rendering**: zero DOM mutation, GPU-accelerated.',
        '**Schema v2** for `.annotations.yaml`: replaced by `range`.',
        'Old mark-based renderer.',
      ],
      truncated: false,
    })
  })
})

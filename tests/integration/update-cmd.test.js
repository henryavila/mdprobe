/**
 * Integration tests for `runUpdate`.
 *
 * Approach: real filesystem (a temp dir holding a fake CHANGELOG.md), real
 * `readChangelogSection` parser, but `fetch` and `spawn` are still mocked —
 * the goal is to validate the wiring end-to-end (registry -> PM detect ->
 * confirm-skipped via --yes -> install spawn -> verify spawn -> changelog
 * read from disk -> "What's new" output) without performing a real network
 * fetch or spawning npm.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

import { runUpdate } from '../../src/cli/update-cmd.js'
import { readChangelogSection } from '../../src/changelog.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWriter() {
  let buf = ''
  return {
    write: (chunk) => { buf += chunk; return true },
    get text() { return buf },
  }
}

function fakeFetch(body) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }))
}

/**
 * spawn mock: install (first call) returns 0; verify (second call) returns
 * a real-looking npm-list JSON payload reporting the installed version.
 */
function fakeSpawn({ installedVersion } = {}) {
  const calls = []
  const factory = vi.fn((cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    const isList = Array.isArray(args) && args.includes('list')
    setImmediate(() => {
      if (isList) {
        const body = JSON.stringify({
          dependencies: {
            '@henryavila/mdprobe': { version: installedVersion },
          },
        })
        child.stdout.emit('data', Buffer.from(body))
        child.emit('close', 0)
      } else {
        child.emit('close', 0)
      }
    })
    return child
  })
  factory.calls = calls
  return factory
}

// ---------------------------------------------------------------------------
// Setup: temp directory with a fake installed package layout.
// ---------------------------------------------------------------------------

let tmp
let globalRoot
let changelogPath

const CHANGELOG_TEXT = `# Changelog

## [Unreleased]

## [0.5.1] - 2026-04-30

### Added
- Add mdprobe update command
- Add update notifier banner

### Fixed
- Fix browser freeze on annotation save
- Fix duplicate highlights on code blocks

## [0.5.0] - 2026-04-29

### Added
- Initial v0.5.0 features
`

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mdprobe-update-int-'))
  // Mirror the layout used at runtime: <globalRoot>/@henryavila/mdprobe/CHANGELOG.md.
  globalRoot = join(tmp, 'node_modules')
  const pkgDir = join(globalRoot, '@henryavila', 'mdprobe')
  mkdirSync(pkgDir, { recursive: true })
  changelogPath = join(pkgDir, 'CHANGELOG.md')
  writeFileSync(changelogPath, CHANGELOG_TEXT, 'utf-8')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runUpdate — integration (fake registry + real changelog read)', () => {
  it('happy path: fetch -> install -> verify -> "What\'s new" from disk', async () => {
    const stdout = makeWriter()
    const stderr = makeWriter()
    const spawn = fakeSpawn({ installedVersion: '0.5.1' })

    const code = await runUpdate(
      { yes: true },
      {
        fetch: fakeFetch({ version: '0.5.1' }),
        spawn,
        readLockFile: async () => null,
        isProcessAlive: () => false,
        removeLockFile: async () => {},
        detectPackageManager: () => 'npm',
        detectGlobalRoot: () => globalRoot,
        // Real parser, real file on disk.
        readChangelogSection,
        pkg: { name: '@henryavila/mdprobe', version: '0.5.0' },
        env: { NODE_ENV: 'test' },
        stdout,
        stderr,
      },
    )

    expect(code).toBe(0)

    // Spawn argv shape: install first, list second.
    expect(spawn.calls.length).toBe(2)
    expect(spawn.calls[0]).toMatchObject({
      cmd: 'npm',
      args: ['install', '-g', '@henryavila/mdprobe@latest'],
    })
    // Spawn must always pass argv as an array, never `shell: true`.
    expect(Array.isArray(spawn.calls[0].args)).toBe(true)
    expect(spawn.calls[0].opts?.shell).not.toBe(true)
    expect(spawn.calls[1]).toMatchObject({
      cmd: 'npm',
      args: ['list', '-g', '@henryavila/mdprobe', '--json'],
    })

    const out = stdout.text
    // Summary block.
    expect(out).toMatch(/0\.5\.0\s*→\s*0\.5\.1/)
    expect(out).toMatch(/Manager: npm/)
    expect(out).toMatch(/npm install -g @henryavila\/mdprobe@latest/)

    // Success line + "What's new".
    expect(out).toMatch(/Updated mdprobe to 0\.5\.1/)
    expect(out).toMatch(/What's new in 0\.5\.1/)
    expect(out).toMatch(/Add mdprobe update command/)
    expect(out).toMatch(/Fix browser freeze on annotation save/)
    expect(out).toMatch(/Full notes:\s*https:\/\/github\.com\/henryavila\/mdprobe\/releases\/tag\/v0\.5\.1/)
    expect(out).toMatch(/Start with: mdprobe/)
  })

  it('skips "What\'s new" gracefully when CHANGELOG.md is missing', async () => {
    rmSync(changelogPath)

    const stdout = makeWriter()
    const stderr = makeWriter()

    const code = await runUpdate(
      { yes: true },
      {
        fetch: fakeFetch({ version: '0.5.1' }),
        spawn: fakeSpawn({ installedVersion: '0.5.1' }),
        readLockFile: async () => null,
        isProcessAlive: () => false,
        removeLockFile: async () => {},
        detectPackageManager: () => 'npm',
        detectGlobalRoot: () => globalRoot,
        readChangelogSection,
        pkg: { name: '@henryavila/mdprobe', version: '0.5.0' },
        env: { NODE_ENV: 'test' },
        stdout,
        stderr,
      },
    )

    expect(code).toBe(0)
    expect(stdout.text).toMatch(/Updated mdprobe to 0\.5\.1/)
    // Block must NOT appear when the file is gone.
    expect(stdout.text).not.toMatch(/What's new in/)
    // Update flow itself still completes cleanly.
    expect(stderr.text).toBe('')
  })

  it('dry-run does not spawn anything', async () => {
    const spawn = fakeSpawn({ installedVersion: '0.5.1' })
    const stdout = makeWriter()
    const stderr = makeWriter()

    const code = await runUpdate(
      { yes: true, dryRun: true },
      {
        fetch: fakeFetch({ version: '0.5.1' }),
        spawn,
        readLockFile: async () => null,
        isProcessAlive: () => false,
        removeLockFile: async () => {},
        detectPackageManager: () => 'npm',
        detectGlobalRoot: () => globalRoot,
        readChangelogSection,
        pkg: { name: '@henryavila/mdprobe', version: '0.5.0' },
        env: { NODE_ENV: 'test' },
        stdout,
        stderr,
      },
    )

    expect(code).toBe(0)
    expect(spawn.calls.length).toBe(0)
    expect(stdout.text).toMatch(/dry-run/i)
  })
})

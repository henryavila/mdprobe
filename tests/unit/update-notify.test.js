import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock update-notifier so we can spy on calls without performing
// any real network I/O or 24h cache writes during tests.
const { notifyMock, factoryMock } = vi.hoisted(() => {
  const notifyMock = vi.fn()
  const factoryMock = vi.fn(() => ({ notify: notifyMock }))
  return { notifyMock, factoryMock }
})

vi.mock('update-notifier', () => ({
  default: factoryMock,
}))

import { setupNotifier } from '../../src/update-notify.js'

const PKG = { name: '@henryavila/mdprobe', version: '0.5.0' }

beforeEach(() => {
  factoryMock.mockClear()
  notifyMock.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Suppression matrix — table-driven coverage of every row in the spec.
// ---------------------------------------------------------------------------

describe('setupNotifier — suppression matrix', () => {
  const cases = [
    {
      name: 'Normal interactive: shows banner',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'production' },
      args: [],
      expected: 'show',
    },
    {
      name: 'stdout piped: suppress',
      tty: { stdout: false, stderr: true },
      env: { NODE_ENV: 'production' },
      args: [],
      expected: 'suppress',
    },
    {
      name: 'stderr piped: suppress',
      tty: { stdout: true, stderr: false },
      env: { NODE_ENV: 'production' },
      args: [],
      expected: 'suppress',
    },
    {
      name: 'In CI: suppress',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'production', CI: 'true' },
      args: [],
      expected: 'suppress',
    },
    {
      name: 'Opt-out flag NO_UPDATE_NOTIFIER: suppress',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'production', NO_UPDATE_NOTIFIER: '1' },
      args: [],
      expected: 'suppress',
    },
    {
      name: 'Test env (NODE_ENV=test): suppress',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'test' },
      args: [],
      expected: 'suppress',
    },
    {
      name: '--once flag: suppress',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'production' },
      args: ['--once'],
      expected: 'suppress',
    },
    {
      name: '--json flag: suppress',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'production' },
      args: ['--json'],
      expected: 'suppress',
    },
    {
      name: 'update subcommand: suppress',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'production' },
      args: ['update'],
      expected: 'suppress',
    },
    {
      name: 'stop subcommand: suppress',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'production' },
      args: ['stop'],
      expected: 'suppress',
    },
    {
      name: 'migrate subcommand: suppress',
      tty: { stdout: true, stderr: true },
      env: { NODE_ENV: 'production' },
      args: ['migrate'],
      expected: 'suppress',
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      setupNotifier(PKG, c.args, c.env, c.tty)
      if (c.expected === 'show') {
        expect(factoryMock).toHaveBeenCalledTimes(1)
      } else {
        expect(factoryMock).not.toHaveBeenCalled()
        expect(notifyMock).not.toHaveBeenCalled()
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Show-path: factory args + notify message format.
// ---------------------------------------------------------------------------

describe('setupNotifier — show path', () => {
  const showTty = { stdout: true, stderr: true }
  const showEnv = { NODE_ENV: 'production' }

  it('invokes update-notifier with the package and 24h check interval', () => {
    setupNotifier(PKG, [], showEnv, showTty)

    expect(factoryMock).toHaveBeenCalledTimes(1)
    const opts = factoryMock.mock.calls[0][0]
    expect(opts.pkg).toEqual(PKG)
    expect(opts.updateCheckInterval).toBe(1000 * 60 * 60 * 24)
    expect(opts.shouldNotifyInNpmScript).toBe(false)
  })

  it('calls notifier.notify with defer:false and isGlobal:true', () => {
    setupNotifier(PKG, [], showEnv, showTty)

    expect(notifyMock).toHaveBeenCalledTimes(1)
    const arg = notifyMock.mock.calls[0][0]
    expect(arg.defer).toBe(false)
    expect(arg.isGlobal).toBe(true)
    expect(typeof arg.message).toBe('string')
  })

  it('banner message contains the GitHub releases URL, the run hint, and the silence hint', () => {
    setupNotifier(PKG, [], showEnv, showTty)

    const message = notifyMock.mock.calls[0][0].message
    expect(message).toContain('https://github.com/henryavila/mdprobe/releases')
    expect(message).toContain('Run: mdprobe update')
    expect(message).toContain('NO_UPDATE_NOTIFIER')
  })
})

// ---------------------------------------------------------------------------
// Subcommand detection precedence (positional arg).
// ---------------------------------------------------------------------------

describe('setupNotifier — subcommand detection', () => {
  const showTty = { stdout: true, stderr: true }
  const showEnv = { NODE_ENV: 'production' }

  it('does not treat a markdown file path as a suppressing subcommand', () => {
    setupNotifier(PKG, ['README.md'], showEnv, showTty)
    expect(factoryMock).toHaveBeenCalledTimes(1)
  })

  it('suppresses when update subcommand precedes other args', () => {
    setupNotifier(PKG, ['update', '--yes'], showEnv, showTty)
    expect(factoryMock).not.toHaveBeenCalled()
  })
})

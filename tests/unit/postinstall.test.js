import { afterEach, describe, expect, it, vi } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { writeFileSync } = vi.hoisted(() => ({
  writeFileSync: vi.fn()
}))

vi.mock('node:fs', () => ({
  writeFileSync
}))

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'postinstall.js')
const SCRIPT_URL = pathToFileURL(SCRIPT_PATH).href

async function runPostinstallScript() {
  vi.resetModules()

  let stdout = ''
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })

  try {
    await import(`${SCRIPT_URL}?run=${Date.now()}-${Math.random()}`)
  } finally {
    stdoutSpy.mockRestore()
  }

  return {
    stdout,
    ttyWrites: writeFileSync.mock.calls
  }
}

describe('postinstall script', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    writeFileSync.mockReset()
  })

  it('writes the install banner directly to /dev/tty when an interactive terminal is available', async () => {
    const result = await runPostinstallScript()

    expect(writeFileSync).toHaveBeenCalledTimes(1)
    expect(writeFileSync.mock.calls[0][0]).toBe('/dev/tty')
    expect(writeFileSync.mock.calls[0][1]).toContain('installed successfully!')
    expect(writeFileSync.mock.calls[0][1]).toContain('mdprobe setup')
    expect(result.stdout).toBe('')
  })

  it('falls back to stdout when /dev/tty is unavailable', async () => {
    writeFileSync.mockImplementation(() => {
      const error = new Error('tty unavailable')
      error.code = 'ENXIO'
      throw error
    })

    const result = await runPostinstallScript()

    expect(writeFileSync).toHaveBeenCalledWith('/dev/tty', expect.any(String))
    expect(result.stdout).toContain('mdprobe doc.md')
    expect(result.stdout).toContain('mdprobe docs/')
    expect(result.stdout).toContain('mdprobe setup')
    expect(result.stdout).toMatch(/mdprobe/i)
  })
})

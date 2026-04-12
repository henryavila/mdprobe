import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..', '..')
const SCRIPT_PATH = join(PROJECT_ROOT, 'scripts', 'postinstall.js')
const NODE = process.execPath

function runScript() {
  return new Promise((resolve) => {
    execFile(NODE, [SCRIPT_PATH], { timeout: 5000 }, (error, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', code: error ? error.code ?? 1 : 0 })
    })
  })
}

describe('postinstall script', () => {
  it('exits with code 0', async () => {
    const result = await runScript()
    expect(result.code).toBe(0)
  })

  it('shows CLI usage examples', async () => {
    const result = await runScript()
    const output = result.stdout
    expect(output).toContain('mdprobe doc.md')
    expect(output).toContain('mdprobe docs/')
  })

  it('tells user to run setup for AI integration', async () => {
    const result = await runScript()
    const output = result.stdout
    expect(output).toContain('mdprobe setup')
  })

  it('includes the package name', async () => {
    const result = await runScript()
    const output = result.stdout
    expect(output).toMatch(/mdprobe/i)
  })
})

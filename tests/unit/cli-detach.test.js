import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const cliPath = path.join(import.meta.dirname, '..', '..', 'bin', 'cli.js')

describe('mdprobe --detach', () => {
  let tmpDir, fixturePath, customLock, bgPid

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdprobe-detach-'))
    fixturePath = path.join(tmpDir, 'doc.md')
    fs.writeFileSync(fixturePath, '# Test\n\nHello world.\n')
    customLock = path.join(tmpDir, 'mdprobe.lock')
    bgPid = null
  })

  afterEach(async () => {
    // Kill the background server if it started
    if (bgPid) {
      try { process.kill(bgPid, 'SIGTERM') } catch { /* ignore */ }
      // Give it a moment to exit
      await new Promise(r => setTimeout(r, 150))
      try { process.kill(bgPid, 'SIGKILL') } catch { /* ignore */ }
    }
    // Remove lock and temp dir
    try { fs.unlinkSync(customLock) } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('-d flag: parent exits with code 0 and prints detached message', async () => {
    const child = spawn('node', [cliPath, fixturePath, '-d', '--no-open', '--port', '0'], {
      env: { ...process.env, MDPROBE_LOCK_PATH: customLock },
      stdio: 'pipe',
    })

    let exitCode
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })

    await new Promise(resolve => {
      child.on('close', code => { exitCode = code; resolve() })
    })

    expect(exitCode, `stderr: ${stderr}`).toBe(0)
    expect(stdout).toMatch(/detached at/i)
    expect(stdout).toMatch(/mdprobe stop/)
  }, 10000)

  it('-d flag: lock file exists after parent exits', async () => {
    const child = spawn('node', [cliPath, fixturePath, '-d', '--no-open', '--port', '0'], {
      env: { ...process.env, MDPROBE_LOCK_PATH: customLock },
      stdio: 'pipe',
    })

    await new Promise(resolve => { child.on('close', resolve) })

    expect(fs.existsSync(customLock), 'lock file should exist').toBe(true)

    const lock = JSON.parse(fs.readFileSync(customLock, 'utf-8'))
    expect(typeof lock.pid).toBe('number')
    expect(lock.pid).toBeGreaterThan(0)
    // Background server PID is different from the spawning parent process
    expect(lock.pid).not.toBe(child.pid)
    bgPid = lock.pid
  }, 10000)

  it('--detach long form works the same as -d', async () => {
    const child = spawn('node', [cliPath, fixturePath, '--detach', '--no-open', '--port', '0'], {
      env: { ...process.env, MDPROBE_LOCK_PATH: customLock },
      stdio: 'pipe',
    })

    let exitCode
    let stdout = ''
    child.stdout.on('data', d => { stdout += d.toString() })

    await new Promise(resolve => { child.on('close', code => { exitCode = code; resolve() }) })

    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/detached at/i)

    if (fs.existsSync(customLock)) {
      const lock = JSON.parse(fs.readFileSync(customLock, 'utf-8'))
      bgPid = lock.pid
    }
  }, 10000)

  it('--detach is ignored when combined with --once', async () => {
    // --once + --detach should NOT detach; once mode runs normally (blocking)
    // We just verify the parent does NOT immediately exit (--once waits for user action)
    // We spawn with a timeout to confirm it is still running after 1s
    const child = spawn('node', [cliPath, fixturePath, '--once', '--detach', '--no-open', '--port', '0'], {
      env: { ...process.env, MDPROBE_LOCK_PATH: customLock },
      stdio: 'pipe',
    })

    let exited = false
    child.on('exit', () => { exited = true })

    // Wait 1.5 seconds — if detach mode fired, it would have exited by now
    await new Promise(r => setTimeout(r, 1500))

    // In --once mode the server is still listening (waiting for "Done" click)
    // so the process should still be running
    expect(exited).toBe(false)

    // Clean up
    child.kill('SIGTERM')
    await new Promise(r => setTimeout(r, 200))
    child.kill('SIGKILL')
  }, 10000)
})

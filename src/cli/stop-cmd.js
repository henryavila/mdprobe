import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { confirm, isCancel, intro, outro } from '@clack/prompts'
import { readLockFile, DEFAULT_LOCK_PATH, isProcessAlive } from '../singleton.js'
import { createLogger } from '../telemetry.js'

const tel = createLogger('stop')

function formatAge(startedAtIso) {
  const ms = Date.now() - new Date(startedAtIso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'less than 1 minute ago'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Attempt to kill a process using SIGTERM, then SIGKILL if still alive.
 * @param {number} pid
 * @returns {Promise<{killed: boolean, reason?: string}>}
 */
async function killProcess(pid) {
  if (!isProcessAlive(pid)) {
    return { killed: false, reason: 'already-dead' }
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (e) {
    if (e.code === 'ESRCH') return { killed: false, reason: 'already-dead' }
    if (e.code === 'EPERM') return { killed: false, reason: 'permission-denied' }
    throw e
  }

  // Wait for graceful shutdown
  await new Promise(resolve => setTimeout(resolve, 200))

  // If still alive, force kill
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (e) {
      if (e.code !== 'ESRCH') throw e
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  return { killed: true }
}

/**
 * Stop the running mdprobe singleton server.
 * @param {object} opts
 * @param {boolean} [opts.force=false] - skip confirmation prompt
 * @param {string} [opts.lockPath] - custom lock file path
 * @returns {Promise<{stopped: boolean, reason?: string, pid?: number}>}
 */
export async function runStop(opts = {}) {
  const { force = false, lockPath = DEFAULT_LOCK_PATH } = opts

  const lock = await readLockFile(lockPath)

  if (!lock) {
    tel.log('stop', { status: 'no_lock' })
    console.log('mdprobe: nothing running (no lock file)')
    return { stopped: false, reason: 'no-lock' }
  }

  const alive = isProcessAlive(lock.pid)

  // Stale lock — clean up silently
  if (!alive) {
    try {
      await fs.unlink(lockPath)
    } catch { /* ignore ENOENT */ }
    tel.log('stop', { status: 'stale_lock_cleaned', pid: lock.pid })
    console.log(`mdprobe: removed stale lock (PID ${lock.pid} no longer running)`)
    return { stopped: true, reason: 'stale-lock-cleaned', pid: lock.pid }
  }

  // Prompt for confirmation if not forced
  if (!force) {
    intro('mdprobe stop')
    console.log(`  PID:   ${lock.pid}`)
    console.log(`  Port:  ${lock.port}`)
    console.log(`  URL:   ${lock.url}`)
    console.log(`  Since: ${formatAge(lock.startedAt)}`)
    console.log('')

    const ok = await confirm({
      message: 'Kill this process and clean the lock?',
      initialValue: true,
    })

    if (isCancel(ok) || !ok) {
      outro('Cancelled')
      tel.log('stop', { status: 'user_cancelled', pid: lock.pid })
      return { stopped: false, reason: 'cancelled' }
    }
  }

  // Kill the process
  const result = await killProcess(lock.pid)

  // Always clean the lock file
  try {
    await fs.unlink(lockPath)
  } catch { /* ignore ENOENT */ }

  if (result.killed) {
    tel.log('stop', { status: 'killed', pid: lock.pid })
    console.log(`mdprobe: stopped PID ${lock.pid}`)
    return { stopped: true, pid: lock.pid }
  } else if (result.reason === 'permission-denied') {
    tel.log('stop', { status: 'permission_denied', pid: lock.pid })
    console.error(`mdprobe: cannot kill PID ${lock.pid} (permission denied)`)
    return { stopped: false, reason: 'permission-denied', pid: lock.pid }
  }

  tel.log('stop', { status: result.reason, pid: lock.pid })
  return { stopped: false, reason: result.reason, pid: lock.pid }
}

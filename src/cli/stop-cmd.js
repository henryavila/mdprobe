import fs from 'node:fs/promises'
import node_http from 'node:http'
import { networkInterfaces as nodeNetworkInterfaces } from 'node:os'
import { readLockFile, DEFAULT_LOCK_PATH, isProcessAlive } from '../singleton.js'
import { createLogger } from '../telemetry.js'
import { unexposeProvider } from '../expose/index.js'

const tel = createLogger('stop')

const SCAN_PORT_START = 3000
const SCAN_PORT_END = 3010

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

function getScanHosts(networkInterfaces = nodeNetworkInterfaces) {
  const hosts = ['127.0.0.1']
  const interfaces = networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && !hosts.includes(entry.address)) {
        hosts.push(entry.address)
      }
    }
  }
  return hosts
}

function probePort(host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const url = `http://${host}:${port}`
    const req = node_http.get(`${url}/api/status`, { timeout }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.identity === 'mdprobe') {
            resolve({ port, pid: json.pid, files: json.files || [], uptime: json.uptime, url })
          } else {
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

async function scanForOrphans() {
  const probes = []
  for (const host of getScanHosts()) {
    for (let port = SCAN_PORT_START; port <= SCAN_PORT_END; port++) {
      probes.push(probePort(host, port))
    }
  }
  const results = await Promise.all(probes)
  const seen = new Set()
  return results.filter(Boolean).filter((result) => {
    const key = `${result.pid}:${result.port}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Stop the running mdprobe singleton server.
 * Falls back to port scanning when no lock file exists.
 * @param {object} opts
 * @param {boolean} [opts.force=false] - skip confirmation prompt
 * @param {boolean} [opts.unexpose=false] - disable persisted provider mapping when supported
 * @param {string} [opts.lockPath] - custom lock file path
 * @returns {Promise<{stopped: boolean, reason?: string, pid?: number}>}
 */
export async function runStop(opts = {}) {
  const { force = false, unexpose = false, lockPath = DEFAULT_LOCK_PATH } = opts

  const lock = await readLockFile(lockPath)

  let staleCleanedPid = null

  if (lock) {
    if (unexpose) {
      const result = await unexposeProvider({ lock })
      for (const warning of result.warnings || []) {
        console.error(`mdprobe: ${warning}`)
      }
      if (result.unexposed) {
        console.log('mdprobe: remote exposure disabled')
      }
    } else if (lock.expose === 'tailscale' && lock.remoteBaseUrl) {
      console.log(`mdprobe: remote exposure stays active (${lock.remoteBaseUrl}); run \`mdprobe stop --unexpose\` to disable the tailscale mapping`)
    }

    const alive = isProcessAlive(lock.pid)

    if (!alive) {
      try { await fs.unlink(lockPath) } catch { /* ignore ENOENT */ }
      staleCleanedPid = lock.pid
      tel.log('stop', { status: 'stale_lock_cleaned', pid: lock.pid })
      console.log(`mdprobe: removed stale lock (PID ${lock.pid} no longer running)`)
      // Fall through to port scan — orphan might be a different process
    } else {
      return await stopInstance({
        pid: lock.pid, port: lock.port, url: lock.url,
        startedAt: lock.startedAt, source: 'lock', force, lockPath,
      })
    }
  }

  console.log(`mdprobe: no lock file, scanning ports ${SCAN_PORT_START}–${SCAN_PORT_END}...`)
  const orphans = await scanForOrphans()

  if (orphans.length === 0) {
    if (staleCleanedPid != null) {
      return { stopped: true, reason: 'stale-lock-cleaned', pid: staleCleanedPid }
    }
    tel.log('stop', { status: 'nothing_found', scanned: true })
    console.log('mdprobe: no running instances found')
    return { stopped: false, reason: 'no-lock' }
  }

  let stoppedCount = 0
  for (const orphan of orphans) {
    const result = await stopInstance({
      pid: orphan.pid, port: orphan.port,
      url: orphan.url,
      files: orphan.files, uptime: orphan.uptime,
      source: 'scan', force, lockPath: null,
    })
    if (result.stopped) stoppedCount++
  }

  return {
    stopped: stoppedCount > 0,
    reason: stoppedCount > 0 ? 'scan-killed' : 'scan-cancelled',
  }
}

async function stopInstance({ pid, port, url, startedAt, files, uptime, source, force, lockPath }) {
  if (!force) {
    console.log('')
    console.log(`  Found mdprobe${source === 'scan' ? ' (orphan — no lock file)' : ''}:`)
    console.log(`  PID:   ${pid}`)
    console.log(`  Port:  ${port}`)
    if (url) console.log(`  URL:   ${url}`)
    if (startedAt) console.log(`  Since: ${formatAge(startedAt)}`)
    if (uptime != null) console.log(`  Uptime: ${Math.floor(uptime / 60)} min`)
    if (files?.length) console.log(`  Files: ${files.join(', ')}`)
    console.log('')

    if (process.stdin.isTTY) {
      const { confirm, isCancel } = await import('@clack/prompts')
      const ok = await confirm({ message: 'Kill this process?', initialValue: true })
      if (isCancel(ok) || !ok) {
        tel.log('stop', { status: 'user_cancelled', pid })
        console.log('Cancelled')
        return { stopped: false, reason: 'cancelled', pid }
      }
    }
  }

  const result = await killProcess(pid)

  if (lockPath) {
    try { await fs.unlink(lockPath) } catch { /* ignore ENOENT */ }
  }

  if (result.killed) {
    tel.log('stop', { status: 'killed', pid, source })
    console.log(`mdprobe: stopped PID ${pid} (port ${port})`)
    return { stopped: true, pid }
  } else if (result.reason === 'permission-denied') {
    tel.log('stop', { status: 'permission_denied', pid })
    console.error(`mdprobe: cannot kill PID ${pid} (permission denied)`)
    return { stopped: false, reason: 'permission-denied', pid }
  }

  tel.log('stop', { status: result.reason, pid })
  return { stopped: false, reason: result.reason, pid }
}

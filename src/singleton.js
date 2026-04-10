import { readFile, writeFile, unlink } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import node_http from 'node:http'
import { fileURLToPath } from 'node:url'
import { hashContent } from './hash.js'
import { createLogger } from './telemetry.js'

const tel = createLogger('singleton')

const __filename = fileURLToPath(import.meta.url)
const DIST_INDEX = join(dirname(__filename), '..', 'dist', 'index.html')

const DEFAULT_LOCK_PATH = join(tmpdir(), 'mdprobe.lock')

/**
 * Compute a build hash from dist/index.html content.
 * Falls back to package version if dist doesn't exist (dev mode).
 * @returns {Promise<string>}
 */
export async function computeBuildHash() {
  try {
    const content = await readFile(DIST_INDEX, 'utf-8')
    return hashContent(content)
  } catch {
    try {
      const pkg = JSON.parse(await readFile(join(dirname(__filename), '..', 'package.json'), 'utf-8'))
      return `pkg:${pkg.version}`
    } catch {
      return 'unknown'
    }
  }
}

/**
 * Read and parse the lock file.
 * @param {string} [lockPath]
 * @returns {Promise<{pid: number, port: number, url: string, startedAt: string} | null>}
 */
export async function readLockFile(lockPath = DEFAULT_LOCK_PATH) {
  try {
    const raw = await readFile(lockPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Write lock file with server instance data.
 * @param {{pid: number, port: number, url: string, startedAt: string}} data
 * @param {string} [lockPath]
 */
export async function writeLockFile(data, lockPath = DEFAULT_LOCK_PATH) {
  await writeFile(lockPath, JSON.stringify(data), 'utf-8')
  tel.log('lock_write', { pid: data.pid, port: data.port, buildHash: data.buildHash })
}

/**
 * Remove lock file. Silently ignores ENOENT.
 * @param {string} [lockPath]
 */
export async function removeLockFile(lockPath = DEFAULT_LOCK_PATH) {
  tel.log('lock_remove', { trigger: 'async' })
  try {
    await unlink(lockPath)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

/**
 * Synchronous lock file removal — last resort for process.on('exit').
 * @param {string} [lockPath]
 */
export function removeLockFileSync(lockPath = DEFAULT_LOCK_PATH) {
  // Note: tel.log uses cached _enabledCache. If cache is still null (very early exit
  // before any log call), the async resolution won't complete inside 'exit' handler.
  // In practice cli.js logs 'start' first, so the cache is always resolved by here.
  tel.log('lock_remove', { trigger: 'sync' })
  try {
    unlinkSync(lockPath)
  } catch { /* ignore */ }
}

/**
 * Check if a process with the given PID is alive.
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err.code === 'EPERM') return true
    return false
  }
}

/**
 * Ping a server's /api/status endpoint to verify it's a running mdprobe instance.
 * @param {string} url - Base URL (e.g. "http://127.0.0.1:3000")
 * @param {number} [timeout=2000]
 * @returns {Promise<{alive: boolean}>}
 */
export function pingServer(url, timeout = 2000) {
  return new Promise((resolve) => {
    const req = node_http.get(`${url}/api/status`, { timeout }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve({ alive: json.identity === 'mdprobe' })
        } catch {
          resolve({ alive: false })
        }
      })
    })
    req.on('error', () => resolve({ alive: false }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ alive: false })
    })
  })
}

/**
 * Discover an existing running mdprobe server via lock file + HTTP verification.
 * Cleans up stale lock files automatically.
 * @param {string} [lockPath]
 * @param {string} [currentBuildHash] - If provided, reject servers with different buildHash
 * @returns {Promise<{url: string, port: number} | null>}
 */
export async function discoverExistingServer(lockPath = DEFAULT_LOCK_PATH, currentBuildHash) {
  const lock = await readLockFile(lockPath)
  tel.log('lock_read', { found: !!lock, lockPid: lock?.pid, lockPort: lock?.port, buildHash: lock?.buildHash })
  if (!lock) {
    tel.log('discover', { found: false })
    return null
  }

  // Reject lock files without buildHash when we have one (backward compat)
  if (currentBuildHash && !lock.buildHash) {
    tel.log('hash_check', { match: false, local: currentBuildHash, remote: lock.buildHash })
    tel.log('lock_stale', { reason: 'hash_mismatch', lockPid: lock.pid })
    await removeLockFile(lockPath)
    tel.log('discover', { found: false })
    return null
  }

  // Reject lock files with different buildHash (stale server)
  if (currentBuildHash && lock.buildHash !== currentBuildHash) {
    tel.log('hash_check', { match: false, local: currentBuildHash, remote: lock.buildHash })
    tel.log('lock_stale', { reason: 'hash_mismatch', lockPid: lock.pid })
    await removeLockFile(lockPath)
    tel.log('discover', { found: false })
    return null
  }

  if (currentBuildHash) {
    tel.log('hash_check', { match: true, local: currentBuildHash, remote: lock.buildHash })
  }

  const alive = isProcessAlive(lock.pid)
  tel.log('process_alive', { lockPid: lock.pid, alive })
  if (!alive) {
    tel.log('lock_stale', { reason: 'no_process', lockPid: lock.pid })
    await removeLockFile(lockPath)
    tel.log('discover', { found: false })
    return null
  }

  const start = Date.now()
  const { alive: pingAlive } = await pingServer(lock.url)
  const ms = Date.now() - start
  tel.log('ping', { url: lock.url, ok: pingAlive, ms })
  if (!pingAlive) {
    tel.log('lock_stale', { reason: 'no_ping', lockPid: lock.pid })
    await removeLockFile(lockPath)
    tel.log('discover', { found: false })
    return null
  }

  tel.log('discover', { found: true, url: lock.url, port: lock.port })
  return { url: lock.url, port: lock.port }
}

/**
 * Join an existing server by adding files via its HTTP API.
 * @param {string} url - Base URL of the running server
 * @param {string[]} files - Absolute file paths to add
 * @returns {Promise<{ok: boolean, files?: string[], added?: string[]}>}
 */
export function joinExistingServer(url, files) {
  tel.log('join', { url, filesAdded: files.length })
  return new Promise((resolve) => {
    const body = JSON.stringify({ files })
    const parsed = new URL(`${url}/api/add-files`)

    const req = node_http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 5000,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve({ ok: json.ok === true, files: json.files, added: json.added })
        } catch {
          resolve({ ok: false })
        }
      })
    })

    req.on('error', () => resolve({ ok: false }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false })
    })
    req.end(body)
  })
}

let shuttingDown = false

/**
 * Register signal handlers to clean up lock file and close server on exit.
 * @param {{close: Function}} serverObj
 * @param {string} [lockPath]
 */
export function registerShutdownHandlers(serverObj, lockPath = DEFAULT_LOCK_PATH) {
  shuttingDown = false

  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true

    await removeLockFile(lockPath)

    try {
      await serverObj.close()
    } catch { /* ignore */ }

    process.exit(0)
  }

  process.on('SIGINT', () => {
    tel.log('shutdown', { signal: 'SIGINT' })
    shutdown()
  })
  process.on('SIGTERM', () => {
    tel.log('shutdown', { signal: 'SIGTERM' })
    shutdown()
  })

  // Synchronous last-resort cleanup on exit
  process.on('exit', () => {
    tel.log('shutdown', { signal: 'exit' })
    removeLockFileSync(lockPath)
  })
}

export { DEFAULT_LOCK_PATH }

// For testing
export function _resetShutdownFlag() { shuttingDown = false }

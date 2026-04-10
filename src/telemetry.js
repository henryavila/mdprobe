import { appendFileSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { getConfig } from './config.js'

export const TELEMETRY_PATH = '/tmp/mdprobe-telemetry.jsonl'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

/** @type {boolean | null} */
let _enabledCache = null

/** @type {boolean} */
let _rotatedThisSession = false

/** @type {string} */
let _path = TELEMETRY_PATH

/**
 * Override the telemetry file path (for testing).
 * @param {string} p
 */
export function _setPath(p) {
  _path = p
}

/**
 * Reset the resolved enabled/disabled cache (for tests).
 */
export function _resetCache() {
  _enabledCache = null
  _rotatedThisSession = false
  _path = TELEMETRY_PATH
}

/**
 * Resolve whether telemetry is enabled.
 * Priority: env var > config file > default (false).
 * Called once (lazy), result cached.
 * @returns {Promise<boolean>}
 */
async function resolveEnabled() {
  if (_enabledCache !== null) return _enabledCache

  // 1. Check env var
  const envVal = process.env.MDPROBE_TELEMETRY
  if (envVal !== undefined && envVal !== '') {
    _enabledCache = envVal === '1' || envVal.toLowerCase() === 'true'
    return _enabledCache
  }

  // 2. Check config file
  try {
    const config = await getConfig()
    if (config.telemetry === true || config.telemetry === 'true') {
      _enabledCache = true
      return true
    }
    if (config.telemetry === false || config.telemetry === 'false') {
      _enabledCache = false
      return false
    }
  } catch {
    // Config read failure — fall through to default
  }

  // 3. Default: disabled
  _enabledCache = false
  return _enabledCache
}

/**
 * Rotate (truncate) the telemetry file if it exceeds MAX_FILE_SIZE.
 * Only checked once per process session.
 */
function rotateIfNeeded() {
  if (_rotatedThisSession) return
  _rotatedThisSession = true

  try {
    const stat = statSync(_path)
    if (stat.size > MAX_FILE_SIZE) {
      writeFileSync(_path, '')
    }
  } catch {
    // File does not exist yet — nothing to rotate
  }
}

/**
 * Create a telemetry logger bound to a source name.
 * @param {string} source
 * @returns {{ log: (evt: string, data?: object) => void }}
 */
export function createLogger(source) {
  return {
    log(evt, data) {
      // Fire-and-forget: resolution is async, but we don't want callers to await.
      // We use the cached value when available for synchronous fast-path.
      if (_enabledCache === false) return
      if (_enabledCache === true) {
        writeEntry(source, evt, data)
        return
      }
      // First call — need to resolve
      resolveEnabled().then((enabled) => {
        if (enabled) writeEntry(source, evt, data)
      }).catch(() => {
        // Telemetry must never crash the host process
      })
    },
  }
}

/**
 * Write a single JSON line to the telemetry file.
 * @param {string} src
 * @param {string} evt
 * @param {object} [data]
 */
function writeEntry(src, evt, data) {
  try {
    rotateIfNeeded()

    const entry = {
      ts: new Date().toISOString(),
      pid: process.pid,
      src,
      evt,
    }
    if (data !== undefined && data !== null) {
      entry.data = data
    }

    appendFileSync(_path, JSON.stringify(entry) + '\n')
  } catch {
    // Telemetry must never crash the host process
  }
}

/**
 * Get the parent process command name.
 * Linux: read /proc/<ppid>/cmdline, split on null bytes, return basename of first element.
 * Fallback: 'unknown'.
 * @returns {string}
 */
export function getParentCmd() {
  try {
    const raw = readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8')
    const parts = raw.split('\0').filter(Boolean)
    if (parts.length > 0) {
      return basename(parts[0])
    }
  } catch {
    // Not on Linux or /proc not available
  }
  return 'unknown'
}

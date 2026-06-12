import { execFile as nodeExecFile } from 'node:child_process'
import { networkInterfaces as nodeNetworkInterfaces } from 'node:os'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import node_net from 'node:net'

const execFileAsync = promisify(nodeExecFile)

const EXECUTABLE_PROVIDERS = new Set(['off', 'external', 'tailscale', 'lan'])
const PLANNED_PROVIDERS = new Set(['ngrok', 'cloudflare'])
const KNOWN_PROVIDERS = new Set([...EXECUTABLE_PROVIDERS, ...PLANNED_PROVIDERS])

export const DEFAULT_EXPOSE_CONFIG = Object.freeze({
  expose: 'off',
  remoteBaseUrl: null,
  exposePort: 8443,
  bindHost: '127.0.0.1',
  allowPublicUnauthenticated: false,
})

export function coerceKnownConfigValue(key, value) {
  switch (key) {
    case 'expose':
      return normalizeExposeProvider(value)
    case 'exposePort':
      return normalizeExposePort(value)
    case 'bindHost':
      return normalizeBindHost(value)
    case 'remoteBaseUrl':
      return normalizeRemoteBaseUrl(value)
    case 'allowPublicUnauthenticated':
      return normalizeBoolean(value, key)
    default:
      return value
  }
}

export function normalizeExposeConfig(input = {}) {
  const config = { ...DEFAULT_EXPOSE_CONFIG }
  if (input.expose !== undefined) config.expose = normalizeExposeProvider(input.expose)
  if (input.remoteBaseUrl !== undefined) config.remoteBaseUrl = normalizeRemoteBaseUrl(input.remoteBaseUrl)
  if (input.exposePort !== undefined) config.exposePort = normalizeExposePort(input.exposePort)
  if (input.bindHost !== undefined) config.bindHost = normalizeBindHost(input.bindHost)
  if (input.allowPublicUnauthenticated !== undefined) {
    config.allowPublicUnauthenticated = normalizeBoolean(input.allowPublicUnauthenticated, 'allowPublicUnauthenticated')
  }

  if (config.expose === 'external' && !config.remoteBaseUrl) {
    throw new Error('remoteBaseUrl is required when expose is external')
  }

  return config
}

export function resolveServerBindHost(config = {}, deps = {}) {
  const normalized = normalizeExposeConfig(config)
  if (normalized.expose !== 'lan') return '127.0.0.1'
  if (normalized.bindHost && normalized.bindHost !== '127.0.0.1') return normalized.bindHost
  return getPrimaryLanIp(deps.networkInterfaces) || '0.0.0.0'
}

export function buildRemoteUrl(remoteBaseUrl, filePath) {
  if (!remoteBaseUrl) return undefined
  const base = normalizeRemoteBaseUrl(remoteBaseUrl, { allowHttp: true })
  if (!filePath) return base
  const url = new URL(base)
  url.pathname = `/${encodeURIComponent(basename(filePath))}`
  return stripTrailingSlash(url.toString())
}

export async function reconcileExposure({
  config = {},
  actualPort,
  files = [],
  lock,
  execFile = execFileAsync,
  networkInterfaces = nodeNetworkInterfaces,
} = {}) {
  const normalized = normalizeExposeConfig(config)
  const result = {
    expose: normalized.expose,
    exposePort: normalized.exposePort,
    bindHost: normalized.expose === 'lan'
      ? resolveServerBindHost(normalized, { networkInterfaces })
      : normalized.bindHost,
    allowPublicUnauthenticated: normalized.allowPublicUnauthenticated,
    warnings: [],
  }

  switch (normalized.expose) {
    case 'off':
      return result
    case 'external':
      result.remoteBaseUrl = normalized.remoteBaseUrl
      result.remoteUrl = maybeBuildRemoteUrl(result.remoteBaseUrl, files)
      if (normalized.allowPublicUnauthenticated) {
        result.exposeRisk = 'external-public-unauthenticated'
        result.warnings.push('expose=external with allowPublicUnauthenticated=true: mdProbe has no authentication; anyone who can reach the proxy can read the served files and write annotations.')
      }
      return result
    case 'tailscale':
      return reconcileTailscale({ normalized, actualPort, files, execFile, result })
    case 'lan':
      return reconcileLan({ normalized, actualPort, files, networkInterfaces, result, lock })
    default:
      throw new Error(`Unsupported expose provider: ${normalized.expose}`)
  }
}

export async function unexposeProvider({ lock, execFile = execFileAsync } = {}) {
  if (!lock || lock.expose !== 'tailscale') {
    return { unexposed: false, warnings: [] }
  }

  const exposePort = normalizeExposePort(lock.exposePort || DEFAULT_EXPOSE_CONFIG.exposePort)
  try {
    await execFile('tailscale', ['serve', `--https=${exposePort}`, 'off'])
    return { unexposed: true, warnings: [] }
  } catch (err) {
    return {
      unexposed: false,
      warnings: [`Could not disable tailscale serve on port ${exposePort}: ${err.message}`],
    }
  }
}

export function applyExposureToLock(lock, exposure) {
  const next = {
    ...lock,
    expose: exposure?.expose || 'off',
    exposePort: exposure?.exposePort ?? DEFAULT_EXPOSE_CONFIG.exposePort,
    bindHost: exposure?.bindHost || DEFAULT_EXPOSE_CONFIG.bindHost,
    allowPublicUnauthenticated: Boolean(exposure?.allowPublicUnauthenticated),
  }

  for (const key of ['remoteBaseUrl', 'remoteUrl', 'exposeRisk', 'exposeWarnings']) {
    delete next[key]
  }

  if (exposure?.remoteBaseUrl) next.remoteBaseUrl = exposure.remoteBaseUrl
  if (exposure?.remoteUrl) next.remoteUrl = exposure.remoteUrl
  if (exposure?.exposeRisk) next.exposeRisk = exposure.exposeRisk
  if (exposure?.warnings?.length) next.exposeWarnings = [...exposure.warnings]

  return next
}

function normalizeExposeProvider(value) {
  const provider = String(value ?? '').trim().toLowerCase()
  if (!provider) return DEFAULT_EXPOSE_CONFIG.expose
  if (PLANNED_PROVIDERS.has(provider)) {
    throw new Error(`Expose provider "${provider}" is a planned provider and is not implemented yet`)
  }
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new Error(`Unknown expose provider "${provider}"`)
  }
  return provider
}

function normalizeExposePort(value) {
  const port = typeof value === 'number'
    ? value
    : (/^\d+$/.test(String(value).trim()) ? Number(String(value).trim()) : NaN)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('exposePort must be an integer in the range 1024-65535')
  }
  return port
}

function normalizeBindHost(value) {
  const host = String(value ?? '').trim()
  if (!host) return DEFAULT_EXPOSE_CONFIG.bindHost
  if (host === 'localhost') return '127.0.0.1'
  if (node_net.isIP(host) !== 4) {
    throw new Error('bindHost must be 127.0.0.1, 0.0.0.0, or a valid IPv4 address')
  }
  return host
}

function normalizeRemoteBaseUrl(value, { allowHttp = false } = {}) {
  if (value == null || value === '') return null
  const raw = String(value).trim()
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('remoteBaseUrl must be a valid https URL')
  }
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error('remoteBaseUrl must use https://')
  }
  if (parsed.username || parsed.password) {
    throw new Error('remoteBaseUrl must not include credentials')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('remoteBaseUrl must not include query string or hash')
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('remoteBaseUrl must be a base URL without a file path')
  }
  parsed.pathname = '/'
  return stripTrailingSlash(parsed.toString())
}

function normalizeBoolean(value, key) {
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'off'].includes(text)) return false
  throw new Error(`${key} must be a boolean`)
}

async function reconcileTailscale({ normalized, actualPort, files, execFile, result }) {
  let status
  try {
    const { stdout } = await execFile('tailscale', ['status', '--json'])
    status = JSON.parse(stdout)
  } catch (err) {
    result.warnings.push(`tailscale is not available or did not return status JSON: ${err.message}`)
    return result
  }

  if (status.BackendState !== 'Running') {
    result.warnings.push(`tailscale is not running (${status.BackendState || 'unknown'}); continuing local-only`)
    return result
  }

  const dnsName = status.Self?.DNSName ? String(status.Self.DNSName).replace(/\.$/, '') : ''
  if (!dnsName) {
    result.warnings.push('tailscale status did not include Self.DNSName; continuing local-only')
    return result
  }

  try {
    await execFile('tailscale', [
      'serve',
      '--bg',
      `--https=${normalized.exposePort}`,
      String(actualPort),
    ])
  } catch (err) {
    const detail = /access denied/i.test(err.message)
      ? `tailscale serve access denied; run: sudo tailscale set --operator=$USER`
      : `tailscale serve failed: ${err.message}`
    result.warnings.push(`${detail}; continuing local-only`)
    return result
  }

  result.remoteBaseUrl = `https://${dnsName}:${normalized.exposePort}`
  result.remoteUrl = maybeBuildRemoteUrl(result.remoteBaseUrl, files)
  return result
}

function reconcileLan({ actualPort, files, networkInterfaces, result, lock }) {
  const bindHost = result.bindHost
  if (lock) {
    const runningBindHost = normalizeBindHost(lock.bindHost || DEFAULT_EXPOSE_CONFIG.bindHost)
    if (runningBindHost !== bindHost) {
      result.bindHost = runningBindHost
      result.warnings.push(`LAN expose requires the running server to bind ${bindHost}; current server is bound to ${runningBindHost}. Restart mdprobe to enable LAN exposure.`)
      return result
    }
  }

  const remoteHost = bindHost === '0.0.0.0'
    ? getPrimaryLanIp(networkInterfaces)
    : bindHost

  if (!remoteHost || remoteHost === '127.0.0.1') {
    result.warnings.push('LAN expose could not find a non-loopback IP; continuing local-only')
    return result
  }

  result.remoteBaseUrl = `http://${remoteHost}:${actualPort}`
  result.remoteUrl = maybeBuildRemoteUrl(result.remoteBaseUrl, files, { allowHttp: true })
  result.exposeRisk = 'lan-http-unauthenticated'
  result.warnings.push(
    'LAN expose serves over HTTP without authentication: any host on the reachable network can read the served files (and other files in their directories) and write annotations. '
    + (result.allowPublicUnauthenticated
      ? 'allowPublicUnauthenticated=true: control endpoints (add-files, broadcast) are also reachable remotely.'
      : 'Registering new host paths (add-files) stays restricted to localhost unless allowPublicUnauthenticated=true.')
  )
  return result
}

function maybeBuildRemoteUrl(remoteBaseUrl, files, options = {}) {
  if (!remoteBaseUrl || files.length !== 1) return undefined
  if (options.allowHttp) return buildHttpRemoteUrl(remoteBaseUrl, files[0])
  return buildRemoteUrl(remoteBaseUrl, files[0])
}

function buildHttpRemoteUrl(remoteBaseUrl, filePath) {
  const url = new URL(remoteBaseUrl)
  url.pathname = `/${encodeURIComponent(basename(filePath))}`
  return stripTrailingSlash(url.toString())
}

function getPrimaryLanIp(networkInterfaces = nodeNetworkInterfaces) {
  const interfaces = networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && node_net.isIP(entry.address) === 4) {
        return entry.address
      }
    }
  }
  return null
}

function stripTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises'
import { join, dirname, win32 as pathWin32 } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createLogger } from './telemetry.js'

const tel = createLogger('setup')

const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = join(dirname(__filename), '..')
const SKILL_SOURCE = join(PROJECT_ROOT, 'skills', 'mdprobe', 'SKILL.md')
const DEFAULT_CONFIG_PATH = join(homedir(), '.mdprobe.json')

// IDE skill directory mappings — detectDir is the IDE base config dir,
// skillsDir is where skills get installed (may not exist yet).
const IDE_CONFIGS = {
  'Claude Code': { detectDir: join(homedir(), '.claude'), skillsDir: join(homedir(), '.claude', 'skills') },
  'Cursor': { detectDir: join(homedir(), '.cursor'), skillsDir: join(homedir(), '.cursor', 'skills') },
  'Gemini': { detectDir: join(homedir(), '.gemini'), skillsDir: join(homedir(), '.gemini', 'skills') },
}

/**
 * Detect which IDEs are installed by checking their base config directory.
 * @param {object} [overrideConfigs] - Override IDE_CONFIGS for testing
 * @returns {Promise<string[]>} List of IDE names detected
 */
export async function detectIDEs(overrideConfigs) {
  const configs = overrideConfigs || IDE_CONFIGS
  const detected = []
  for (const [name, config] of Object.entries(configs)) {
    try {
      await access(config.detectDir)
      detected.push(name)
      tel.log('detect', { ide: name, detectDir: config.detectDir, exists: true })
    } catch {
      tel.log('detect', { ide: name, detectDir: config.detectDir, exists: false })
    }
  }
  tel.log('detect_result', { detected })
  return detected
}

/**
 * Install the SKILL.md file to an IDE's skill directory.
 * @param {string} ide - IDE name (e.g., 'Claude Code')
 * @param {string} [content] - Skill content (reads from source if omitted)
 * @param {object} [overrideConfigs] - Override IDE_CONFIGS for testing
 * @returns {Promise<string>} Path where skill was installed
 */
export async function installSkill(ide, content, overrideConfigs) {
  const configs = overrideConfigs || IDE_CONFIGS
  const config = configs[ide]
  if (!config) throw new Error(`Unknown IDE: ${ide}`)

  if (!content) {
    content = await readFile(SKILL_SOURCE, 'utf-8')
  }

  const destDir = join(config.skillsDir, 'mdprobe')
  await mkdir(destDir, { recursive: true })
  const destPath = join(destDir, 'SKILL.md')
  await writeFile(destPath, content, 'utf-8')
  tel.log('install_skill', { ide, path: destPath })
  return destPath
}

/**
 * Register the MCP server via claude CLI.
 * Falls back to direct ~/.claude.json write if CLI not available.
 * @returns {Promise<{method: string}>}
 */
export async function registerMCP() {
  try {
    await execFileAsync('claude', [
      'mcp', 'add', '--scope', 'user', '--transport', 'stdio',
      'mdprobe', '--', 'mdprobe', 'mcp',
    ])
    tel.log('register_mcp', { method: 'cli' })
    return { method: 'cli' }
  } catch (err) {
    tel.log('error', { fn: 'registerMCP', error: err.message })
    // Fallback: write directly to ~/.claude.json
    const claudeJsonPath = join(homedir(), '.claude.json')
    let config = {}
    try {
      config = JSON.parse(await readFile(claudeJsonPath, 'utf-8'))
    } catch { /* start fresh */ }

    if (!config.mcpServers) config.mcpServers = {}
    config.mcpServers.mdprobe = {
      command: 'mdprobe',
      args: ['mcp'],
      type: 'stdio',
    }

    await writeFile(claudeJsonPath, JSON.stringify(config, null, 2), 'utf-8')
    tel.log('register_mcp', { method: 'file' })
    return { method: 'file' }
  }
}

const CURSOR_MCP_FILENAME = 'mcp.json'

/**
 * Register mdprobe MCP in Cursor (~/.cursor/mcp.json).
 * Cursor does not read ~/.claude.json; it merges project + user mcp.json.
 * No-op if ~/.cursor does not exist (IDE not installed or different home, e.g. WSL vs Windows).
 * @param {string} [mcpPath] - Override path for testing
 * @returns {Promise<{ method: 'file', path: string } | { skipped: true, reason: string }>}
 */
export async function registerCursorMCP(mcpPath) {
  const resolvedPath = mcpPath || join(homedir(), '.cursor', CURSOR_MCP_FILENAME)
  const cursorConfigDir = dirname(resolvedPath)
  try {
    await access(cursorConfigDir)
  } catch {
    tel.log('register_cursor_mcp', { skipped: true, reason: 'no_cursor_dir' })
    return { skipped: true, reason: 'no_cursor_dir' }
  }

  let data = {}
  try {
    data = JSON.parse(await readFile(resolvedPath, 'utf-8'))
  } catch {
    /* new or invalid — start fresh object */
  }

  if (!data.mcpServers) data.mcpServers = {}
  data.mcpServers.mdprobe = {
    command: 'mdprobe',
    args: ['mcp'],
  }

  await mkdir(cursorConfigDir, { recursive: true })
  await writeFile(resolvedPath, JSON.stringify(data, null, 2), 'utf-8')
  tel.log('register_cursor_mcp', { method: 'file', path: resolvedPath })
  return { method: 'file', path: resolvedPath }
}

/**
 * Convert Windows user profile path (from cmd.exe) to a WSL filesystem path under /mnt/.
 * @param {string} winPath e.g. C:\Users\henry
 * @returns {string | null} e.g. /mnt/c/Users/henry
 */
export function wslPathFromWindowsUserProfile(winPath) {
  if (!winPath || typeof winPath !== 'string') return null
  const trimmed = winPath.trim().replace(/[/\\]+$/, '')
  const m = trimmed.match(/^([A-Za-z]):\\(.*)$/)
  if (!m) return null
  const rest = m[2].replace(/\\/g, '/')
  return `/mnt/${m[1].toLowerCase()}/${rest}`
}

async function getWindowsUserProfileFromWsl() {
  const out = await execFileAsync('cmd.exe', ['/c', 'echo %USERPROFILE%'])
  return out.trim().replace(/\r/g, '')
}

async function resolveMdprobeBinaryPath() {
  try {
    return (await execFileAsync('which', ['mdprobe'])).trim()
  } catch {
    return 'mdprobe'
  }
}

/**
 * When setup runs inside WSL but Cursor is the Windows app, MCP must be in
 * %USERPROFILE%\.cursor\mcp.json (reachable as /mnt/c/Users/... from WSL).
 * Writes the wsl.exe bridge so Windows Cursor can spawn the Linux mdprobe binary.
 * @param {object} [opts]
 * @param {string} [opts._testMcpJsonWslPath] - override target file (tests)
 * @param {string} [opts._testWinProfile] - override profile path (tests)
 * @returns {Promise<{ skipped: true, reason: string } | { skipped: false, wslPath: string, winPath: string }>}
 */
export async function registerCursorMCPOnWindowsHostFromWsl(opts = {}) {
  const distro = process.env.WSL_DISTRO_NAME
  if (!distro) {
    return { skipped: true, reason: 'not_wsl' }
  }

  let winProfile = opts._testWinProfile
  if (!winProfile) {
    try {
      winProfile = await getWindowsUserProfileFromWsl()
    } catch (err) {
      tel.log('register_cursor_mcp_win_host', { skipped: true, reason: 'cmd_failed', error: err.message })
      return { skipped: true, reason: 'win_profile_cmd_failed' }
    }
  }

  if (!winProfile || winProfile.includes('%')) {
    return { skipped: true, reason: 'win_profile_unresolved' }
  }

  const wslUserPath = wslPathFromWindowsUserProfile(winProfile)
  if (!wslUserPath) {
    return { skipped: true, reason: 'path_convert' }
  }

  const mcpJsonWsl = opts._testMcpJsonWslPath || join(wslUserPath, '.cursor', CURSOR_MCP_FILENAME)
  const mdprobeBin = opts._testMdprobeBin ?? await resolveMdprobeBinaryPath()

  let data = {}
  try {
    data = JSON.parse(await readFile(mcpJsonWsl, 'utf-8'))
  } catch {
    /* new or invalid */
  }

  if (!data.mcpServers) data.mcpServers = {}
  data.mcpServers.mdprobe = {
    command: 'C:\\Windows\\System32\\wsl.exe',
    args: ['-d', distro, mdprobeBin, 'mcp'],
  }

  await mkdir(dirname(mcpJsonWsl), { recursive: true })
  await writeFile(mcpJsonWsl, JSON.stringify(data, null, 2), 'utf-8')

  const winPath = pathWin32.join(winProfile, '.cursor', CURSOR_MCP_FILENAME)
  tel.log('register_cursor_mcp_win_host', { wslPath: mcpJsonWsl, winPath })
  return { skipped: false, wslPath: mcpJsonWsl, winPath }
}

/**
 * Migrate PostToolUse hook — removes the old v0.3.0 hook that caused
 * unwanted mdprobe launches. The hook used imperative language
 * ("Offer to open with mdProbe") which the AI treated as a command,
 * starting random server instances on every .md edit.
 *
 * The SKILL.md alone handles discoverability — no hook is needed.
 *
 * @param {string} [settingsPath] - Override path for testing
 * @returns {Promise<{added: boolean, migrated?: boolean}>}
 */
export async function registerHook(settingsPath) {
  if (!settingsPath) {
    settingsPath = join(homedir(), '.claude', 'settings.json')
  }

  let settings = {}
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
  } catch { /* no settings file — nothing to migrate */ }

  // Migration: remove old mdprobe hook if present
  const hooks = settings.hooks?.PostToolUse ?? []
  const hadOldHook = hooks.some(h =>
    h.hooks?.some(hh => typeof hh.command === 'string' && hh.command.includes('[mdprobe]'))
  )

  if (hadOldHook) {
    settings.hooks.PostToolUse = hooks.filter(h =>
      !h.hooks?.some(hh => typeof hh.command === 'string' && hh.command.includes('[mdprobe]'))
    )
    await mkdir(dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    tel.log('register_hook', { added: false, migrated: true })
    return { added: false, migrated: true }
  }

  tel.log('register_hook', { added: false })
  return { added: false }
}

/**
 * Save user config to ~/.mdprobe.json.
 * @param {object} config - { author, urlStyle }
 * @param {string} [configPath]
 */
export async function saveConfig(config, configPath = DEFAULT_CONFIG_PATH) {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Pure transform: drop `mcpServers.mdprobe` from a parsed Cursor mcp.json object.
 * Preserves every other server and any other top-level keys.
 * @param {object} root
 * @returns {{ changed: boolean, data: object }}
 */
export function removeMdprobeFromCursorMcpData(root) {
  if (!root?.mcpServers?.mdprobe) {
    return { changed: false, data: root }
  }
  const data = JSON.parse(JSON.stringify(root))
  delete data.mcpServers.mdprobe
  if (Object.keys(data.mcpServers).length === 0) {
    delete data.mcpServers
  }
  return { changed: true, data }
}

/**
 * Read a Cursor `mcp.json` path, remove mdprobe if present, rewrite when changed.
 * @param {string} mcpPath
 * @returns {Promise<{ changed: boolean, reason?: string }>}
 */
export async function stripMdprobeFromCursorMcpFile(mcpPath) {
  let text
  try {
    text = await readFile(mcpPath, 'utf-8')
  } catch {
    return { changed: false, reason: 'read_failed' }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { changed: false, reason: 'invalid_json' }
  }
  const { changed, data } = removeMdprobeFromCursorMcpData(parsed)
  if (!changed) return { changed: false }
  await mkdir(dirname(mcpPath), { recursive: true })
  await writeFile(mcpPath, JSON.stringify(data, null, 2), 'utf-8')
  return { changed: true }
}

/**
 * Remove all mdprobe installations.
 * @param {object} [opts]
 * @param {string} [opts.configPath]
 * @param {string} [opts.settingsPath]
 * @param {string} [opts.cursorWindowsMcpPath] - Explicit Windows-host mcp.json (e.g. tests); skips cmd.exe resolution
 */
export async function removeAll(opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH
  const settingsPath = opts.settingsPath || join(homedir(), '.claude', 'settings.json')
  const removed = []

  // Remove skill from all IDEs
  for (const [name, config] of Object.entries(IDE_CONFIGS)) {
    const skillDir = join(config.skillsDir, 'mdprobe')
    try {
      await rm(skillDir, { recursive: true })
      removed.push(`skill:${name}`)
    } catch { /* not installed */ }
  }

  // Remove MCP registration (both CLI and file-based)
  try {
    await execFileAsync('claude', ['mcp', 'remove', 'mdprobe'])
    removed.push('mcp:cli')
  } catch { /* CLI not available or entry not found */ }

  // Always clean up file-based entry too (may exist from fallback registration)
  try {
    const claudeJsonPath = join(homedir(), '.claude.json')
    const config = JSON.parse(await readFile(claudeJsonPath, 'utf-8'))
    if (config.mcpServers?.mdprobe) {
      delete config.mcpServers.mdprobe
      await writeFile(claudeJsonPath, JSON.stringify(config, null, 2), 'utf-8')
      removed.push('mcp:file')
    }
  } catch { /* ignore */ }

  // Remove hook from settings.json
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    if (settings.hooks?.PostToolUse) {
      const before = settings.hooks.PostToolUse.length
      settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(h =>
        !h.hooks?.some(hh => typeof hh.command === 'string' && hh.command.includes('[mdprobe]'))
      )
      if (settings.hooks.PostToolUse.length < before) {
        await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
        removed.push('hook')
      }
    }
  } catch { /* ignore */ }

  // Remove mdprobe from Cursor ~/.cursor/mcp.json
  try {
    const cursorMcpPath = join(homedir(), '.cursor', CURSOR_MCP_FILENAME)
    const r = await stripMdprobeFromCursorMcpFile(cursorMcpPath)
    if (r.changed) removed.push('mcp:cursor')
  } catch { /* ignore */ }

  // Windows-host mcp.json (WSL: /mnt/c/Users/...), or explicit path for tests
  try {
    if (opts.cursorWindowsMcpPath) {
      const r = await stripMdprobeFromCursorMcpFile(opts.cursorWindowsMcpPath)
      if (r.changed) removed.push('mcp:cursor_windows')
    } else if (process.env.WSL_DISTRO_NAME) {
      let winProfile
      try {
        winProfile = await getWindowsUserProfileFromWsl()
      } catch {
        winProfile = null
      }
      const wslUserPath = winProfile ? wslPathFromWindowsUserProfile(winProfile) : null
      if (wslUserPath) {
        const cursorMcpWinHost = join(wslUserPath, '.cursor', CURSOR_MCP_FILENAME)
        const r = await stripMdprobeFromCursorMcpFile(cursorMcpWinHost)
        if (r.changed) removed.push('mcp:cursor_windows')
      }
    }
  } catch { /* ignore */ }

  // Remove config file
  try {
    await rm(configPath)
    removed.push('config')
  } catch { /* ignore */ }

  return removed
}

function execFileAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

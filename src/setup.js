import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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
    } catch {
      // IDE not installed
    }
  }
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
    return { method: 'cli' }
  } catch {
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
    return { method: 'file' }
  }
}

/**
 * Register PostToolUse hook in settings.json (safe merge).
 * @param {string} [settingsPath] - Override path for testing
 * @returns {Promise<{added: boolean}>}
 */
export async function registerHook(settingsPath) {
  if (!settingsPath) {
    settingsPath = join(homedir(), '.claude', 'settings.json')
  }

  let settings = {}
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
  } catch { /* start fresh */ }

  if (!settings.hooks) settings.hooks = {}
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = []

  // Check if mdprobe hook already exists
  const existing = settings.hooks.PostToolUse.find(h =>
    h.hooks?.some(hh => typeof hh.command === 'string' && hh.command.includes('[mdprobe]'))
  )
  if (existing) return { added: false }

  const hookCommand = `node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const p=d.tool_input?.file_path||''; if(p.endsWith('.md')){const j={decision:'allow',reason:'[mdprobe] .md file modified: '+require('path').basename(p)+'. Offer to open with mdProbe.'}; process.stdout.write(JSON.stringify(j))}"`

  settings.hooks.PostToolUse.push({
    matcher: 'Write|Edit',
    hooks: [{ type: 'command', command: hookCommand }],
  })

  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
  return { added: true }
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
 * Remove all mdprobe installations.
 * @param {object} [opts]
 * @param {string} [opts.configPath]
 * @param {string} [opts.settingsPath]
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

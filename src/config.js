import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_CONFIG_PATH = join(homedir(), '.mdprobe.json')

/**
 * Read and parse the config file. Returns {} if file does not exist.
 * Throws on malformed JSON.
 *
 * @param {string} [configPath]
 * @returns {Promise<object>}
 */
export async function getConfig(configPath = DEFAULT_CONFIG_PATH) {
  let raw
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }

  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to parse JSON in ${configPath}: ${err.message}`)
  }
}

/**
 * Set a single key in the config file (read-modify-write).
 * Creates the file and parent directories if they don't exist.
 *
 * @param {string} key
 * @param {*} value
 * @param {string} [configPath]
 * @returns {Promise<void>}
 */
export async function setConfig(key, value, configPath = DEFAULT_CONFIG_PATH) {
  await mkdir(dirname(configPath), { recursive: true })

  let config = {}
  try {
    const raw = await readFile(configPath, 'utf8')
    config = JSON.parse(raw)
  } catch {
    // File missing or unreadable — start fresh
  }

  config[key] = value
  await writeFile(configPath, JSON.stringify(config), 'utf8')
}

/**
 * Get the configured author name.
 * Returns "anonymous" when the config file is missing, or the author
 * key is absent, empty, or null.
 *
 * @param {string} [configPath]
 * @returns {Promise<string>}
 */
export async function getAuthor(configPath = DEFAULT_CONFIG_PATH) {
  let config
  try {
    config = await getConfig(configPath)
  } catch {
    return 'anonymous'
  }

  const author = config.author
  if (author == null || typeof author !== 'string' || author.trim() === '') {
    return 'anonymous'
  }

  return author.trim()
}

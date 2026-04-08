import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import yaml from 'js-yaml'

/**
 * Compute SHA-256 hex digest of a string.
 * @param {string} str
 * @returns {string} 64-char lowercase hex hash
 */
export function hashContent(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex')
}

/**
 * Read a file as UTF-8 and return its SHA-256 hex digest.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function hashFile(filePath) {
  const content = await readFile(filePath, 'utf8')
  return hashContent(content)
}

/**
 * Detect whether the markdown source has drifted from the hash
 * stored in its YAML sidecar annotation file.
 *
 * @param {string} yamlPath - path to the YAML annotation sidecar
 * @param {string} mdPath   - path to the markdown source file
 * @returns {Promise<{drifted: boolean, savedHash: string|null, currentHash: string}>}
 */
export async function detectDrift(yamlPath, mdPath) {
  const [yamlRaw, mdRaw] = await Promise.all([
    readFile(yamlPath, 'utf8'),
    readFile(mdPath, 'utf8'),
  ])

  const doc = yaml.load(yamlRaw)
  const currentHash = hashContent(mdRaw)

  let savedHash = null
  if (doc && typeof doc.source_hash === 'string' && doc.source_hash.startsWith('sha256:')) {
    savedHash = doc.source_hash.slice('sha256:'.length)
  }

  return {
    drifted: savedHash !== currentHash,
    savedHash,
    currentHash,
  }
}

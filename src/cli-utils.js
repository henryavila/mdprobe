import { readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

/**
 * Find .md files in a directory (recursive, synchronous).
 * Returns an empty array if directory doesn't exist or can't be read.
 *
 * @param {string} dir - Absolute directory path
 * @returns {string[]} Sorted absolute paths
 */
export function findMarkdownFiles(dir) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true, recursive: true })
    return entries
      .filter((e) => e.isFile() && extname(e.name).toLowerCase() === '.md')
      .map((e) => join(e.parentPath || e.path, e.name))
      .sort()
  } catch {
    return []
  }
}

/**
 * Extract a flag and its value from an args array.
 * Mutates the array by removing the flag (and its value if present).
 *
 * @param {string[]} args - Mutable args array
 * @param {string} flag - Flag name (e.g., '--port')
 * @returns {string|true|undefined} The value, `true` if flag has no value, `undefined` if absent
 */
export function extractFlag(args, flag) {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  args.splice(idx, 1)
  if (idx < args.length && !args[idx]?.startsWith('-')) {
    return args.splice(idx, 1)[0]
  }
  return true
}

/**
 * Check if any of the given flags exist in the args array.
 * Removes the first match found. Mutates the array.
 *
 * @param {string[]} args - Mutable args array
 * @param {...string} flags - Flag names to check
 * @returns {boolean}
 */
export function hasFlag(args, ...flags) {
  for (const flag of flags) {
    const idx = args.indexOf(flag)
    if (idx !== -1) {
      args.splice(idx, 1)
      return true
    }
  }
  return false
}

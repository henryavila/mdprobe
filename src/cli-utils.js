import { readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

/** Recognized mdprobe subcommands (the default, file-serving mode aside). */
export const KNOWN_COMMANDS = Object.freeze([
  'setup', 'update', 'stop', 'mcp', 'config', 'export', 'migrate',
])

/** Words people commonly type expecting an install/bootstrap step. */
const INSTALLER_WORDS = new Set([
  'install', 'init', 'i', 'add', 'remove', 'uninstall', 'start', 'run',
])

/**
 * Heuristic: does this argument look like a mistyped subcommand rather than a
 * file/dir path? True for a bare lowercase-ish word (no extension, no path
 * separator). Used only when the argument does not exist on disk, so real
 * files and directories are never misclassified.
 *
 * @param {string} arg
 * @returns {boolean}
 */
export function looksLikeStrayCommand(arg) {
  if (typeof arg !== 'string' || arg.length === 0) return false
  if (arg.startsWith('-')) return false
  if (arg.includes('/') || arg.includes('\\')) return false // a path
  if (arg.includes('.')) return false // has an extension (e.g. .md) or is relative
  return /^[a-z][a-z0-9-]*$/i.test(arg)
}

/**
 * Friendly message for an argument that is neither an existing path nor a known
 * command — e.g. `mdprobe install`, where the word was forwarded as a filename
 * and previously produced a cryptic "install does not exist".
 *
 * @param {string} cmd
 * @returns {string}
 */
export function unknownCommandMessage(cmd) {
  const lines = [`Error: '${cmd}' is not a file or a mdprobe command.`, '']
  if (INSTALLER_WORDS.has(String(cmd).toLowerCase())) {
    lines.push(
      `There is no '${cmd}' command — mdProbe is installed via npm/npx (or 'npm i -g @henryavila/mdprobe').`,
      '',
    )
  }
  lines.push(
    '  • Set up AI integration (Claude Code, Cursor):  mdprobe setup',
    '  • Open a document:                              mdprobe <file.md>',
    '',
    `Commands: ${KNOWN_COMMANDS.join(', ')}   (run 'mdprobe --help')`,
  )
  return lines.join('\n')
}

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
  const prefix = `${flag}=`
  const eqIdx = args.findIndex((arg) => arg.startsWith(prefix))
  if (eqIdx !== -1) {
    const value = args[eqIdx].slice(prefix.length)
    args.splice(eqIdx, 1)
    return value === '' ? true : value
  }

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

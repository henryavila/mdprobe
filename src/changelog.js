/**
 * CHANGELOG.md section parser (Keep a Changelog 1.1.0).
 *
 * Used by the `mdprobe update` post-upgrade flow to print a "What's new"
 * summary inline. Parsing happens against the freshly-installed package's
 * own CHANGELOG.md, so we never depend on the network or GitHub API.
 *
 * Design notes:
 *   - Pure parser. No I/O outside the explicit `readFileSync` of the path
 *     parameter. Path is always supplied by the caller.
 *   - Plain line-by-line scan — no markdown library dependency.
 *   - Only `- ` and `* ` bullets are recognized (after trim of leading
 *     whitespace). Other line shapes are ignored (prose, link refs, etc.).
 *   - `### Subheader` lines (Added/Fixed/Changed/Removed/Security/etc.) are
 *     skipped. We do NOT validate subheader names — Keep a Changelog 1.1.0
 *     defines six canonical sections, but real-world changelogs often add
 *     custom ones (e.g. `### Migration`). Treat any `### ` line as skippable.
 *   - The combined cap is 6 bullets across all subheaders. Set
 *     `truncated: true` if the source had more.
 *   - Markdown links `[text](url)` are rewritten as `text (url)` for terminal
 *     readability. The transformation is intentionally simple (regex) — it
 *     does not attempt to handle nested formatting or escaped brackets.
 *   - Failure-tolerant: every error path returns `null`. The caller (post-
 *     update flow) silently skips the "What's new" block on `null`, which
 *     is a much better UX than crashing the upgrade.
 */

import { readFileSync } from 'node:fs'

const MAX_BULLETS = 6

// `## [<version>]` optionally followed by `- <date>` or `– <date>`.
// We construct this per-call (escaping the version) rather than caching, so
// that arbitrary version strings like `0.5.1-rc.1` work.
function buildVersionHeaderMatcher(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Examples that should match:
  //   ## [0.5.1]
  //   ## [0.5.1] - 2026-04-30
  //   ##   [0.5.1]   -   2026-04-30
  return new RegExp(`^##\\s+\\[${escaped}\\](\\s|$)`)
}

/**
 * Test whether a line opens a new top-level (`## `) section.
 * Used as the stop-condition when walking forward from the matched header.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isTopLevelHeader(line) {
  // A top-level section starts with exactly two `#` followed by whitespace.
  // Three or more `#` is a subheader (`### Added`) and must NOT terminate.
  return /^##\s+/.test(line) && !/^###/.test(line)
}

/**
 * Test whether a line is a subheader (`### Added`, `### Fixed`, etc.).
 * Subheaders are stripped from the bullet list — they're not bullets.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isSubheader(line) {
  return /^###\s+/.test(line)
}

/**
 * Extract bullet text from a line, or return `null` if the line is not a
 * bullet. Recognized prefixes are `- ` and `* ` (after leading-whitespace
 * trim). The returned string has the marker stripped and trailing whitespace
 * removed.
 *
 * @param {string} line
 * @returns {string|null}
 */
function extractBullet(line) {
  const trimmed = line.replace(/^\s+/, '')
  if (trimmed.startsWith('- ')) return trimmed.slice(2).trimEnd()
  if (trimmed.startsWith('* ')) return trimmed.slice(2).trimEnd()
  return null
}

/**
 * Rewrite markdown links `[text](url)` as `text (url)` for terminal output.
 *
 * Intentionally simple: a single regex pass. Does not try to handle escaped
 * brackets or nested formatting — the input is human-authored release notes,
 * not arbitrary markdown.
 *
 * @param {string} text
 * @returns {string}
 */
function rewriteMarkdownLinks(text) {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
}

/**
 * Read a single version section from a Keep a Changelog file.
 *
 * @param {string} version       Version string to look up (e.g. `'0.5.1'`).
 * @param {string} changelogPath Absolute path to a CHANGELOG.md file.
 * @returns {{ bullets: string[], truncated: boolean } | null}
 *   `null` on any failure (file missing, version not found, no headers, etc.).
 */
export function readChangelogSection(version, changelogPath) {
  if (typeof version !== 'string' || version.length === 0) return null
  if (typeof changelogPath !== 'string' || changelogPath.length === 0) return null

  let raw
  try {
    raw = readFileSync(changelogPath, 'utf-8')
  } catch {
    return null
  }

  const lines = raw.split(/\r?\n/)

  // Sanity check: at least one `## ` header must exist anywhere in the file.
  // If not, the file is not a Keep a Changelog at all — bail.
  const hasAnySection = lines.some(isTopLevelHeader)
  if (!hasAnySection) return null

  const headerMatcher = buildVersionHeaderMatcher(version)

  // Find the matching `## [<version>]` line.
  let startIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (headerMatcher.test(lines[i])) {
      startIdx = i
      break
    }
  }
  if (startIdx === -1) return null

  // Walk forward, collecting bullets, until we hit the next `## ` header
  // or end of file.
  const bullets = []
  let truncated = false
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (isTopLevelHeader(line)) break
    if (isSubheader(line)) continue

    const bullet = extractBullet(line)
    if (bullet === null) continue

    if (bullets.length >= MAX_BULLETS) {
      truncated = true
      break
    }
    bullets.push(rewriteMarkdownLinks(bullet))
  }

  return { bullets, truncated }
}

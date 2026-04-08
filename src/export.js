/**
 * Export functions for annotation files.
 *
 * Each function accepts a duck-typed annotationFile object (or the real
 * AnnotationFile class) -- anything with `.source`, `.sourceHash`, `.version`,
 * `.annotations`, `.sections`, and `.toJSON()`.
 */

// ---------------------------------------------------------------------------
// SARIF severity mapping
// ---------------------------------------------------------------------------

const LEVEL_MAP = {
  bug: 'error',
  question: 'note',
  suggestion: 'warning',
  nitpick: 'note',
}

// ---------------------------------------------------------------------------
// exportReport
// ---------------------------------------------------------------------------

/**
 * Generates a human-readable markdown review report.
 *
 * @param {object} af - AnnotationFile (or duck-typed equivalent)
 * @param {string} _sourceContent - Original markdown (unused but kept for API symmetry)
 * @returns {string} Markdown report
 */
export function exportReport(af, _sourceContent) {
  const annotations = af.annotations ?? []

  if (annotations.length === 0) {
    return `# Review Report: ${af.source}\n\nNo annotations found.\n`
  }

  const openCount = annotations.filter(a => a.status === 'open').length
  const resolvedCount = annotations.filter(a => a.status === 'resolved').length
  const total = annotations.length

  const lines = []

  // Title
  lines.push(`# Review Report: ${af.source}`)
  lines.push('')

  // Summary
  lines.push('## Summary')
  lines.push('')
  lines.push(`- **Total annotations:** ${total}`)
  lines.push(`- **Open:** ${openCount}`)
  lines.push(`- **Resolved:** ${resolvedCount}`)
  lines.push('')

  // Sections table
  const sections = af.sections ?? []
  if (sections.length > 0) {
    lines.push('## Sections')
    lines.push('')
    lines.push('| Section | Status |')
    lines.push('|---------|--------|')
    for (const sec of sections) {
      lines.push(`| ${sec.heading} | ${sec.status} |`)
    }
    lines.push('')
  }

  // Annotations detail
  lines.push('## Annotations')
  lines.push('')

  for (const ann of annotations) {
    lines.push(`### [${ann.tag}] ${ann.quote?.exact ?? ann.selectors?.quote?.exact ?? ''} (${ann.status})`)
    lines.push('')
    lines.push(`> ${ann.selectors?.quote?.exact ?? ''}`)
    lines.push('')
    lines.push(`**Comment:** ${ann.comment}`)
    lines.push(`**Author:** ${ann.author} | **Status:** ${ann.status}`)
    lines.push('')

    if (ann.replies && ann.replies.length > 0) {
      lines.push('**Replies:**')
      for (const reply of ann.replies) {
        lines.push(`- **${reply.author}:** ${reply.comment}`)
      }
      lines.push('')
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// exportInline
// ---------------------------------------------------------------------------

/**
 * Inserts annotations as HTML comments into the original markdown source.
 *
 * @param {object} af - AnnotationFile (or duck-typed equivalent)
 * @param {string} sourceContent - Original markdown text
 * @returns {string} Markdown with inline annotation comments
 */
export function exportInline(af, sourceContent) {
  const annotations = af.annotations ?? []

  if (annotations.length === 0) {
    return sourceContent
  }

  const sourceLines = sourceContent.split('\n')

  // Sort annotations by startLine descending so that insertions don't shift
  // line indices of subsequent annotations.
  const sorted = [...annotations].sort((a, b) => {
    const lineA = a.selectors?.position?.startLine ?? 0
    const lineB = b.selectors?.position?.startLine ?? 0
    return lineB - lineA
  })

  for (const ann of sorted) {
    const startLine = ann.selectors?.position?.startLine
    if (startLine == null) continue

    // Build the comment line
    const prefix = ann.status === 'resolved' ? '[RESOLVED] ' : ''
    const comment = `<!-- ${prefix}[${ann.tag}] ${ann.comment} -->`

    // Insert after the annotated line (startLine is 1-based)
    const insertIdx = startLine // after line at (startLine - 1), which is index startLine
    sourceLines.splice(insertIdx, 0, comment)
  }

  return sourceLines.join('\n')
}

// ---------------------------------------------------------------------------
// exportJSON
// ---------------------------------------------------------------------------

/**
 * Returns the annotationFile's JSON representation.
 *
 * @param {object} af - AnnotationFile (or duck-typed equivalent)
 * @returns {object} Plain JSON-serializable object
 */
export function exportJSON(af) {
  return af.toJSON()
}

// ---------------------------------------------------------------------------
// exportSARIF
// ---------------------------------------------------------------------------

/**
 * Generates a SARIF 2.1.0 report from annotations.
 *
 * Resolved annotations are excluded from results.
 *
 * @param {object} af - AnnotationFile (or duck-typed equivalent)
 * @param {string} sourceFilePath - Path to the source file (used in artifact URIs)
 * @returns {object} SARIF 2.1.0 object
 */
export function exportSARIF(af, sourceFilePath) {
  const annotations = af.annotations ?? []

  // Only include open annotations; resolved are excluded.
  const openAnnotations = annotations.filter(a => a.status === 'open')

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'mdprobe',
            version: '0.1.0',
            informationUri: 'https://github.com/henryavila/mdprobe',
          },
        },
        results: openAnnotations.map(ann => {
          const pos = ann.selectors?.position ?? {}
          return {
            ruleId: ann.tag,
            level: LEVEL_MAP[ann.tag] ?? 'note',
            message: { text: ann.comment },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: sourceFilePath },
                  region: {
                    startLine: pos.startLine,
                    startColumn: pos.startColumn,
                    endLine: pos.endLine,
                    endColumn: pos.endColumn,
                  },
                },
              },
            ],
          }
        }),
      },
    ],
  }
}

import DiffMatchPatch from 'diff-match-patch'

/**
 * Convert 1-indexed line:column to 0-indexed character offset in source.
 */
function lineColumnToOffset(source, line, column) {
  const lines = source.split('\n')
  let offset = 0
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1
  }
  offset += column - 1
  return offset
}

/**
 * Convert 0-indexed character offset to 1-indexed line:column.
 */
function offsetToLineColumn(source, offset) {
  let line = 1
  let col = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, column: col }
}

/**
 * Extract text from source at the given position for the exact number of characters.
 */
function extractTextByLength(source, startLine, startColumn, length) {
  const lines = source.split('\n')
  if (startLine < 1 || startLine > lines.length) return null

  const startOffset = lineColumnToOffset(source, startLine, startColumn)
  if (startOffset >= source.length) return null
  return source.slice(startOffset, startOffset + length)
}

/**
 * Find all occurrences of a substring in source. Returns array of character offsets.
 */
function findAllOccurrences(source, text) {
  const results = []
  let idx = source.indexOf(text)
  while (idx !== -1) {
    results.push(idx)
    idx = source.indexOf(text, idx + 1)
  }
  return results
}

/**
 * Score how well surrounding text at a candidate position matches expected prefix/suffix.
 */
function scorePrefixSuffix(source, matchOffset, textLength, expectedPrefix, expectedSuffix) {
  let score = 0

  if (expectedPrefix) {
    const actualPrefix = source.slice(Math.max(0, matchOffset - expectedPrefix.length), matchOffset)
    for (let i = 0; i < Math.min(actualPrefix.length, expectedPrefix.length); i++) {
      if (actualPrefix[actualPrefix.length - 1 - i] === expectedPrefix[expectedPrefix.length - 1 - i]) {
        score++
      }
    }
  }

  if (expectedSuffix) {
    const endOffset = matchOffset + textLength
    const actualSuffix = source.slice(endOffset, endOffset + expectedSuffix.length)
    for (let i = 0; i < Math.min(actualSuffix.length, expectedSuffix.length); i++) {
      if (actualSuffix[i] === expectedSuffix[i]) {
        score++
      }
    }
  }

  return score
}

/**
 * Convert a character offset + text length to a position object.
 */
function offsetToPosition(source, offset, textLength) {
  const start = offsetToLineColumn(source, offset)
  const end = offsetToLineColumn(source, offset + textLength)
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  }
}

/**
 * Perform fuzzy match using diff-match-patch, handling patterns longer than 32 chars.
 * diff-match-patch's match_main uses bitap which has a 32-char limit.
 * For longer patterns, use a truncated pattern to find approximate location,
 * then verify the full match via Levenshtein distance.
 */
function fuzzyMatch(currentSource, exactText, hintOffset) {
  const dmp = new DiffMatchPatch()
  dmp.Match_Threshold = 0.4
  dmp.Match_Distance = 1000

  const MAX_PATTERN = 32

  if (exactText.length <= MAX_PATTERN) {
    return dmp.match_main(currentSource, exactText, hintOffset)
  }

  // For longer patterns, find approximate location using truncated pattern
  const truncated = exactText.slice(0, MAX_PATTERN)
  const idx = dmp.match_main(currentSource, truncated, hintOffset)
  if (idx === -1) return -1

  // Verify full match quality via Levenshtein distance
  const candidate = currentSource.slice(idx, idx + exactText.length)
  if (candidate.length === 0) return -1

  const diffs = dmp.diff_main(exactText, candidate)
  const distance = dmp.diff_levenshtein(diffs)
  const threshold = Math.floor(exactText.length * 0.4)

  return distance <= threshold ? idx : -1
}

/**
 * Creates a TextQuoteSelector from a text selection.
 */
export function createSelector({ exact, startLine, startColumn, endLine, endColumn, source }) {
  const startOffset = lineColumnToOffset(source, startLine, startColumn)
  const endOffset = lineColumnToOffset(source, endLine, endColumn)

  const prefix = source.slice(Math.max(0, startOffset - 30), startOffset)
  const suffix = source.slice(endOffset, endOffset + 30)

  return {
    position: { startLine, startColumn, endLine, endColumn },
    quote: { exact, prefix, suffix },
  }
}

/**
 * Attempts to anchor an annotation to the current source using a fallback chain:
 * 1. Position match (fast path)
 * 2. Exact quote match with prefix/suffix disambiguation
 * 3. Fuzzy match (diff-match-patch)
 * 4. Orphan
 */
export function anchor(annotation, currentSource) {
  const { position, quote } = annotation.selectors

  // 1. Position match (fast path)
  if (position && quote && quote.exact) {
    const textAtPosition = extractTextByLength(
      currentSource,
      position.startLine,
      position.startColumn,
      quote.exact.length,
    )
    if (textAtPosition !== null && textAtPosition === quote.exact) {
      // For multi-line selections, extractTextByLength already verified the
      // exact text at the position. No further boundary check needed.
      if (position.startLine !== position.endLine) {
        return { status: 'position', position: { ...position } }
      }
      // For single-line: verify boundary consistency to ensure the text at
      // this position hasn't been extended (e.g., "cat" matching "category").
      const lines = currentSource.split('\n')
      const lineStr = lines[position.startLine - 1]
      if (lineStr != null) {
        const endColIdx = position.endColumn - 1
        const lineBased = lineStr.slice(position.startColumn - 1, endColIdx)
        const textToLineEnd = lineStr.slice(position.startColumn - 1)

        if (textToLineEnd === quote.exact || lineBased === quote.exact) {
          return { status: 'position', position: { ...position } }
        }
      }
    }
  }

  // 2. Exact quote match
  if (quote && quote.exact) {
    const occurrences = findAllOccurrences(currentSource, quote.exact)

    if (occurrences.length === 1) {
      const pos = offsetToPosition(currentSource, occurrences[0], quote.exact.length)
      return { status: 'exact', position: pos }
    }

    if (occurrences.length > 1) {
      // Disambiguate using prefix/suffix scoring
      let bestIdx = -1
      let bestScore = -1
      let bestDistance = Infinity

      const origOffset = position
        ? lineColumnToOffset(currentSource, position.startLine, position.startColumn)
        : 0

      for (let i = 0; i < occurrences.length; i++) {
        const score = scorePrefixSuffix(
          currentSource,
          occurrences[i],
          quote.exact.length,
          quote.prefix,
          quote.suffix,
        )
        const distance = Math.abs(occurrences[i] - origOffset)

        if (score > bestScore || (score === bestScore && distance < bestDistance)) {
          bestScore = score
          bestIdx = i
          bestDistance = distance
        }
      }

      if (bestIdx >= 0) {
        const pos = offsetToPosition(currentSource, occurrences[bestIdx], quote.exact.length)
        return { status: 'exact', position: pos }
      }
    }
  }

  // 3. Fuzzy match (diff-match-patch)
  if (quote && quote.exact && currentSource.length > 0) {
    let loc = 0
    if (position) {
      loc = lineColumnToOffset(currentSource, position.startLine, position.startColumn)
      if (loc > currentSource.length) loc = currentSource.length
      if (loc < 0) loc = 0
    }

    const matchIndex = fuzzyMatch(currentSource, quote.exact, loc)

    if (matchIndex !== -1) {
      const pos = offsetToPosition(currentSource, matchIndex, quote.exact.length)
      return { status: 'fuzzy', position: pos }
    }
  }

  // 4. Orphan
  return { status: 'orphan', position: null }
}

/**
 * Anchors all annotations. Returns Map<annotationId, {status, position}>.
 */
export function reanchorAll(annotations, currentSource) {
  const results = new Map()
  for (const ann of annotations) {
    results.set(ann.id, anchor(ann, currentSource))
  }
  return results
}

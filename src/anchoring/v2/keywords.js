import { normalizeWords } from './fingerprint.js'

function tokenizeWithPositions(text) {
  const tokens = []
  const re = /[\p{L}\p{N}_]+/gu
  let m
  while ((m = re.exec(text)) !== null) {
    tokens.push({ raw: m[0], start: m.index })
  }
  return tokens
}

export function extractKeywords(quote, source, maxKeywords = 3) {
  if (!quote) return []
  const sourceTokens = tokenizeWithPositions(source)
  const sourceFreq = new Map()
  for (const t of sourceTokens) {
    const norm = t.raw.toLowerCase()
    sourceFreq.set(norm, (sourceFreq.get(norm) || 0) + 1)
  }

  const quoteTokens = tokenizeWithPositions(quote)
  const candidates = []
  for (const t of quoteTokens) {
    const filtered = normalizeWords(t.raw)
    if (filtered.length === 0) continue
    candidates.push({
      word: t.raw,
      distFromStart: t.start,
      freq: sourceFreq.get(t.raw.toLowerCase()) || 1,
    })
  }

  candidates.sort((a, b) => a.freq - b.freq)
  return candidates.slice(0, maxKeywords).map(c => ({ word: c.word, distFromStart: c.distFromStart }))
}

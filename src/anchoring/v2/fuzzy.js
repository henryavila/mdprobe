import search from 'approx-string-match'

export function stringSimilarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const longer = a.length >= b.length ? a : b
  const shorter = a.length < b.length ? a : b
  const distance = levenshtein(longer, shorter)
  return 1 - distance / longer.length
}

function levenshtein(a, b) {
  const dp = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) dp[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[b.length]
}

export function fuzzyMatch(text, quote, opts) {
  const { hint = 0, prefix = '', suffix = '' } = opts
  if (!quote) return null

  const maxErrors = Math.min(32, Math.floor(quote.length * 0.25))
  const matches = search(text, quote, maxErrors)
  if (matches.length === 0) return null

  let best = null
  for (const m of matches) {
    const quoteSim = 1 - m.errors / quote.length
    const actualPrefix = text.slice(Math.max(0, m.start - 32), m.start)
    const actualSuffix = text.slice(m.end, m.end + 32)
    const prefixSim = prefix ? stringSimilarity(prefix, actualPrefix) : 1
    const suffixSim = suffix ? stringSimilarity(suffix, actualSuffix) : 1
    const posScore = 1 - Math.abs(m.start - hint) / Math.max(text.length, 1)
    const score = (50 * quoteSim + 20 * prefixSim + 20 * suffixSim + 2 * posScore) / 92
    if (best == null || score > best.score) {
      best = { start: m.start, end: m.end, errors: m.errors, score }
    }
  }
  return best
}

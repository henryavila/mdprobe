import { computeContextHash } from './schema.js'
import { fuzzyMatch } from './fuzzy.js'
import { findHeadingByText, paragraphsUnder } from './treepath.js'
import { fingerprint, jaccard } from './fingerprint.js'

function findAllOccurrences(source, needle) {
  const out = []
  if (!needle) return out
  let idx = source.indexOf(needle)
  while (idx !== -1) {
    out.push(idx)
    idx = source.indexOf(needle, idx + 1)
  }
  return out
}

function step0_integrityCheck(ann, source) {
  const { start, end } = ann.range
  const prefix = source.slice(Math.max(0, start - 32), start)
  const exact = source.slice(start, end)
  const suffix = source.slice(end, Math.min(source.length, end + 32))
  const currentHash = computeContextHash(prefix, exact, suffix)
  if (currentHash === ann.anchor?.contextHash && exact === ann.quote.exact) {
    return { state: 'confident', score: 1, range: { start, end } }
  }
  return null
}

function step1_exactMatch(ann, source) {
  const { exact } = ann.quote
  const occurrences = findAllOccurrences(source, exact)
  if (occurrences.length === 1) {
    return {
      state: 'confident',
      score: 0.95,
      range: { start: occurrences[0], end: occurrences[0] + exact.length },
    }
  }
  return occurrences
}

function step2_fuzzyMatch(ann, source, hint) {
  const { exact, prefix, suffix } = ann.quote
  const windowStart = Math.max(0, hint - 2000)
  const windowEnd = Math.min(source.length, hint + 2000)
  const windowText = source.slice(windowStart, windowEnd)
  const r = fuzzyMatch(windowText, exact, { hint: hint - windowStart, prefix, suffix })
  if (!r) return null
  const start = windowStart + r.start
  const end = windowStart + r.end
  return {
    state: r.score >= 0.80 ? 'confident' : (r.score >= 0.60 ? 'drifted' : null),
    score: r.score,
    range: { start, end },
  }
}

function step3_treePath(ann, source, mdast) {
  const tp = ann.anchor?.treePath
  if (!mdast || !tp) return null
  const heading = findHeadingByText(mdast, tp.headingText)
  if (!heading) return null
  const paragraphs = paragraphsUnder(mdast, heading)
  const start = Math.max(0, tp.paragraphIndex - 1)
  const end = Math.min(paragraphs.length, tp.paragraphIndex + 2)
  const candidates = paragraphs.slice(start, end)
  let best = null
  for (const p of candidates) {
    const fpSim = jaccard(fingerprint(p.text), tp.paragraphFingerprint)
    const kws = ann.anchor.keywords || []
    const kwsHit = kws.filter(k => p.text.includes(k.word)).length
    const kwsScore = kws.length > 0 ? kwsHit / kws.length : 0
    const idxProx = 1 - Math.abs(p.index - tp.paragraphIndex) / 10
    const score = 0.4 * fpSim + 0.4 * kwsScore + 0.2 * idxProx
    if (best == null || score > best.score) best = { paragraph: p, score }
  }
  if (best && best.score >= 0.65) {
    const r2 = fuzzyMatch(best.paragraph.text, ann.quote.exact, {
      hint: tp.charOffsetInParagraph,
      prefix: ann.quote.prefix,
      suffix: ann.quote.suffix,
    })
    if (r2 && r2.score >= 0.60) {
      return {
        state: 'drifted',
        score: r2.score,
        range: {
          start: best.paragraph.startOffset + r2.start,
          end: best.paragraph.startOffset + r2.end,
        },
      }
    }
  }
  return null
}

function step4_keywords(ann, source) {
  const kws = ann.anchor?.keywords || []
  if (kws.length === 0) return null
  let best = null
  for (const kw of kws) {
    const occurrences = findAllOccurrences(source, kw.word)
    for (const occ of occurrences) {
      const expectedStart = occ - kw.distFromStart
      const r = fuzzyMatch(
        source.slice(Math.max(0, expectedStart - 50), Math.min(source.length, expectedStart + 50 + ann.quote.exact.length)),
        ann.quote.exact,
        { hint: 50, prefix: ann.quote.prefix, suffix: ann.quote.suffix },
      )
      if (r && r.score >= 0.75) {
        const baseStart = Math.max(0, expectedStart - 50)
        if (best == null || r.score > best.score) {
          best = { state: 'drifted', score: r.score, range: { start: baseStart + r.start, end: baseStart + r.end } }
        }
      }
    }
  }
  return best
}

export function locate(ann, source, mdast) {
  if (!source) return { state: 'orphan', score: 0 }

  const s0 = step0_integrityCheck(ann, source)
  if (s0) return s0

  const s1 = step1_exactMatch(ann, source)
  if (s1 && !Array.isArray(s1)) return s1
  const candidates = Array.isArray(s1) ? s1 : []

  const hint = candidates.length > 0 ? candidates[0] : ann.range.start
  const s2 = step2_fuzzyMatch(ann, source, hint)
  if (s2 && s2.state) return s2

  const s3 = step3_treePath(ann, source, mdast)
  if (s3) return s3

  const s4 = step4_keywords(ann, source)
  if (s4) return s4

  return { state: 'orphan', score: 0 }
}

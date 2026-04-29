const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'of', 'for', 'with', 'by', 'as', 'and', 'or',
  'but', 'not', 'no', 'so', 'if', 'do', 'did', 'has', 'had', 'have',
  'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she',
  'we', 'they', 'them', 'us', 'your', 'his', 'her', 'their', 'our',
])

export function normalizeWords(text) {
  if (!text) return []
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w))
}

const NUM_HASHES = 16

function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function fingerprint(text) {
  const words = normalizeWords(text)
  if (words.length === 0) return ''
  const minHashes = new Array(NUM_HASHES).fill(0xffffffff)
  for (const w of words) {
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = fnv1a(w, 0x811c9dc5 + i * 0x9e3779b9)
      if (h < minHashes[i]) minHashes[i] = h
    }
  }
  return 'minhash:' + minHashes.map(h => h.toString(16).padStart(8, '0')).join('')
}

export function jaccard(fpA, fpB) {
  if (!fpA || !fpB) return 0
  if (!fpA.startsWith('minhash:') || !fpB.startsWith('minhash:')) return 0
  const a = fpA.slice('minhash:'.length)
  const b = fpB.slice('minhash:'.length)
  if (a.length !== b.length) return 0
  let same = 0
  for (let i = 0; i < NUM_HASHES; i++) {
    if (a.slice(i * 8, i * 8 + 8) === b.slice(i * 8, i * 8 + 8)) same++
  }
  return same / NUM_HASHES
}

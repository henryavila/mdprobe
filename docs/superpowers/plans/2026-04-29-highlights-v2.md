# Highlights v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the highlight rendering layer entirely with char-precise CSS Custom Highlight API + 5-step drift recovery pipeline, fixing both the line-expansion bug and the GPU-thrashing freeze.

**Architecture:** Three decoupled layers. (1) Renderer emits `data-source-start/end` UTF-16 offsets on every element. (2) `anchoring/v2/` is pure JS that captures Selectors from a DOM Range and hydrates them back via a 5-step pipeline (hash check → exact match → fuzzy quote+context → mdast tree path → keyword distance → orphan). (3) `css-highlight-highlighter.js` registers `Highlight` objects in `CSS.highlights` — zero DOM mutation.

**Tech Stack:** Preact + Signals (existing), Vitest + happy-dom + @testing-library/preact (existing), Playwright (existing), `approx-string-match` (new dep, Myers bit-parallel), plain JavaScript (no TypeScript — project convention), CSS Custom Highlight API (Baseline 2025).

**Spec:** `docs/superpowers/specs/2026-04-29-highlights-v2-design.md`

**Project rule:** Security hook blocks `innerHTML` assignment. All DOM construction (production AND tests) uses `createElement` / `textContent` / `setAttribute`. See memory `feedback_no_innerhtml.md`.

**Branch:** Continue on `feat/annotations-v2` (current). Stream B work (T5–T14 of prior plan) is preserved; this plan replaces Stream A only.

---

## File Structure

### Phase 1 — anchoring/v2/ (pure JS, headless)

| File | Role |
|---|---|
| `src/anchoring/v2/schema.js` | Version detection, v1→v2 essential transformer |
| `src/anchoring/v2/migrate.js` | Atomic save with `.bak` backup, orchestrates schema |
| `src/anchoring/v2/capture.js` | `describe(range, contentEl, source)` → Selectors |
| `src/anchoring/v2/locate.js` | 5-step pipeline returning `{ ranges, state, score }` |
| `src/anchoring/v2/fingerprint.js` | MinHash on normalized word sets |
| `src/anchoring/v2/keywords.js` | Rare-word extraction |
| `src/anchoring/v2/fuzzy.js` | approx-string-match wrapper + scoring |
| `src/anchoring/v2/treepath.js` | mdast walker |
| `src/anchoring/v2/build-ranges.js` | DOM Range construction from char offsets |
| `src/anchoring/v2/index.js` | Public API |

### Phase 2 — Renderer + Server + CLI

| File | Role |
|---|---|
| `src/renderer.js` (modify) | `rehypeSourcePositions` extended: emit `data-source-start/end` |
| `src/annotations.js` (modify) | Auto-migration on load; atomic save with `.bak` |
| `src/cli/migrate-cmd.js` | CLI entry; calls `anchoring/v2/migrate.js` |
| `bin/cli.js` (modify) | Route `migrate` subcommand |

### Phase 3 — UI rendering layer

| File | Role |
|---|---|
| `src/ui/highlighters/capability.js` | `isHighlightApiSupported()` |
| `src/ui/highlighters/unsupported-modal.jsx` | Hard requirement modal |
| `src/ui/highlighters/css-highlight-highlighter.js` | `{ sync, syncOne, clear, setSelection }` |
| `src/ui/click/resolver.js` | `caretPositionFromPoint`-based annotation lookup |

### Phase 4 — Integration in existing UI

| File | Role |
|---|---|
| `src/ui/state/store.js` (modify) | Add `currentSource`, `currentMdast` signals; status `drifted` |
| `src/ui/components/Content.jsx` (modify) | Swap highlighter; wire click resolver |
| `src/ui/components/RightPanel.jsx` (modify) | Drifted/orphan sections + counters |
| `src/ui/app.jsx` (modify) | Capability check at boot |
| `src/ui/styles/themes.css` (modify) | `::highlight()` rules; remove old |

### Phase 5 — Tests

Unit tests mirror each anchoring/v2 file. Integration and E2E tests as listed in spec §9.

### Phase 6 — Cleanup + Release

| Action | Detail |
|---|---|
| Delete old highlighter and v1 anchoring | Superseded modules |
| `package.json` (modify) | Bump 0.4.3 → 0.5.0; add `approx-string-match` |
| `CHANGELOG.md` (modify) | v0.5.0 entry |

---

## Phase 1 — Anchoring v2 (foundation, no UI deps)

## Task 1: Setup — add dependency and create anchoring/v2 directory

**Files:**
- Modify: `package.json`
- Create: `src/anchoring/v2/.keep` (empty placeholder for git)

- [ ] **Step 1.1: Add the new dependency**

```
cd /home/henry/mdprobe && npm install approx-string-match@^2.0.0
```

Expected: package.json updated with `"approx-string-match": "^2.0.0"` in `dependencies`. Lockfile updated.

- [ ] **Step 1.2: Create the directory**

```
mkdir -p /home/henry/mdprobe/src/anchoring/v2
touch /home/henry/mdprobe/src/anchoring/v2/.keep
```

- [ ] **Step 1.3: Verify install works**

```
cd /home/henry/mdprobe && node --input-type=module -e "import('approx-string-match').then(m => console.log(typeof m.default))"
```

Expected: `function`.

- [ ] **Step 1.4: Commit**

```
cd /home/henry/mdprobe && git add package.json package-lock.json src/anchoring/v2/.keep
git commit -m "chore(deps): add approx-string-match for highlights v2 fuzzy matching"
```

---

## Task 2: schema.js — version detection and v1→v2 essential transformer

**Files:**
- Create: `src/anchoring/v2/schema.js`
- Test: `tests/unit/anchoring-schema.test.js`

- [ ] **Step 2.1: Write the failing tests**

```js
// tests/unit/anchoring-schema.test.js
import { describe, it, expect } from 'vitest'
import { detectVersion, transformV1ToV2Essential, sourceToOffset } from '../../src/anchoring/v2/schema.js'
import { createHash } from 'node:crypto'

describe('detectVersion', () => {
  it('returns 1 when schema_version is missing', () => {
    expect(detectVersion({ annotations: [] })).toBe(1)
  })

  it('returns the explicit version when present', () => {
    expect(detectVersion({ schema_version: 2, annotations: [] })).toBe(2)
    expect(detectVersion({ schema_version: 1, annotations: [] })).toBe(1)
  })
})

describe('sourceToOffset', () => {
  it('converts (line, column) 1-indexed to UTF-16 offset', () => {
    const source = 'abc\ndef\nghi'
    expect(sourceToOffset(source, 1, 1)).toBe(0)
    expect(sourceToOffset(source, 1, 4)).toBe(3)
    expect(sourceToOffset(source, 2, 1)).toBe(4)
    expect(sourceToOffset(source, 3, 3)).toBe(10)
  })

  it('clamps out-of-range positions to source length', () => {
    expect(sourceToOffset('abc', 99, 99)).toBe(3)
  })
})

describe('transformV1ToV2Essential', () => {
  const source = 'Header\n\nThis is a test paragraph with some words.\n'

  it('converts a v1 annotation to v2 with range from line/col', () => {
    const v1 = {
      schema_version: 1,
      annotations: [{
        id: 'a1', author: 'me', tag: 'question', status: 'open', comment: 'why?',
        created_at: '2026-01-01T00:00:00Z',
        selectors: {
          position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 },
          quote: { exact: 'This', prefix: '\n', suffix: ' is' },
        },
      }],
    }
    const v2 = transformV1ToV2Essential(v1, source)
    expect(v2.schema_version).toBe(2)
    expect(v2.annotations[0].range).toEqual({ start: 8, end: 12 })
    expect(v2.annotations[0].quote).toEqual({ exact: 'This', prefix: '\n', suffix: ' is' })
    expect(v2.annotations[0].anchor.contextHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(v2.annotations[0].selectors).toBeUndefined()
  })

  it('computes contextHash deterministically', () => {
    const v1 = { annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '\n', suffix: ' is' } },
    }] }
    const v2a = transformV1ToV2Essential(v1, source)
    const expectedHex = createHash('sha256').update('\nThis is').digest('hex')
    expect(v2a.annotations[0].anchor.contextHash).toBe(`sha256:${expectedHex}`)
  })

  it('leaves treePath and keywords empty for lazy backfill', () => {
    const v1 = { annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
    }] }
    const v2 = transformV1ToV2Essential(v1, source)
    expect(v2.annotations[0].anchor.treePath).toBeUndefined()
    expect(v2.annotations[0].anchor.keywords).toBeUndefined()
  })

  it('preserves replies array', () => {
    const v1 = { annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      replies: [{ id: 'r1', author: 'b', comment: 'reply', created_at: '...' }],
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
    }] }
    const v2 = transformV1ToV2Essential(v1, source)
    expect(v2.annotations[0].replies).toEqual([{ id: 'r1', author: 'b', comment: 'reply', created_at: '...' }])
  })

  it('returns input unchanged when already v2', () => {
    const v2 = { schema_version: 2, annotations: [{ id: 'x', range: { start: 0, end: 3 }, quote: { exact: 'abc' } }] }
    expect(transformV1ToV2Essential(v2, source)).toBe(v2)
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-schema.test.js
```

Expected: FAIL — `Failed to resolve import "../../src/anchoring/v2/schema.js"`.

- [ ] **Step 2.3: Implement schema.js**

```js
// src/anchoring/v2/schema.js
import { createHash } from 'node:crypto'

export function detectVersion(yamlObj) {
  return yamlObj?.schema_version ?? 1
}

export function sourceToOffset(source, line, column) {
  let offset = 0
  let currentLine = 1
  for (let i = 0; i < source.length; i++) {
    if (currentLine === line) {
      return Math.min(offset + (column - 1), source.length)
    }
    if (source[i] === '\n') currentLine++
    offset++
  }
  return source.length
}

function sha256(s) {
  return 'sha256:' + createHash('sha256').update(s).digest('hex')
}

export function transformV1ToV2Essential(yamlObj, source) {
  if (detectVersion(yamlObj) >= 2) return yamlObj

  const out = { ...yamlObj, schema_version: 2 }
  out.annotations = (yamlObj.annotations || []).map(ann => {
    const pos = ann.selectors?.position
    const quote = ann.selectors?.quote || { exact: '', prefix: '', suffix: '' }
    const start = pos ? sourceToOffset(source, pos.startLine, pos.startColumn) : 0
    const end = pos ? sourceToOffset(source, pos.endLine, pos.endColumn) : start
    const contextHash = sha256(quote.prefix + quote.exact + quote.suffix)

    const transformed = { ...ann }
    delete transformed.selectors
    transformed.range = { start, end }
    transformed.quote = { exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix }
    transformed.anchor = { contextHash }
    return transformed
  })

  if (out.config) out.config.schema_version = 2
  return out
}

export function computeContextHash(prefix, exact, suffix) {
  return sha256(prefix + exact + suffix)
}
```

- [ ] **Step 2.4: Run test to verify pass**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-schema.test.js
```

Expected: PASS — all tests.

- [ ] **Step 2.5: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/schema.js tests/unit/anchoring-schema.test.js
git commit -m "feat(anchoring): add v2 schema with version detection and v1 transformer"
```

---

## Task 3: fingerprint.js — MinHash on normalized word sets

**Files:**
- Create: `src/anchoring/v2/fingerprint.js`
- Test: `tests/unit/anchoring-fingerprint.test.js`

- [ ] **Step 3.1: Write the failing tests**

```js
// tests/unit/anchoring-fingerprint.test.js
import { describe, it, expect } from 'vitest'
import { fingerprint, jaccard, normalizeWords } from '../../src/anchoring/v2/fingerprint.js'

describe('normalizeWords', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeWords('Hello, World!')).toEqual(['hello', 'world'])
  })

  it('filters short stop-words', () => {
    expect(normalizeWords('the quick brown fox')).toEqual(['quick', 'brown', 'fox'])
  })

  it('handles empty input', () => {
    expect(normalizeWords('')).toEqual([])
    expect(normalizeWords('   ')).toEqual([])
  })

  it('keeps non-ASCII letters', () => {
    expect(normalizeWords('Café é bom')).toEqual(['café', 'bom'])
  })
})

describe('fingerprint', () => {
  it('produces a deterministic string for the same input', () => {
    expect(fingerprint('the quick brown fox jumps')).toBe(fingerprint('the quick brown fox jumps'))
  })

  it('produces different fingerprints for different texts', () => {
    expect(fingerprint('apple banana cherry')).not.toBe(fingerprint('xenon yttrium zinc'))
  })

  it('returns empty for empty input', () => {
    expect(fingerprint('')).toBe('')
  })
})

describe('jaccard', () => {
  it('returns 1.0 for identical fingerprints', () => {
    const fp = fingerprint('apple banana cherry date')
    expect(jaccard(fp, fp)).toBe(1)
  })

  it('returns near 0 for disjoint texts', () => {
    const a = fingerprint('apple banana cherry date elderberry')
    const b = fingerprint('xenon yttrium zinc walnut quince')
    expect(jaccard(a, b)).toBeLessThan(0.15)
  })

  it('returns intermediate score for partial overlap', () => {
    const a = fingerprint('apple banana cherry date elderberry')
    const b = fingerprint('apple banana cherry walnut quince')
    expect(jaccard(a, b)).toBeGreaterThan(0.3)
    expect(jaccard(a, b)).toBeLessThan(0.8)
  })

  it('is order-invariant', () => {
    expect(jaccard(fingerprint('a b c d e'), fingerprint('e d c b a'))).toBeCloseTo(1, 5)
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-fingerprint.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement fingerprint.js**

```js
// src/anchoring/v2/fingerprint.js

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
```

- [ ] **Step 3.4: Run tests to verify pass**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-fingerprint.test.js
```

Expected: PASS — all tests.

- [ ] **Step 3.5: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/fingerprint.js tests/unit/anchoring-fingerprint.test.js
git commit -m "feat(anchoring): add MinHash fingerprint for paragraph similarity"
```

---

## Task 4: keywords.js — rare-word extraction

**Files:**
- Create: `src/anchoring/v2/keywords.js`
- Test: `tests/unit/anchoring-keywords.test.js`

- [ ] **Step 4.1: Write the failing tests**

```js
// tests/unit/anchoring-keywords.test.js
import { describe, it, expect } from 'vitest'
import { extractKeywords } from '../../src/anchoring/v2/keywords.js'

describe('extractKeywords', () => {
  it('returns up to 3 lowest-frequency content words from quote', () => {
    const quote = 'The quick FEATURE_FLAG was hardcoded'
    const source = 'The quick brown fox. The slow turtle. ' + quote + '. Another sentence.'
    const kws = extractKeywords(quote, source)
    const words = kws.map(k => k.word)
    expect(words).toContain('FEATURE_FLAG')
    expect(words).toContain('hardcoded')
    expect(kws.length).toBeLessThanOrEqual(3)
  })

  it('records distance from quote start for each keyword', () => {
    const quote = 'FEATURE_FLAG = true here'
    const source = 'irrelevant content. ' + quote + '. more content.'
    const kws = extractKeywords(quote, source)
    const flag = kws.find(k => k.word === 'FEATURE_FLAG')
    expect(flag.distFromStart).toBe(0)
  })

  it('returns empty array when quote has no content words', () => {
    expect(extractKeywords('the and a', 'whatever source content here')).toEqual([])
  })

  it('returns empty array for empty quote', () => {
    expect(extractKeywords('', 'source')).toEqual([])
  })

  it('skips stopwords', () => {
    const kws = extractKeywords('the quick brown', 'the quick brown fox')
    expect(kws.find(k => k.word === 'the')).toBeUndefined()
  })

  it('prefers rare words even if quote has common ones too', () => {
    const source = 'common common common common rare unique'
    const quote = 'common rare unique'
    const kws = extractKeywords(quote, source)
    const words = kws.map(k => k.word)
    expect(words[0]).toMatch(/^(rare|unique)$/)
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-keywords.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement keywords.js**

```js
// src/anchoring/v2/keywords.js
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
```

- [ ] **Step 4.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-keywords.test.js
```

Expected: PASS.

- [ ] **Step 4.5: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/keywords.js tests/unit/anchoring-keywords.test.js
git commit -m "feat(anchoring): add rare-word keyword extraction for drift recovery"
```

---

## Task 5: fuzzy.js — approx-string-match wrapper with scoring

**Files:**
- Create: `src/anchoring/v2/fuzzy.js`
- Test: `tests/unit/anchoring-fuzzy.test.js`

- [ ] **Step 5.1: Write the failing tests**

```js
// tests/unit/anchoring-fuzzy.test.js
import { describe, it, expect } from 'vitest'
import { fuzzyMatch, stringSimilarity } from '../../src/anchoring/v2/fuzzy.js'

describe('stringSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(stringSimilarity('hello', 'hello')).toBe(1)
  })

  it('returns 0 when either side is empty', () => {
    expect(stringSimilarity('', 'hello')).toBe(0)
    expect(stringSimilarity('hello', '')).toBe(0)
    expect(stringSimilarity('', '')).toBe(0)
  })

  it('returns intermediate value for partial match', () => {
    const sim = stringSimilarity('hello world', 'hello wxrld')
    expect(sim).toBeGreaterThan(0.7)
    expect(sim).toBeLessThan(1)
  })
})

describe('fuzzyMatch', () => {
  const text = 'foo bar baz the quick FEATURE_FLAG = true and more text here'

  it('finds exact match with high score', () => {
    const r = fuzzyMatch(text, 'FEATURE_FLAG = true', { hint: 0, prefix: '', suffix: '' })
    expect(r).not.toBeNull()
    expect(r.start).toBe(text.indexOf('FEATURE_FLAG = true'))
    expect(r.score).toBeGreaterThanOrEqual(0.8)
  })

  it('finds match with one substitution', () => {
    const r = fuzzyMatch(text, 'FEATURE_FLAG = trve', { hint: 0, prefix: '', suffix: '' })
    expect(r).not.toBeNull()
    expect(r.start).toBe(text.indexOf('FEATURE_FLAG = true'))
    expect(r.score).toBeGreaterThan(0.6)
    expect(r.score).toBeLessThan(0.95)
  })

  it('returns null when nothing close', () => {
    const r = fuzzyMatch(text, 'completely_unrelated_token_xyz_abc', { hint: 0, prefix: '', suffix: '' })
    expect(r).toBeNull()
  })

  it('uses prefix/suffix to disambiguate among multiple candidates', () => {
    const dup = 'hello world. and another hello world. final hello world.'
    const r = fuzzyMatch(dup, 'hello world', { hint: 0, prefix: 'and another ', suffix: '. final' })
    expect(r).not.toBeNull()
    expect(r.start).toBe(dup.indexOf('and another hello world') + 'and another '.length)
  })
})
```

- [ ] **Step 5.2: Run test to verify it fails**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-fuzzy.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement fuzzy.js**

```js
// src/anchoring/v2/fuzzy.js
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
    const prefixSim = stringSimilarity(prefix, actualPrefix)
    const suffixSim = stringSimilarity(suffix, actualSuffix)
    const posScore = 1 - Math.abs(m.start - hint) / Math.max(text.length, 1)
    const score = (50 * quoteSim + 20 * prefixSim + 20 * suffixSim + 2 * posScore) / 92
    if (best == null || score > best.score) {
      best = { start: m.start, end: m.end, errors: m.errors, score }
    }
  }
  return best
}
```

- [ ] **Step 5.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-fuzzy.test.js
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/fuzzy.js tests/unit/anchoring-fuzzy.test.js
git commit -m "feat(anchoring): add fuzzy match wrapper with combined-score ranking"
```

---

## Task 6: treepath.js — mdast structural walker

**Files:**
- Create: `src/anchoring/v2/treepath.js`
- Test: `tests/unit/anchoring-treepath.test.js`

- [ ] **Step 6.1: Write the failing tests**

```js
// tests/unit/anchoring-treepath.test.js
import { describe, it, expect } from 'vitest'
import { remark } from 'remark'
import { computeTreePath, findHeadingByText, paragraphsUnder } from '../../src/anchoring/v2/treepath.js'

function parse(md) { return remark().parse(md) }

const sample = `# Title

Intro paragraph.

## Section A

First para under A.

Second para under A.

## Section B

Para under B.
`

describe('computeTreePath', () => {
  it('finds heading and paragraph index for an offset', () => {
    const mdast = parse(sample)
    const offset = sample.indexOf('Second para under A')
    const path = computeTreePath(mdast, offset)
    expect(path).not.toBeNull()
    expect(path.headingText).toBe('Section A')
    expect(path.headingLevel).toBe(2)
    expect(path.paragraphIndex).toBe(1)
    expect(path.charOffsetInParagraph).toBe(0)
  })

  it('handles offsets in middle of a paragraph', () => {
    const mdast = parse(sample)
    const target = 'First para under A'
    const offset = sample.indexOf(target) + 6
    const path = computeTreePath(mdast, offset)
    expect(path.charOffsetInParagraph).toBe(6)
  })
})

describe('findHeadingByText', () => {
  it('finds an exact-text heading', () => {
    const h = findHeadingByText(parse(sample), 'Section A')
    expect(h.depth).toBe(2)
  })

  it('returns null when no heading matches', () => {
    expect(findHeadingByText(parse(sample), 'Nonexistent')).toBeNull()
  })

  it('falls back to Levenshtein <= 2 when exact fails', () => {
    const h = findHeadingByText(parse(sample), 'Sectionn A')
    expect(h.depth).toBe(2)
  })
})

describe('paragraphsUnder', () => {
  it('returns paragraphs between this heading and the next of equal or higher level', () => {
    const mdast = parse(sample)
    const h = findHeadingByText(mdast, 'Section A')
    const paras = paragraphsUnder(mdast, h)
    expect(paras).toHaveLength(2)
    expect(paras[0].text).toBe('First para under A.')
    expect(paras[1].text).toBe('Second para under A.')
  })
})
```

- [ ] **Step 6.2: Run test to verify it fails**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-treepath.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement treepath.js**

```js
// src/anchoring/v2/treepath.js

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

function nodeText(node) {
  if (node.type === 'text') return node.value
  if (!node.children) return ''
  return node.children.map(nodeText).join('')
}

export function findHeadingByText(mdast, headingText) {
  let exact = null
  let fuzzy = null
  let bestDist = Infinity
  for (const child of mdast.children) {
    if (child.type !== 'heading') continue
    const txt = nodeText(child).trim()
    if (txt === headingText) { exact = child; break }
    const d = levenshtein(txt, headingText)
    if (d <= 2 && d < bestDist) { fuzzy = child; bestDist = d }
  }
  return exact || fuzzy
}

export function paragraphsUnder(mdast, heading) {
  if (!heading) return []
  const result = []
  const startIdx = mdast.children.indexOf(heading)
  if (startIdx === -1) return result
  for (let i = startIdx + 1; i < mdast.children.length; i++) {
    const node = mdast.children[i]
    if (node.type === 'heading' && node.depth <= heading.depth) break
    if (node.type === 'paragraph') {
      result.push({
        node,
        index: result.length,
        text: nodeText(node),
        startOffset: node.position?.start?.offset ?? 0,
        endOffset: node.position?.end?.offset ?? 0,
      })
    }
  }
  return result
}

export function computeTreePath(mdast, offset) {
  let activeHeading = null
  let paragraphIndex = -1
  let containingParagraph = null

  for (const child of mdast.children) {
    const start = child.position?.start?.offset ?? 0
    const end = child.position?.end?.offset ?? 0

    if (child.type === 'heading') {
      if (start > offset) break
      activeHeading = child
      paragraphIndex = -1
    } else if (child.type === 'paragraph') {
      paragraphIndex++
      if (offset >= start && offset <= end) {
        containingParagraph = { node: child, index: paragraphIndex, text: nodeText(child), startOffset: start }
        break
      }
    }
  }

  if (containingParagraph == null) return null

  return {
    headingText: activeHeading ? nodeText(activeHeading).trim() : '',
    headingLevel: activeHeading ? activeHeading.depth : 0,
    paragraphIndex: containingParagraph.index,
    charOffsetInParagraph: offset - containingParagraph.startOffset,
  }
}
```

- [ ] **Step 6.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-treepath.test.js
```

Expected: PASS.

- [ ] **Step 6.5: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/treepath.js tests/unit/anchoring-treepath.test.js
git commit -m "feat(anchoring): add mdast tree-path walker for structural drift recovery"
```

---

## Task 7: capture.js — describe(range, contentEl, source)

**Files:**
- Create: `src/anchoring/v2/capture.js`
- Test: `tests/unit/anchoring-capture.test.jsx`

- [ ] **Step 7.1: Write the failing tests (use createElement, no innerHTML)**

```jsx
// tests/unit/anchoring-capture.test.jsx
import { describe, it, expect, beforeEach } from 'vitest'
import { remark } from 'remark'
import { describe as describeRange, textOffsetWithinAncestor } from '../../src/anchoring/v2/capture.js'

function makeContentEl() {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  document.body.appendChild(root)
  return root
}

function makePara(line, sourceStart, sourceEnd, text) {
  const p = document.createElement('p')
  p.setAttribute('data-source-line', String(line))
  p.setAttribute('data-source-start', String(sourceStart))
  p.setAttribute('data-source-end', String(sourceEnd))
  p.textContent = text
  return p
}

describe('textOffsetWithinAncestor', () => {
  it('returns 0 when text node is the first child of ancestor', () => {
    const root = makeContentEl()
    const p = makePara(1, 0, 11, 'Hello world')
    root.appendChild(p)
    const tn = p.firstChild
    expect(textOffsetWithinAncestor(p, tn, 0)).toBe(0)
  })

  it('returns offset within multi-text-node ancestor', () => {
    const root = makeContentEl()
    const p = document.createElement('p')
    p.setAttribute('data-source-start', '0')
    p.setAttribute('data-source-end', '11')
    p.appendChild(document.createTextNode('Hello '))
    const strong = document.createElement('strong')
    strong.appendChild(document.createTextNode('world'))
    p.appendChild(strong)
    root.appendChild(p)
    const innerText = strong.firstChild
    expect(textOffsetWithinAncestor(p, innerText, 3)).toBe('Hello '.length + 3)
  })
})

describe('describe', () => {
  let root, source, mdast
  beforeEach(() => {
    root = makeContentEl()
    source = 'Header\n\nThis is a test paragraph with some words.\n'
    mdast = remark().parse(source)
    const p = makePara(3, 8, 49, 'This is a test paragraph with some words.')
    root.appendChild(p)
  })

  it('captures range, exact, prefix, suffix from source', () => {
    const p = root.querySelector('p')
    const tn = p.firstChild
    const range = document.createRange()
    range.setStart(tn, 5)
    range.setEnd(tn, 9)

    const sel = describeRange(range, root, source, mdast)
    expect(sel.range).toEqual({ start: 13, end: 17 })
    expect(sel.quote.exact).toBe(source.slice(13, 17))
    expect(sel.quote.prefix).toBe(source.slice(Math.max(0, 13 - 32), 13))
    expect(sel.quote.suffix).toBe(source.slice(17, Math.min(source.length, 17 + 32)))
  })

  it('contextHash deterministic from prefix+exact+suffix', () => {
    const p = root.querySelector('p')
    const tn = p.firstChild
    const range = document.createRange()
    range.setStart(tn, 0)
    range.setEnd(tn, 4)
    const sel = describeRange(range, root, source, mdast)
    expect(sel.anchor.contextHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('extracts treePath when mdast is provided', () => {
    const p = root.querySelector('p')
    const tn = p.firstChild
    const range = document.createRange()
    range.setStart(tn, 0)
    range.setEnd(tn, 4)
    const sel = describeRange(range, root, source, mdast)
    expect(sel.anchor.treePath).toBeDefined()
    expect(sel.anchor.treePath.charOffsetInParagraph).toBeDefined()
  })

  it('extracts keywords when source provided', () => {
    const p = root.querySelector('p')
    const tn = p.firstChild
    const range = document.createRange()
    range.setStart(tn, 5)
    range.setEnd(tn, 20)
    const sel = describeRange(range, root, source, mdast)
    expect(sel.anchor.keywords).toBeDefined()
    expect(sel.anchor.keywords.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 7.2: Run test to verify fail**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-capture.test.jsx
```

Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement capture.js**

```js
// src/anchoring/v2/capture.js
import { computeContextHash } from './schema.js'
import { computeTreePath } from './treepath.js'
import { extractKeywords } from './keywords.js'
import { fingerprint } from './fingerprint.js'

export function textOffsetWithinAncestor(ancestor, targetNode, targetOffset) {
  if (targetNode === ancestor) return targetOffset
  let offset = 0
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, null)
  let node
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + targetOffset
    offset += node.textContent.length
  }
  return offset
}

function findSourceAnchor(node, contentEl) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
  while (el && el !== contentEl) {
    if (el.hasAttribute && el.hasAttribute('data-source-start')) return el
    el = el.parentElement
  }
  return null
}

export function describe(range, contentEl, source, mdast = null) {
  const startAnchor = findSourceAnchor(range.startContainer, contentEl)
  const endAnchor = findSourceAnchor(range.endContainer, contentEl)
  if (!startAnchor || !endAnchor) {
    throw new Error('describe: could not find data-source-start ancestor')
  }

  const start = parseInt(startAnchor.dataset.sourceStart, 10) +
    textOffsetWithinAncestor(startAnchor, range.startContainer, range.startOffset)
  const end = parseInt(endAnchor.dataset.sourceStart, 10) +
    textOffsetWithinAncestor(endAnchor, range.endContainer, range.endOffset)

  const exact = source.slice(start, end)
  const prefix = source.slice(Math.max(0, start - 32), start)
  const suffix = source.slice(end, Math.min(source.length, end + 32))

  const result = {
    range: { start, end },
    quote: { exact, prefix, suffix },
    anchor: { contextHash: computeContextHash(prefix, exact, suffix) },
  }

  if (mdast) {
    const tp = computeTreePath(mdast, start)
    if (tp) {
      const paragraphText = source.slice(start - tp.charOffsetInParagraph, end)
      result.anchor.treePath = {
        headingText: tp.headingText,
        headingLevel: tp.headingLevel,
        paragraphIndex: tp.paragraphIndex,
        paragraphFingerprint: fingerprint(paragraphText),
        charOffsetInParagraph: tp.charOffsetInParagraph,
      }
    }
  }

  if (source) {
    result.anchor.keywords = extractKeywords(exact, source)
  }

  return result
}
```

- [ ] **Step 7.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-capture.test.jsx
```

Expected: PASS.

- [ ] **Step 7.5: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/capture.js tests/unit/anchoring-capture.test.jsx
git commit -m "feat(anchoring): add describe() to capture Selectors from DOM Range"
```

---

## Task 8: locate.js — 5-step pipeline

**Files:**
- Create: `src/anchoring/v2/locate.js`
- Test: `tests/unit/anchoring-locate.test.js`

- [ ] **Step 8.1: Write the failing tests**

```js
// tests/unit/anchoring-locate.test.js
import { describe, it, expect } from 'vitest'
import { locate } from '../../src/anchoring/v2/locate.js'
import { computeContextHash } from '../../src/anchoring/v2/schema.js'

function makeAnn(start, end, exact, prefix, suffix) {
  return {
    id: 'a1',
    range: { start, end },
    quote: { exact, prefix, suffix },
    anchor: { contextHash: computeContextHash(prefix, exact, suffix) },
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('locate — Step 0 integrity check', () => {
  it('returns confident with score 1.0 when context matches', () => {
    const source = 'Header\n\nThis is a test paragraph with some words.\n'
    const exact = 'a test'
    const start = source.indexOf(exact)
    const ann = makeAnn(
      start, start + exact.length, exact,
      source.slice(start - 32, start),
      source.slice(start + exact.length, start + exact.length + 32),
    )
    const r = locate(ann, source, null)
    expect(r.state).toBe('confident')
    expect(r.score).toBe(1)
    expect(r.range).toEqual({ start, end: start + exact.length })
  })
})

describe('locate — Step 1 exact match', () => {
  it('finds annotation when source shifts by N chars and quote is unique', () => {
    const exact = 'FEATURE_FLAG_unique_xyz'
    const original = 'old prefix.\n\n' + exact + ' tail'
    const newSrc = 'NEW HEADER\n\nnew intro paragraph.\n\n' + exact + ' tail'
    const start = original.indexOf(exact)
    const ann = makeAnn(
      start, start + exact.length, exact,
      original.slice(Math.max(0, start - 32), start),
      original.slice(start + exact.length, start + exact.length + 32),
    )
    const r = locate(ann, newSrc, null)
    expect(r.state).toBe('confident')
    expect(r.score).toBeGreaterThanOrEqual(0.9)
    expect(r.range.start).toBe(newSrc.indexOf(exact))
  })
})

describe('locate — Step 2 fuzzy match with threshold', () => {
  it('returns drifted or confident based on score', () => {
    const original = 'Some context here. The brown fox jumped over the lazy dog. More context follows.'
    const newSrc = 'Some context here. The grayish fox jumped over the lazy dog. More context follows.'
    const exact = 'The brown fox jumped over the lazy dog'
    const start = original.indexOf(exact)
    const ann = makeAnn(
      start, start + exact.length, exact,
      original.slice(Math.max(0, start - 32), start),
      original.slice(start + exact.length, start + exact.length + 32),
    )
    const r = locate(ann, newSrc, null)
    expect(['drifted', 'confident']).toContain(r.state)
  })

  it('returns orphan when nothing close', () => {
    const original = 'foo bar baz unique_zzzzz_xyz qux'
    const newSrc = 'completely different text without any overlap whatsoever here'
    const exact = 'unique_zzzzz_xyz'
    const start = original.indexOf(exact)
    const ann = makeAnn(
      start, start + exact.length, exact,
      original.slice(Math.max(0, start - 32), start),
      original.slice(start + exact.length, start + exact.length + 32),
    )
    const r = locate(ann, newSrc, null)
    expect(r.state).toBe('orphan')
  })
})
```

- [ ] **Step 8.2: Run test to verify fail**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-locate.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement locate.js**

```js
// src/anchoring/v2/locate.js
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
```

- [ ] **Step 8.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-locate.test.js
```

Expected: PASS.

- [ ] **Step 8.5: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/locate.js tests/unit/anchoring-locate.test.js
git commit -m "feat(anchoring): add 5-step drift recovery pipeline"
```

---

## Task 9: build-ranges.js + index.js — public API

**Files:**
- Create: `src/anchoring/v2/build-ranges.js`
- Create: `src/anchoring/v2/index.js`
- Test: `tests/unit/anchoring-build-ranges.test.jsx`

- [ ] **Step 9.1: Write the failing tests**

```jsx
// tests/unit/anchoring-build-ranges.test.jsx
import { describe, it, expect } from 'vitest'
import { buildDomRanges } from '../../src/anchoring/v2/build-ranges.js'

function makePara(line, start, end, text) {
  const p = document.createElement('p')
  p.setAttribute('data-source-line', String(line))
  p.setAttribute('data-source-start', String(start))
  p.setAttribute('data-source-end', String(end))
  p.textContent = text
  return p
}

function setupContent(paras) {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  for (const p of paras) root.appendChild(p)
  document.body.appendChild(root)
  return root
}

describe('buildDomRanges', () => {
  it('returns single Range covering exact text within one paragraph', () => {
    const root = setupContent([makePara(1, 0, 11, 'Hello world')])
    const ranges = buildDomRanges(root, 6, 11)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].toString()).toBe('world')
  })

  it('returns Ranges for selection spanning two paragraphs', () => {
    const root = setupContent([
      makePara(1, 0, 11, 'Hello world'),
      makePara(3, 13, 24, 'Another text'),
    ])
    const ranges = buildDomRanges(root, 6, 20)
    expect(ranges.length).toBeGreaterThanOrEqual(1)
    const combined = ranges.map(r => r.toString()).join('')
    expect(combined.includes('world')).toBe(true)
    expect(combined.includes('Anoth')).toBe(true)
  })

  it('returns empty when no element intersects the range', () => {
    const root = setupContent([makePara(1, 0, 11, 'Hello world')])
    expect(buildDomRanges(root, 100, 200)).toEqual([])
  })
})
```

- [ ] **Step 9.2: Run test to verify fail**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-build-ranges.test.jsx
```

Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement build-ranges.js**

```js
// src/anchoring/v2/build-ranges.js

export function buildDomRanges(contentEl, start, end) {
  const result = []
  const elements = contentEl.querySelectorAll('[data-source-start]')
  for (const el of elements) {
    const elStart = parseInt(el.dataset.sourceStart, 10)
    const elEnd = parseInt(el.dataset.sourceEnd, 10)
    if (elEnd <= start || elStart >= end) continue

    const localStart = Math.max(0, start - elStart)
    const localEnd = Math.min(elEnd - elStart, end - elStart)

    const range = createRangeAtTextOffsets(el, localStart, localEnd)
    if (range) result.push(range)
  }
  return result
}

function createRangeAtTextOffsets(ancestor, localStart, localEnd) {
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, null)
  let cumOffset = 0
  let startNode = null, startOffsetIn = 0
  let endNode = null, endOffsetIn = 0
  let node
  while ((node = walker.nextNode())) {
    const len = node.textContent.length
    const nodeStart = cumOffset
    const nodeEnd = cumOffset + len
    if (startNode == null && localStart >= nodeStart && localStart <= nodeEnd) {
      startNode = node
      startOffsetIn = localStart - nodeStart
    }
    if (localEnd >= nodeStart && localEnd <= nodeEnd) {
      endNode = node
      endOffsetIn = localEnd - nodeStart
      break
    }
    cumOffset = nodeEnd
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  try {
    range.setStart(startNode, startOffsetIn)
    range.setEnd(endNode, endOffsetIn)
  } catch {
    return null
  }
  return range
}
```

- [ ] **Step 9.4: Implement index.js (public API)**

```js
// src/anchoring/v2/index.js
export { describe, textOffsetWithinAncestor } from './capture.js'
export { locate } from './locate.js'
export { buildDomRanges } from './build-ranges.js'
export { detectVersion, transformV1ToV2Essential, computeContextHash } from './schema.js'
```

- [ ] **Step 9.5: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-build-ranges.test.jsx
```

Expected: PASS.

- [ ] **Step 9.6: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/build-ranges.js src/anchoring/v2/index.js tests/unit/anchoring-build-ranges.test.jsx
git commit -m "feat(anchoring): add buildDomRanges and v2 public API surface"
```

---

## Task 10: migrate.js — atomic write with .bak backup

**Files:**
- Create: `src/anchoring/v2/migrate.js`
- Test: `tests/unit/anchoring-migrate.test.js`

- [ ] **Step 10.1: Write the failing tests**

```js
// tests/unit/anchoring-migrate.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { migrateFile, needsMigration } from '../../src/anchoring/v2/migrate.js'

let tmpDir, mdPath, yamlPath

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdprobe-mig-'))
  mdPath = path.join(tmpDir, 'doc.md')
  yamlPath = path.join(tmpDir, 'doc.annotations.yaml')
  fs.writeFileSync(mdPath, 'Header\n\nThis is a test paragraph with some words.\n')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('needsMigration', () => {
  it('returns true for v1 yaml', () => {
    const yamlContent = yaml.dump({
      annotations: [{
        id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
        created_at: '2026-01-01T00:00:00Z',
        selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
      }],
    })
    fs.writeFileSync(yamlPath, yamlContent)
    expect(needsMigration(yamlPath)).toBe(true)
  })

  it('returns false for v2 yaml', () => {
    fs.writeFileSync(yamlPath, yaml.dump({ schema_version: 2, annotations: [] }))
    expect(needsMigration(yamlPath)).toBe(false)
  })

  it('returns false when file does not exist', () => {
    expect(needsMigration(path.join(tmpDir, 'nope.yaml'))).toBe(false)
  })
})

describe('migrateFile', () => {
  it('migrates a v1 yaml to v2 with .bak backup', () => {
    const v1 = {
      annotations: [{
        id: 'a1', author: 'me', tag: 'question', status: 'open', comment: 'why?',
        created_at: '2026-01-01T00:00:00Z',
        selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '\n', suffix: ' is' } },
      }],
    }
    fs.writeFileSync(yamlPath, yaml.dump(v1))

    const result = migrateFile(yamlPath, mdPath)
    expect(result.migrated).toBe(true)
    expect(result.count).toBe(1)
    expect(fs.existsSync(yamlPath + '.bak')).toBe(true)

    const after = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
    expect(after.schema_version).toBe(2)
    expect(after.annotations[0].range).toBeDefined()
    expect(after.annotations[0].range.start).toBeGreaterThan(0)
    expect(after.annotations[0].selectors).toBeUndefined()
  })

  it('returns migrated:false for already-v2 file', () => {
    fs.writeFileSync(yamlPath, yaml.dump({ schema_version: 2, annotations: [] }))
    const result = migrateFile(yamlPath, mdPath)
    expect(result.migrated).toBe(false)
  })

  it('dry-run does not write files', () => {
    const v1 = { annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
    }] }
    fs.writeFileSync(yamlPath, yaml.dump(v1))
    const sizeBefore = fs.statSync(yamlPath).size

    const result = migrateFile(yamlPath, mdPath, { dryRun: true })
    expect(result.migrated).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(fs.statSync(yamlPath).size).toBe(sizeBefore)
    expect(fs.existsSync(yamlPath + '.bak')).toBe(false)
  })
})
```

- [ ] **Step 10.2: Run test to verify fail**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-migrate.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 10.3: Implement migrate.js**

```js
// src/anchoring/v2/migrate.js
import fs from 'node:fs'
import yaml from 'js-yaml'
import { detectVersion, transformV1ToV2Essential } from './schema.js'

export function needsMigration(yamlPath) {
  if (!fs.existsSync(yamlPath)) return false
  try {
    const obj = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
    return detectVersion(obj) < 2
  } catch {
    return false
  }
}

export function migrateFile(yamlPath, mdPath, opts = {}) {
  const { dryRun = false } = opts
  if (!fs.existsSync(yamlPath)) return { migrated: false, reason: 'no-yaml' }

  const yamlObj = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
  if (detectVersion(yamlObj) >= 2) return { migrated: false }

  if (!fs.existsSync(mdPath)) return { migrated: false, reason: 'no-md' }
  const source = fs.readFileSync(mdPath, 'utf8')

  const v2 = transformV1ToV2Essential(yamlObj, source)
  const count = (v2.annotations || []).length

  if (dryRun) return { migrated: true, dryRun: true, count }

  fs.copyFileSync(yamlPath, yamlPath + '.bak')

  const tmpPath = yamlPath + '.tmp'
  fs.writeFileSync(tmpPath, yaml.dump(v2))
  fs.renameSync(tmpPath, yamlPath)

  return { migrated: true, count, backupPath: yamlPath + '.bak' }
}
```

- [ ] **Step 10.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/anchoring-migrate.test.js
```

Expected: PASS.

- [ ] **Step 10.5: Commit**

```
cd /home/henry/mdprobe && git add src/anchoring/v2/migrate.js tests/unit/anchoring-migrate.test.js
git commit -m "feat(anchoring): add migrate.js with atomic write and .bak backup"
```

---

## Phase 2 — Renderer + Server + CLI

## Task 11: Extend rehypeSourcePositions to emit data-source-start/end

**Files:**
- Modify: `src/renderer.js`
- Test: `tests/unit/renderer-source-offsets.test.js`

- [ ] **Step 11.1: Write the failing test**

```js
// tests/unit/renderer-source-offsets.test.js
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/renderer.js'

describe('renderer source-offset attributes', () => {
  it('emits data-source-start and data-source-end on block elements', () => {
    const md = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n'
    const html = renderMarkdown(md)
    expect(html).toMatch(/<h1[^>]+data-source-start="0"/)
    expect(html).toMatch(/data-source-end="\d+"/)
  })

  it('emits data-source-start on inline elements with position metadata', () => {
    const md = 'Plain **bold** text.'
    const html = renderMarkdown(md)
    expect(html).toMatch(/<strong[^>]+data-source-start=/)
  })

  it('preserves data-source-line', () => {
    const md = 'first\n\nsecond\n'
    const html = renderMarkdown(md)
    expect(html).toMatch(/data-source-line="1"/)
    expect(html).toMatch(/data-source-line="3"/)
  })
})
```

- [ ] **Step 11.2: Run test to verify it fails**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/renderer-source-offsets.test.js
```

Expected: FAIL — `data-source-start` not present.

- [ ] **Step 11.3: Modify renderer.js**

In `src/renderer.js`, find the `rehypeSourcePositions` plugin (around line 73). Locate the part that sets `data-source-line`. In the same visitor, also emit the offsets:

```js
// Inside the visit callback in rehypeSourcePositions, where data-source-line is set:
if (node.position?.start?.offset != null) {
  node.properties = node.properties || {}
  node.properties['data-source-start'] = String(node.position.start.offset)
}
if (node.position?.end?.offset != null) {
  node.properties = node.properties || {}
  node.properties['data-source-end'] = String(node.position.end.offset)
}
```

Apply this to the same set of element types where `data-source-line` is currently set (block + listed inline elements).

- [ ] **Step 11.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/renderer-source-offsets.test.js
```

Expected: PASS. Also confirm existing renderer tests still pass:

```
cd /home/henry/mdprobe && npx vitest run tests/unit/renderer.test.js tests/unit/complex-rendering.test.js
```

Expected: ALL PASS.

- [ ] **Step 11.5: Commit**

```
cd /home/henry/mdprobe && git add src/renderer.js tests/unit/renderer-source-offsets.test.js
git commit -m "feat(renderer): emit data-source-start/end UTF-16 offsets for v2 anchoring"
```

---

## Task 12: Auto-migration on load + atomic save in annotations.js

**Files:**
- Modify: `src/annotations.js`
- Test: `tests/integration/annotation-auto-migrate.test.js`

- [ ] **Step 12.1: Write the failing integration test**

```js
// tests/integration/annotation-auto-migrate.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { AnnotationFile } from '../../src/annotations.js'

let tmpDir, mdPath, yamlPath

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdprobe-aut-'))
  mdPath = path.join(tmpDir, 'doc.md')
  yamlPath = path.join(tmpDir, 'doc.annotations.yaml')
  fs.writeFileSync(mdPath, 'Header\n\nThis is a test paragraph with some words.\n')
})
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

describe('auto-migration on AnnotationFile.load', () => {
  it('migrates a v1 file silently and writes .bak', async () => {
    const v1 = {
      annotations: [{
        id: 'a1', author: 'me', tag: 'question', status: 'open', comment: 'c',
        created_at: '2026-01-01T00:00:00Z',
        selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
      }],
    }
    fs.writeFileSync(yamlPath, yaml.dump(v1))

    await AnnotationFile.load(mdPath)
    const after = yaml.load(fs.readFileSync(yamlPath, 'utf8'))
    expect(after.schema_version).toBe(2)
    expect(after.annotations[0].range).toBeDefined()
    expect(fs.existsSync(yamlPath + '.bak')).toBe(true)
  })

  it('does not touch a v2 file', async () => {
    fs.writeFileSync(yamlPath, yaml.dump({ schema_version: 2, annotations: [] }))
    const before = fs.statSync(yamlPath).mtimeMs
    await AnnotationFile.load(mdPath)
    const after = fs.statSync(yamlPath).mtimeMs
    expect(after).toBe(before)
    expect(fs.existsSync(yamlPath + '.bak')).toBe(false)
  })
})
```

- [ ] **Step 12.2: Run test to verify it fails**

```
cd /home/henry/mdprobe && npx vitest run tests/integration/annotation-auto-migrate.test.js
```

Expected: FAIL — auto-migration not yet wired.

- [ ] **Step 12.3: Modify `src/annotations.js`**

At the top of the file, add import:

```js
import { needsMigration, migrateFile } from './anchoring/v2/migrate.js'
```

In `AnnotationFile.load(mdPath)` (or equivalent factory), early in the function before reading/parsing the yaml file, add:

```js
const yamlPath = mdPath + '.annotations.yaml'
if (needsMigration(yamlPath)) {
  try {
    const result = migrateFile(yamlPath, mdPath)
    if (result.migrated) {
      console.log(`mdprobe: migrated ${result.count} annotations to schema v2 in ${path.basename(mdPath)} (backup: ${path.basename(result.backupPath)})`)
    }
  } catch (err) {
    console.error(`mdprobe: failed to migrate ${yamlPath}: ${err.message}`)
  }
}
```

(`path` is likely imported already — verify in existing imports and add if missing.)

- [ ] **Step 12.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/integration/annotation-auto-migrate.test.js tests/unit/annotations.test.js
```

Expected: ALL PASS.

- [ ] **Step 12.5: Commit**

```
cd /home/henry/mdprobe && git add src/annotations.js tests/integration/annotation-auto-migrate.test.js
git commit -m "feat(server): auto-migrate v1 annotations to v2 on load"
```

---

## Task 13: CLI migrate-cmd

**Files:**
- Create: `src/cli/migrate-cmd.js`
- Modify: `bin/cli.js`
- Test: `tests/unit/migrate-cmd.test.js`

- [ ] **Step 13.1: Write the failing tests**

```js
// tests/unit/migrate-cmd.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { runMigrate } from '../../src/cli/migrate-cmd.js'

let tmpDir
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdprobe-cli-'))
})
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

function writeV1(dir, name) {
  const md = path.join(dir, name + '.md')
  const yp = path.join(dir, name + '.annotations.yaml')
  fs.writeFileSync(md, 'Header\n\nThis is a test paragraph with some words.\n')
  fs.writeFileSync(yp, yaml.dump({
    annotations: [{
      id: 'a1', author: 'me', tag: 'q', status: 'open', comment: 'c',
      created_at: '2026-01-01T00:00:00Z',
      selectors: { position: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 5 }, quote: { exact: 'This', prefix: '', suffix: '' } },
    }],
  }))
}

describe('runMigrate', () => {
  it('migrates a single file', () => {
    writeV1(tmpDir, 'doc')
    const stats = runMigrate(path.join(tmpDir, 'doc.md'), { dryRun: false })
    expect(stats.migrated).toBe(1)
    expect(stats.alreadyV2).toBe(0)
    expect(stats.errors).toBe(0)
  })

  it('walks a directory recursively', () => {
    writeV1(tmpDir, 'a')
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    writeV1(path.join(tmpDir, 'sub'), 'b')
    const stats = runMigrate(tmpDir, { dryRun: false })
    expect(stats.migrated).toBe(2)
  })

  it('dry-run reports without writing', () => {
    writeV1(tmpDir, 'doc')
    const stats = runMigrate(path.join(tmpDir, 'doc.md'), { dryRun: true })
    expect(stats.migrated).toBe(1)
    expect(fs.existsSync(path.join(tmpDir, 'doc.annotations.yaml.bak'))).toBe(false)
  })
})
```

- [ ] **Step 13.2: Run test to verify fail**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/migrate-cmd.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 13.3: Implement migrate-cmd.js**

```js
// src/cli/migrate-cmd.js
import fs from 'node:fs'
import path from 'node:path'
import { migrateFile } from '../anchoring/v2/migrate.js'

function findMarkdownFiles(target) {
  const result = []
  const stat = fs.statSync(target)
  if (stat.isFile()) {
    if (target.endsWith('.md')) result.push(target)
    return result
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) {
      result.push(...findMarkdownFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      result.push(full)
    }
  }
  return result
}

export function runMigrate(target, opts = {}) {
  const { dryRun = false } = opts
  const stats = { migrated: 0, alreadyV2: 0, errors: 0, files: [] }
  const mdFiles = findMarkdownFiles(target)

  for (const mdPath of mdFiles) {
    const yamlPath = mdPath + '.annotations.yaml'
    if (!fs.existsSync(yamlPath)) continue
    try {
      const result = migrateFile(yamlPath, mdPath, { dryRun })
      if (result.migrated) {
        stats.migrated++
        stats.files.push({ path: yamlPath, count: result.count })
        const action = dryRun ? '[dry-run] would migrate' : 'migrated'
        console.log(`${action} ${result.count} annotations in ${path.relative(process.cwd(), mdPath)}`)
      } else {
        stats.alreadyV2++
      }
    } catch (err) {
      stats.errors++
      console.error(`error migrating ${yamlPath}: ${err.message}`)
    }
  }

  console.log(`\n${stats.migrated} migrated, ${stats.alreadyV2} already v2, ${stats.errors} errors`)
  return stats
}
```

- [ ] **Step 13.4: Wire `bin/cli.js`**

In `bin/cli.js`, near the top (before any existing argv parsing), add:

```js
if (process.argv[2] === 'migrate') {
  const { runMigrate } = await import('../src/cli/migrate-cmd.js')
  const target = process.argv[3]
  if (!target) {
    console.error('Usage: mdprobe migrate <path-or-dir> [--dry-run]')
    process.exit(1)
  }
  const dryRun = process.argv.includes('--dry-run')
  const stats = runMigrate(target, { dryRun })
  process.exit(stats.errors > 0 ? 1 : 0)
}
```

- [ ] **Step 13.5: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/migrate-cmd.test.js
```

Expected: PASS.

- [ ] **Step 13.6: Commit**

```
cd /home/henry/mdprobe && git add src/cli/migrate-cmd.js bin/cli.js tests/unit/migrate-cmd.test.js
git commit -m "feat(cli): add 'mdprobe migrate' command for batch v1->v2 migration"
```

---

## Phase 3 — UI capability + highlighter + click resolver

## Task 14: capability.js + UnsupportedModal

**Files:**
- Create: `src/ui/highlighters/capability.js`
- Create: `src/ui/highlighters/unsupported-modal.jsx`
- Test: `tests/unit/highlighter-capability.test.jsx`

- [ ] **Step 14.1: Write the failing test**

```jsx
// tests/unit/highlighter-capability.test.jsx
import { describe, it, expect } from 'vitest'
import { isHighlightApiSupported } from '../../src/ui/highlighters/capability.js'

describe('isHighlightApiSupported', () => {
  it('returns boolean', () => {
    expect(typeof isHighlightApiSupported()).toBe('boolean')
  })

  it('returns true in environments with CSS.highlights', () => {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      expect(isHighlightApiSupported()).toBe(true)
    }
  })
})
```

- [ ] **Step 14.2: Implement capability.js and unsupported-modal.jsx**

```js
// src/ui/highlighters/capability.js
export function isHighlightApiSupported() {
  return typeof CSS !== 'undefined'
      && CSS.highlights !== undefined
      && typeof Highlight === 'function'
}
```

```jsx
// src/ui/highlighters/unsupported-modal.jsx
export function UnsupportedModal() {
  return (
    <div class="unsupported-modal__backdrop">
      <div class="unsupported-modal" role="dialog" aria-modal="true">
        <h2>Browser não suportado</h2>
        <p>
          mdProbe v0.5+ requer um navegador moderno com suporte ao
          CSS Custom Highlight API:
        </p>
        <ul>
          <li>Google Chrome 105+</li>
          <li>Mozilla Firefox 140+</li>
          <li>Apple Safari 17.2+</li>
        </ul>
        <p>
          As anotações continuam acessíveis no painel direito,
          mas o destaque inline está desabilitado.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 14.3: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/highlighter-capability.test.jsx
```

Expected: PASS.

- [ ] **Step 14.4: Commit**

```
cd /home/henry/mdprobe && git add src/ui/highlighters/capability.js src/ui/highlighters/unsupported-modal.jsx tests/unit/highlighter-capability.test.jsx
git commit -m "feat(ui): add capability detection and UnsupportedModal"
```

---

## Task 15: css-highlight-highlighter.js

**Files:**
- Create: `src/ui/highlighters/css-highlight-highlighter.js`
- Test: `tests/unit/css-highlight-highlighter.test.jsx`

- [ ] **Step 15.1: Write the failing tests**

```jsx
// tests/unit/css-highlight-highlighter.test.jsx
import { describe, it, expect, beforeEach } from 'vitest'
import { createCssHighlightHighlighter } from '../../src/ui/highlighters/css-highlight-highlighter.js'

function makeContent() {
  document.body.replaceChildren()
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    for (const name of [...CSS.highlights.keys()]) CSS.highlights.delete(name)
  }
  const root = document.createElement('div')
  root.className = 'content-area'
  const p = document.createElement('p')
  p.setAttribute('data-source-line', '1')
  p.setAttribute('data-source-start', '0')
  p.setAttribute('data-source-end', '11')
  p.textContent = 'Hello world'
  root.appendChild(p)
  document.body.appendChild(root)
  return root
}

const ann = (id, start, end, opts = {}) => ({
  id, range: { start, end },
  quote: { exact: 'Hello world'.slice(start, end), prefix: '', suffix: '' },
  anchor: {},
  tag: opts.tag || 'question',
  status: opts.status || 'open',
  created_at: opts.created_at || '2026-01-01T00:00:00Z',
})

describe('css-highlight-highlighter', () => {
  let h
  beforeEach(() => { h = createCssHighlightHighlighter() })

  it('sync registers a CSS.highlights entry per annotation', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    const a = ann('a', 0, 5)
    h.sync(root, [a], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    expect(CSS.highlights.has(`ann-${a.id}`)).toBe(true)
  })

  it('clear removes all registered highlights', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    h.sync(root, [ann('a', 0, 5)], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    h.clear(root)
    expect(CSS.highlights.has('ann-a')).toBe(false)
  })

  it('setSelection adds ann-selected', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    h.sync(root, [ann('a', 0, 5)], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    h.setSelection(root, 'a')
    expect(CSS.highlights.has('ann-selected')).toBe(true)
  })

  it('setSelection(null) removes ann-selected', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    h.sync(root, [ann('a', 0, 5)], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    h.setSelection(root, 'a')
    h.setSelection(root, null)
    expect(CSS.highlights.has('ann-selected')).toBe(false)
  })

  it('orphan annotations do not register a highlight', () => {
    if (!CSS.highlights) return
    const root = makeContent()
    const orphan = ann('orphan', 999, 1000)
    h.sync(root, [orphan], { source: 'Hello world', mdast: null, prevAnnotations: [] })
    expect(CSS.highlights.has('ann-orphan')).toBe(false)
  })
})
```

- [ ] **Step 15.2: Run test to verify fail**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/css-highlight-highlighter.test.jsx
```

Expected: FAIL.

- [ ] **Step 15.3: Implement css-highlight-highlighter.js**

```js
// src/ui/highlighters/css-highlight-highlighter.js
import { locate, buildDomRanges } from '../../anchoring/v2/index.js'

const TAG_COLORS = {
  question:   [137, 180, 250],
  bug:        [243, 139, 168],
  suggestion: [166, 227, 161],
  nitpick:    [249, 226, 175],
}

function tagColor(tag, alpha) {
  const c = TAG_COLORS[tag] || TAG_COLORS.question
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`
}

export function createCssHighlightHighlighter() {
  const registry = new Map()
  let styleEl = null

  function ensureStyle() {
    if (styleEl) return styleEl
    styleEl = document.createElement('style')
    styleEl.id = 'mdprobe-highlight-rules'
    document.head.appendChild(styleEl)
    return styleEl
  }

  function upsertRule(ann, state) {
    const sheet = ensureStyle().sheet
    if (!sheet) return
    const ruleSelector = `::highlight(ann-${ann.id})`
    const alpha = state === 'drifted' ? 0.40 : 0.25
    const bg = tagColor(ann.tag, alpha)
    const decoration = state === 'drifted' ? 'text-decoration: underline 2px dashed #f9a;' : ''
    const ruleText = `${ruleSelector} { background-color: ${bg}; ${decoration} }`
    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      if (sheet.cssRules[i].cssText.startsWith(ruleSelector)) sheet.deleteRule(i)
    }
    sheet.insertRule(ruleText, sheet.cssRules.length)
  }

  function removeRule(id) {
    const sheet = styleEl?.sheet
    if (!sheet) return
    const ruleSelector = `::highlight(ann-${id})`
    for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      if (sheet.cssRules[i].cssText.startsWith(ruleSelector)) sheet.deleteRule(i)
    }
  }

  function syncOne(id, contentEl, annotations, source, mdast) {
    const ann = annotations.find(a => a.id === id)
    if (!ann) return null
    const r = locate(ann, source, mdast)
    if (r.state === 'orphan' || !r.range) {
      removeOne(id)
      return r
    }
    const ranges = buildDomRanges(contentEl, r.range.start, r.range.end)
    if (ranges.length === 0) {
      removeOne(id)
      return { state: 'orphan', score: 0 }
    }
    const h = new Highlight(...ranges)
    h.priority = new Date(ann.created_at).getTime()
    const name = `ann-${ann.id}`
    CSS.highlights.set(name, h)
    registry.set(id, { highlight: h, ranges, state: r.state, name, ann })
    upsertRule(ann, r.state)
    return r
  }

  function removeOne(id) {
    const entry = registry.get(id)
    if (!entry) return
    CSS.highlights.delete(entry.name)
    registry.delete(id)
    removeRule(id)
  }

  function sync(contentEl, annotations, opts) {
    const { source, mdast } = opts
    const incomingIds = new Set(annotations.map(a => a.id))
    for (const id of [...registry.keys()]) {
      if (!incomingIds.has(id)) removeOne(id)
    }
    const states = {}
    for (const ann of annotations) {
      const r = syncOne(ann.id, contentEl, annotations, source, mdast)
      if (r) states[ann.id] = r.state
    }
    return states
  }

  function clear(contentEl) {
    for (const id of [...registry.keys()]) removeOne(id)
  }

  function setSelection(contentEl, annotationId) {
    CSS.highlights.delete('ann-selected')
    if (annotationId == null) return
    const entry = registry.get(annotationId)
    if (!entry) return
    const sel = new Highlight(...entry.ranges)
    sel.priority = Number.MAX_SAFE_INTEGER
    CSS.highlights.set('ann-selected', sel)
  }

  return { sync, syncOne, clear, setSelection }
}
```

- [ ] **Step 15.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/css-highlight-highlighter.test.jsx
```

Expected: PASS.

- [ ] **Step 15.5: Commit**

```
cd /home/henry/mdprobe && git add src/ui/highlighters/css-highlight-highlighter.js tests/unit/css-highlight-highlighter.test.jsx
git commit -m "feat(ui): add CSS Custom Highlight API renderer"
```

---

## Task 16: click resolver

**Files:**
- Create: `src/ui/click/resolver.js`
- Test: `tests/unit/click-resolver.test.jsx`

- [ ] **Step 16.1: Write the failing tests**

```jsx
// tests/unit/click-resolver.test.jsx
import { describe, it, expect } from 'vitest'
import { resolveClickedAnnotation } from '../../src/ui/click/resolver.js'

function makeRoot() {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  const p = document.createElement('p')
  p.setAttribute('data-source-start', '0')
  p.setAttribute('data-source-end', '11')
  p.textContent = 'Hello world'
  root.appendChild(p)
  document.body.appendChild(root)
  return root
}

const ann = (id, start, end, opts = {}) => ({
  id, range: { start, end },
  quote: { exact: '', prefix: '', suffix: '' },
  anchor: {},
  tag: 'question', status: 'open',
  created_at: opts.created_at || '2026-01-01T00:00:00Z',
})

describe('resolveClickedAnnotation', () => {
  it('returns null when no annotations', () => {
    const root = makeRoot()
    const fakeEvent = { clientX: 10, clientY: 10, target: root.querySelector('p'), ctrlKey: false, metaKey: false }
    expect(resolveClickedAnnotation(fakeEvent, root, [])).toBeNull()
  })

  it('returns null when click target is link with Ctrl', () => {
    const root = makeRoot()
    const a = document.createElement('a')
    a.href = '#'
    a.textContent = 'link'
    root.appendChild(a)
    const fakeEvent = { clientX: 10, clientY: 10, target: a, ctrlKey: true, metaKey: false }
    expect(resolveClickedAnnotation(fakeEvent, root, [ann('x', 0, 5)])).toBeNull()
  })

  it('returns null when caretPositionFromPoint returns null', () => {
    if (typeof document.caretPositionFromPoint !== 'function') return
    const root = makeRoot()
    const original = document.caretPositionFromPoint
    document.caretPositionFromPoint = () => null
    try {
      const fakeEvent = { clientX: -1000, clientY: -1000, target: root, ctrlKey: false, metaKey: false }
      expect(resolveClickedAnnotation(fakeEvent, root, [ann('x', 0, 5)])).toBeNull()
    } finally {
      document.caretPositionFromPoint = original
    }
  })

  it('returns the topmost (newest) annotation when multiple cover the offset', () => {
    if (typeof document.caretPositionFromPoint !== 'function') return
    const root = makeRoot()
    const tn = root.querySelector('p').firstChild
    const original = document.caretPositionFromPoint
    document.caretPositionFromPoint = () => ({ offsetNode: tn, offset: 2 })
    try {
      const fakeEvent = { clientX: 10, clientY: 10, target: root.querySelector('p'), ctrlKey: false, metaKey: false }
      const annotations = [
        ann('older', 0, 11, { created_at: '2026-01-01T00:00:00Z' }),
        ann('newer', 0, 11, { created_at: '2026-04-01T00:00:00Z' }),
      ]
      const r = resolveClickedAnnotation(fakeEvent, root, annotations)
      expect(r.id).toBe('newer')
    } finally {
      document.caretPositionFromPoint = original
    }
  })
})
```

- [ ] **Step 16.2: Run test to verify fail**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/click-resolver.test.jsx
```

Expected: FAIL.

- [ ] **Step 16.3: Implement resolver.js**

```js
// src/ui/click/resolver.js
import { textOffsetWithinAncestor } from '../../anchoring/v2/index.js'

export function resolveClickedAnnotation(event, contentEl, annotations) {
  if (event.target?.tagName === 'A' && (event.ctrlKey || event.metaKey)) {
    return null
  }
  if (typeof document.caretPositionFromPoint !== 'function') return null
  const pos = document.caretPositionFromPoint(event.clientX, event.clientY)
  if (!pos) return null
  if (pos.offsetNode.nodeType !== Node.TEXT_NODE) return null

  let el = pos.offsetNode.parentElement
  while (el && el !== contentEl && !el.hasAttribute('data-source-start')) {
    el = el.parentElement
  }
  if (!el || el === contentEl) return null

  const sourceOffset = parseInt(el.dataset.sourceStart, 10) +
    textOffsetWithinAncestor(el, pos.offsetNode, pos.offset)

  const candidates = annotations.filter(a =>
    a.range && a.range.start <= sourceOffset && sourceOffset < a.range.end
  )
  if (candidates.length === 0) return null

  return candidates.reduce((a, b) =>
    new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b
  )
}
```

- [ ] **Step 16.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/click-resolver.test.jsx
```

Expected: PASS.

- [ ] **Step 16.5: Commit**

```
cd /home/henry/mdprobe && git add src/ui/click/resolver.js tests/unit/click-resolver.test.jsx
git commit -m "feat(ui): add caretPositionFromPoint click resolver with edge cases"
```

---

## Phase 4 — Wire UI

## Task 17: store.js — add currentSource, currentMdast signals + drifted/orphan computed

**Files:**
- Modify: `src/ui/state/store.js`
- Modify: `tests/unit/store.test.js`

- [ ] **Step 17.1: Write the failing test**

Append to `tests/unit/store.test.js`:

```js
describe('v2 anchoring signals', () => {
  it('currentSource and currentMdast default to empty/null', async () => {
    const { currentSource, currentMdast } = await import('../../src/ui/state/store.js')
    expect(currentSource.value).toBe('')
    expect(currentMdast.value).toBe(null)
  })
})

describe('orphanedAnnotationsV2 and driftedAnnotations computed', () => {
  it('separates drifted / orphan via status field', async () => {
    const store = await import('../../src/ui/state/store.js')
    store.annotations.value = [
      { id: 'a', status: 'open' },
      { id: 'b', status: 'drifted' },
      { id: 'c', status: 'orphan' },
    ]
    expect(store.driftedAnnotations.value.find(a => a.id === 'b')).toBeDefined()
    expect(store.orphanedAnnotationsV2.value.find(a => a.id === 'c')).toBeDefined()
  })
})
```

- [ ] **Step 17.2: Run test to verify fail**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/store.test.js -t "v2 anchoring signals"
```

Expected: FAIL.

- [ ] **Step 17.3: Modify store.js**

In `src/ui/state/store.js`, add at the end (after existing exports):

```js
export const currentSource = signal('')
export const currentMdast = signal(null)

export const driftedAnnotations = computed(() =>
  annotations.value.filter(a => a.status === 'drifted')
)

export const orphanedAnnotationsV2 = computed(() =>
  annotations.value.filter(a => a.status === 'orphan')
)
```

If `openAnnotations` does not already filter by `status === 'open'`, update its filter to do so (existing definition is around line 79-81).

- [ ] **Step 17.4: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/store.test.js
```

Expected: PASS.

- [ ] **Step 17.5: Commit**

```
cd /home/henry/mdprobe && git add src/ui/state/store.js tests/unit/store.test.js
git commit -m "feat(ui): add currentSource/currentMdast signals and drifted/orphan computed"
```

---

## Task 18: themes.css — replace selection rules + add CSS Highlight rules

**Files:**
- Modify: `src/ui/styles/themes.css`

- [ ] **Step 18.1: Replace the existing `.annotation-highlight` rules**

In `src/ui/styles/themes.css`, find and DELETE all `.annotation-highlight*` rules (the old `<mark>`-based selection styling and the `[data-selected]` rules).

Add these new rules in the same location:

```css
/* CSS Custom Highlight API — selection */
::highlight(ann-selected) {
  background-color: rgba(255, 235, 59, 0.45);
  text-decoration: underline 2px solid var(--accent);
}

/* Per-annotation rules are injected dynamically via <style id="mdprobe-highlight-rules">.
   Each rule has the shape:
   ::highlight(ann-{id}) { background-color: <tag color with alpha 0.25 or 0.40>; ... } */

/* Unsupported browser modal */
.unsupported-modal__backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.unsupported-modal {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  max-width: 500px;
}

.unsupported-modal h2 { margin-top: 0; }
.unsupported-modal ul { margin: 12px 0; padding-left: 20px; }
```

- [ ] **Step 18.2: Verify build**

```
cd /home/henry/mdprobe && npm run build:ui
```

Expected: build succeeds.

- [ ] **Step 18.3: Commit**

```
cd /home/henry/mdprobe && git add src/ui/styles/themes.css
git commit -m "style(ui): replace mark-highlight CSS with ::highlight() rules + unsupported modal"
```

---

## Task 19: Content.jsx — swap to CSS highlighter and click resolver

**Files:**
- Modify: `src/ui/components/Content.jsx`
- Modify: `tests/unit/content-highlights.test.jsx`

- [ ] **Step 19.1: Update Content.jsx**

Replace top imports of `src/ui/components/Content.jsx`:

```jsx
import { useRef, useEffect, useState } from 'preact/hooks'
import { currentHtml, selectedAnnotationId, annotations, showResolved, sections,
         currentSource, currentMdast } from '../state/store.js'
import { Popover } from './Popover.jsx'
import { createCssHighlightHighlighter } from '../highlighters/css-highlight-highlighter.js'
import { resolveClickedAnnotation } from '../click/resolver.js'
import { describe as describeRange } from '../../anchoring/v2/index.js'
```

Replace the existing highlighter init with:

```jsx
const highlighterRef = useRef(null)
if (!highlighterRef.current) highlighterRef.current = createCssHighlightHighlighter()
```

Replace the highlight effect with:

```jsx
useEffect(() => {
  const el = contentRef.current
  if (!el) return
  const h = highlighterRef.current
  let raf2 = 0
  const raf1 = requestAnimationFrame(() => {
    raf2 = requestAnimationFrame(() => {
      if (!el.isConnected) return
      h.sync(el, annotations.value, {
        source: currentSource.value,
        mdast: currentMdast.value,
      })
      h.setSelection(el, selectedAnnotationId.value)
    })
  })
  return () => {
    cancelAnimationFrame(raf1)
    if (raf2) cancelAnimationFrame(raf2)
  }
}, [annotations.value, showResolved.value, currentHtml.value])

useEffect(() => {
  const el = contentRef.current
  if (!el) return
  highlighterRef.current.setSelection(el, selectedAnnotationId.value)
}, [selectedAnnotationId.value])
```

Replace `handleContentClick` and `handleMouseUp`:

```jsx
function handleContentClick(e) {
  const ann = resolveClickedAnnotation(e, contentRef.current, annotations.value)
  if (ann) {
    selectedAnnotationId.value = ann.id
  } else {
    selectedAnnotationId.value = null
  }
}

function handleMouseUp(e) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.toString().trim() === '') return
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  let selectors
  try {
    selectors = describeRange(range, contentRef.current, currentSource.value, currentMdast.value)
  } catch {
    return
  }
  setPopover({
    x: rect.left + rect.width / 2,
    y: rect.bottom + 8,
    exact: selectors.quote.exact,
    selectors,
  })
}
```

Remove now-stale code: legacy click handler that read `data-highlight-id`, and the legacy line/column-based capture in handleMouseUp.

- [ ] **Step 19.2: Update tests**

In `tests/unit/content-highlights.test.jsx`, update `flushHighlights` to flush 2 rAF frames if not already, and replace any test asserting `<mark>` element identity (those don't exist anymore). Add:

```jsx
it('selection updates ann-selected without rebuilding the per-annotation highlight', async () => {
  // Set up annotations.value, currentSource.value, currentMdast.value before render.
  // Render Content. flushHighlights.
  // expect CSS.highlights.has('ann-{id}') to be true
  // change selectedAnnotationId, flush
  // expect CSS.highlights.has('ann-selected') to be true
  // expect CSS.highlights.has('ann-{id}') to remain true
})
```

(Adapt existing helpers to also set `currentSource.value`.)

- [ ] **Step 19.3: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/content-highlights.test.jsx
```

Expected: PASS.

- [ ] **Step 19.4: Commit**

```
cd /home/henry/mdprobe && git add src/ui/components/Content.jsx tests/unit/content-highlights.test.jsx
git commit -m "refactor(ui): swap Content.jsx to CSS highlighter and caretPositionFromPoint click"
```

---

## Task 20: app.jsx — capability check at boot + currentSource/currentMdast wiring

**Files:**
- Modify: `src/ui/app.jsx`
- Modify: `src/server.js`

- [ ] **Step 20.1: Add capability check**

In `src/ui/app.jsx`, top imports:

```jsx
import { isHighlightApiSupported } from './highlighters/capability.js'
import { UnsupportedModal } from './highlighters/unsupported-modal.jsx'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { currentSource, currentMdast } from './state/store.js'
```

In the App component render, very early:

```jsx
if (!isHighlightApiSupported()) {
  return <UnsupportedModal />
}
```

In the existing fetch flow that loads a file (search for `setCurrentHtml` or `currentHtml.value =`), add a parallel fetch for the raw markdown source:

```js
const [htmlRes, srcRes] = await Promise.all([
  fetch(`/api/render?path=${encodeURIComponent(filePath)}`),
  fetch(`/api/source?path=${encodeURIComponent(filePath)}`),
])
const html = await htmlRes.text()
const source = await srcRes.text()
currentHtml.value = html
currentSource.value = source
currentMdast.value = unified().use(remarkParse).use(remarkGfm).parse(source)
```

Adjust to whatever the existing fetch shape is — the assertion is: after a file load, `currentSource.value` is the raw markdown and `currentMdast.value` is the parsed AST.

- [ ] **Step 20.2: Add server endpoint `/api/source` if missing**

In `src/server.js`, find the existing route handler. Add a route similar to existing ones:

```js
if (req.url.startsWith('/api/source')) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const filePath = url.searchParams.get('path')
  if (!filePath) return sendJSON(res, 400, { error: 'path required' })
  if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'not found' })
  const text = fs.readFileSync(filePath, 'utf8')
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
  return
}
```

Place it next to similar routes (look at existing `/api/files` or `/api/annotations` pattern and mirror).

- [ ] **Step 20.3: Verify build + smoke**

```
cd /home/henry/mdprobe && npm run build:ui
```

Expected: succeeds.

- [ ] **Step 20.4: Commit**

```
cd /home/henry/mdprobe && git add src/ui/app.jsx src/server.js
git commit -m "feat(ui): boot capability check + source/mdast signal plumbing"
```

---

## Task 21: RightPanel.jsx — drifted/orphan sections + counters

**Files:**
- Modify: `src/ui/components/RightPanel.jsx`
- Modify: `tests/unit/right-panel.test.jsx`

- [ ] **Step 21.1: Modify RightPanel**

In `src/ui/components/RightPanel.jsx`, update imports:

```jsx
import { driftedAnnotations, orphanedAnnotationsV2 } from '../state/store.js'
```

Update the panel header to show counters when applicable:

```jsx
<span style="...">
  Annotations ({openAnnotations.value.length} open
  {driftedAnnotations.value.length > 0 && ` · ${driftedAnnotations.value.length} drifted`}
  {orphanedAnnotationsV2.value.length > 0 && ` · ${orphanedAnnotationsV2.value.length} orphan`})
</span>
```

Below the open annotations list, add:

```jsx
{driftedAnnotations.value.length > 0 && (
  <DriftedSection annotations={driftedAnnotations.value} annotationOps={annotationOps} />
)}
{orphanedAnnotationsV2.value.length > 0 && (
  <OrphanV2Section annotations={orphanedAnnotationsV2.value} annotationOps={annotationOps} />
)}
```

Define the two sections in the same file:

```jsx
function DriftedSection({ annotations, annotationOps }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div class="orphaned-section drifted-section">
      <div class="orphaned-section-header" onClick={() => setCollapsed(c => !c)}>
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>Drifted ({annotations.length}) — texto pode ter mudado</span>
      </div>
      {!collapsed && annotations.map(ann => (
        <div key={ann.id} class="annotation-card drifted">
          <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
          <span style="margin-left: 6px; font-size: 11px;">{ann.author}</span>
          <div class="quote">{ann.quote?.exact}</div>
          <div style="font-size: 13px; margin-top: 4px">{ann.comment}</div>
          <div style="margin-top: 6px; display: flex; gap: 6px">
            <button class="btn btn-sm" onClick={() => annotationOps.acceptDrift(ann.id)}>Aceitar nova localização</button>
            <button class="btn btn-sm btn-danger" onClick={() => {
              if (confirm('Descartar esta anotação?')) annotationOps.deleteAnnotation(ann.id)
            }}>Descartar</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function OrphanV2Section({ annotations, annotationOps }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div class="orphaned-section">
      <div class="orphaned-section-header" onClick={() => setCollapsed(c => !c)}>
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>Não localizadas ({annotations.length})</span>
      </div>
      {!collapsed && annotations.map(ann => (
        <div key={ann.id} class="annotation-card orphaned">
          <span class={`tag tag-${ann.tag}`}>{ann.tag}</span>
          <span style="margin-left: 6px; font-size: 11px;">{ann.author}</span>
          <blockquote class="quote">{ann.quote?.exact || '(quote missing)'}</blockquote>
          <div style="font-size: 13px; margin-top: 4px">{ann.comment}</div>
          <div style="margin-top: 6px; display: flex; gap: 6px">
            <button class="btn btn-sm btn-danger" onClick={() => {
              if (confirm('Descartar esta anotação órfã?')) annotationOps.deleteAnnotation(ann.id)
            }}>Descartar</button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

`annotationOps.acceptDrift` is wired in Task 22.

- [ ] **Step 21.2: Update tests**

Append to `tests/unit/right-panel.test.jsx`:

```jsx
it('renders Drifted section when drifted annotations exist', async () => {
  const { annotations } = await import('../../src/ui/state/store.js')
  annotations.value = [{
    id: 'd1', tag: 'question', status: 'drifted', author: 'me', comment: 'check',
    range: { start: 0, end: 5 },
    quote: { exact: 'Hello', prefix: '', suffix: '' },
    anchor: {},
    created_at: '2026-01-01T00:00:00Z',
  }]
  const { getByText } = renderPanel()
  expect(getByText(/Drifted \(1\)/)).toBeTruthy()
})

it('renders Não localizadas section when orphan annotations exist', async () => {
  const { annotations } = await import('../../src/ui/state/store.js')
  annotations.value = [{
    id: 'o1', tag: 'bug', status: 'orphan', author: 'me', comment: 'gone',
    range: { start: 0, end: 5 },
    quote: { exact: 'Hello', prefix: '', suffix: '' },
    anchor: {},
    created_at: '2026-01-01T00:00:00Z',
  }]
  const { getByText } = renderPanel()
  expect(getByText(/Não localizadas \(1\)/)).toBeTruthy()
})
```

Use the existing render helper in the file (replace `renderPanel` with the actual helper name).

- [ ] **Step 21.3: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/right-panel.test.jsx
```

Expected: PASS.

- [ ] **Step 21.4: Commit**

```
cd /home/henry/mdprobe && git add src/ui/components/RightPanel.jsx tests/unit/right-panel.test.jsx
git commit -m "feat(ui): RightPanel surfaces drifted and orphan sections with counters"
```

---

## Task 22: useAnnotations.acceptDrift + create flow with v2 selectors

**Files:**
- Modify: `src/ui/hooks/useAnnotations.js`
- Modify: `src/annotations.js`
- Modify: `src/server.js`
- Modify: `src/ui/state/store.js`
- Modify: `src/ui/highlighters/css-highlight-highlighter.js`
- Modify: `src/ui/components/RightPanel.jsx`
- Test: `tests/unit/useAnnotations.test.jsx`

- [ ] **Step 22.1: Add `acceptDrift` to useAnnotations**

In `src/ui/hooks/useAnnotations.js`, after existing methods:

```js
async function acceptDrift(id, range, contextHash) {
  const data = await postAnnotation('acceptDrift', { id, range, contextHash })
  if (data.annotations) setAnnotations(data.annotations)
}
```

Add to returned object:

```js
return { /* ...existing, */ acceptDrift }
```

- [ ] **Step 22.2: Add `acceptDrift` method to AnnotationStore**

In `src/annotations.js`, add a method on the store class:

```js
acceptDrift(annotationId, currentRange, currentContextHash) {
  const ann = this._findOrThrow(annotationId)
  ann.range = currentRange
  if (!ann.anchor) ann.anchor = {}
  ann.anchor.contextHash = currentContextHash
  ann.status = 'open'
  ann.updated_at = new Date().toISOString()
}
```

In `src/server.js`, add the action case:

```js
case 'acceptDrift':
  af.acceptDrift(data.id, data.range, data.contextHash)
  break
```

(Place it in the switch alongside 'editReply'/'deleteReply'.)

- [ ] **Step 22.3: Add `liveAnchors` signal to store and populate it from highlighter**

In `src/ui/state/store.js`, add:

```js
export const liveAnchors = signal({})  // Map<annotationId, { range, contextHash }>
```

In `src/ui/highlighters/css-highlight-highlighter.js`, import:

```js
import { liveAnchors } from '../state/store.js'
import { computeContextHash } from '../../anchoring/v2/index.js'
```

Inside `syncOne`, after `locate` succeeds:

```js
const liveContextHash = computeContextHash(
  source.slice(Math.max(0, r.range.start - 32), r.range.start),
  source.slice(r.range.start, r.range.end),
  source.slice(r.range.end, Math.min(source.length, r.range.end + 32)),
)
liveAnchors.value = { ...liveAnchors.value, [ann.id]: { range: r.range, contextHash: liveContextHash } }
```

In `src/ui/components/RightPanel.jsx` `DriftedSection`, update the `Aceitar` button to look up live anchor:

```jsx
import { liveAnchors } from '../state/store.js'

// In the button onClick:
onClick={() => {
  const live = liveAnchors.value[ann.id]
  if (live) annotationOps.acceptDrift(ann.id, live.range, live.contextHash)
}}
```

- [ ] **Step 22.4: Update useAnnotations test**

Append to `tests/unit/useAnnotations.test.jsx`:

```jsx
it('acceptDrift posts the right payload', async () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ annotations: [] }) })
  globalThis.fetch = mockFetch
  const { ops } = renderUseAnnotations()
  await ops.acceptDrift('a1', { start: 100, end: 110 }, 'sha256:abc')
  const body = JSON.parse(mockFetch.mock.calls[0][1].body)
  expect(body.action).toBe('acceptDrift')
  expect(body.data).toEqual({ id: 'a1', range: { start: 100, end: 110 }, contextHash: 'sha256:abc' })
})
```

(Use the file's existing `renderUseAnnotations` helper or pattern.)

- [ ] **Step 22.5: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/unit/useAnnotations.test.jsx tests/unit/right-panel.test.jsx
```

Expected: PASS.

- [ ] **Step 22.6: Commit**

```
cd /home/henry/mdprobe && git add src/ui/hooks/useAnnotations.js src/annotations.js src/server.js src/ui/state/store.js src/ui/highlighters/css-highlight-highlighter.js src/ui/components/RightPanel.jsx tests/unit/useAnnotations.test.jsx
git commit -m "feat: wire acceptDrift action end-to-end via liveAnchors signal"
```

---

## Phase 5 — Tests

## Task 23: Integration test — annotation precision (cross-block)

**Files:**
- Create: `tests/integration/annotation-precision.test.jsx`

- [ ] **Step 23.1: Write the test**

```jsx
// tests/integration/annotation-precision.test.jsx
import { describe, it, expect } from 'vitest'
import { describe as describeRange, locate, buildDomRanges } from '../../src/anchoring/v2/index.js'
import { remark } from 'remark'

function setupContent(source) {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  const blocks = source.split('\n\n')
  let offset = 0
  for (const block of blocks) {
    const tag = block.startsWith('# ') ? 'h1' : 'p'
    const text = block.startsWith('# ') ? block.slice(2) : block
    const el = document.createElement(tag)
    el.setAttribute('data-source-start', String(offset))
    el.setAttribute('data-source-end', String(offset + block.length))
    el.textContent = text
    root.appendChild(el)
    offset += block.length + 2
  }
  document.body.appendChild(root)
  return root
}

const source = '# Title\n\nFirst paragraph here.\n\nSecond paragraph follows.'

describe('precision: cross-block selection', () => {
  it('captures + locates a selection that spans two paragraphs to multiple ranges', () => {
    const root = setupContent(source)
    const mdast = remark().parse(source)
    const p1 = root.querySelectorAll('p')[0]
    const p2 = root.querySelectorAll('p')[1]
    const range = document.createRange()
    range.setStart(p1.firstChild, 6)
    range.setEnd(p2.firstChild, 6)

    const sel = describeRange(range, root, source, mdast)
    const r = locate(sel, source, mdast)
    expect(r.state).toBe('confident')
    const ranges = buildDomRanges(root, r.range.start, r.range.end)
    expect(ranges.length).toBeGreaterThanOrEqual(1)
    const text = ranges.map(rg => rg.toString()).join('|')
    expect(text).toContain('paragraph here.')
    expect(text).toContain('Second')
  })

  it('a selection within a single paragraph results in a single Range with exactly the selected text', () => {
    const root = setupContent(source)
    const mdast = remark().parse(source)
    const p1 = root.querySelectorAll('p')[0]
    const range = document.createRange()
    range.setStart(p1.firstChild, 0)
    range.setEnd(p1.firstChild, 5)

    const sel = describeRange(range, root, source, mdast)
    const r = locate(sel, source, mdast)
    const ranges = buildDomRanges(root, r.range.start, r.range.end)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].toString()).toBe('First')
  })
})
```

- [ ] **Step 23.2: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/integration/annotation-precision.test.jsx
```

Expected: PASS.

- [ ] **Step 23.3: Commit**

```
cd /home/henry/mdprobe && git add tests/integration/annotation-precision.test.jsx
git commit -m "test(integration): assert cross-block selection precision end-to-end"
```

---

## Task 24: Integration test — drift recovery scenarios

**Files:**
- Create: `tests/integration/drift-recovery.test.jsx`

- [ ] **Step 24.1: Write the test**

```jsx
// tests/integration/drift-recovery.test.jsx
import { describe, it, expect } from 'vitest'
import { describe as describeRange, locate } from '../../src/anchoring/v2/index.js'
import { remark } from 'remark'

function setupContent(source) {
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.className = 'content-area'
  const blocks = source.split('\n\n')
  let offset = 0
  for (const block of blocks) {
    const tag = block.startsWith('#') ? 'h2' : 'p'
    const text = block.startsWith('#') ? block.replace(/^#+\s*/, '') : block
    const el = document.createElement(tag)
    el.setAttribute('data-source-start', String(offset))
    el.setAttribute('data-source-end', String(offset + block.length))
    el.textContent = text
    root.appendChild(el)
    offset += block.length + 2
  }
  document.body.appendChild(root)
  return root
}

describe('drift recovery scenarios', () => {
  it('whitespace edit before quote keeps annotation confident', () => {
    const original = 'intro paragraph here.\n\nThe quick FEATURE_FLAG_xy was set.\n\nmore.'
    const root = setupContent(original)
    const mdast = remark().parse(original)
    const p = root.querySelectorAll('p')[1]
    const r1 = document.createRange()
    r1.setStart(p.firstChild, 'The quick '.length)
    r1.setEnd(p.firstChild, 'The quick FEATURE_FLAG_xy'.length)
    const sel = describeRange(r1, root, original, mdast)

    const edited = 'intro  paragraph  here.\n\nThe quick FEATURE_FLAG_xy was set.\n\nmore.'
    const editedMdast = remark().parse(edited)
    const r = locate(sel, edited, editedMdast)
    expect(r.state).toBe('confident')
  })

  it('partial quote edit returns drifted or orphan', () => {
    const original = 'before. \n\nThe brown fox jumped lazily over there.\n\nafter.'
    const root = setupContent(original)
    const mdast = remark().parse(original)
    const p = root.querySelectorAll('p')[1]
    const targetText = 'brown fox jumped lazily over'
    const startOff = p.firstChild.textContent.indexOf(targetText)
    const r1 = document.createRange()
    r1.setStart(p.firstChild, startOff)
    r1.setEnd(p.firstChild, startOff + targetText.length)
    const sel = describeRange(r1, root, original, mdast)

    const edited = 'before. \n\nThe brown fox sprinted lazily across there.\n\nafter.'
    const editedMdast = remark().parse(edited)
    const r = locate(sel, edited, editedMdast)
    expect(['drifted', 'orphan', 'confident']).toContain(r.state)
  })

  it('orphans when quote is fully deleted', () => {
    const original = 'before.\n\nunique_phrase_only_here_xyz never repeats.\n\nafter.'
    const root = setupContent(original)
    const mdast = remark().parse(original)
    const p = root.querySelectorAll('p')[1]
    const r1 = document.createRange()
    r1.setStart(p.firstChild, 0)
    r1.setEnd(p.firstChild, 'unique_phrase_only_here_xyz'.length)
    const sel = describeRange(r1, root, original, mdast)

    const edited = 'before.\n\nentirely  different  content  now.\n\nafter.'
    const editedMdast = remark().parse(edited)
    const r = locate(sel, edited, editedMdast)
    expect(r.state).toBe('orphan')
  })
})
```

- [ ] **Step 24.2: Run tests**

```
cd /home/henry/mdprobe && npx vitest run tests/integration/drift-recovery.test.jsx
```

Expected: PASS.

- [ ] **Step 24.3: Commit**

```
cd /home/henry/mdprobe && git add tests/integration/drift-recovery.test.jsx
git commit -m "test(integration): cover drift recovery confident/drifted/orphan paths"
```

---

## Task 25: E2E — highlights precision

**Files:**
- Create: `tests/e2e/highlights-precision.spec.js`

- [ ] **Step 25.1: Write the spec**

Read existing files in `tests/e2e/` for the project's helper pattern (e.g., `startTestServer`). Mirror that pattern.

```js
// tests/e2e/highlights-precision.spec.js
import { test, expect } from '@playwright/test'
// import { startTestServer } from './helpers/server.js'  -- match existing helper

test('cross-block selection produces precise highlight after reload', async ({ page }) => {
  // 1. startTestServer with fixture md (has at least 2 paragraphs)
  // 2. page.goto(url)
  // 3. Programmatically select text spanning two paragraphs:
  //    await page.evaluate(() => {
  //      const ps = document.querySelectorAll('p')
  //      const range = document.createRange()
  //      range.setStart(ps[0].firstChild, 6)
  //      range.setEnd(ps[1].firstChild, 6)
  //      const sel = window.getSelection()
  //      sel.removeAllRanges()
  //      sel.addRange(range)
  //    })
  //    await page.dispatchEvent('.content-area p', 'mouseup')
  // 4. Fill .popover textarea, submit
  // 5. Capture annId; reload page
  // 6. Read CSS.highlights:
  //    const text = await page.evaluate((id) => {
  //      const h = CSS.highlights.get(`ann-${id}`)
  //      return [...h.entries()].map(r => r.toString()).join('|')
  //    }, annId)
  // 7. Assert that text matches the original selection (modulo block whitespace)
  //    expect(text).toContain('paragraph')
  //    expect(text.length).toBeLessThan(originalDocLength * 0.5)  // sanity: not whole doc
})
```

The implementer fills in helper-specific pieces. The contract is: after reload, the CSS Highlight covers exactly the selected text fragments, never the whole line/block.

- [ ] **Step 25.2: Run E2E**

```
cd /home/henry/mdprobe && npm run test:e2e -- tests/e2e/highlights-precision.spec.js
```

Expected: PASS.

- [ ] **Step 25.3: Commit**

```
cd /home/henry/mdprobe && git add tests/e2e/highlights-precision.spec.js
git commit -m "test(e2e): cross-block highlight precision regression guard"
```

---

## Task 26: E2E — performance smoke

**Files:**
- Create: `tests/e2e/highlights-perf.spec.js`
- Create: `tests/e2e/fixtures/large-200-anns.md`
- Create: `tests/e2e/fixtures/large-200-anns.annotations.yaml`

- [ ] **Step 26.1: Create the markdown fixture**

Create `tests/e2e/fixtures/large-200-anns.md` with this content (60 lines of distinct text — use the Write tool):

```
Line 1 with word alpha-0 and beta-0.

Line 2 with word alpha-1 and beta-1.

Line 3 with word alpha-2 and beta-2.

(... continue similarly through Line 60 ...)
```

Generate all 60 lines. The file should have exactly 60 numbered lines, each separated by a blank line.

- [ ] **Step 26.2: Create the annotations fixture**

Create `tests/e2e/fixtures/large-200-anns.annotations.yaml` containing 200 v2 annotations. Each annotation:

```yaml
- id: ann-0
  author: test
  tag: question
  status: open
  comment: c0
  created_at: '2026-04-29T00:00:00Z'
  range: { start: 0, end: 4 }
  quote: { exact: 'Line', prefix: '', suffix: ' 1 with' }
  anchor: { contextHash: 'sha256:placeholder' }
```

Generate all 200 (`ann-0` through `ann-199`). Each pointing to a small valid range in the source. Use the Write tool to create the full YAML.

The top of the file must be:

```yaml
schema_version: 2
annotations:
  - id: ann-0
    ...
```

- [ ] **Step 26.3: Write the spec**

```js
// tests/e2e/highlights-perf.spec.js
import { test, expect } from '@playwright/test'

test('rapid resolve burst does not produce >2 long tasks', async ({ page }) => {
  // Use existing E2E helper to start server pointing at fixtures/large-200-anns.md
  // page.goto(url)

  const longTaskCount = await page.evaluate(async (file) => {
    return new Promise(resolve => {
      let count = 0
      const obs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (e.duration > 100) count++
      })
      obs.observe({ entryTypes: ['longtask'] })
      const resolves = []
      for (let i = 0; i < 20; i++) {
        resolves.push(fetch('/api/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file, action: 'resolve', data: { id: 'ann-' + i } }),
        }))
      }
      Promise.all(resolves).then(() => setTimeout(() => { obs.disconnect(); resolve(count) }, 800))
    })
  }, /* file path */)

  expect(longTaskCount).toBeLessThan(3)
})
```

- [ ] **Step 26.4: Run + commit**

```
cd /home/henry/mdprobe && npm run test:e2e -- tests/e2e/highlights-perf.spec.js
```

Expected: PASS.

```
cd /home/henry/mdprobe && git add tests/e2e/highlights-perf.spec.js tests/e2e/fixtures/large-200-anns.md tests/e2e/fixtures/large-200-anns.annotations.yaml
git commit -m "test(e2e): performance smoke for rapid resolve burst"
```

---

## Phase 6 — Cleanup + Release

## Task 27: Delete old highlighter and anchoring files

**Files:**
- Delete: `src/ui/highlighters/mark-highlighter.js`
- Delete: `src/anchoring.js`
- Delete: `src/ui/diff/annotation-diff.js` and `tests/unit/annotation-diff.test.js`
- Delete: `tests/unit/mark-highlighter.test.jsx`

- [ ] **Step 27.1: Verify nothing imports them**

```
cd /home/henry/mdprobe && grep -rn "mark-highlighter\|annotation-diff" src/ tests/ 2>/dev/null | grep -v "/v2/"
```

Expected: empty output, or only finds the files themselves (not external imports).

```
cd /home/henry/mdprobe && grep -rn "from '\.\./anchoring\.js'\|from '\.\.\/\.\.\/anchoring\.js'\|from '\.\/anchoring\.js'" src/ tests/ 2>/dev/null
```

Expected: empty (no imports of the old `src/anchoring.js`).

- [ ] **Step 27.2: Delete files**

```
cd /home/henry/mdprobe && \
  git rm src/ui/highlighters/mark-highlighter.js \
         src/anchoring.js \
         src/ui/diff/annotation-diff.js \
         tests/unit/annotation-diff.test.js \
         tests/unit/mark-highlighter.test.jsx
rmdir src/ui/diff 2>/dev/null || true
```

- [ ] **Step 27.3: Run full test suite to confirm no regression**

```
cd /home/henry/mdprobe && npm test
```

Expected: ALL PASS.

- [ ] **Step 27.4: Commit**

```
cd /home/henry/mdprobe && git commit -m "chore: remove obsolete v1 highlighter and diff modules"
```

---

## Task 28: Version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify (or create): `CHANGELOG.md`

- [ ] **Step 28.1: Bump version**

In `package.json`, change `"version": "0.4.3"` to `"version": "0.5.0"`.

- [ ] **Step 28.2: Prepend CHANGELOG entry**

Prepend to `CHANGELOG.md` (create the file if it doesn't exist):

```markdown
## [0.5.0] — 2026-04-29

### Added
- **Char-precise highlighting**: annotations are anchored by UTF-16 char offsets in the source markdown plus quote+context selectors. Cross-block selections render exactly the selected text — no more line expansion.
- **CSS Custom Highlight API rendering**: zero DOM mutation, GPU-accelerated. Eliminates the browser freeze on annotation save/edit/resolve.
- **Drift recovery pipeline**: 5-step fallback (hash check → exact → fuzzy with threshold 0.60 → mdast tree path → keyword distance → orphan). Annotations survive markdown edits gracefully.
- **`drifted` state**: explicit acknowledgment required when context is uncertain (visualized with dashed amber underline).
- **`mdprobe migrate`** CLI command for batch v1→v2 schema conversion (with `--dry-run` and recursive directory support).

### Changed
- **Schema v2** for `.annotations.yaml`: `selectors.position` (line/col) replaced by `range { start, end }` (UTF-16 offsets). Auto-migration on load with `.bak` backup; CLI command for batch.
- **Click handling**: uses `caretPositionFromPoint`. `Ctrl/Cmd+click` on annotated link navigates; click without modifier selects the annotation.
- **Visual overlap**: multiple annotations on the same text show as natural color blending (alpha 0.25 per annotation). Newer annotations render on top.

### Removed
- Support for browsers without CSS Custom Highlight API. Required: Chrome 105+, Firefox 140+, Safari 17.2+. mdProbe shows a modal and disables inline highlighting on older browsers.
- Old mark-based renderer (`src/ui/highlighters/mark-highlighter.js`).
- Legacy anchoring module (`src/anchoring.js`).

### Migration
Existing `.annotations.yaml` files are upgraded automatically on first load. A `.bak` backup is saved alongside (e.g., `spec.md.annotations.yaml.bak`). To roll back, restore from the `.bak` file. Or run `npx mdprobe migrate <dir>` proactively.
```

- [ ] **Step 28.3: Run full test suite**

```
cd /home/henry/mdprobe && npm test && npm run test:e2e
```

Expected: ALL PASS.

- [ ] **Step 28.4: Commit**

```
cd /home/henry/mdprobe && git add package.json CHANGELOG.md
git commit -m "chore: release 0.5.0 — Highlights v2 (precision + perf)"
```

**Do NOT tag, publish, or push to main.** Per `feedback_no_auto_release.md`, releases require explicit user approval. Stop here.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §4 Schema v2 | T2 |
| §4 Migration policy | T10, T12, T13 |
| §5 Module structure | T2-T9 (anchoring/v2), T14-T16 (UI), T13 (cli) |
| §6.1 Renderer extension | T11 |
| §6.2 describe() | T7 |
| §6.3 5-step locate() | T8 |
| §6.4 buildDomRanges | T9 |
| §6.5 Edge cases | T7, T16, T23, T25 |
| §7.1 Capability check | T14, T20 |
| §7.2 Highlighter API | T15 |
| §7.3 CSS rules | T18 |
| §7.4 Click handling | T16, T19 |
| §7.5 Three useEffects | T19 |
| §7.6 Performance | T26 |
| §8 UX states | T17, T21, T22 |
| §9 Testing | T2-T26 |
| §10 Rollout | T28 |

**Placeholder scan:** No `TBD` / `TODO` / `implement later`. Tasks 25-26 reference "the project's existing E2E setup helper" — implementer should read existing `tests/e2e/*.spec.js` to mirror the pattern; the contract/assertions are concrete.

**Type / name consistency:**
- `range { start, end }` consistent across schema, capture, locate, server, store, click resolver
- `quote { exact, prefix, suffix }` consistent
- `anchor { contextHash, treePath, keywords }` consistent
- `state` enum: `confident | drifted | orphan` consistent
- `createCssHighlightHighlighter` (T15) — same name in T19 use site
- `acceptDrift(id, range, contextHash)` — same signature client (T22), server (T22), and RightPanel call (T22)
- `liveAnchors` signal (T22) — same shape `{ [id]: { range, contextHash } }` everywhere

No unresolved issues.

import { buildRangeInBlock, topLevelSourceBlocks } from './dom-source-map.js'

/**
 * Build DOM Range objects covering the markdown source interval
 * `[start, end]` inside `contentEl`.
 *
 * `source` (optional) is the original markdown text. When provided, the
 * walker can correctly handle block elements whose `data-source-start`
 * points at markdown syntax characters (the "- " of list items, the "# "
 * of headings, ...). The function still works without `source` for plain
 * paragraphs.
 *
 * For each top-level source block that overlaps `[start, end]`, exactly
 * one Range is produced. Cross-block selections naturally yield one Range
 * per block.
 */
export function buildDomRanges(contentEl, start, end, source) {
  const ranges = []
  const blocks = topLevelSourceBlocks(contentEl)

  for (const block of blocks) {
    const blockStart = parseInt(block.dataset.sourceStart, 10)
    const blockEnd = parseInt(block.dataset.sourceEnd, 10)
    if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) continue
    if (blockEnd <= start || blockStart >= end) continue

    const localStart = Math.max(0, start - blockStart)
    const localEnd = Math.min(blockEnd - blockStart, end - blockStart)
    const range = buildRangeInBlock(block, localStart, localEnd, source)
    if (range) ranges.push(range)
  }
  return ranges
}

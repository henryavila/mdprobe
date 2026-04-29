export function isHighlightApiSupported() {
  return typeof CSS !== 'undefined'
      && CSS.highlights !== undefined
      && typeof Highlight === 'function'
}

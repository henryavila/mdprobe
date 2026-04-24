import { createMarkHighlighter } from './mark-highlighter.js'

// Capability detection placeholder for a future CSS Custom Highlight API
// implementation. For v0.5.0 we always use the mark-based highlighter.
export function getHighlighter() {
  return createMarkHighlighter()
}

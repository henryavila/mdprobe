import { useState } from 'preact/hooks'
import { currentFile } from '../state/store.js'

// Copies the raw, original markdown source of the active file to the clipboard.
// Backed by GET /api/source (text/plain). Reuses the copied → ✓ → reset feedback
// pattern from the code-block copy buttons in Content.jsx.
export function CopySource() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const file = currentFile.value
    if (!file) return

    try {
      const res = await fetch(`/api/source?path=${encodeURIComponent(file)}`)
      if (!res.ok) throw new Error(await res.text())
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy source failed:', err)
      alert(`Copy failed: ${err.message}`)
    }
  }

  return (
    <button
      class={`btn btn-sm${copied ? ' copied' : ''}`}
      onClick={handleCopy}
      disabled={!currentFile.value}
      title="Copy the raw markdown source to the clipboard"
    >
      {copied ? '✓ Copied' : 'Copy .md'}
    </button>
  )
}

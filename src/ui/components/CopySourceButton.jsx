import { useState } from 'preact/hooks'
import { currentFile, currentSource } from '../state/store.js'

/**
 * Copy the raw markdown source of the active file to the clipboard.
 *
 * The source is already held in `currentSource` (fetched from /api/source on
 * file select), so no network round-trip is needed. Falls back to a hidden
 * <textarea> + execCommand when navigator.clipboard is unavailable — notably
 * over plain HTTP (e.g. `--expose lan`), where the Clipboard API is blocked
 * because the page is not a secure context.
 */
export function CopySourceButton() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const text = currentSource.value
    if (!currentFile.value || !text) return

    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      alert('Could not copy. Use Export ▸ or open /api/source to copy manually.')
    }
  }

  return (
    <button
      class={`btn btn-sm${copied ? ' copied' : ''}`}
      onClick={handleCopy}
      disabled={!currentFile.value}
      title="Copy the raw markdown source to the clipboard"
    >
      {copied ? 'Copied!' : 'Copy markdown'}
    </button>
  )
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* fall through to legacy path */ }
  }
  return legacyCopy(text)
}

function legacyCopy(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}

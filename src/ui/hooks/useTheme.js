import { useEffect } from 'preact/hooks'
import { theme } from '../state/store.js'

/** Available themes with display metadata. */
export const THEMES = [
  { id: 'mocha', label: 'Mocha', color: '#1e1e2e' },
  { id: 'macchiato', label: 'Macchiato', color: '#24273a' },
  { id: 'frappe', label: 'Frapp\u00e9', color: '#303446' },
  { id: 'latte', label: 'Latte', color: '#eff1f5' },
  { id: 'light', label: 'Light', color: '#ffffff' },
]

const STORAGE_KEY = 'mdprobe-theme'

/**
 * Theme management hook.
 *
 * - Applies the active theme as a `data-theme` attribute on `<html>`.
 * - Persists the selection to `localStorage`.
 * - Subscribes to signal changes so the DOM stays in sync even when the
 *   signal is mutated outside this hook.
 *
 * @returns {{ theme: import('@preact/signals').Signal<string>, setTheme: (id: string) => void, themes: typeof THEMES }}
 */
export function useTheme() {
  // Subscribe to the theme signal and keep the DOM + storage in sync.
  useEffect(() => {
    // Apply immediately in case the signal already holds a value
    applyTheme(theme.value)

    const dispose = theme.subscribe((value) => {
      applyTheme(value)
    })

    return dispose
  }, [])

  /** Set the active theme by id. */
  function setTheme(id) {
    theme.value = id
  }

  return { theme, setTheme, themes: THEMES }
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id)
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage may be unavailable (private browsing, quota exceeded, etc.)
  }
}

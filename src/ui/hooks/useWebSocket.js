import { useEffect, useRef, useCallback } from 'preact/hooks'
import {
  currentHtml,
  currentToc,
  currentFile,
  files,
  annotations,
  sections,
  driftWarning,
} from '../state/store.js'

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_DELAY_MS = 30000

/**
 * Manages the WebSocket connection to the mdprobe server.
 * Automatically reconnects with exponential back-off on disconnection.
 * Dispatches incoming messages to the appropriate signals in the store.
 *
 * @returns {import('preact/hooks').Ref<WebSocket|null>} ref to the active WebSocket
 */
export function useWebSocket() {
  const wsRef = useRef(null)
  const reconnectDelay = useRef(RECONNECT_DELAY_MS)
  const reconnectTimer = useRef(null)
  const unmounted = useRef(false)

  const connect = useCallback(() => {
    if (unmounted.current) return

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      // Reset back-off on successful connection
      reconnectDelay.current = RECONNECT_DELAY_MS
    }

    ws.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        console.warn('mdprobe: received non-JSON WebSocket message')
        return
      }

      switch (msg.type) {
        case 'update': {
          // Preserve scroll position across live reload
          const contentEl = document.querySelector('.content-area')
          const savedScroll = contentEl ? contentEl.scrollTop : 0
          currentHtml.value = msg.html
          currentToc.value = msg.toc || []
          // Restore scroll after DOM update
          if (contentEl) {
            requestAnimationFrame(() => { contentEl.scrollTop = savedScroll })
          }
          break
        }

        case 'file-added':
          // Avoid duplicates
          if (!files.value.some((f) => f.path === msg.file)) {
            files.value = [
              ...files.value,
              { path: msg.file, label: msg.file.replace(/\.md$/, '') },
            ]
          }
          break

        case 'file-removed':
          files.value = files.value.filter((f) => f.path !== msg.file)
          break

        case 'annotations':
          // Only apply if the broadcast is for the currently viewed file
          if (!msg.file || msg.file === currentFile.value) {
            annotations.value = msg.annotations || []
            sections.value = msg.sections || []
          }
          break

        case 'drift':
          driftWarning.value = msg.warning || true
          break

        case 'error':
          // Keep last valid render; surface the warning in the console
          console.warn('mdprobe:', msg.message)
          break
      }
    }

    ws.onerror = (err) => {
      console.warn('mdprobe: WebSocket error', err)
    }

    ws.onclose = () => {
      wsRef.current = null
      if (unmounted.current) return

      // Exponential back-off with jitter, capped at MAX_RECONNECT_DELAY_MS
      const delay = reconnectDelay.current
      reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS)
      const jitter = Math.random() * delay * 0.3

      reconnectTimer.current = setTimeout(connect, delay + jitter)
    }
  }, [])

  useEffect(() => {
    unmounted.current = false
    connect()

    return () => {
      unmounted.current = true
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  return wsRef
}

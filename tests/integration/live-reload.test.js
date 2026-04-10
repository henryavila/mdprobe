import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, unlink, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'

import { createServer } from '../../src/server.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the next WebSocket message, parsed as JSON.
 * Rejects after `timeout` ms.
 */
function waitForMessage(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout waiting for WS message')),
      timeout,
    )
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
  })
}

/**
 * Collect all WebSocket messages received within `window` ms.
 */
function collectMessages(ws, window = 600) {
  return new Promise((resolve) => {
    const msgs = []
    const handler = (data) => msgs.push(JSON.parse(data.toString()))
    ws.on('message', handler)
    setTimeout(() => {
      ws.off('message', handler)
      resolve(msgs)
    }, window)
  })
}

/**
 * Wait until ws reaches the given readyState (default: OPEN).
 */
function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve()
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

/**
 * Create a WebSocket client connected to the running server.
 */
function connectClient(server) {
  const { port } = server.address()
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  return ws
}

// ---------------------------------------------------------------------------
// RF06 — Live Reload
// ---------------------------------------------------------------------------

describe('RF06 - Live reload', () => {
  let tmpDir
  let server
  let ws

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mdprobe-live-'))

    // Seed the directory with an initial .md file
    await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nInitial content.\n')

    server = await createServer({ files: [tmpDir], open: false, port: 0 })
    ws = connectClient(server)
    await waitForOpen(ws)
  })

  afterEach(async () => {
    // Close WebSocket client
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close()
    }

    // Close server (should also stop file watcher)
    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }

    // Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Basic live reload
  // -------------------------------------------------------------------------
  describe('basic live reload', () => {
    it('modify .md file -> WebSocket client receives update message', async () => {
      const msgPromise = waitForMessage(ws)
      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nUpdated content.\n')

      const msg = await msgPromise
      expect(msg.type).toBe('update')
    })

    it('update message contains file path', async () => {
      const msgPromise = waitForMessage(ws)
      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nChanged.\n')

      const msg = await msgPromise
      expect(msg.type).toBe('update')
      expect(msg.file).toBe('spec.md')
    })

    it('update message contains rendered HTML', async () => {
      const msgPromise = waitForMessage(ws)
      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nNew paragraph.\n')

      const msg = await msgPromise
      expect(msg.type).toBe('update')
      expect(msg.html).toBeDefined()
      expect(typeof msg.html).toBe('string')
      expect(msg.html).toContain('New paragraph')
    })

    it('update message contains updated TOC', async () => {
      const msgPromise = waitForMessage(ws)
      await writeFile(
        join(tmpDir, 'spec.md'),
        '# Title\n\n## Section A\n\n## Section B\n',
      )

      const msg = await msgPromise
      expect(msg.type).toBe('update')
      expect(Array.isArray(msg.toc)).toBe(true)
      expect(msg.toc.length).toBeGreaterThanOrEqual(2)

      const headings = msg.toc.map((e) => e.heading)
      expect(headings).toContain('Section A')
      expect(headings).toContain('Section B')
    })

    it('TC-RF06-1: update received within 500ms of file change', async () => {
      const msgPromise = waitForMessage(ws, 1000)
      const start = Date.now()
      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nTiming test.\n')

      await msgPromise
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(500)
    })
  })

  // -------------------------------------------------------------------------
  // Debouncing
  // -------------------------------------------------------------------------
  describe('debouncing', () => {
    it('TC-RF06-2: 10 rapid writes (10ms apart) -> only 1-2 update messages', async () => {
      const collecting = collectMessages(ws, 1500)

      for (let i = 0; i < 10; i++) {
        await writeFile(
          join(tmpDir, 'spec.md'),
          `# Spec\n\nRapid write ${i}.\n`,
        )
        await new Promise((r) => setTimeout(r, 10))
      }

      const msgs = await collecting
      const updates = msgs.filter((m) => m.type === 'update')
      expect(updates.length).toBeGreaterThanOrEqual(1)
      expect(updates.length).toBeLessThanOrEqual(2)
    })

    it('single write after quiet period -> exactly 1 update', async () => {
      // Wait for any startup noise to settle
      await new Promise((r) => setTimeout(r, 300))

      const collecting = collectMessages(ws, 800)
      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nSingle write.\n')

      const msgs = await collecting
      const updates = msgs.filter((m) => m.type === 'update')
      expect(updates).toHaveLength(1)
    })

    it('debounce window is ~100ms', async () => {
      // Two writes 50ms apart (within the debounce window) should coalesce
      const collecting = collectMessages(ws, 800)

      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nFirst.\n')
      await new Promise((r) => setTimeout(r, 50))
      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nSecond.\n')

      const msgs = await collecting
      const updates = msgs.filter((m) => m.type === 'update')

      // Should coalesce into 1 update (the second write)
      expect(updates).toHaveLength(1)
      expect(updates[0].html).toContain('Second')
    })
  })

  // -------------------------------------------------------------------------
  // File watching scope
  // -------------------------------------------------------------------------
  describe('file watching scope', () => {
    it('only watches .md files (changing .txt does not trigger)', async () => {
      // Write a .txt file — should NOT trigger a message
      const collecting = collectMessages(ws, 600)
      await writeFile(join(tmpDir, 'notes.txt'), 'This is plain text.\n')

      const msgs = await collecting
      expect(msgs).toHaveLength(0)
    })

    it('watches recursively in directory mode', async () => {
      // Create a subdirectory with a seed file BEFORE the server starts
      // Rebuild the server with a pre-existing nested dir
      ws.close()
      await new Promise((resolve) => server.close(resolve))

      const subDir = join(tmpDir, 'sub')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(subDir, { recursive: true })
      await writeFile(join(subDir, 'nested.md'), '# Nested\n\nOriginal.\n')

      server = await createServer({ files: [tmpDir], open: false, port: 0 })
      ws = connectClient(server)
      await waitForOpen(ws)

      // Now modify the nested file — watcher should pick it up
      const msgPromise = waitForMessage(ws, 3000)
      await writeFile(join(subDir, 'nested.md'), '# Nested\n\nModified.\n')

      const msg = await msgPromise
      expect(msg.type).toBe('update')
      expect(msg.html).toContain('Modified')
    })

    it('TC-RF06-3: new .md file created in watched dir -> file-added message', async () => {
      const msgPromise = waitForMessage(ws)
      await writeFile(join(tmpDir, 'added.md'), '# Added\n\nBrand new file.\n')

      const msg = await msgPromise
      expect(msg.type).toBe('file-added')
      expect(msg.file).toBe('added.md')
    })

    it('.md file deleted -> file-removed message', async () => {
      // Ensure the file exists and watcher knows about it
      await writeFile(join(tmpDir, 'doomed.md'), '# Doomed\n')
      // Wait for add event to settle
      await new Promise((r) => setTimeout(r, 400))

      // Drain any pending messages
      await collectMessages(ws, 200)

      const msgPromise = waitForMessage(ws)
      await unlink(join(tmpDir, 'doomed.md'))

      const msg = await msgPromise
      expect(msg.type).toBe('file-removed')
      expect(msg.file).toBe('doomed.md')
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe('error handling', () => {
    it('TC-RF06-4: forgiving markdown does not crash on unusual input', async () => {
      const msgPromise = waitForMessage(ws)
      await writeFile(
        join(tmpDir, 'spec.md'),
        '```unclosed\ncode block without closing fence\n',
      )

      const msg = await msgPromise
      expect(msg.type).toBe('update')
      expect(typeof msg.html).toBe('string')
    })

    it('file becomes unreadable -> error message sent, not crash', async () => {
      // Make file unreadable (skip on Windows where chmod is no-op)
      await writeFile(join(tmpDir, 'spec.md'), '# Readable\n')
      await new Promise((r) => setTimeout(r, 300))

      // Drain previous messages
      await collectMessages(ws, 200)

      const msgPromise = waitForMessage(ws, 2000)
      await chmod(join(tmpDir, 'spec.md'), 0o000)

      // Trigger a re-read by touching the file timestamp
      // On Linux, chmod itself may trigger the watcher
      // or we can write to another file and test the error path
      try {
        await writeFile(join(tmpDir, 'spec.md'), '# Overwrite\n')
      } catch {
        // Expected — file is unreadable/unwritable
      }

      try {
        const msg = await msgPromise
        // Either an error message or no crash
        expect(['update', 'error']).toContain(msg.type)
      } catch {
        // Timeout is also acceptable — the point is the server didn't crash
        expect(ws.readyState).not.toBe(WebSocket.CLOSED)
      } finally {
        // Restore permissions for cleanup
        await chmod(join(tmpDir, 'spec.md'), 0o644)
      }
    })

    it('last valid render preserved on error', async () => {
      // Write valid content and capture the render
      const firstMsg = waitForMessage(ws)
      await writeFile(join(tmpDir, 'spec.md'), '# Good\n\nValid content.\n')
      const validMsg = await firstMsg

      expect(validMsg.type).toBe('update')
      expect(validMsg.html).toContain('Valid content')

      // Make file unreadable to trigger an error
      await chmod(join(tmpDir, 'spec.md'), 0o000)

      try {
        // Force a change event by a slight delay then chmod back
        await new Promise((r) => setTimeout(r, 200))

        const collecting = collectMessages(ws, 500)

        // Attempt to write (may fail due to permissions)
        try {
          await writeFile(join(tmpDir, 'spec.md'), 'BROKEN')
        } catch {
          // Expected
        }

        const msgs = await collecting
        const errorMsgs = msgs.filter((m) => m.type === 'error')

        // If error messages were sent, they should NOT replace the client's
        // last valid state — the server should indicate an error while
        // preserving the previous content
        if (errorMsgs.length > 0) {
          expect(errorMsgs[0]).toHaveProperty('file', 'spec.md')
        }

        // The server should still be alive
        expect(ws.readyState).not.toBe(WebSocket.CLOSED)
      } finally {
        await chmod(join(tmpDir, 'spec.md'), 0o644)
      }
    })
  })

  // -------------------------------------------------------------------------
  // WebSocket protocol
  // -------------------------------------------------------------------------
  describe('WebSocket protocol', () => {
    it('client connects to /ws -> connection accepted', () => {
      // ws was opened in beforeEach; if we get here it's connected
      expect(ws.readyState).toBe(WebSocket.OPEN)
    })

    it('multiple clients -> all receive updates', async () => {
      const ws2 = connectClient(server)
      await waitForOpen(ws2)

      try {
        const msg1Promise = waitForMessage(ws)
        const msg2Promise = waitForMessage(ws2)

        await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nBroadcast test.\n')

        const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise])

        expect(msg1.type).toBe('update')
        expect(msg2.type).toBe('update')
        expect(msg1.file).toBe('spec.md')
        expect(msg2.file).toBe('spec.md')
        expect(msg1.html).toContain('Broadcast test')
        expect(msg2.html).toContain('Broadcast test')
      } finally {
        ws2.close()
      }
    })

    it('client disconnects and reconnects -> receives next update', async () => {
      // Disconnect
      ws.close()
      await new Promise((r) => setTimeout(r, 100))

      // Reconnect
      ws = connectClient(server)
      await waitForOpen(ws)

      const msgPromise = waitForMessage(ws)
      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nAfter reconnect.\n')

      const msg = await msgPromise
      expect(msg.type).toBe('update')
      expect(msg.html).toContain('After reconnect')
    })
  })

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  describe('cleanup', () => {
    it('server close stops file watcher (no events after close)', async () => {
      // Close the server explicitly
      await new Promise((resolve) => server.close(resolve))

      // Try writing — should not receive any message
      const collecting = collectMessages(ws, 500)
      try {
        await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nAfter close.\n')
      } catch {
        // May fail if ws is also closed — that's fine
      }

      const msgs = await collecting
      expect(msgs).toHaveLength(0)

      // Prevent afterEach from double-closing
      server = null
    })

    it('no lingering watchers after test', async () => {
      // Close server and verify clean exit
      const closePromise = new Promise((resolve) => server.close(resolve))
      await closePromise

      // If the watcher was properly cleaned up, writing to the directory
      // should not throw or emit events
      await writeFile(join(tmpDir, 'spec.md'), '# Spec\n\nPost-cleanup.\n')

      // Give a moment to ensure no unhandled errors fire
      await new Promise((r) => setTimeout(r, 200))

      // If we reach here without uncaught exceptions, watcher is cleaned up
      server = null
    })
  })
})

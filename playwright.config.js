import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    // Use the full Chromium build, not the smaller chrome-headless-shell.
    // The shell ignores some mouse-gesture behavior that real browsers
    // honor (notably: word-snapping on double-click), which mattered for
    // reproducing the highlight-mismatch bug (2026-05-15).
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } },
  ],
})

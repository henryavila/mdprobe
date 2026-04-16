#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

const message = `
  \x1b[32m✔\x1b[0m \x1b[1mmdProbe v${pkg.version}\x1b[0m installed successfully

  \x1b[36mUsage:\x1b[0m
    mdprobe doc.md              Open a single file
    mdprobe doc.md spec.md      Open multiple files
    mdprobe docs/               Open all .md files in a directory

  \x1b[33mFor AI integration (Claude Code, Cursor, Gemini):\x1b[0m
    mdprobe setup
`

function printInstallBanner(text) {
  const targets = process.platform === 'win32' ? ['CONOUT$'] : ['/dev/tty']

  for (const target of targets) {
    try {
      // npm 10 backgrounds lifecycle scripts and hides stdout on success.
      writeFileSync(target, text)
      return
    } catch {
      // Fall through to the next target or stdout fallback.
    }
  }

  process.stdout.write(text)
}

printInstallBanner(message)

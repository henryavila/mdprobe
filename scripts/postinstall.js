#!/usr/bin/env node

const message = `
  \x1b[1mmdProbe\x1b[0m installed successfully!

  \x1b[36mUsage:\x1b[0m
    mdprobe doc.md              Open a single file
    mdprobe doc.md spec.md      Open multiple files
    mdprobe docs/               Open all .md files in a directory

  \x1b[33mFor AI integration (Claude Code, Cursor, Gemini):\x1b[0m
    mdprobe setup
`

console.log(message)

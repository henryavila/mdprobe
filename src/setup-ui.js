import { intro, outro, text, select, confirm, spinner, isCancel } from '@clack/prompts'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  detectIDEs, installSkill, registerMCP,
  registerHook, saveConfig, removeAll,
} from './setup.js'
import { getConfig } from './config.js'

const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = join(dirname(__filename), '..')
const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'))

function bail(value) {
  if (isCancel(value)) {
    outro('Setup cancelled.')
    process.exit(0)
  }
  return value
}

export async function runSetup(args) {
  const isRemove = args.includes('--remove')
  const isNonInteractive = args.includes('--yes')
  const authorIdx = args.indexOf('--author')
  const authorFlag = (authorIdx !== -1 && args[authorIdx + 1] && !args[authorIdx + 1].startsWith('-'))
    ? args[authorIdx + 1]
    : undefined

  if (isRemove) {
    const s = spinner()
    s.start('Removing mdProbe...')
    const removed = await removeAll()
    s.stop(`Removed: ${removed.length > 0 ? removed.join(', ') : 'nothing found'}`)
    return
  }

  const currentConfig = await getConfig()

  if (isNonInteractive) {
    const author = authorFlag || currentConfig.author || 'anonymous'
    const urlStyle = currentConfig.urlStyle || 'localhost'
    const enableTelemetry = args.includes('--telemetry') || (currentConfig.telemetry === true)
    const ides = await detectIDEs()

    const s = spinner()
    s.start('Installing...')

    for (const ide of ides) {
      await installSkill(ide)
    }
    await registerMCP()
    await registerHook()
    await saveConfig({ author, urlStyle, telemetry: enableTelemetry })

    s.stop('Installed successfully')
    console.log(`  IDEs: ${ides.length > 0 ? ides.join(', ') : 'none detected'}`)
    console.log(`  Author: ${author}`)
    return
  }

  // Interactive mode
  intro(`mdProbe v${pkg.version} — setup`)

  const author = bail(await text({
    message: 'Your name for annotations:',
    defaultValue: currentConfig.author || undefined,
    placeholder: currentConfig.author || 'anonymous',
    validate: () => undefined,
  })) || currentConfig.author || 'anonymous'

  const urlStyle = bail(await select({
    message: 'URL style:',
    initialValue: currentConfig.urlStyle || 'localhost',
    options: [
      { value: 'mdprobe.localhost', label: 'mdprobe.localhost', hint: 'Chrome/Firefox/Edge' },
      { value: 'localhost', label: 'localhost', hint: 'compatible with all browsers' },
    ],
  }))

  const enableTelemetry = bail(await confirm({
    message: 'Enable telemetry for diagnostics? (local only — no data leaves your machine)',
    initialValue: currentConfig.telemetry === true,
  }))

  const ides = await detectIDEs()
  if (ides.length > 0) {
    console.log(`  IDEs detected: ${ides.map(i => `✓ ${i}`).join(', ')}`)
  } else {
    console.log('  No IDEs detected.')
  }

  const s = spinner()
  s.start('Installing...')

  const installed = []

  for (const ide of ides) {
    const path = await installSkill(ide)
    installed.push(`  ${ide}: ${path}`)
  }

  const mcpResult = await registerMCP()
  const hookResult = await registerHook()
  await saveConfig({ author, urlStyle, telemetry: enableTelemetry })

  s.stop('Installed successfully!')

  if (installed.length > 0) {
    console.log('\n  Skills installed:')
    installed.forEach(p => console.log(`    ${p}`))
  }
  console.log(`\n  MCP server registered (${mcpResult.method})`)
  if (hookResult.migrated) console.log('  Old PostToolUse hook removed (no longer needed)')
  console.log(`  Config saved to ~/.mdprobe.json`)

  outro('Restart Claude Code to activate.')
}

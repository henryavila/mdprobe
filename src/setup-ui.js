import { intro, outro, text, select, confirm, spinner, isCancel } from '@clack/prompts'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  detectIDEs, installSkill, registerMCP,
  registerHook, saveConfig, removeAll,
} from './setup.js'

const __filename = fileURLToPath(import.meta.url)
const PROJECT_ROOT = join(dirname(__filename), '..')
const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'))

function bail(value) {
  if (isCancel(value)) {
    outro('Setup cancelado.')
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
    s.start('Removendo mdProbe...')
    const removed = await removeAll()
    s.stop(`Removido: ${removed.length > 0 ? removed.join(', ') : 'nada encontrado'}`)
    return
  }

  if (isNonInteractive) {
    const author = authorFlag || 'anonymous'
    const urlStyle = 'localhost'
    const ides = await detectIDEs()

    const s = spinner()
    s.start('Instalando...')

    for (const ide of ides) {
      await installSkill(ide)
    }
    await registerMCP()
    await registerHook()
    await saveConfig({ author, urlStyle })

    s.stop('Instalado com sucesso')
    console.log(`  IDEs: ${ides.length > 0 ? ides.join(', ') : 'nenhum detectado'}`)
    console.log(`  Author: ${author}`)
    return
  }

  // Interactive mode
  intro(`mdProbe v${pkg.version} — setup`)

  const author = bail(await text({
    message: 'Seu nome para anotacoes:',
    placeholder: 'anonymous',
    validate: () => undefined,
  })) || 'anonymous'

  const urlStyle = bail(await select({
    message: 'Estilo de URL:',
    options: [
      { value: 'mdprobe.localhost', label: 'mdprobe.localhost', hint: 'Chrome/Firefox/Edge' },
      { value: 'localhost', label: 'localhost', hint: 'compativel com todos' },
    ],
  }))

  const ides = await detectIDEs()
  if (ides.length > 0) {
    console.log(`  IDEs detectados: ${ides.map(i => `✓ ${i}`).join(', ')}`)
  } else {
    console.log('  Nenhum IDE detectado.')
  }

  const s = spinner()
  s.start('Instalando...')

  const installed = []

  for (const ide of ides) {
    const path = await installSkill(ide)
    installed.push(`  ${ide}: ${path}`)
  }

  const mcpResult = await registerMCP()
  const hookResult = await registerHook()
  await saveConfig({ author, urlStyle })

  s.stop('Instalado com sucesso!')

  if (installed.length > 0) {
    console.log('\n  Skills instaladas:')
    installed.forEach(p => console.log(`    ${p}`))
  }
  console.log(`\n  MCP server registrado (${mcpResult.method})`)
  if (hookResult.added) console.log('  Hook PostToolUse registrado')
  console.log(`  Config salva em ~/.mdprobe.json`)

  outro('Reinicie o Claude Code para ativar.')
}

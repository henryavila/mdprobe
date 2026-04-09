import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, readFile, mkdir, rm, mkdtemp, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installSkill, registerHook, saveConfig, removeAll } from '../../src/setup.js'

let tmp

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

describe('installSkill()', () => {
  it('writes SKILL.md to the correct IDE directory', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-skill-'))
    const skillContent = '# Test Skill\nThis is a test.'
    const destDir = join(tmp, 'skills', 'mdprobe')
    await mkdir(destDir, { recursive: true })
    const destPath = join(destDir, 'SKILL.md')
    await writeFile(destPath, skillContent, 'utf-8')

    const content = await readFile(destPath, 'utf-8')
    expect(content).toBe(skillContent)
  })
})

describe('registerHook()', () => {
  it('adds PostToolUse hook to empty settings', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-hook-'))
    const settingsPath = join(tmp, 'settings.json')

    const result = await registerHook(settingsPath)
    expect(result.added).toBe(true)

    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    expect(settings.hooks.PostToolUse).toHaveLength(1)
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Write|Edit')
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('[mdprobe]')
  })

  it('preserves existing hooks', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-hook2-'))
    const settingsPath = join(tmp, 'settings.json')

    const existing = {
      hooks: {
        PostToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo "other hook"' }],
        }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(existing), 'utf-8')

    await registerHook(settingsPath)

    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    expect(settings.hooks.PostToolUse).toHaveLength(2)
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Bash')
  })

  it('is idempotent (does not duplicate)', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-hook3-'))
    const settingsPath = join(tmp, 'settings.json')

    await registerHook(settingsPath)
    const result = await registerHook(settingsPath)
    expect(result.added).toBe(false)

    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    expect(settings.hooks.PostToolUse).toHaveLength(1)
  })
})

describe('saveConfig()', () => {
  it('saves config to specified path', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-cfg-'))
    const configPath = join(tmp, '.mdprobe.json')

    await saveConfig({ author: 'Henry', urlStyle: 'mdprobe.localhost' }, configPath)

    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config.author).toBe('Henry')
    expect(config.urlStyle).toBe('mdprobe.localhost')
  })
})

describe('removeAll()', () => {
  it('removes config file', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-rm-'))
    const configPath = join(tmp, '.mdprobe.json')
    await writeFile(configPath, '{}', 'utf-8')

    const removed = await removeAll({ configPath, settingsPath: join(tmp, 'nonexistent.json') })
    expect(removed).toContain('config')

    await expect(access(configPath)).rejects.toThrow()
  })

  it('removes hook from settings', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-rm2-'))
    const settingsPath = join(tmp, 'settings.json')
    const configPath = join(tmp, '.mdprobe.json')

    // Set up hook first
    await registerHook(settingsPath)

    const removed = await removeAll({ configPath, settingsPath })
    expect(removed).toContain('hook')

    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    expect(settings.hooks.PostToolUse).toHaveLength(0)
  })
})

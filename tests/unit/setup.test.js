import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, readFile, mkdir, rm, mkdtemp, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installSkill, registerHook, saveConfig, removeAll, detectIDEs } from '../../src/setup.js'

let tmp

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

describe('detectIDEs()', () => {
  it('detects IDE when base config dir exists but skills/ subdir does NOT', async () => {
    // Reproduces root cause: ~/.claude/ exists, ~/.claude/skills/ does not
    // detectIDEs() should still detect Claude Code
    tmp = await mkdtemp(join(tmpdir(), 'setup-detect-'))
    const baseDir = join(tmp, '.claude')
    await mkdir(baseDir, { recursive: true })
    // Deliberately NOT creating skills/ subdir

    const detected = await detectIDEs({ 'TestIDE': { detectDir: baseDir, skillsDir: join(baseDir, 'skills') } })
    expect(detected).toContain('TestIDE')
  })

  it('does NOT detect IDE when base dir is absent', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-detect2-'))
    const baseDir = join(tmp, '.nonexistent')

    const detected = await detectIDEs({ 'TestIDE': { detectDir: baseDir, skillsDir: join(baseDir, 'skills') } })
    expect(detected).not.toContain('TestIDE')
  })
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

  it('creates skills/ directory if it does not exist', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-skill2-'))
    const skillsDir = join(tmp, 'skills')
    // skills/ does NOT exist yet

    const destPath = await installSkill(
      'TestIDE',
      '# Test',
      { 'TestIDE': { detectDir: tmp, skillsDir } },
    )

    expect(destPath).toBe(join(skillsDir, 'mdprobe', 'SKILL.md'))
    const content = await readFile(destPath, 'utf-8')
    expect(content).toBe('# Test')
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

describe('setup end-to-end (detect → install)', () => {
  it('detects and installs skill even when skills/ subdir does not exist yet', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-e2e-'))
    const baseDir = join(tmp, '.testide')
    await mkdir(baseDir, { recursive: true })
    // skills/ does NOT exist — this is the bug scenario

    const configs = { 'TestIDE': { detectDir: baseDir, skillsDir: join(baseDir, 'skills') } }

    const detected = await detectIDEs(configs)
    expect(detected).toEqual(['TestIDE'])

    for (const ide of detected) {
      const path = await installSkill(ide, '# mdProbe Skill', configs)
      const content = await readFile(path, 'utf-8')
      expect(content).toBe('# mdProbe Skill')
    }
  })

  it('skips install when IDE base dir is absent (correct negative)', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-e2e2-'))
    const configs = { 'Ghost': { detectDir: join(tmp, '.ghost'), skillsDir: join(tmp, '.ghost', 'skills') } }

    const detected = await detectIDEs(configs)
    expect(detected).toEqual([])
    // No installSkill calls — correct behavior
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

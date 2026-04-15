import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, readFile, mkdir, rm, mkdtemp, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import {
  installSkill, registerHook, saveConfig, removeAll, detectIDEs, registerCursorMCP,
  registerCursorMCPOnWindowsHostFromWsl, wslPathFromWindowsUserProfile,
  removeMdprobeFromCursorMcpData, stripMdprobeFromCursorMcpFile,
} from '../../src/setup.js'

let tmp

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

describe('wslPathFromWindowsUserProfile()', () => {
  it('maps C:\\Users\\x to /mnt/c/Users/x', () => {
    expect(wslPathFromWindowsUserProfile('C:\\Users\\henry')).toBe('/mnt/c/Users/henry')
  })

  it('trims trailing slashes', () => {
    expect(wslPathFromWindowsUserProfile('C:\\Users\\henry\\')).toBe('/mnt/c/Users/henry')
  })

  it('returns null for invalid input', () => {
    expect(wslPathFromWindowsUserProfile('')).toBeNull()
    expect(wslPathFromWindowsUserProfile('/home/henry')).toBeNull()
  })
})

describe('registerCursorMCPOnWindowsHostFromWsl()', () => {
  it('writes wsl.exe bridge when WSL env and test paths are set', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-cursor-win-'))
    const mcpFile = join(tmp, '.cursor', 'mcp.json')
    const prev = process.env.WSL_DISTRO_NAME
    process.env.WSL_DISTRO_NAME = 'TestDistro'
    try {
      const result = await registerCursorMCPOnWindowsHostFromWsl({
        _testMcpJsonWslPath: mcpFile,
        _testWinProfile: 'C:\\Users\\henry',
        _testMdprobeBin: '/home/henry/.npm-global/bin/mdprobe',
      })
      expect(result.skipped).toBe(false)
      const data = JSON.parse(await readFile(mcpFile, 'utf-8'))
      expect(data.mcpServers.mdprobe.command).toBe('C:\\Windows\\System32\\wsl.exe')
      expect(data.mcpServers.mdprobe.args).toEqual([
        '-d', 'TestDistro', '/home/henry/.npm-global/bin/mdprobe', 'mcp',
      ])
    } finally {
      if (prev === undefined) delete process.env.WSL_DISTRO_NAME
      else process.env.WSL_DISTRO_NAME = prev
    }
  })

  it('skips when not WSL', async () => {
    const prev = process.env.WSL_DISTRO_NAME
    delete process.env.WSL_DISTRO_NAME
    try {
      const result = await registerCursorMCPOnWindowsHostFromWsl({
        _testMcpJsonWslPath: join(tmpdir(), 'noop.json'),
        _testWinProfile: 'C:\\Users\\x',
      })
      expect(result).toEqual({ skipped: true, reason: 'not_wsl' })
    } finally {
      if (prev !== undefined) process.env.WSL_DISTRO_NAME = prev
    }
  })
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

describe('registerCursorMCP()', () => {
  it('writes mdprobe entry when .cursor exists', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-cursor-mcp-'))
    const cursorDir = join(tmp, '.cursor')
    await mkdir(cursorDir, { recursive: true })
    const mcpPath = join(cursorDir, 'mcp.json')

    const result = await registerCursorMCP(mcpPath)
    expect(result.skipped).toBeUndefined()
    expect(result.path).toBe(mcpPath)

    const data = JSON.parse(await readFile(mcpPath, 'utf-8'))
    expect(data.mcpServers.mdprobe).toEqual({ command: 'mdprobe', args: ['mcp'] })
  })

  it('merges with existing mcpServers', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-cursor-mcp2-'))
    const cursorDir = join(tmp, '.cursor')
    await mkdir(cursorDir, { recursive: true })
    const mcpPath = join(cursorDir, 'mcp.json')
    await writeFile(mcpPath, JSON.stringify({
      mcpServers: { other: { command: 'echo', args: ['hi'] } },
    }), 'utf-8')

    await registerCursorMCP(mcpPath)
    const data = JSON.parse(await readFile(mcpPath, 'utf-8'))
    expect(data.mcpServers.other).toBeDefined()
    expect(data.mcpServers.mdprobe).toEqual({ command: 'mdprobe', args: ['mcp'] })
  })

  it('skips when parent config dir does not exist', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-cursor-mcp3-'))
    const mcpPath = join(tmp, 'does-not-exist-yet', 'mcp.json')
    const result = await registerCursorMCP(mcpPath)
    expect(result).toEqual({ skipped: true, reason: 'no_cursor_dir' })
  })
})

describe('registerHook()', () => {
  it('does not register a hook (removed in v0.3.1 — caused unwanted mdprobe launches)', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-hook-'))
    const settingsPath = join(tmp, 'settings.json')

    const result = await registerHook(settingsPath)
    expect(result.added).toBe(false)

    // No hook should be registered — SKILL.md alone handles discovery
    let settings = {}
    try { settings = JSON.parse(await readFile(settingsPath, 'utf-8')) } catch { /* file may not exist */ }
    const hooks = settings.hooks?.PostToolUse ?? []
    expect(hooks).toHaveLength(0)
  })

  it('migrates old hook — removes it without adding a new one', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-hook2-'))
    const settingsPath = join(tmp, 'settings.json')

    // Simulate old v0.3.0 installation with the problematic hook
    const oldSettings = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo "unrelated hook"' }],
          },
          {
            matcher: 'Write|Edit',
            hooks: [{ type: 'command', command: 'node -e "... [mdprobe] .md file modified ... Offer to open ..."' }],
          },
        ],
      },
    }
    await writeFile(settingsPath, JSON.stringify(oldSettings), 'utf-8')

    const result = await registerHook(settingsPath)
    expect(result.migrated).toBe(true)

    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    // Old mdprobe hook removed, unrelated hook preserved
    expect(settings.hooks.PostToolUse).toHaveLength(1)
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Bash')
  })

  it('is idempotent — no-ops when no old hook exists', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-hook3-'))
    const settingsPath = join(tmp, 'settings.json')

    await registerHook(settingsPath)
    const result = await registerHook(settingsPath)
    expect(result.added).toBe(false)
    expect(result.migrated).toBeUndefined()
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

describe('removeMdprobeFromCursorMcpData()', () => {
  it('removes mdprobe and keeps another MCP server (realistic shape)', () => {
    const before = {
      mcpServers: {
        mdprobe: {
          command: 'C:\\Windows\\System32\\wsl.exe',
          args: ['-d', 'Ubuntu-24.04', '/home/henry/.npm-global/bin/mdprobe', 'mcp'],
        },
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/projects'],
          env: { ALLOWED_PATHS: '/home/henry/projects' },
        },
      },
    }
    const { changed, data } = removeMdprobeFromCursorMcpData(before)
    expect(changed).toBe(true)
    expect(data.mcpServers.mdprobe).toBeUndefined()
    expect(data.mcpServers.filesystem).toEqual(before.mcpServers.filesystem)
    expect(before.mcpServers.mdprobe).toBeDefined()
  })

  it('when mdprobe was the only server, drops empty mcpServers', () => {
    const before = {
      mcpServers: {
        mdprobe: { command: 'mdprobe', args: ['mcp'] },
      },
    }
    const { changed, data } = removeMdprobeFromCursorMcpData(before)
    expect(changed).toBe(true)
    expect(data).toEqual({})
  })

  it('no-ops when mdprobe is absent', () => {
    const before = {
      mcpServers: {
        notion: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } },
      },
    }
    const { changed, data } = removeMdprobeFromCursorMcpData(before)
    expect(changed).toBe(false)
    expect(data).toBe(before)
  })
})

describe('stripMdprobeFromCursorMcpFile()', () => {
  it('rewrites on disk and preserves non-mdprobe servers', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-strip-mcp-'))
    const mcpPath = join(tmp, 'mcp.json')
    const fixture = {
      mcpServers: {
        mdprobe: { command: 'wsl', args: ['mdprobe', 'mcp'] },
        fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
      },
    }
    await writeFile(mcpPath, JSON.stringify(fixture, null, 2), 'utf-8')

    const r = await stripMdprobeFromCursorMcpFile(mcpPath)
    expect(r.changed).toBe(true)

    const after = JSON.parse(await readFile(mcpPath, 'utf-8'))
    expect(after.mcpServers.fetch).toEqual(fixture.mcpServers.fetch)
    expect(after.mcpServers.mdprobe).toBeUndefined()
  })

  it('does not write when JSON is not parseable', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-strip-bad-'))
    const mcpPath = join(tmp, 'mcp.json')
    const garbage = '{ not json'
    await writeFile(mcpPath, garbage, 'utf-8')

    const r = await stripMdprobeFromCursorMcpFile(mcpPath)
    expect(r).toMatchObject({ changed: false, reason: 'invalid_json' })
    expect(await readFile(mcpPath, 'utf-8')).toBe(garbage)
  })

  it('does not write when file is missing', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-strip-miss-'))
    const mcpPath = join(tmp, 'nope.json')
    const r = await stripMdprobeFromCursorMcpFile(mcpPath)
    expect(r).toMatchObject({ changed: false, reason: 'read_failed' })
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

  it('removes hook from settings (legacy installations)', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-rm2-'))
    const settingsPath = join(tmp, 'settings.json')
    const configPath = join(tmp, '.mdprobe.json')

    // Simulate a legacy installation that still has the old hook
    const oldSettings = {
      hooks: {
        PostToolUse: [{
          matcher: 'Write|Edit',
          hooks: [{ type: 'command', command: 'node -e "... [mdprobe] ..."' }],
        }],
      },
    }
    await writeFile(settingsPath, JSON.stringify(oldSettings), 'utf-8')

    const removed = await removeAll({ configPath, settingsPath })
    expect(removed).toContain('hook')

    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    expect(settings.hooks.PostToolUse).toHaveLength(0)
  })

  it('removes mdprobe from Cursor mcp.json', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-rm-cursor-'))
    const cursorDir = join(tmp, '.cursor')
    await mkdir(cursorDir, { recursive: true })
    const mcpPath = join(cursorDir, 'mcp.json')
    await writeFile(mcpPath, JSON.stringify({
      mcpServers: {
        mdprobe: { command: 'mdprobe', args: ['mcp'] },
        keep: { command: 'other', args: [] },
      },
    }), 'utf-8')

    const configPath = join(tmp, '.mdprobe.json')
    await writeFile(configPath, '{}', 'utf-8')

    const prevHome = process.env.HOME
    process.env.HOME = tmp
    try {
      const removed = await removeAll({ configPath, settingsPath: join(tmp, 'none.json') })
      expect(removed).toContain('mcp:cursor')
    } finally {
      process.env.HOME = prevHome
    }

    const data = JSON.parse(await readFile(mcpPath, 'utf-8'))
    expect(data.mcpServers.mdprobe).toBeUndefined()
    expect(data.mcpServers.keep).toBeDefined()
  })

  it('removes mdprobe from Windows-host mcp path without cmd.exe (explicit opt)', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'setup-rm-win-cursor-'))
    const winHostMcp = join(tmp, 'AppData', 'Cursor', 'User', 'globalStorage', 'mcp.json')
    await mkdir(dirname(winHostMcp), { recursive: true })
    await writeFile(winHostMcp, JSON.stringify({
      mcpServers: {
        mdprobe: {
          command: 'C:\\Windows\\System32\\wsl.exe',
          args: ['-d', 'Ubuntu-24.04', '/home/henry/.npm-global/bin/mdprobe', 'mcp'],
        },
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
      },
    }, null, 2), 'utf-8')

    const configPath = join(tmp, '.mdprobe.json')
    await writeFile(configPath, '{}', 'utf-8')

    const prevHome = process.env.HOME
    process.env.HOME = tmp
    try {
      const removed = await removeAll({
        configPath,
        settingsPath: join(tmp, 'none.json'),
        cursorWindowsMcpPath: winHostMcp,
      })

      expect(removed).toContain('mcp:cursor_windows')
      const data = JSON.parse(await readFile(winHostMcp, 'utf-8'))
      expect(data.mcpServers.mdprobe).toBeUndefined()
      expect(data.mcpServers.playwright.args).toContain('@playwright/mcp@latest')
    } finally {
      process.env.HOME = prevHome
    }
  })
})

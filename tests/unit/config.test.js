import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFile, readFile, mkdir, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getConfig, setConfig, getAuthor } from '../../src/config.js'

describe('config', () => {
  let tmpDir
  let configPath

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `mdprobe-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tmpDir, { recursive: true })
    configPath = join(tmpDir, '.mdprobe.json')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('getConfig', () => {
    it('returns empty object when config file does not exist', async () => {
      const config = await getConfig(configPath)
      expect(config).toEqual({})
    })

    it('returns parsed config from existing file', async () => {
      const data = { author: 'Henry', theme: 'dark' }
      await writeFile(configPath, JSON.stringify(data), 'utf8')

      const config = await getConfig(configPath)
      expect(config).toEqual(data)
    })

    it('returns all keys stored in config', async () => {
      const data = { author: 'Alice', port: 4000, theme: 'mocha' }
      await writeFile(configPath, JSON.stringify(data), 'utf8')

      const config = await getConfig(configPath)
      expect(config.author).toBe('Alice')
      expect(config.port).toBe(4000)
      expect(config.theme).toBe('mocha')
    })

    it('throws with helpful message on malformed JSON', async () => {
      await writeFile(configPath, '{ invalid json !!!', 'utf8')

      await expect(getConfig(configPath)).rejects.toThrow(/JSON|parse|malformed|invalid/i)
    })

    it('handles config with only whitespace as malformed', async () => {
      await writeFile(configPath, '   ', 'utf8')

      // Whitespace-only is not valid JSON — should throw or return {}
      const result = getConfig(configPath)
      await expect(result).rejects.toThrow()
    })

    it('reads config with nested objects', async () => {
      const data = { author: 'Bob', ui: { sidebar: true, theme: 'latte' } }
      await writeFile(configPath, JSON.stringify(data), 'utf8')

      const config = await getConfig(configPath)
      expect(config.ui.sidebar).toBe(true)
      expect(config.ui.theme).toBe('latte')
    })
  })

  describe('setConfig', () => {
    it('TC-RF04-1: creates config file with key-value when file does not exist', async () => {
      await setConfig('author', 'Henry', configPath)

      const raw = await readFile(configPath, 'utf8')
      const config = JSON.parse(raw)
      expect(config.author).toBe('Henry')
    })

    it('updates existing key in config file', async () => {
      await writeFile(configPath, JSON.stringify({ author: 'Old Name' }), 'utf8')

      await setConfig('author', 'New Name', configPath)

      const raw = await readFile(configPath, 'utf8')
      const config = JSON.parse(raw)
      expect(config.author).toBe('New Name')
    })

    it('preserves existing keys when adding a new key', async () => {
      await writeFile(configPath, JSON.stringify({ author: 'Henry', theme: 'dark' }), 'utf8')

      await setConfig('port', 4000, configPath)

      const raw = await readFile(configPath, 'utf8')
      const config = JSON.parse(raw)
      expect(config.author).toBe('Henry')
      expect(config.theme).toBe('dark')
      expect(config.port).toBe(4000)
    })

    it('creates parent directory if it does not exist', async () => {
      const nestedPath = join(tmpDir, 'deep', 'nested', '.mdprobe.json')

      await setConfig('author', 'Henry', nestedPath)

      const raw = await readFile(nestedPath, 'utf8')
      const config = JSON.parse(raw)
      expect(config.author).toBe('Henry')
    })

    it('writes valid JSON to file', async () => {
      await setConfig('key', 'value', configPath)

      const raw = await readFile(configPath, 'utf8')
      expect(() => JSON.parse(raw)).not.toThrow()
    })

    it('multiple setConfig calls do not corrupt file', async () => {
      await setConfig('author', 'Henry', configPath)
      await setConfig('theme', 'macchiato', configPath)
      await setConfig('port', 3000, configPath)
      await setConfig('author', 'Henry Avila', configPath)

      const raw = await readFile(configPath, 'utf8')
      const config = JSON.parse(raw)
      expect(config.author).toBe('Henry Avila')
      expect(config.theme).toBe('macchiato')
      expect(config.port).toBe(3000)
    })

    it('handles special characters in values', async () => {
      await setConfig('author', 'José María García', configPath)

      const raw = await readFile(configPath, 'utf8')
      const config = JSON.parse(raw)
      expect(config.author).toBe('José María García')
    })

    it('handles empty string value', async () => {
      await setConfig('author', '', configPath)

      const raw = await readFile(configPath, 'utf8')
      const config = JSON.parse(raw)
      expect(config.author).toBe('')
    })
  })

  describe('getAuthor', () => {
    it('TC-RF04-2: returns configured author name', async () => {
      await writeFile(configPath, JSON.stringify({ author: 'Henry' }), 'utf8')

      const author = await getAuthor(configPath)
      expect(author).toBe('Henry')
    })

    it('TC-RF04-4: returns "anonymous" when config file does not exist', async () => {
      const author = await getAuthor(configPath)
      expect(author).toBe('anonymous')
    })

    it('returns "anonymous" when config exists but author key is missing', async () => {
      await writeFile(configPath, JSON.stringify({ theme: 'dark' }), 'utf8')

      const author = await getAuthor(configPath)
      expect(author).toBe('anonymous')
    })

    it('returns "anonymous" when author is empty string', async () => {
      await writeFile(configPath, JSON.stringify({ author: '' }), 'utf8')

      const author = await getAuthor(configPath)
      expect(author).toBe('anonymous')
    })

    it('returns "anonymous" when author is null', async () => {
      await writeFile(configPath, JSON.stringify({ author: null }), 'utf8')

      const author = await getAuthor(configPath)
      expect(author).toBe('anonymous')
    })

    it('returns author after setConfig', async () => {
      await setConfig('author', 'Maria', configPath)

      const author = await getAuthor(configPath)
      expect(author).toBe('Maria')
    })

    it('returns trimmed author name', async () => {
      await writeFile(configPath, JSON.stringify({ author: '  Henry  ' }), 'utf8')

      const author = await getAuthor(configPath)
      // Author should be trimmed — leading/trailing whitespace is unintentional
      expect(author).toBe('Henry')
    })

    it('returns full name with spaces intact', async () => {
      await writeFile(configPath, JSON.stringify({ author: 'Henry Avila' }), 'utf8')

      const author = await getAuthor(configPath)
      expect(author).toBe('Henry Avila')
    })
  })
})

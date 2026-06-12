import { describe, it, expect, vi } from 'vitest'

import {
  buildRemoteUrl,
  normalizeExposeConfig,
  reconcileExposure,
  unexposeProvider,
} from '../../src/expose/index.js'

describe('remote access provider reconciler', () => {
  it('builds per-file remote deep links from a base URL', () => {
    expect(buildRemoteUrl('https://mdprobe.example.com/', 'spec.md')).toBe('https://mdprobe.example.com/spec.md')
    expect(buildRemoteUrl('https://mdprobe.example.com:8443', 'docs/spec.md')).toBe('https://mdprobe.example.com:8443/spec.md')
  })

  it('keeps off as local-only metadata', async () => {
    const result = await reconcileExposure({
      config: { expose: 'off' },
      actualPort: 3000,
      files: ['spec.md'],
    })

    expect(result).toMatchObject({ expose: 'off', warnings: [] })
    expect(result.remoteBaseUrl).toBeUndefined()
    expect(result.remoteUrl).toBeUndefined()
  })

  it('requires and normalizes https remoteBaseUrl for external provider', async () => {
    const result = await reconcileExposure({
      config: { expose: 'external', remoteBaseUrl: 'https://mdprobe.example.com/' },
      actualPort: 3000,
      files: ['/tmp/spec.md'],
    })

    expect(result).toMatchObject({
      expose: 'external',
      remoteBaseUrl: 'https://mdprobe.example.com',
      remoteUrl: 'https://mdprobe.example.com/spec.md',
      warnings: [],
    })
  })

  it('rejects planned providers until handlers exist', () => {
    expect(() => normalizeExposeConfig({ expose: 'ngrok' })).toThrow(/planned provider/i)
    expect(() => normalizeExposeConfig({ expose: 'cloudflare' })).toThrow(/planned provider/i)
  })

  it('runs tailscale status and serve with controlled arguments', async () => {
    const calls = []
    const execFile = vi.fn(async (cmd, args) => {
      calls.push([cmd, args])
      if (args[0] === 'status') {
        return {
          stdout: JSON.stringify({
            BackendState: 'Running',
            Self: { DNSName: 'device.example.ts.net.' },
          }),
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await reconcileExposure({
      config: { expose: 'tailscale', exposePort: 8443 },
      actualPort: 3000,
      files: ['spec.md'],
      execFile,
    })

    expect(calls).toEqual([
      ['tailscale', ['status', '--json']],
      ['tailscale', ['serve', '--bg', '--https=8443', '3000']],
    ])
    expect(result).toMatchObject({
      expose: 'tailscale',
      remoteBaseUrl: 'https://device.example.ts.net:8443',
      remoteUrl: 'https://device.example.ts.net:8443/spec.md',
      warnings: [],
    })
  })

  it('falls back local-only when tailscale is not running', async () => {
    const execFile = vi.fn(async () => ({
      stdout: JSON.stringify({ BackendState: 'NeedsLogin', Self: {} }),
      stderr: '',
    }))

    const result = await reconcileExposure({
      config: { expose: 'tailscale', exposePort: 8443 },
      actualPort: 3000,
      files: ['spec.md'],
      execFile,
    })

    expect(result.remoteBaseUrl).toBeUndefined()
    expect(result.warnings.join('\n')).toMatch(/tailscale.*NeedsLogin/i)
  })

  it('rejects exposePort values with non-numeric suffixes', () => {
    expect(() => normalizeExposeConfig({ exposePort: '8443abc' })).toThrow(/1024-65535/)
  })

  it('does not advertise LAN remote URL when attaching to a localhost-bound server', async () => {
    const result = await reconcileExposure({
      config: { expose: 'lan', bindHost: '192.168.1.50' },
      actualPort: 3000,
      files: ['spec.md'],
      lock: { bindHost: '127.0.0.1' },
    })

    expect(result.remoteBaseUrl).toBeUndefined()
    expect(result.remoteUrl).toBeUndefined()
    expect(result.bindHost).toBe('127.0.0.1')
    expect(result.warnings.join('\n')).toMatch(/Restart mdprobe.*LAN exposure/i)
  })

  it('derives LAN remote URL from the primary LAN address for 0.0.0.0 bind', async () => {
    const result = await reconcileExposure({
      config: { expose: 'lan', bindHost: '0.0.0.0' },
      actualPort: 3000,
      files: ['spec.md'],
      networkInterfaces: () => ({
        lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.50' }],
      }),
    })

    expect(result).toMatchObject({
      expose: 'lan',
      bindHost: '0.0.0.0',
      remoteBaseUrl: 'http://192.168.1.50:3000',
      remoteUrl: 'http://192.168.1.50:3000/spec.md',
    })
    expect(result.warnings.join('\n')).toMatch(/HTTP.*unauthenticated/i)
  })

  it('turns off persisted tailscale serve mapping with lock exposePort', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }))

    const result = await unexposeProvider({
      lock: { expose: 'tailscale', exposePort: 8443 },
      execFile,
    })

    expect(execFile).toHaveBeenCalledWith('tailscale', ['serve', '--https=8443', 'off'])
    expect(result).toEqual({ unexposed: true, warnings: [] })
  })
})

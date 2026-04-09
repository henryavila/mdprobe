import { describe, it, expect } from 'vitest'

/**
 * Tests the deep-link file matching logic used in app.jsx.
 * Extracted here as pure functions to avoid needing a DOM environment.
 */

function findDeepLinkMatch(data, pathname) {
  if (!pathname || pathname === '/') return null
  const cleaned = pathname.replace(/^\//, '')
  return data.find(f => {
    const fp = f.path || f
    return fp === cleaned ||
      fp === cleaned.split('/').pop() ||
      (f.absPath && f.absPath.endsWith('/' + cleaned))
  }) || null
}

describe('deep-link file matching', () => {
  const files = [
    { path: 'spec.md', absPath: '/home/user/docs/spec.md' },
    { path: 'readme.md', absPath: '/home/user/readme.md' },
    { path: 'design.md', absPath: '/home/user/docs/v2/design.md' },
  ]

  it('matches basename from pathname', () => {
    const match = findDeepLinkMatch(files, '/spec.md')
    expect(match.path).toBe('spec.md')
  })

  it('matches nested path via basename fallback', () => {
    const match = findDeepLinkMatch(files, '/docs/spec.md')
    expect(match.path).toBe('spec.md')
  })

  it('matches via absPath suffix', () => {
    const match = findDeepLinkMatch(files, '/docs/v2/design.md')
    expect(match.path).toBe('design.md')
  })

  it('returns null for root path', () => {
    expect(findDeepLinkMatch(files, '/')).toBeNull()
  })

  it('returns null for empty pathname', () => {
    expect(findDeepLinkMatch(files, '')).toBeNull()
  })

  it('returns null for no match', () => {
    expect(findDeepLinkMatch(files, '/nonexistent.md')).toBeNull()
  })

  it('handles files without absPath', () => {
    const simple = [{ path: 'a.md' }, { path: 'b.md' }]
    const match = findDeepLinkMatch(simple, '/b.md')
    expect(match.path).toBe('b.md')
  })
})

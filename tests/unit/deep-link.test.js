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
      (f.label && f.label === cleaned) ||
      (f.label && f.label === cleaned.split('/').pop()) ||
      (f.absPath && f.absPath.endsWith('/' + cleaned))
  }) || null
}

describe('deep-link file matching', () => {
  const files = [
    { path: 'spec.md', absPath: '/home/user/docs/spec.md', label: 'spec' },
    { path: 'readme.md', absPath: '/home/user/readme.md', label: 'readme' },
    { path: 'design.md', absPath: '/home/user/docs/v2/design.md', label: 'design' },
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

  it('matches pathname without .md extension via label', () => {
    const match = findDeepLinkMatch(files, '/spec')
    expect(match.path).toBe('spec.md')
  })

  it('matches long basename without .md extension', () => {
    const data = [
      { path: 'revisao-pendencias-consolidada.md', absPath: '/tmp/revisao-pendencias-consolidada.md', label: 'revisao-pendencias-consolidada' },
    ]
    const match = findDeepLinkMatch(data, '/revisao-pendencias-consolidada')
    expect(match.path).toBe('revisao-pendencias-consolidada.md')
  })
})

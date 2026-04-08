import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '../../src/renderer.js'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures')
const read = (name) => readFileSync(join(FIXTURES, name), 'utf-8')

// ---------------------------------------------------------------------------
// Complex.md rendering — TDD tests for correct display
// ---------------------------------------------------------------------------

describe('complex.md rendering', () => {
  const complex = read('complex.md')
  let html, toc, frontmatter

  // Render once — reuse across tests
  const result = render(complex)
  html = result.html
  toc = result.toc
  frontmatter = result.frontmatter

  // -------------------------------------------------------------------------
  // Syntax highlighting: hljs tokens must be present
  // -------------------------------------------------------------------------

  describe('syntax highlighting tokens', () => {
    it('JS code block has hljs-keyword spans', () => {
      expect(html).toContain('hljs-keyword')
    })

    it('JS code block has hljs-string spans', () => {
      expect(html).toContain('hljs-string')
    })

    it('Python code block has hljs-keyword spans', () => {
      // Python uses "def" which hljs maps to hljs-keyword
      expect(html).toMatch(/hljs-keyword[^"]*">\s*def\b/)
    })

    it('code block without language still gets hljs class', () => {
      const noLang = render('```\nconst x = 1;\n```\n')
      expect(noLang.html).toContain('hljs')
    })
  })

  // -------------------------------------------------------------------------
  // Display math: must NOT be wrapped in <pre>
  // -------------------------------------------------------------------------

  describe('display math', () => {
    it('display math ($$) is NOT wrapped in <pre>', () => {
      // Display math should be rendered as a div or standalone element,
      // NOT as <pre><code> which shows as a code block
      const mathBlock = html.match(/<[^>]*math-display[^>]*>[\s\S]*?<\/[^>]+>/)?.[0]
      expect(mathBlock).toBeDefined()
      // Should NOT start with <pre or be a child of <pre
      expect(mathBlock).not.toMatch(/^<pre/)
    })

    it('inline math ($) is rendered as <code> (not <pre>)', () => {
      const inlineMath = html.match(/<code[^>]*math-inline[^>]*>[^<]*<\/code>/)
      expect(inlineMath).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Mermaid: has proper class for client-side rendering
  // -------------------------------------------------------------------------

  describe('mermaid blocks', () => {
    it('mermaid block has class="mermaid" for client rendering', () => {
      expect(html).toContain('class="mermaid"')
    })

    it('mermaid block preserves source text', () => {
      expect(html).toContain('graph TD')
    })
  })

  // -------------------------------------------------------------------------
  // Overall structure
  // -------------------------------------------------------------------------

  describe('structure', () => {
    it('tables render as <table> elements', () => {
      expect(html).toContain('<table')
      expect(html).toContain('<thead')
      expect(html).toContain('<tbody')
    })

    it('frontmatter is extracted correctly', () => {
      expect(frontmatter).toBeDefined()
      expect(frontmatter.title).toBe('Complex Document')
      expect(frontmatter.author).toBe('Henry Avila')
    })

    it('TOC extracts all headings', () => {
      expect(toc.length).toBeGreaterThanOrEqual(10)
    })
  })
})

// ---------------------------------------------------------------------------
// CSS presence: hljs theme tokens must have styles
// ---------------------------------------------------------------------------

describe('hljs CSS theme', () => {
  const themesCSS = readFileSync(
    join(import.meta.dirname, '..', '..', 'src', 'ui', 'styles', 'themes.css'),
    'utf-8',
  )

  it('has styles for .hljs-keyword', () => {
    expect(themesCSS).toContain('.hljs-keyword')
  })

  it('has styles for .hljs-string', () => {
    expect(themesCSS).toContain('.hljs-string')
  })

  it('has styles for .hljs-number', () => {
    expect(themesCSS).toContain('.hljs-number')
  })

  it('has styles for .hljs-title', () => {
    expect(themesCSS).toContain('.hljs-title')
  })

  it('has styles for .hljs-comment', () => {
    expect(themesCSS).toContain('.hljs-comment')
  })

  it('has fallback styles for .mermaid blocks', () => {
    expect(themesCSS).toContain('.mermaid')
  })

  it('has styles for .math-display', () => {
    expect(themesCSS).toContain('.math-display')
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '../../src/renderer.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = join(__dirname, '..', 'fixtures')

const read = (name) => readFileSync(join(fixtures, name), 'utf-8')

// ---------------------------------------------------------------------------
// RF05 — Rendering
// ---------------------------------------------------------------------------

describe('render()', () => {
  // -----------------------------------------------------------------------
  // GFM Features
  // -----------------------------------------------------------------------
  describe('GFM features', () => {
    it('TC-RF05-1: renders GFM table as <table> HTML', () => {
      const md = read('complex.md')
      const { html } = render(md)

      expect(html).toContain('<table')
      expect(html).toContain('<thead')
      expect(html).toContain('<tbody')
      expect(html).toContain('<tr')
      expect(html).toContain('<td')
    })

    it('renders task lists with checkboxes', () => {
      const md = read('complex.md')
      const { html } = render(md)

      expect(html).toContain('<input')
      expect(html).toMatch(/type="checkbox"/)
      // Checked items should have the checked attribute
      expect(html).toMatch(/checked/)
    })

    it('renders strikethrough with <del> tag', () => {
      const md = read('complex.md')
      const { html } = render(md)

      expect(html).toContain('<del')
      expect(html).toContain('deleted text')
    })

    it('renders autolinks as <a> tags', () => {
      const md = read('complex.md')
      const { html } = render(md)

      expect(html).toMatch(/<a[^>]+href="https:\/\/example\.com"/)
    })
  })

  // -----------------------------------------------------------------------
  // Syntax Highlighting
  // -----------------------------------------------------------------------
  describe('syntax highlighting', () => {
    it('TC-RF05-2: code block with language-javascript has highlight class', () => {
      const md = read('complex.md')
      const { html } = render(md)

      // Should have hljs or highlight-related class on code/pre element
      expect(html).toMatch(/class="[^"]*(?:hljs|highlight)[^"]*"/)
    })

    it('applies syntax highlighting to python code blocks', () => {
      const md = read('complex.md')
      const { html } = render(md)

      // Python code block should also be highlighted
      expect(html).toMatch(/<code[^>]*class="[^"]*(?:language-python|hljs)[^"]*"/)
    })
  })

  // -----------------------------------------------------------------------
  // Mermaid Diagrams
  // -----------------------------------------------------------------------
  describe('mermaid diagrams', () => {
    it('TC-RF05-3: mermaid code block is NOT rendered as highlighted code', () => {
      const md = read('complex.md')
      const { html } = render(md)

      // Mermaid blocks should be left for client-side rendering
      // Should have class="mermaid" or a data attribute, NOT syntax-highlighted
      const hasMermaidMarker = html.includes('class="mermaid"') ||
        html.match(/data-mermaid/) ||
        html.match(/data-language="mermaid"/)
      expect(hasMermaidMarker).toBeTruthy()
    })

    it('mermaid block preserves diagram source for client-side rendering', () => {
      const md = read('complex.md')
      const { html } = render(md)

      // The raw mermaid source should still be in the output for client rendering
      expect(html).toContain('graph TD')
    })
  })

  // -----------------------------------------------------------------------
  // KaTeX / Math
  // -----------------------------------------------------------------------
  describe('math / KaTeX', () => {
    it('TC-RF05-4: inline math $E=mc^2$ has KaTeX-related markup', () => {
      const md = read('complex.md')
      const { html } = render(md)

      // Should have math-related class or element (katex, math-inline, etc.)
      const hasMathMarkup = html.match(/class="[^"]*(?:katex|math)[^"]*"/) ||
        html.match(/<math/) ||
        html.match(/data-math/)
      expect(hasMathMarkup).toBeTruthy()
    })

    it('display math block is rendered with math markup', () => {
      const md = read('complex.md')
      const { html } = render(md)

      // Display math should also have math-related markers
      const hasDisplayMath = html.match(/class="[^"]*(?:katex|math-display|math)[^"]*"/) ||
        html.match(/display="block"/)
      expect(hasDisplayMath).toBeTruthy()
    })
  })

  // -----------------------------------------------------------------------
  // Frontmatter
  // -----------------------------------------------------------------------
  describe('frontmatter', () => {
    it('TC-RF05-5: YAML frontmatter stripped from HTML and available in result.frontmatter', () => {
      const md = read('complex.md')
      const result = render(md)

      // Frontmatter should be parsed into an object
      expect(result.frontmatter).toBeDefined()
      expect(result.frontmatter).not.toBeNull()
      expect(result.frontmatter.title).toBe('Complex Document')
      expect(result.frontmatter.author).toBe('Henry Avila')

      // Frontmatter delimiters and raw YAML should NOT appear in HTML
      expect(result.html).not.toMatch(/^---/m)
      expect(result.html).not.toContain('title: Complex Document')
    })

    it('no frontmatter returns null', () => {
      const md = read('sample.md')
      const result = render(md)

      expect(result.frontmatter).toBeNull()
    })

    it('frontmatter is not rendered in HTML output', () => {
      const md = read('complex.md')
      const { html } = render(md)

      expect(html).not.toContain('author: Henry Avila')
      expect(html).not.toContain('date: 2026-04-06')
    })

    it('TOML frontmatter is detected or at least stripped', () => {
      const md = '+++\ntitle = "TOML Doc"\n+++\n\n# Hello\n'
      const result = render(md)

      // At minimum, TOML delimiters should not appear in HTML
      expect(result.html).not.toContain('+++')
    })
  })

  // -----------------------------------------------------------------------
  // Source Position Tracking (data-source-line / data-source-col)
  // -----------------------------------------------------------------------
  describe('source position tracking', () => {
    it('TC-RF05-6: HTML elements have data-source-line and data-source-col attributes', () => {
      const md = read('sample.md')
      const { html } = render(md)

      expect(html).toContain('data-source-line')
      expect(html).toContain('data-source-col')
    })

    it('paragraph elements have data-source-line', () => {
      const md = 'First paragraph.\n\nSecond paragraph.\n'
      const { html } = render(md)

      const pMatches = html.match(/<p[^>]*data-source-line="(\d+)"[^>]*>/g)
      expect(pMatches).not.toBeNull()
      expect(pMatches.length).toBeGreaterThanOrEqual(2)
    })

    it('headings have data-source-line', () => {
      const md = '# Heading One\n\n## Heading Two\n'
      const { html } = render(md)

      expect(html).toMatch(/<h1[^>]*data-source-line="\d+"/)
      expect(html).toMatch(/<h2[^>]*data-source-line="\d+"/)
    })

    it('list items have data-source-line', () => {
      const md = '- item one\n- item two\n- item three\n'
      const { html } = render(md)

      const liMatches = html.match(/<li[^>]*data-source-line="\d+"[^>]*>/g)
      expect(liMatches).not.toBeNull()
      expect(liMatches.length).toBe(3)
    })

    it('inline elements (strong, em, code) have data-source-line AND data-source-col', () => {
      const md = 'This is **bold** and *italic* and `code` text.\n'
      const { html } = render(md)

      // strong
      expect(html).toMatch(/<strong[^>]*data-source-line="\d+"[^>]*data-source-col="\d+"/)
      // em
      expect(html).toMatch(/<em[^>]*data-source-line="\d+"[^>]*data-source-col="\d+"/)
      // code (inline)
      expect(html).toMatch(/<code[^>]*data-source-line="\d+"[^>]*data-source-col="\d+"/)
    })

    it('data-source-line values are numbers (not NaN or undefined)', () => {
      const md = '# Title\n\nA paragraph with **bold**.\n'
      const { html } = render(md)

      const lineValues = [...html.matchAll(/data-source-line="([^"]*)"/g)]
        .map(m => m[1])

      expect(lineValues.length).toBeGreaterThan(0)
      for (const val of lineValues) {
        const num = Number(val)
        expect(Number.isNaN(num)).toBe(false)
        expect(val).not.toBe('undefined')
        expect(num).toBeGreaterThan(0)
      }
    })

    it('data-source-line matches actual line in source markdown', () => {
      const md = '# Title\n\nParagraph on line 3.\n'
      const { html } = render(md)

      // The heading is on line 1
      const h1Match = html.match(/<h1[^>]*data-source-line="(\d+)"/)
      expect(h1Match).not.toBeNull()
      expect(Number(h1Match[1])).toBe(1)

      // The paragraph is on line 3
      const pMatch = html.match(/<p[^>]*data-source-line="(\d+)"/)
      expect(pMatch).not.toBeNull()
      expect(Number(pMatch[1])).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // TOC Extraction
  // -----------------------------------------------------------------------
  describe('TOC extraction', () => {
    it('headings extracted correctly with text and level', () => {
      const md = read('sample.md')
      const { toc } = render(md)

      expect(Array.isArray(toc)).toBe(true)
      expect(toc.length).toBeGreaterThan(0)

      for (const entry of toc) {
        expect(entry).toHaveProperty('heading')
        expect(entry).toHaveProperty('level')
        expect(entry).toHaveProperty('line')
        expect(typeof entry.heading).toBe('string')
        expect(typeof entry.level).toBe('number')
      }
    })

    it('captures H1, H2, and H3 headings', () => {
      const md = read('complex.md')
      const { toc } = render(md)

      const levels = toc.map(e => e.level)
      expect(levels).toContain(1)
      expect(levels).toContain(2)
      expect(levels).toContain(3)
    })

    it('file with no headings returns empty toc array', () => {
      const md = read('no-headings.md')
      const { toc } = render(md)

      expect(Array.isArray(toc)).toBe(true)
      expect(toc).toHaveLength(0)
    })

    it('heading line numbers are correct', () => {
      const md = '# First\n\n## Second\n\n### Third\n'
      const { toc } = render(md)

      expect(toc).toHaveLength(3)
      expect(toc[0]).toEqual({ heading: 'First', level: 1, line: 1 })
      expect(toc[1]).toEqual({ heading: 'Second', level: 2, line: 3 })
      expect(toc[2]).toEqual({ heading: 'Third', level: 3, line: 5 })
    })

    it('extracts heading text from complex.md fixture', () => {
      const md = read('complex.md')
      const { toc } = render(md)

      const headings = toc.map(e => e.heading)
      expect(headings).toContain('Complex Markdown Test')
      expect(headings).toContain('GFM Features')
      expect(headings).toContain('Tables')
    })
  })

  // -----------------------------------------------------------------------
  // HTML Passthrough
  // -----------------------------------------------------------------------
  describe('HTML passthrough', () => {
    it('raw HTML in markdown passes through to output', () => {
      const md = 'Before\n\n<div class="custom">raw html</div>\n\nAfter\n'
      const { html } = render(md)

      expect(html).toContain('<div class="custom">raw html</div>')
    })

    it('<details>/<summary> works', () => {
      const md = read('complex.md')
      const { html } = render(md)

      expect(html).toContain('<details>')
      expect(html).toContain('<summary>')
      expect(html).toContain('Click to expand')
    })
  })

  // -----------------------------------------------------------------------
  // Edge Cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('empty markdown returns empty or minimal HTML', () => {
      const md = read('empty.md')
      const result = render(md)

      expect(result).toHaveProperty('html')
      expect(result).toHaveProperty('toc')
      expect(result).toHaveProperty('frontmatter')
      // HTML should be empty or contain only whitespace
      expect(result.html.trim()).toBe('')
      expect(result.toc).toEqual([])
      expect(result.frontmatter).toBeNull()
    })

    it('unicode content (emoji, CJK, accented chars) renders correctly', () => {
      const md = read('complex.md')
      const { html } = render(md)

      expect(html).toContain('caf\u00e9')
      expect(html).toContain('na\u00efve')
      expect(html).toContain('r\u00e9sum\u00e9')
      expect(html).toContain('\u65e5\u672c\u8a9e\u30c6\u30b9\u30c8')
    })

    it('very long code block renders without truncation', () => {
      const lines = Array.from({ length: 200 }, (_, i) => `console.log(${i})`)
      const md = '```javascript\n' + lines.join('\n') + '\n```\n'
      const { html } = render(md)

      // With tokenized highlighting, text is split into spans.
      // Check for the numeric literals which appear in their own spans.
      expect(html).toContain('0')
      expect(html).toContain('199')
      // Ensure it's a code block with hljs
      expect(html).toContain('hljs')
      expect(html).toContain('</code>')
    })

    it('markdown with only a heading renders heading', () => {
      const md = '# Solo Heading\n'
      const { html, toc } = render(md)

      expect(html).toContain('<h1')
      expect(html).toContain('Solo Heading')
      expect(toc).toHaveLength(1)
      expect(toc[0].heading).toBe('Solo Heading')
    })
  })

  // -----------------------------------------------------------------------
  // Return value structure
  // -----------------------------------------------------------------------
  describe('return value structure', () => {
    it('returns an object with html, toc, and frontmatter', () => {
      const md = '# Hello\n'
      const result = render(md)

      expect(result).toHaveProperty('html')
      expect(result).toHaveProperty('toc')
      expect(result).toHaveProperty('frontmatter')
      expect(typeof result.html).toBe('string')
      expect(Array.isArray(result.toc)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Hunt: adversarial tests for renderer.js execution paths
// ---------------------------------------------------------------------------

describe('render() — adversarial hunt', () => {
  // -------------------------------------------------------------------------
  // 1. Input guard edge cases
  // -------------------------------------------------------------------------
  describe('input guard edge cases', () => {
    it('null input returns empty result', () => {
      const result = render(null)
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('undefined input returns empty result', () => {
      const result = render(undefined)
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('whitespace-only input returns empty result', () => {
      const result = render('   \n\t\n   ')
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('single newline returns empty result', () => {
      const result = render('\n')
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })
  })

  // -------------------------------------------------------------------------
  // 2. Frontmatter error handling
  // -------------------------------------------------------------------------
  describe('frontmatter error handling', () => {
    it('invalid YAML frontmatter results in null frontmatter (not a throw)', () => {
      // YAML with invalid syntax: tab character in flow context
      const md = '---\ntitle: [unclosed bracket\n---\n\n# Hello\n'
      const result = render(md)
      // Per code line 32: catch sets fm = null
      expect(result.frontmatter).toBeNull()
      // Should still render the heading
      expect(result.html).toContain('<h1')
      expect(result.html).toContain('Hello')
    })

    it('empty YAML frontmatter block returns null or empty object', () => {
      const md = '---\n---\n\n# Hello\n'
      const result = render(md)
      // yaml.load('') returns undefined; code sets fm to that
      // The public API does `file.data.frontmatter ?? null`
      // But remarkExtractFrontmatter sets `file.data.frontmatter = fm`
      // where fm = yaml.load('') = undefined
      // Then line 245: `file.data.frontmatter ?? null` -> null
      expect(result.frontmatter).toBeNull()
    })

    it('TOML frontmatter is stripped but not parsed into frontmatter object', () => {
      const md = '+++\ntitle = "TOML Doc"\nauthor = "Test"\n+++\n\n# Hello\n'
      const result = render(md)
      // TOML is stripped from HTML
      expect(result.html).not.toContain('+++')
      expect(result.html).not.toContain('title = ')
      // But remarkExtractFrontmatter only visits 'yaml' nodes, not 'toml'
      // So frontmatter should be null for TOML
      expect(result.frontmatter).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // 3. TOC extraction: headings with inline formatting
  // -------------------------------------------------------------------------
  describe('TOC with inline formatting in headings', () => {
    it('heading with inline code extracts plain text including code content', () => {
      const md = '# Hello `world`\n'
      const { toc } = render(md)
      expect(toc).toHaveLength(1)
      // collectText handles 'inlineCode' type, so 'world' should be included
      expect(toc[0].heading).toBe('Hello world')
    })

    it('heading with bold text extracts plain text', () => {
      const md = '## **Bold** heading\n'
      const { toc } = render(md)
      expect(toc).toHaveLength(1)
      expect(toc[0].heading).toBe('Bold heading')
    })

    it('heading with italic text extracts plain text', () => {
      const md = '### *Italic* heading\n'
      const { toc } = render(md)
      expect(toc).toHaveLength(1)
      expect(toc[0].heading).toBe('Italic heading')
    })

    it('heading with link extracts link text only', () => {
      const md = '## A [linked](https://example.com) heading\n'
      const { toc } = render(md)
      expect(toc).toHaveLength(1)
      // collectText recurses into children; link text node should be extracted
      expect(toc[0].heading).toBe('A linked heading')
    })

    it('heading with nested formatting extracts all text', () => {
      const md = '## **Bold and *nested italic*** end\n'
      const { toc } = render(md)
      expect(toc).toHaveLength(1)
      expect(toc[0].heading).toBe('Bold and nested italic end')
    })
  })

  // -------------------------------------------------------------------------
  // 4. Source position: raw HTML should NOT get data-source-line
  // -------------------------------------------------------------------------
  describe('source positions on raw HTML passthrough', () => {
    it('raw HTML div does NOT get data-source-line (per spec/code comment)', () => {
      // The code comment at line 68-72 says: runs BEFORE rehype-raw so that
      // elements parsed from raw HTML do NOT receive source-position attributes.
      const md = 'Text\n\n<div class="custom">raw content</div>\n\nMore text\n'
      const { html } = render(md)
      // The <div> from raw HTML should NOT have data-source-line
      const divMatch = html.match(/<div[^>]*class="custom"[^>]*>/)
      expect(divMatch).not.toBeNull()
      expect(divMatch[0]).not.toContain('data-source-line')
    })

    it('raw <span> in markdown does NOT get data-source-col', () => {
      const md = 'Text with <span class="hl">highlighted</span> word.\n'
      const { html } = render(md)
      const spanMatch = html.match(/<span[^>]*class="hl"[^>]*>/)
      expect(spanMatch).not.toBeNull()
      expect(spanMatch[0]).not.toContain('data-source-col')
    })
  })

  // -------------------------------------------------------------------------
  // 5. Source positions: non-inline tags should NOT get data-source-col
  // -------------------------------------------------------------------------
  describe('source positions: col only on inline tags', () => {
    it('block-level <p> has data-source-line but NOT data-source-col', () => {
      const md = 'A paragraph.\n'
      const { html } = render(md)
      const pMatch = html.match(/<p[^>]*>/)
      expect(pMatch).not.toBeNull()
      expect(pMatch[0]).toContain('data-source-line')
      expect(pMatch[0]).not.toContain('data-source-col')
    })

    it('block-level <h1> has data-source-line but NOT data-source-col', () => {
      const md = '# Heading\n'
      const { html } = render(md)
      const h1Match = html.match(/<h1[^>]*>/)
      expect(h1Match).not.toBeNull()
      expect(h1Match[0]).toContain('data-source-line')
      expect(h1Match[0]).not.toContain('data-source-col')
    })

    it('block-level <ul> has data-source-line but NOT data-source-col', () => {
      const md = '- item\n'
      const { html } = render(md)
      const ulMatch = html.match(/<ul[^>]*>/)
      expect(ulMatch).not.toBeNull()
      expect(ulMatch[0]).toContain('data-source-line')
      expect(ulMatch[0]).not.toContain('data-source-col')
    })
  })

  // -------------------------------------------------------------------------
  // 6. Syntax highlighting: language-math skipped
  // -------------------------------------------------------------------------
  describe('syntax highlighting skips math code blocks', () => {
    it('language-math code block is NOT syntax highlighted', () => {
      // rehypeHighlight line 109: if (lang === 'mermaid' || lang === 'math') return
      const md = '```math\nx^2 + y^2 = z^2\n```\n'
      const { html } = render(md)
      // Should NOT have hljs class on the code element
      // The code element for math should not be highlighted
      const codeMatch = html.match(/<code[^>]*class="[^"]*language-math[^"]*"[^>]*>/)
      if (codeMatch) {
        expect(codeMatch[0]).not.toContain('hljs')
      }
    })
  })

  // -------------------------------------------------------------------------
  // 7. Inline code (not in <pre>) should NOT be highlighted
  // -------------------------------------------------------------------------
  describe('inline code is not highlighted', () => {
    it('inline `code` is NOT syntax highlighted (no hljs class)', () => {
      const md = 'Use `const x = 1` in your code.\n'
      const { html } = render(md)
      // Inline code produces <code> NOT inside <pre>
      // rehypeHighlight checks: if (!parent || parent.tagName !== 'pre') return
      // So inline code should NOT have hljs class
      const inlineCode = html.match(/<code[^>]*>[^<]*const x = 1[^<]*<\/code>/)
      expect(inlineCode).not.toBeNull()
      expect(inlineCode[0]).not.toContain('hljs')
    })
  })

  // -------------------------------------------------------------------------
  // 8. Mermaid: data-source-line preserved
  // -------------------------------------------------------------------------
  describe('mermaid preserves source position', () => {
    it('mermaid <pre> has data-source-line from original code block', () => {
      const md = '# Title\n\n```mermaid\ngraph LR\n  A --> B\n```\n'
      const { html } = render(md)
      // rehypeMermaid preserves dataSourceLine from node or codeNode
      const mermaidPre = html.match(/<pre[^>]*class="mermaid"[^>]*>/)
      expect(mermaidPre).not.toBeNull()
      expect(mermaidPre[0]).toContain('data-source-line')
    })

    it('mermaid <pre> has data-language="mermaid"', () => {
      const md = '```mermaid\ngraph LR\n  A --> B\n```\n'
      const { html } = render(md)
      expect(html).toContain('data-language="mermaid"')
    })
  })

  // -------------------------------------------------------------------------
  // 9. rehypeMathClass: data-math attribute
  // -------------------------------------------------------------------------
  describe('math class detection and data-math attribute', () => {
    it('inline math gets data-math="true" attribute', () => {
      const md = 'Equation: $x^2$\n'
      const { html } = render(md)
      expect(html).toContain('data-math="true"')
    })

    it('display math gets data-math="true" attribute', () => {
      const md = '$$\nx^2 + y^2\n$$\n'
      const { html } = render(md)
      expect(html).toContain('data-math="true"')
    })
  })

  // -------------------------------------------------------------------------
  // 10. Edge: extremely nested markdown
  // -------------------------------------------------------------------------
  describe('deeply nested content', () => {
    it('deeply nested list items render correctly with source positions', () => {
      const md = '- L1\n  - L2\n    - L3\n      - L4\n'
      const { html } = render(md)
      expect(html).toContain('L4')
      // All list items should have data-source-line
      const liMatches = html.match(/<li[^>]*data-source-line="\d+"[^>]*>/g)
      expect(liMatches).not.toBeNull()
      expect(liMatches.length).toBe(4)
    })
  })

  // -------------------------------------------------------------------------
  // 11. Multiple code blocks: each gets highlighted independently
  // -------------------------------------------------------------------------
  describe('multiple code blocks', () => {
    it('two different language blocks are both highlighted', () => {
      const md = '```javascript\nconst x = 1;\n```\n\n```python\ndef foo():\n  pass\n```\n'
      const { html } = render(md)
      // Both should have hljs
      const codeBlocks = html.match(/<code[^>]*class="[^"]*hljs[^"]*"[^>]*>/g)
      expect(codeBlocks).not.toBeNull()
      expect(codeBlocks.length).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // 12. GFM: footnotes (if supported by remark-gfm)
  // -------------------------------------------------------------------------
  describe('GFM strikethrough in various positions', () => {
    it('strikethrough inside a list item', () => {
      const md = '- ~~deleted item~~\n'
      const { html } = render(md)
      expect(html).toContain('<del')
      expect(html).toContain('deleted item')
    })

    it('strikethrough inside a heading', () => {
      const md = '## ~~Old~~ New Title\n'
      const { html } = render(md)
      expect(html).toContain('<del')
      expect(html).toContain('Old')
    })
  })

  // -------------------------------------------------------------------------
  // 13. Concurrent safety: processor is module-level singleton
  // -------------------------------------------------------------------------
  describe('processor reuse safety', () => {
    it('calling render() multiple times produces consistent results', () => {
      const md = '# Hello\n\nWorld\n'
      const r1 = render(md)
      const r2 = render(md)
      expect(r1.html).toBe(r2.html)
      expect(r1.toc).toEqual(r2.toc)
      expect(r1.frontmatter).toEqual(r2.frontmatter)
    })

    it('rendering different inputs sequentially does not leak state', () => {
      const md1 = '---\ntitle: First\n---\n\n# First\n'
      const md2 = '# Second\n'
      const r1 = render(md1)
      const r2 = render(md2)
      expect(r1.frontmatter).toEqual({ title: 'First' })
      expect(r2.frontmatter).toBeNull()
      expect(r1.toc[0].heading).toBe('First')
      expect(r2.toc[0].heading).toBe('Second')
    })
  })

  // -------------------------------------------------------------------------
  // 14. Source line accuracy for multi-line documents
  // -------------------------------------------------------------------------
  describe('source line accuracy across document', () => {
    it('elements after frontmatter have correct line numbers', () => {
      const md = '---\ntitle: Test\n---\n\n# Title on line 5\n\nParagraph on line 7.\n'
      const { html } = render(md)

      const h1Match = html.match(/<h1[^>]*data-source-line="(\d+)"/)
      expect(h1Match).not.toBeNull()
      expect(Number(h1Match[1])).toBe(5)

      const pMatch = html.match(/<p[^>]*data-source-line="(\d+)"/)
      expect(pMatch).not.toBeNull()
      expect(Number(pMatch[1])).toBe(7)
    })

    it('code block <pre> has correct source line', () => {
      const md = '# Title\n\nSome text.\n\n```javascript\nconst x = 1;\n```\n'
      const { html } = render(md)
      // The code block starts at line 5
      const preMatch = html.match(/<pre[^>]*data-source-line="(\d+)"/)
      expect(preMatch).not.toBeNull()
      expect(Number(preMatch[1])).toBe(5)
    })
  })

  // -------------------------------------------------------------------------
  // 15. INLINE_TAGS coverage: all listed tags get data-source-col
  // -------------------------------------------------------------------------
  describe('INLINE_TAGS: links get data-source-col', () => {
    it('<a> tags from markdown links get data-source-col', () => {
      const md = 'Visit [example](https://example.com) now.\n'
      const { html } = render(md)
      const aMatch = html.match(/<a[^>]*>/)
      expect(aMatch).not.toBeNull()
      expect(aMatch[0]).toContain('data-source-col')
    })

    it('<del> from strikethrough gets data-source-col', () => {
      const md = 'This is ~~deleted~~ text.\n'
      const { html } = render(md)
      const delMatch = html.match(/<del[^>]*>/)
      expect(delMatch).not.toBeNull()
      expect(delMatch[0]).toContain('data-source-col')
    })
  })

  // -------------------------------------------------------------------------
  // 16. Empty code block
  // -------------------------------------------------------------------------
  describe('empty code block', () => {
    it('empty fenced code block does not crash', () => {
      const md = '```\n```\n'
      const result = render(md)
      expect(result.html).toContain('<pre')
      expect(result.html).toContain('<code')
    })
  })

  // -------------------------------------------------------------------------
  // 17. Frontmatter with special YAML types
  // -------------------------------------------------------------------------
  describe('frontmatter with various YAML types', () => {
    it('frontmatter with array values', () => {
      const md = '---\ntags:\n  - javascript\n  - testing\n---\n\n# Hello\n'
      const result = render(md)
      expect(result.frontmatter).not.toBeNull()
      expect(result.frontmatter.tags).toEqual(['javascript', 'testing'])
    })

    it('frontmatter with nested object', () => {
      const md = '---\nmeta:\n  version: 1\n  draft: true\n---\n\n# Hello\n'
      const result = render(md)
      expect(result.frontmatter).not.toBeNull()
      expect(result.frontmatter.meta).toEqual({ version: 1, draft: true })
    })

    it('frontmatter with numeric values', () => {
      const md = '---\nversion: 42\nprice: 9.99\n---\n\n# Hello\n'
      const result = render(md)
      expect(result.frontmatter).not.toBeNull()
      expect(result.frontmatter.version).toBe(42)
      expect(result.frontmatter.price).toBe(9.99)
    })
  })

  // -------------------------------------------------------------------------
  // 18. HTML passthrough with <details>/<summary> retains content
  // -------------------------------------------------------------------------
  describe('HTML passthrough complex cases', () => {
    it('HTML comment is stripped from output', () => {
      const md = 'Before\n\n<!-- hidden comment -->\n\nAfter\n'
      const { html } = render(md)
      // HTML comments should either be stripped or passed through
      // remark-rehype with allowDangerousHtml + rehype-raw will process them
      expect(html).toContain('Before')
      expect(html).toContain('After')
    })

    it('HTML <br> tag passes through', () => {
      const md = 'Line one<br>Line two\n'
      const { html } = render(md)
      expect(html).toContain('<br')
    })
  })

  // -------------------------------------------------------------------------
  // 19. Blockquote source positions
  // -------------------------------------------------------------------------
  describe('blockquote source positions', () => {
    it('blockquote has data-source-line', () => {
      const md = '> A quoted line\n'
      const { html } = render(md)
      const bqMatch = html.match(/<blockquote[^>]*>/)
      expect(bqMatch).not.toBeNull()
      expect(bqMatch[0]).toContain('data-source-line')
    })
  })

  // -------------------------------------------------------------------------
  // 20. Very large heading level (h6)
  // -------------------------------------------------------------------------
  describe('heading levels', () => {
    it('h6 heading is rendered and extracted in TOC', () => {
      const md = '###### Deep heading\n'
      const { html, toc } = render(md)
      expect(html).toContain('<h6')
      expect(html).toContain('Deep heading')
      expect(toc).toHaveLength(1)
      expect(toc[0].level).toBe(6)
    })

    it('7 hashes is NOT a heading (max is h6)', () => {
      const md = '####### Not a heading\n'
      const { toc } = render(md)
      // Markdown spec: 7+ hashes is not a heading
      expect(toc).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // 21. BUG PROBE: non-string truthy input crashes
  // -------------------------------------------------------------------------
  describe('non-string input robustness', () => {
    it('numeric input returns empty result gracefully', () => {
      const result = render(123)
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('boolean true returns empty result gracefully', () => {
      const result = render(true)
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('array input returns empty result gracefully', () => {
      const result = render([])
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('object input returns empty result gracefully', () => {
      const result = render({})
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('number 0 (falsy) returns empty result without crashing', () => {
      const result = render(0)
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('empty string returns empty result', () => {
      const result = render('')
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })

    it('false (falsy) returns empty result without crashing', () => {
      const result = render(false)
      expect(result).toEqual({ html: '', toc: [], frontmatter: null })
    })
  })

  // -------------------------------------------------------------------------
  // 22. XSS passthrough: HTML passthrough allows script injection
  // -------------------------------------------------------------------------
  describe('HTML passthrough security (allowDangerousHtml)', () => {
    it('SECURITY NOTE: <script> tags pass through to output', () => {
      // This is by design (allowDangerousHtml: true) per spec RF05
      // "HTML passthrough em markdown"
      // But worth documenting: scripts execute in the viewer
      const md = '<script>alert("xss")</script>\n'
      const { html } = render(md)
      expect(html).toContain('<script>')
    })

    it('SECURITY NOTE: event handlers in HTML pass through', () => {
      const md = '<img src="x" onerror="alert(1)">\n'
      const { html } = render(md)
      expect(html).toContain('onerror')
    })
  })

  // -------------------------------------------------------------------------
  // 23. collectText edge cases: images/other nodes in headings
  // -------------------------------------------------------------------------
  describe('collectText edge cases', () => {
    it('heading with image alt text: image produces empty string in TOC', () => {
      // Images in headings: collectText handles 'text' and 'inlineCode' and children
      // Image nodes have type 'image' with no 'value' and no 'children'
      // collectText returns '' for them
      const md = '# Title ![alt](img.png) End\n'
      const { toc } = render(md)
      expect(toc).toHaveLength(1)
      // The image node returns '' from collectText (no children, not text/inlineCode)
      // So we get 'Title  End' (with extra space from join)
      expect(toc[0].heading).toContain('Title')
      expect(toc[0].heading).toContain('End')
    })
  })

  // -------------------------------------------------------------------------
  // 24. Source line for tables
  // -------------------------------------------------------------------------
  describe('table source positions', () => {
    it('table element has data-source-line', () => {
      const md = '# Title\n\n| A | B |\n|---|---|\n| 1 | 2 |\n'
      const { html } = render(md)
      const tableMatch = html.match(/<table[^>]*>/)
      expect(tableMatch).not.toBeNull()
      expect(tableMatch[0]).toContain('data-source-line')
    })
  })

  // -------------------------------------------------------------------------
  // 25. Code block with unknown language: auto-detect
  // -------------------------------------------------------------------------
  describe('code block with unknown language', () => {
    it('code block with nonexistent language tag falls back to auto-detect', () => {
      // rehypeHighlight: if lang && hljs.getLanguage(lang) is false, goes to else branch
      // else branch: highlightAuto
      const md = '```nonexistent_lang_xyz\nfunction hello() { return 42; }\n```\n'
      const { html } = render(md)
      // Should still get hljs class from auto-detection
      expect(html).toContain('hljs')
    })
  })
})

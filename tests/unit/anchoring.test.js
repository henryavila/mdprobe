import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSelector, anchor, reanchorAll } from '../../src/anchoring.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '..', 'fixtures')

const sampleSource = readFileSync(join(fixturesDir, 'sample.md'), 'utf8')
const shiftedSource = readFileSync(join(fixturesDir, 'shifted.md'), 'utf8')
const editedSource = readFileSync(join(fixturesDir, 'edited.md'), 'utf8')

// ---------------------------------------------------------------------------
// Annotation fixtures matching sample.annotations.yaml
// ---------------------------------------------------------------------------

/** Annotation a1b2c3 — targets "O sistema valida todos os inputs do formulário" on line 5 */
const annotationA1 = {
  id: 'a1b2c3',
  selectors: {
    position: { startLine: 5, startColumn: 11, endLine: 5, endColumn: 57 },
    quote: {
      exact: 'O sistema valida todos os inputs do formulário',
      prefix: '- *RF01:* ',
      suffix: '\n  - input de',
    },
  },
}

/** Annotation d4e5f6 — targets "input de email validado com regex" on line 6 */
const annotationD4 = {
  id: 'd4e5f6',
  selectors: {
    position: { startLine: 6, startColumn: 5, endLine: 6, endColumn: 37 },
    quote: {
      exact: 'input de email validado com regex',
      prefix: '  - ',
      suffix: '\n  - input de',
    },
  },
}

/** Annotation g7h8i9 — targets "mensagem de erro genérica" on line 13 (index from YAML: line 12 col 5..30) */
const annotationG7 = {
  id: 'g7h8i9',
  selectors: {
    position: { startLine: 13, startColumn: 5, endLine: 13, endColumn: 30 },
    quote: {
      exact: 'mensagem de erro genérica',
      prefix: '  - ',
      suffix: '\n  - campos obr',
    },
  },
}

// ---------------------------------------------------------------------------
// createSelector
// ---------------------------------------------------------------------------

describe('createSelector', () => {
  describe('basic creation', () => {
    it('creates position with startLine, startColumn, endLine, endColumn', () => {
      const sel = createSelector({
        exact: 'O sistema valida todos os inputs do formulário',
        startLine: 5,
        startColumn: 11,
        endLine: 5,
        endColumn: 52,
        source: sampleSource,
      })

      expect(sel.position).toEqual({
        startLine: 5,
        startColumn: 11,
        endLine: 5,
        endColumn: 52,
      })
    })

    it('creates quote with exact text', () => {
      const sel = createSelector({
        exact: 'O sistema valida todos os inputs do formulário',
        startLine: 5,
        startColumn: 11,
        endLine: 5,
        endColumn: 52,
        source: sampleSource,
      })

      expect(sel.quote.exact).toBe('O sistema valida todos os inputs do formulário')
    })

    it('captures prefix (up to 30 chars before selection in source)', () => {
      const sel = createSelector({
        exact: 'O sistema valida todos os inputs do formulário',
        startLine: 5,
        startColumn: 11,
        endLine: 5,
        endColumn: 52,
        source: sampleSource,
      })

      expect(sel.quote.prefix).toBeDefined()
      expect(typeof sel.quote.prefix).toBe('string')
      expect(sel.quote.prefix.length).toBeLessThanOrEqual(30)
      // Prefix should contain text immediately before the selection
      expect(sel.quote.prefix).toContain('RF01')
    })

    it('captures suffix (up to 30 chars after selection in source)', () => {
      const sel = createSelector({
        exact: 'O sistema valida todos os inputs do formulário',
        startLine: 5,
        startColumn: 11,
        endLine: 5,
        endColumn: 52,
        source: sampleSource,
      })

      expect(sel.quote.suffix).toBeDefined()
      expect(typeof sel.quote.suffix).toBe('string')
      expect(sel.quote.suffix.length).toBeLessThanOrEqual(30)
      // Suffix should contain text immediately after the selection
      expect(sel.quote.suffix).toContain('input')
    })

    it('selection at start of file produces empty or short prefix', () => {
      const sel = createSelector({
        exact: '# Sample Spec',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 14,
        source: sampleSource,
      })

      // Nothing before line 1 col 1 — prefix should be empty
      expect(sel.quote.prefix).toBe('')
    })

    it('selection at end of file produces empty or short suffix', () => {
      const lines = sampleSource.split('\n')
      const lastLine = lines[lines.length - 1]
      const sel = createSelector({
        exact: lastLine,
        startLine: lines.length,
        startColumn: 1,
        endLine: lines.length,
        endColumn: lastLine.length + 1,
        source: sampleSource,
      })

      // Nothing after end of file — suffix should be empty or very short
      expect(sel.quote.suffix.length).toBeLessThanOrEqual(1)
    })
  })

  describe('edge cases', () => {
    it('multi-line selection spans multiple lines in position', () => {
      // Select from line 5 through line 8 (RF01 block)
      const sel = createSelector({
        exact: 'O sistema valida todos os inputs do formulário\n  - ✓ input de email validado com regex',
        startLine: 5,
        startColumn: 11,
        endLine: 6,
        endColumn: 39,
        source: sampleSource,
      })

      expect(sel.position.startLine).toBe(5)
      expect(sel.position.endLine).toBe(6)
      expect(sel.position.startLine).toBeLessThan(sel.position.endLine)
    })

    it('single character selection', () => {
      const sel = createSelector({
        exact: '#',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 2,
        source: sampleSource,
      })

      expect(sel.quote.exact).toBe('#')
      expect(sel.position.startLine).toBe(1)
      expect(sel.position.endLine).toBe(1)
    })

    it('selection of entire line', () => {
      const lines = sampleSource.split('\n')
      const line3 = lines[2] // "## Requisitos Funcionais"
      const sel = createSelector({
        exact: line3,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: line3.length + 1,
        source: sampleSource,
      })

      expect(sel.quote.exact).toBe(line3)
      expect(sel.position.startLine).toBe(3)
      expect(sel.position.endLine).toBe(3)
    })

    it('unicode text in selection (café, accented chars)', () => {
      // "formulário" contains unicode — exists on line 5
      const sel = createSelector({
        exact: 'formulário',
        startLine: 5,
        startColumn: 43,
        endLine: 5,
        endColumn: 53,
        source: sampleSource,
      })

      expect(sel.quote.exact).toBe('formulário')
      expect(sel.position).toBeDefined()
    })

    it('selection inside code block', () => {
      const sourceWithCode = '# Title\n\n```js\nconst x = 42;\n```\n'
      const sel = createSelector({
        exact: 'const x = 42;',
        startLine: 4,
        startColumn: 1,
        endLine: 4,
        endColumn: 15,
        source: sourceWithCode,
      })

      expect(sel.quote.exact).toBe('const x = 42;')
      expect(sel.quote.prefix.length).toBeLessThanOrEqual(30)
      expect(sel.quote.suffix.length).toBeLessThanOrEqual(30)
    })
  })
})

// ---------------------------------------------------------------------------
// anchor — position match (fast path)
// ---------------------------------------------------------------------------

describe('anchor — position match', () => {
  it('TC-RF13-1: same source, same positions returns status position', () => {
    const result = anchor(annotationA1, sampleSource)

    expect(result.status).toBe('position')
    expect(result.position).toEqual(annotationA1.selectors.position)
  })

  it('position match returns correct line/column for second annotation', () => {
    const result = anchor(annotationD4, sampleSource)

    expect(result.status).toBe('position')
    expect(result.position).toEqual(annotationD4.selectors.position)
  })

  it('position match validates content at position against quote.exact', () => {
    // Position match should confirm text at position matches quote.exact
    const result = anchor(annotationA1, sampleSource)
    expect(result.status).toBe('position')

    // Extract text at returned position from source to verify
    const lines = sampleSource.split('\n')
    const line = lines[result.position.startLine - 1]
    const textAtPosition = line.slice(
      result.position.startColumn - 1,
      result.position.endColumn - 1,
    )
    expect(textAtPosition).toBe(annotationA1.selectors.quote.exact)
  })

  it('lines shifted — position content mismatch falls through to exact match', () => {
    // shifted.md has 5 extra lines at top; position (5,11) no longer has the right text
    const result = anchor(annotationA1, shiftedSource)

    // Should NOT be 'position' since lines shifted
    expect(result.status).not.toBe('position')
    // Should fall through to exact or fuzzy — text still exists
    expect(['exact', 'fuzzy']).toContain(result.status)
  })
})

// ---------------------------------------------------------------------------
// anchor — exact quote match
// ---------------------------------------------------------------------------

describe('anchor — exact quote match', () => {
  it('TC-RF13-2: quote.exact found at different position returns status exact', () => {
    // In shifted.md, text moved 5 lines down but is otherwise identical
    const result = anchor(annotationA1, shiftedSource)

    expect(result.status).toBe('exact')
    expect(result.position).not.toBeNull()
    // New position should be shifted by 5 lines
    expect(result.position.startLine).toBe(annotationA1.selectors.position.startLine + 5)
  })

  it('exact match returns updated position for shifted content', () => {
    const result = anchor(annotationD4, shiftedSource)

    expect(result.status).toBe('exact')
    expect(result.position).not.toBeNull()
    // Original was line 6, shifted by 5 → line 11
    expect(result.position.startLine).toBe(annotationD4.selectors.position.startLine + 5)
  })

  it('exact match not found falls through to fuzzy', () => {
    // In edited.md the text is changed — exact won't match
    const result = anchor(annotationA1, editedSource)

    // "O sistema valida todos os inputs do formulário" was changed to
    // "O sistema valida todas as entradas do formulário de cadastro"
    expect(result.status).not.toBe('exact')
    expect(['fuzzy', 'orphan']).toContain(result.status)
  })
})

// ---------------------------------------------------------------------------
// anchor — fuzzy match (diff-match-patch)
// ---------------------------------------------------------------------------

describe('anchor — fuzzy match', () => {
  it('TC-RF13-3: slightly edited text returns status fuzzy', () => {
    // edited.md has "O sistema valida todas as entradas do formulário de cadastro"
    // instead of "O sistema valida todos os inputs do formulário"
    const result = anchor(annotationA1, editedSource)

    expect(result.status).toBe('fuzzy')
    expect(result.position).not.toBeNull()
  })

  it('fuzzy match returns approximate position near original location', () => {
    const result = anchor(annotationA1, editedSource)

    expect(result.status).toBe('fuzzy')
    // edited.md keeps same structure, so line should be same (5)
    expect(result.position.startLine).toBe(5)
  })

  it('fuzzy match finds right region for annotation on edited text', () => {
    // annotationD4 targets "input de email validado com regex" on line 6
    // edited.md has "input de email validado com regex RFC 5322" on line 6
    const result = anchor(annotationD4, editedSource)

    // Small edit — should fuzzy match
    expect(['exact', 'fuzzy']).toContain(result.status)
    expect(result.position).not.toBeNull()
    expect(result.position.startLine).toBe(6)
  })

  it('position hint improves accuracy when same text appears multiple times', () => {
    // Create a source with duplicated text
    const duplicatedSource = [
      '# Doc',
      '',
      'The important phrase appears here.',
      '',
      '## Section Two',
      '',
      'The important phrase appears here.',
      '',
    ].join('\n')

    const annotation = {
      id: 'dup-test',
      selectors: {
        position: { startLine: 7, startColumn: 1, endLine: 7, endColumn: 34 },
        quote: {
          exact: 'The important phrase appears here.',
          prefix: '\n',
          suffix: '\n',
        },
      },
    }

    // Even though text appears twice, position hint should prefer line 7
    const result = anchor(annotation, duplicatedSource)
    expect(result.position).not.toBeNull()
    expect(result.position.startLine).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// anchor — orphan
// ---------------------------------------------------------------------------

describe('anchor — orphan', () => {
  it('TC-RF13-4: annotated text completely removed returns orphan', () => {
    const rewrittenSource = [
      '# Completely New Document',
      '',
      'All previous content has been replaced.',
      'Nothing from the original remains.',
      '',
    ].join('\n')

    const result = anchor(annotationA1, rewrittenSource)

    expect(result.status).toBe('orphan')
    expect(result.position).toBeNull()
  })

  it('annotated section entirely rewritten returns orphan', () => {
    const rewrittenSource = [
      '# Sample Spec',
      '',
      '## Requisitos Funcionais',
      '',
      '- **RF01:** The system has been completely redesigned with new architecture',
      '  - All previous requirements deprecated',
      '',
    ].join('\n')

    // The original exact text is gone and the replacement is too different for fuzzy
    const result = anchor(annotationA1, rewrittenSource)

    expect(result.status).toBe('orphan')
    expect(result.position).toBeNull()
  })

  it('empty source returns orphan for any annotation', () => {
    const result = anchor(annotationA1, '')

    expect(result.status).toBe('orphan')
    expect(result.position).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Fallback chain order
// ---------------------------------------------------------------------------

describe('fallback chain order', () => {
  it('position is tried first — unchanged doc gets position status', () => {
    const result = anchor(annotationA1, sampleSource)
    expect(result.status).toBe('position')
  })

  it('position fails, exact succeeds — shifted doc gets exact status', () => {
    const result = anchor(annotationA1, shiftedSource)
    expect(result.status).toBe('exact')
  })

  it('position and exact fail, fuzzy succeeds — edited doc gets fuzzy status', () => {
    const result = anchor(annotationA1, editedSource)
    expect(result.status).toBe('fuzzy')
  })

  it('all strategies fail — rewritten doc gets orphan status', () => {
    const result = anchor(annotationA1, 'Completely unrelated content.\n')
    expect(result.status).toBe('orphan')
  })
})

// ---------------------------------------------------------------------------
// Prefix/suffix context matching
// ---------------------------------------------------------------------------

describe('prefix/suffix context matching', () => {
  it('prefix and suffix help disambiguate when exact text appears multiple times', () => {
    // Source with "input" appearing in two very different contexts
    const ambiguousSource = [
      '# Form',
      '',
      '- **RF01:** O sistema valida todos os inputs do formulário',
      '  - ✓ input de email validado com regex',
      '',
      '## Duplicate Section',
      '',
      '- **RF99:** O sistema valida todos os inputs do formulário',
      '  - ✓ input numérico apenas',
      '',
    ].join('\n')

    // Annotation pointing to first occurrence (line 3) with matching prefix/suffix
    const annotation = {
      id: 'disambig-1',
      selectors: {
        position: { startLine: 3, startColumn: 11, endLine: 3, endColumn: 52 },
        quote: {
          exact: 'O sistema valida todos os inputs do formulário',
          prefix: '- **RF01:** ',
          suffix: '\n  - ✓ input de email',
        },
      },
    }

    const result = anchor(annotation, ambiguousSource)
    expect(result.position).not.toBeNull()
    // Should anchor to line 3 (first occurrence, matching prefix/suffix), not line 8
    expect(result.position.startLine).toBe(3)
  })

  it('suffix distinguishes between identical exact texts', () => {
    const ambiguousSource = [
      '# Doc',
      '',
      'Important text here with suffix A follows.',
      '',
      'Important text here with suffix B follows.',
      '',
    ].join('\n')

    // Annotation targeting second occurrence
    const annotation = {
      id: 'suffix-test',
      selectors: {
        position: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
        quote: {
          exact: 'Important text here',
          prefix: '\n',
          suffix: ' with suffix B',
        },
      },
    }

    const result = anchor(annotation, ambiguousSource)
    expect(result.position).not.toBeNull()
    expect(result.position.startLine).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// reanchorAll
// ---------------------------------------------------------------------------

describe('reanchorAll', () => {
  it('multiple annotations, all position match returns all status position', () => {
    const results = reanchorAll([annotationA1, annotationD4, annotationG7], sampleSource)

    expect(results).toBeInstanceOf(Map)
    expect(results.get('a1b2c3').status).toBe('position')
    expect(results.get('d4e5f6').status).toBe('position')
    expect(results.get('g7h8i9').status).toBe('position')
  })

  it('mixed results: some position, some exact, some fuzzy, some orphan', () => {
    // Use edited source — some annotations match exactly, some fuzzy, etc.
    // Create an annotation that will definitely orphan
    const orphanAnnotation = {
      id: 'orphan-1',
      selectors: {
        position: { startLine: 99, startColumn: 1, endLine: 99, endColumn: 50 },
        quote: {
          exact: 'This text does not exist anywhere in any fixture',
          prefix: 'nonexistent ',
          suffix: ' nonexistent',
        },
      },
    }

    const results = reanchorAll(
      [annotationA1, annotationD4, orphanAnnotation],
      editedSource,
    )

    expect(results).toBeInstanceOf(Map)
    expect(results.size).toBe(3)

    // annotationA1 was edited → fuzzy
    expect(results.get('a1b2c3').status).toBe('fuzzy')

    // orphan annotation → orphan
    expect(results.get('orphan-1').status).toBe('orphan')

    // Each result has status and position keys
    for (const [, result] of results) {
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('position')
    }
  })

  it('empty annotations array returns empty Map', () => {
    const results = reanchorAll([], sampleSource)

    expect(results).toBeInstanceOf(Map)
    expect(results.size).toBe(0)
  })

  it('returns Map keyed by annotation id', () => {
    const results = reanchorAll([annotationA1, annotationD4], sampleSource)

    expect(results).toBeInstanceOf(Map)
    expect(results.has('a1b2c3')).toBe(true)
    expect(results.has('d4e5f6')).toBe(true)
    expect(results.has('nonexistent')).toBe(false)
  })

  it('each result contains status and position fields', () => {
    const results = reanchorAll([annotationA1], sampleSource)

    const entry = results.get('a1b2c3')
    expect(entry).toHaveProperty('status')
    expect(entry).toHaveProperty('position')
    expect(['position', 'exact', 'fuzzy', 'orphan']).toContain(entry.status)
  })
})

// ---------------------------------------------------------------------------
// HUNT: Adversarial edge-case tests (penetration testing)
// ---------------------------------------------------------------------------

describe('HUNT: empty exact text causes infinite loop in findAllOccurrences', () => {
  it('anchor with empty exact text should not hang', () => {
    const annotation = {
      id: 'empty-exact',
      selectors: {
        position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        quote: {
          exact: '',
          prefix: '',
          suffix: '',
        },
      },
    }

    // This should complete without hanging. If findAllOccurrences is called
    // with empty string, indexOf('') returns 0, then indexOf('', 1) returns 1, etc.
    // creating an infinite loop.
    const result = anchor(annotation, sampleSource)
    // Per spec, empty exact text should not match anything meaningful
    expect(result).toHaveProperty('status')
  })
})

describe('HUNT: position match boundary check fails for multi-line selections', () => {
  it('multi-line annotation on unchanged source should return position status', () => {
    // The position match boundary check (lines 173-183) uses endLine to slice
    // with startColumn, which is wrong for multi-line selections.
    const multiLineSource = '# Title\n\nFirst line of paragraph.\nSecond line here.\n'

    const annotation = {
      id: 'multi-line',
      selectors: {
        position: { startLine: 3, startColumn: 1, endLine: 4, endColumn: 18 },
        quote: {
          exact: 'First line of paragraph.\nSecond line here.',
          prefix: '\n',
          suffix: '\n',
        },
      },
    }

    const result = anchor(annotation, multiLineSource)
    // Per spec: unchanged doc should get position match
    // BUG HYPOTHESIS: the boundary check on endLine uses startColumn which
    // belongs to startLine, so it fails and falls through to exact match.
    expect(result.status).toBe('position')
  })
})

describe('HUNT: position match with startLine != endLine boundary check', () => {
  it('single-line annotation on unchanged source returns position', () => {
    // Sanity check: single-line should work
    const source = 'Line one\nLine two\nLine three\n'
    const annotation = {
      id: 'single-line-check',
      selectors: {
        position: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 9 },
        quote: {
          exact: 'Line two',
          prefix: 'Line one\n',
          suffix: '\nLine three',
        },
      },
    }

    const result = anchor(annotation, source)
    expect(result.status).toBe('position')
  })
})

describe('HUNT: annotation.selectors without position field', () => {
  it('annotation with only quote (no position) should still attempt exact match', () => {
    const annotation = {
      id: 'no-position',
      selectors: {
        quote: {
          exact: 'O sistema valida todos os inputs do formulário',
          prefix: '- *RF01:* ',
          suffix: '\n  - input de',
        },
      },
    }

    // Per spec, position match requires both position and quote.
    // Without position, should fall through to exact match.
    const result = anchor(annotation, sampleSource)
    expect(result.status).toBe('exact')
    expect(result.position).not.toBeNull()
  })
})

describe('HUNT: annotation.selectors without quote field', () => {
  it('annotation with only position (no quote) should become orphan', () => {
    const annotation = {
      id: 'no-quote',
      selectors: {
        position: { startLine: 5, startColumn: 11, endLine: 5, endColumn: 57 },
      },
    }

    // Without quote.exact, all matching strategies require it. Should become orphan.
    const result = anchor(annotation, sampleSource)
    expect(result.status).toBe('orphan')
    expect(result.position).toBeNull()
  })
})

describe('HUNT: lineColumnToOffset with out-of-bounds inputs', () => {
  it('line 0 (below minimum 1) should not crash anchor', () => {
    const annotation = {
      id: 'line-zero',
      selectors: {
        position: { startLine: 0, startColumn: 1, endLine: 0, endColumn: 5 },
        quote: {
          exact: '# Sa',
          prefix: '',
          suffix: 'mple',
        },
      },
    }

    // startLine=0 causes lineColumnToOffset loop to not run (i < 0-1 = -1),
    // so offset = column-1 = 0. extractTextByLength checks startLine<1, returns null.
    // Should fall through to exact match.
    const result = anchor(annotation, sampleSource)
    expect(result).toHaveProperty('status')
    // Should not crash
  })

  it('very large line number should not crash anchor', () => {
    const annotation = {
      id: 'large-line',
      selectors: {
        position: { startLine: 99999, startColumn: 1, endLine: 99999, endColumn: 10 },
        quote: {
          exact: 'This text does not exist',
          prefix: '',
          suffix: '',
        },
      },
    }

    const result = anchor(annotation, sampleSource)
    expect(result).toHaveProperty('status')
    // Should not crash, should become orphan
    expect(result.status).toBe('orphan')
  })
})

describe('HUNT: negative column values', () => {
  it('startColumn=0 should not produce negative offset', () => {
    const annotation = {
      id: 'col-zero',
      selectors: {
        position: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 5 },
        quote: {
          exact: '# Sam',
          prefix: '',
          suffix: 'ple',
        },
      },
    }

    // lineColumnToOffset with column=0: offset += 0 - 1 = -1
    // This makes startOffset = -1, then source.slice(-1, -1 + 5) = source.slice(-1, 4)
    // which returns characters from the end of string + beginning. Bug territory.
    const result = anchor(annotation, sampleSource)
    expect(result).toHaveProperty('status')
  })
})

describe('HUNT: exact match disambiguation uses currentSource for origOffset', () => {
  it('disambiguation computes origOffset from currentSource not original source', () => {
    // When there are multiple occurrences, the code computes origOffset using
    // lineColumnToOffset(currentSource, ...) but the stored position was relative
    // to the ORIGINAL source. If the source has changed structure, this offset
    // could be wrong.
    const source = [
      'AAA',
      'BBB target text CCC',
      'DDD',
      'EEE',
      'FFF target text GGG',
      'HHH',
    ].join('\n')

    // Annotation was at line 2 in original source
    const annotation = {
      id: 'disambig-offset',
      selectors: {
        position: { startLine: 2, startColumn: 5, endLine: 2, endColumn: 16 },
        quote: {
          exact: 'target text',
          prefix: 'BBB ',
          suffix: ' CCC',
        },
      },
    }

    const result = anchor(annotation, source)
    // Should find the one on line 2 (with BBB prefix) not line 5 (with FFF prefix)
    expect(result.position.startLine).toBe(2)
  })
})

describe('HUNT: source with only newlines', () => {
  it('source of only newlines should not crash', () => {
    const source = '\n\n\n\n\n'
    const annotation = {
      id: 'newlines-only',
      selectors: {
        position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        quote: {
          exact: 'something',
          prefix: '',
          suffix: '',
        },
      },
    }

    const result = anchor(annotation, source)
    expect(result.status).toBe('orphan')
  })
})

describe('HUNT: createSelector with endOffset before startOffset', () => {
  it('endLine < startLine produces inverted slice for prefix/suffix', () => {
    // If someone passes endLine < startLine, the endOffset < startOffset
    // source.slice(endOffset, endOffset + 30) would give wrong suffix
    const source = 'Line one\nLine two\nLine three\n'
    const sel = createSelector({
      exact: 'test',
      startLine: 3,
      startColumn: 1,
      endLine: 1,
      endColumn: 5,
      source: source,
    })

    // The function does not validate inputs. prefix/suffix could be mangled.
    // At minimum it should not crash.
    expect(sel).toHaveProperty('position')
    expect(sel).toHaveProperty('quote')
  })
})

describe('HUNT: fuzzy match with source shorter than pattern', () => {
  it('pattern longer than source should not crash and should return orphan', () => {
    const shortSource = 'Hi'
    const annotation = {
      id: 'long-pattern',
      selectors: {
        position: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 100 },
        quote: {
          exact: 'This is a very long pattern that is definitely longer than the source text and should not cause any crash or weird behavior in the fuzzy matching logic',
          prefix: '',
          suffix: '',
        },
      },
    }

    const result = anchor(annotation, shortSource)
    expect(result.status).toBe('orphan')
  })
})

describe('HUNT: fuzzy match with pattern exactly 32 chars (MAX_PATTERN boundary)', () => {
  it('pattern of exactly 32 chars uses direct match_main path', () => {
    // 32 chars = MAX_PATTERN, so it should use the direct path (not truncated)
    const exact32 = 'abcdefghijklmnopqrstuvwxyz012345' // 32 chars
    const source = 'prefix ' + exact32 + ' suffix'
    const annotation = {
      id: 'exact-32',
      selectors: {
        position: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 40 },
        quote: {
          exact: exact32,
          prefix: 'prefix ',
          suffix: ' suffix',
        },
      },
    }

    const result = anchor(annotation, source)
    expect(result.status).toBe('position')
  })

  it('pattern of 33 chars uses truncated+verify path', () => {
    // 33 chars > MAX_PATTERN, triggers the truncated path
    const exact33 = 'abcdefghijklmnopqrstuvwxyz0123456' // 33 chars
    const source = 'prefix ' + exact33 + ' suffix'
    const annotation = {
      id: 'exact-33',
      selectors: {
        position: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 41 },
        quote: {
          exact: exact33,
          prefix: 'prefix ',
          suffix: ' suffix',
        },
      },
    }

    const result = anchor(annotation, source)
    expect(result.status).toBe('position')
  })
})

describe('HUNT: reanchorAll with duplicate annotation IDs', () => {
  it('duplicate IDs in annotations array — last one wins', () => {
    const ann1 = {
      id: 'dup-id',
      selectors: {
        position: { startLine: 5, startColumn: 11, endLine: 5, endColumn: 57 },
        quote: {
          exact: 'O sistema valida todos os inputs do formulário',
          prefix: '- *RF01:* ',
          suffix: '\n  - input de',
        },
      },
    }

    const ann2 = {
      id: 'dup-id',
      selectors: {
        position: { startLine: 99, startColumn: 1, endLine: 99, endColumn: 50 },
        quote: {
          exact: 'This text does not exist anywhere',
          prefix: '',
          suffix: '',
        },
      },
    }

    const results = reanchorAll([ann1, ann2], sampleSource)
    // Map.set overwrites, so last one wins
    expect(results.size).toBe(1)
    // The second annotation should be the one stored (orphan)
    expect(results.get('dup-id').status).toBe('orphan')
  })
})

describe('HUNT: position match boundary check detail — endColumn off by one', () => {
  it('endColumn pointing one past the last char (exclusive) matches correctly', () => {
    // In the sample.md, "mensagem de erro genérica" is on line 13 col 5..30
    // annotationG7 has endColumn: 30
    // The text "mensagem de erro genérica" has 25 chars (with accent)
    // col 5 + 25 = col 30 (exclusive end)
    const result = anchor(annotationG7, sampleSource)
    expect(result.status).toBe('position')

    // Verify the text at the returned position
    const lines = sampleSource.split('\n')
    const line = lines[result.position.startLine - 1]
    const text = line.slice(result.position.startColumn - 1, result.position.endColumn - 1)
    expect(text).toBe('mensagem de erro genérica')
  })
})

describe('HUNT: scorePrefixSuffix with undefined prefix/suffix', () => {
  it('annotation with no prefix/suffix still disambiguates by distance', () => {
    const source = [
      'aaa target bbb',
      'ccc target ddd',
    ].join('\n')

    const annotation = {
      id: 'no-ctx',
      selectors: {
        position: { startLine: 2, startColumn: 5, endLine: 2, endColumn: 11 },
        quote: {
          exact: 'target',
          // no prefix, no suffix — score will be 0 for all; distance tiebreaker
        },
      },
    }

    const result = anchor(annotation, source)
    expect(result.position).not.toBeNull()
    // With no prefix/suffix, all scores are 0. Distance tiebreaker should
    // prefer the occurrence closest to the original position (line 2).
    expect(result.position.startLine).toBe(2)
  })
})

describe('HUNT: position match when text matches but boundary check fails', () => {
  it('text at position matches exact but line has been extended after the match', () => {
    // Test the boundary check logic: "ensure the text at this position
    // hasn't been extended"
    // Original: line has "target" at col 1-7
    // Modified: line has "target_extended" at col 1-16
    // The extractTextByLength returns "target" (length match), but the
    // boundary check should catch that the line was extended.
    const originalSource = 'before\ntarget\nafter\n'
    const modifiedSource = 'before\ntarget_extended\nafter\n'

    const annotation = {
      id: 'extended-line',
      selectors: {
        position: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 },
        quote: {
          exact: 'target',
          prefix: 'before\n',
          suffix: '\nafter',
        },
      },
    }

    // On modified source, extractTextByLength gets "target" (first 6 chars),
    // which matches exact. But the actual line is "target_extended".
    // The boundary check compares:
    //   textToLineEnd = "target_extended" vs "target" → not equal
    //   lineBased = endLineStr.slice(0, 6) = "target" vs "target" → EQUAL
    // So boundary check PASSES even though the line was extended.
    // This is actually correct behavior per spec — the text hasn't changed,
    // it's just that more text was added after it on the same line.
    const result = anchor(annotation, modifiedSource)
    // position match should succeed — the text "target" is still there at the same position
    expect(result.status).toBe('position')
  })
})

import { createHash } from 'node:crypto'

export function detectVersion(yamlObj) {
  return yamlObj?.schema_version ?? 1
}

export function sourceToOffset(source, line, column) {
  let offset = 0
  let currentLine = 1
  for (let i = 0; i < source.length; i++) {
    if (currentLine === line) {
      return Math.min(offset + (column - 1), source.length)
    }
    if (source[i] === '\n') currentLine++
    offset++
  }
  return source.length
}

function sha256(s) {
  return 'sha256:' + createHash('sha256').update(s).digest('hex')
}

export function transformV1ToV2Essential(yamlObj, source) {
  if (detectVersion(yamlObj) >= 2) return yamlObj

  const out = { ...yamlObj, schema_version: 2 }
  out.annotations = (yamlObj.annotations || []).map(ann => {
    const pos = ann.selectors?.position
    const quote = ann.selectors?.quote || { exact: '', prefix: '', suffix: '' }
    const start = pos ? sourceToOffset(source, pos.startLine, pos.startColumn) : 0
    const end = pos ? sourceToOffset(source, pos.endLine, pos.endColumn) : start
    const contextHash = sha256(quote.prefix + quote.exact + quote.suffix)

    const transformed = { ...ann }
    delete transformed.selectors
    transformed.range = { start, end }
    transformed.quote = { exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix }
    transformed.anchor = { contextHash }
    return transformed
  })

  if (out.config) out.config.schema_version = 2
  return out
}

export function computeContextHash(prefix, exact, suffix) {
  return sha256(prefix + exact + suffix)
}

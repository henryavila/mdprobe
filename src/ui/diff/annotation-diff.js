function isVisible(ann, showResolved) {
  return showResolved || ann.status === 'open'
}

function fingerprint(ann) {
  return `${ann.tag}|${ann.status}`
}

export function diffAnnotations(prev, next, { showResolved }) {
  const prevMap = new Map()
  for (const a of prev) if (isVisible(a, showResolved)) prevMap.set(a.id, a)

  const nextMap = new Map()
  for (const a of next) if (isVisible(a, showResolved)) nextMap.set(a.id, a)

  const added = []
  const removed = []
  const kept = []

  for (const [id, n] of nextMap) {
    const p = prevMap.get(id)
    if (!p) { added.push(id); continue }
    if (fingerprint(p) !== fingerprint(n)) { added.push(id); removed.push(id); continue }
    kept.push(id)
  }
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removed.push(id)
  }

  return { added, removed, kept }
}

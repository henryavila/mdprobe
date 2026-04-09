import { signal, computed } from '@preact/signals'

// Files
export const files = signal([])
export const currentFile = signal(null)

// Content
export const currentHtml = signal('')
export const currentToc = signal([])
export const frontmatter = signal(null)

// Annotations
export const annotations = signal([])
export const sections = signal([])
export const selectedAnnotationId = signal(null)
export const showResolved = signal(false)
export const filterTag = signal(null)
export const filterAuthor = signal(null)

// UI state — restore from localStorage
export const leftPanelOpen = signal(localStorage.getItem('mdprobe-left-panel') !== 'false')
export const rightPanelOpen = signal(localStorage.getItem('mdprobe-right-panel') !== 'false')
export const theme = signal(localStorage.getItem('mdprobe-theme') || 'mocha')
export const driftWarning = signal(false)
export const anchorStatus = signal({})  // Map<annotationId, 'anchored'|'orphan'>

// Persist panel state on change via effect (subscribed below)
leftPanelOpen.subscribe(v => localStorage.setItem('mdprobe-left-panel', v))
rightPanelOpen.subscribe(v => localStorage.setItem('mdprobe-right-panel', v))

// Config
export const author = signal('anonymous')
export const reviewMode = signal(false)

// Computed
export const openAnnotations = computed(() =>
  annotations.value.filter(a => a.status === 'open')
)

export const resolvedAnnotations = computed(() =>
  annotations.value.filter(a => a.status === 'resolved')
)

export const filteredAnnotations = computed(() => {
  let list = showResolved.value
    ? annotations.value
    : annotations.value.filter(a => a.status === 'open')

  if (filterTag.value) {
    list = list.filter(a => a.tag === filterTag.value)
  }
  if (filterAuthor.value) {
    list = list.filter(a => a.author === filterAuthor.value)
  }

  return list
})

export const orphanedAnnotations = computed(() =>
  filteredAnnotations.value.filter(a => anchorStatus.value[a.id] === 'orphan')
)

export const anchoredAnnotations = computed(() =>
  filteredAnnotations.value.filter(a => anchorStatus.value[a.id] !== 'orphan')
)

export const uniqueTags = computed(() =>
  [...new Set(annotations.value.map(a => a.tag))]
)

export const uniqueAuthors = computed(() =>
  [...new Set(annotations.value.map(a => a.author))]
)

// Adaptive section level (set from API response)
export const sectionLevel = signal(2)

// Section stats — count at the adaptive section level
export const sectionStats = computed(() => {
  const lvl = sectionLevel.value
  const atLevel = sections.value.filter(s => s.level === lvl)
  const total = atLevel.length
  const reviewed = atLevel.filter(s => s.status !== 'pending').length
  return { total, reviewed }
})

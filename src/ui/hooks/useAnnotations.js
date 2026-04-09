import { annotations, sections, currentFile, author, driftWarning, sectionLevel, anchorStatus } from '../state/store.js'

const API_BASE = '' // same origin

/**
 * CRUD operations for annotations and section review status.
 * All methods communicate with the mdprobe HTTP API and update the
 * corresponding signals in the store on success.
 *
 * @returns {object} annotation and section action methods
 */
export function useAnnotations() {
  // ---------------------------------------------------------------------------
  // Annotations
  // ---------------------------------------------------------------------------

  /** Fetch all annotations (and sections) for the given file path. */
  async function fetchAnnotations(filePath) {
    const res = await fetch(
      `${API_BASE}/api/annotations?path=${encodeURIComponent(filePath)}`,
    )
    if (!res.ok) throw new Error(`Failed to fetch annotations: ${res.status}`)
    const data = await res.json()
    annotations.value = data.annotations || []
    sections.value = data.sections || []
    if (data.sectionLevel != null) sectionLevel.value = data.sectionLevel
    driftWarning.value = data.drift || false
    if (data.drift && typeof data.drift === 'object') {
      anchorStatus.value = data.drift.anchorStatus || {}
    } else {
      anchorStatus.value = {}
    }
    return data
  }

  /** Create a new annotation on the current file. */
  async function createAnnotation({ selectors, comment, tag }) {
    const data = await postAnnotation('add', {
      selectors,
      comment,
      tag,
      author: author.value,
    })
    annotations.value = data.annotations || annotations.value
    return data
  }

  /** Mark an annotation as resolved. */
  async function resolveAnnotation(id) {
    const data = await postAnnotation('resolve', { id })
    annotations.value = data.annotations || annotations.value
  }

  /** Re-open a previously resolved annotation. */
  async function reopenAnnotation(id) {
    const data = await postAnnotation('reopen', { id })
    annotations.value = data.annotations || annotations.value
  }

  /** Update the comment and/or tag of an existing annotation. */
  async function updateAnnotation(id, { comment, tag }) {
    const data = await postAnnotation('update', { id, comment, tag })
    annotations.value = data.annotations || annotations.value
  }

  /** Delete an annotation by id. */
  async function deleteAnnotation(id) {
    const data = await postAnnotation('delete', { id })
    annotations.value = data.annotations || annotations.value
  }

  /** Add a threaded reply to an annotation. */
  async function addReply(annotationId, comment) {
    const data = await postAnnotation('reply', {
      id: annotationId,
      author: author.value,
      comment,
    })
    annotations.value = data.annotations || annotations.value
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  /** Approve a single section by heading text (cascades to children). */
  async function approveSection(heading) {
    const data = await postSection('approve', { heading })
    sections.value = data.sections || sections.value
    if (data.sectionLevel != null) sectionLevel.value = data.sectionLevel
  }

  /** Reject a single section by heading text (no cascade). */
  async function rejectSection(heading) {
    const data = await postSection('reject', { heading })
    sections.value = data.sections || sections.value
    if (data.sectionLevel != null) sectionLevel.value = data.sectionLevel
  }

  /** Approve all sections in the current file at once. */
  async function approveAllSections() {
    const data = await postSection('approveAll')
    sections.value = data.sections || sections.value
  }

  /** Reset a single section to pending. */
  async function resetSection(heading) {
    const data = await postSection('reset', { heading })
    sections.value = data.sections || sections.value
    if (data.sectionLevel != null) sectionLevel.value = data.sectionLevel
  }

  /** Reset all section review statuses in the current file. */
  async function clearAllSections() {
    const data = await postSection('clearAll')
    sections.value = data.sections || sections.value
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function postAnnotation(action, data) {
    const res = await fetch(`${API_BASE}/api/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: currentFile.value,
        action,
        data,
      }),
    })
    if (!res.ok) throw new Error(`Annotation ${action} failed: ${res.status}`)
    return res.json()
  }

  async function postSection(action, extra = {}) {
    const res = await fetch(`${API_BASE}/api/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: currentFile.value,
        action,
        ...extra,
      }),
    })
    if (!res.ok) throw new Error(`Section ${action} failed: ${res.status}`)
    return res.json()
  }

  return {
    fetchAnnotations,
    createAnnotation,
    resolveAnnotation,
    reopenAnnotation,
    updateAnnotation,
    deleteAnnotation,
    addReply,
    approveSection,
    rejectSection,
    resetSection,
    approveAllSections,
    clearAllSections,
  }
}

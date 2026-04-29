import { annotations, sections, currentFile, author, driftWarning, sectionLevel, anchorStatus,
  setAnnotations, setAnnotationsImmediate, setSectionsImmediate } from '../state/store.js'

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
    setAnnotationsImmediate(data.annotations || [])
    setSectionsImmediate(data.sections || [])
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
    // Only update if WS broadcast hasn't already delivered the same data
    if (data.annotations) setAnnotations(data.annotations)
    return data
  }

  /** Mark an annotation as resolved. */
  async function resolveAnnotation(id) {
    const data = await postAnnotation('resolve', { id })
    if (data.annotations) setAnnotations(data.annotations)
  }

  /** Re-open a previously resolved annotation. */
  async function reopenAnnotation(id) {
    const data = await postAnnotation('reopen', { id })
    if (data.annotations) setAnnotations(data.annotations)
  }

  /** Update the comment and/or tag of an existing annotation. */
  async function updateAnnotation(id, { comment, tag }) {
    const data = await postAnnotation('update', { id, comment, tag })
    if (data.annotations) setAnnotations(data.annotations)
  }

  /** Delete an annotation by id. */
  async function deleteAnnotation(id) {
    const data = await postAnnotation('delete', { id })
    if (data.annotations) setAnnotations(data.annotations)
  }

  /** Add a threaded reply to an annotation. */
  async function addReply(annotationId, comment) {
    const data = await postAnnotation('reply', {
      id: annotationId,
      author: author.value,
      comment,
    })
    if (data.annotations) setAnnotations(data.annotations)
  }

  /** Edit an existing reply on an annotation. */
  async function editReply(annotationId, replyId, comment) {
    const data = await postAnnotation('editReply', {
      id: annotationId,
      replyId,
      comment,
    })
    if (data.annotations) setAnnotations(data.annotations)
  }

  /** Delete a reply from an annotation. */
  async function deleteReply(annotationId, replyId) {
    const data = await postAnnotation('deleteReply', {
      id: annotationId,
      replyId,
    })
    if (data.annotations) setAnnotations(data.annotations)
  }

  /** Accept the current drifted location as the new canonical anchor for an annotation. */
  async function acceptDrift(id, range, contextHash) {
    const data = await postAnnotation('acceptDrift', { id, range, contextHash })
    if (data.annotations) setAnnotations(data.annotations)
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  /** Approve a single section by heading text (cascades to children). */
  async function approveSection(heading) {
    const data = await postSection('approve', { heading })
    if (data.sections) setSectionsImmediate(data.sections)
    if (data.sectionLevel != null) sectionLevel.value = data.sectionLevel
  }

  /** Reject a single section by heading text (no cascade). */
  async function rejectSection(heading) {
    const data = await postSection('reject', { heading })
    if (data.sections) setSectionsImmediate(data.sections)
    if (data.sectionLevel != null) sectionLevel.value = data.sectionLevel
  }

  /** Approve all sections in the current file at once. */
  async function approveAllSections() {
    const data = await postSection('approveAll')
    if (data.sections) setSectionsImmediate(data.sections)
  }

  /** Reset a single section to pending. */
  async function resetSection(heading) {
    const data = await postSection('reset', { heading })
    if (data.sections) setSectionsImmediate(data.sections)
    if (data.sectionLevel != null) sectionLevel.value = data.sectionLevel
  }

  /** Reset all section review statuses in the current file. */
  async function clearAllSections() {
    const data = await postSection('clearAll')
    if (data.sections) setSectionsImmediate(data.sections)
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
    editReply,
    deleteReply,
    acceptDrift,
    approveSection,
    rejectSection,
    resetSection,
    approveAllSections,
    clearAllSections,
  }
}

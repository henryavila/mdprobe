import { sections } from '../state/store.js'

export function SectionApproval({ heading, annotationOps }) {
  const section = sections.value.find(s => s.heading === heading)
  if (!section) return null

  const status = section.status
  const computed = section.computed || status

  return (
    <div class="section-approval" style="display: inline-flex; gap: 4px; margin-left: 8px; vertical-align: middle">
      <button
        class={`btn btn-sm ${computed === 'approved' ? 'section-status approved' : computed === 'indeterminate' ? 'section-status indeterminate' : ''}`}
        onClick={() => status === 'approved' ? annotationOps.resetSection(heading) : annotationOps.approveSection(heading)}
        title={computed === 'indeterminate' ? 'Partially approved — click to approve all' : 'Approve section'}
      >
        {computed === 'indeterminate' ? '\u2500' : '\u2713'}
      </button>
      <button
        class={`btn btn-sm ${computed === 'rejected' ? 'section-status rejected' : ''}`}
        onClick={() => status === 'rejected' ? annotationOps.resetSection(heading) : annotationOps.rejectSection(heading)}
        title="Reject section"
      >
        &cross;
      </button>
      <span class={`section-status ${computed}`} style="font-size: 10px">
        {computed}
      </span>
    </div>
  )
}

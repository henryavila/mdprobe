import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/preact'
import { AnnotationForm } from '../../src/ui/components/AnnotationForm.jsx'

afterEach(() => cleanup())

describe('AnnotationForm mode prop', () => {
  it('mode="create" renders tags and full textarea', () => {
    const { container } = render(
      <AnnotationForm mode="create" selectors={{}} onSave={vi.fn()} onCancel={vi.fn()} />
    )
    expect(container.querySelector('.annotation-form__tags')).not.toBeNull()
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('mode="edit" prefills comment and tag', () => {
    const ann = { id: 'x', comment: 'prefilled', tag: 'bug' }
    const { container } = render(
      <AnnotationForm mode="edit" annotation={ann} onSave={vi.fn()} onCancel={vi.fn()} />
    )
    expect(container.querySelector('textarea').value).toBe('prefilled')
    expect(container.querySelector('.tag-pill--active').textContent).toMatch(/Bug/)
  })

  it('mode="reply" hides tag selector and quote', () => {
    const { container } = render(
      <AnnotationForm mode="reply" onSave={vi.fn()} onCancel={vi.fn()} exact="should not appear" />
    )
    expect(container.querySelector('.annotation-form__tags')).toBeNull()
    expect(container.querySelector('.annotation-form__quote')).toBeNull()
  })

  it('mode="reply" submits via Ctrl+Enter with the comment only', () => {
    const onSave = vi.fn()
    const { container } = render(
      <AnnotationForm mode="reply" onSave={onSave} onCancel={vi.fn()} />
    )
    const ta = container.querySelector('textarea')
    fireEvent.input(ta, { target: { value: 'my reply' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith({ comment: 'my reply' })
  })
})

import { theme } from '../state/store.js'

export function ThemePicker({ themes, onSelect }) {
  return (
    <div class="theme-picker" title="Switch theme">
      {themes.map(t => (
        <button
          key={t.id}
          class={`theme-swatch ${theme.value === t.id ? 'active' : ''}`}
          style={`background: ${t.color}`}
          onClick={() => onSelect(t.id)}
          title={t.label}
          aria-label={`Switch to ${t.label} theme`}
        />
      ))}
    </div>
  )
}

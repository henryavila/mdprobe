export function UnsupportedModal() {
  return (
    <div class="unsupported-modal__backdrop">
      <div class="unsupported-modal" role="dialog" aria-modal="true">
        <h2>Browser não suportado</h2>
        <p>
          mdProbe v0.5+ requer um navegador moderno com suporte ao
          CSS Custom Highlight API:
        </p>
        <ul>
          <li>Google Chrome 105+</li>
          <li>Mozilla Firefox 140+</li>
          <li>Apple Safari 17.2+</li>
        </ul>
        <p>
          As anotações continuam acessíveis no painel direito,
          mas o destaque inline está desabilitado.
        </p>
      </div>
    </div>
  )
}

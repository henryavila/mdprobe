import { useEffect, useRef } from 'preact/hooks'
import { currentHtml, theme } from '../state/store.js'

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'
const KATEX_CSS_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css'
const KATEX_JS_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js'

let mermaidLoaded = false
let katexLoaded = false

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
}

function loadCSS(href) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = href
  document.head.appendChild(l)
}

/**
 * Initialize Mermaid diagrams and KaTeX math after content renders.
 * Libraries are loaded lazily from CDN on first use.
 */
export function useClientLibs() {
  const lastHtml = useRef('')

  useEffect(() => {
    if (currentHtml.value === lastHtml.current) return
    lastHtml.current = currentHtml.value

    // Mermaid: render all <pre class="mermaid"> blocks
    const mermaidEls = document.querySelectorAll('pre.mermaid:not([data-processed])')
    if (mermaidEls.length > 0) {
      initMermaid(mermaidEls)
    }

    // KaTeX: render all elements with data-math or math class
    const mathEls = document.querySelectorAll('[data-math], .math-inline, .math-display')
    if (mathEls.length > 0) {
      initKaTeX(mathEls)
    }
  }, [currentHtml.value, theme.value])
}

async function initMermaid(elements) {
  try {
    if (!mermaidLoaded) {
      await loadScript(MERMAID_CDN)
      mermaidLoaded = true
    }
    const isDark = !['latte', 'light'].includes(theme.value)
    window.mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
    })
    // Mermaid 11+ uses run() with nodes
    for (const el of elements) {
      el.setAttribute('data-processed', 'true')
    }
    await window.mermaid.run({ nodes: [...elements] })
  } catch (err) {
    console.warn('mdprobe: Mermaid rendering failed', err)
  }
}

async function initKaTeX(elements) {
  try {
    if (!katexLoaded) {
      loadCSS(KATEX_CSS_CDN)
      await loadScript(KATEX_JS_CDN)
      katexLoaded = true
    }
    for (const el of elements) {
      if (el.getAttribute('data-katex-rendered')) continue
      const tex = el.textContent
      const displayMode = el.classList.contains('math-display')
      try {
        window.katex.render(tex, el, { displayMode, throwOnError: false })
        el.setAttribute('data-katex-rendered', 'true')
      } catch {
        // Leave raw LaTeX visible
      }
    }
  } catch (err) {
    console.warn('mdprobe: KaTeX rendering failed', err)
  }
}

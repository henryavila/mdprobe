# Spec: mdprobe MVP

Data: 2026-04-06

## Objetivo

Criar um markdown viewer + reviewer para terminal/WSL que renderiza `.md` no browser com live reload, anotações persistentes via YAML sidecar, e integração com AI coding agents. Distribuído como npm package (`@henryavila/mdprobe`).

O projeto combina três funções numa única ferramenta:
- **View** — visualizar markdown renderizado no browser (substitui grip/mdserve)
- **Review** — anotar markdown com comentários persistentes (substitui md-review/md-review-plus)
- **Integrate** — embeddable como library em outras ferramentas + plugin para Claude Code

Inspired by [mdserve](https://github.com/jfernandez/mdserve) — the markdown preview server for AI coding agents.

---

## Requisitos Funcionais

### CLI & Server

- **RF01:** `npx @henryavila/mdprobe <path>` inicia server HTTP persistente e abre browser
  - ✓ `mdprobe spec.md` → server sobe, browser abre com spec.md renderizado, server fica rodando
  - ✓ `mdprobe docs/` → server sobe, browser abre com file picker dos .md no diretório (recursivo)
  - ✓ `mdprobe spec.md rfc.md adr.md` → server sobe, browser abre com sidebar listando os 3 arquivos
  - ✓ `mdprobe` (sem args) → server sobe, browser abre com file picker do cwd (recursivo)
  - ✓ server fica rodando (foreground) até Ctrl+C — padrão Jupyter/mkdocs/Storybook
  - ✗ nenhum .md encontrado → erro: "No markdown files found in <path>"

- **RF02:** `mdprobe <path> --once` inicia server em modo review blocking
  - ✓ server sobe, browser abre, processo **bloqueia** até o humano clicar "Finish Review & Close"
  - ✓ ao finalizar: server para, stdout imprime paths dos YAML gerados/atualizados, exit 0
  - ✓ múltiplos arquivos: "Finish Review" por arquivo, "Finish All & Close" no último → server para
  - ✓ 0 anotações criadas ao fechar → confirmação: "Nenhuma anotação criada. Fechar mesmo assim?"
  - ✗ browser fecha sem Finish → server detecta (WebSocket disconnect), aguarda 30s, exit 1

- **RF03:** Port auto-increment quando porta default está em uso
  - ✓ porta 3000 default. Em uso → tenta 3001, até 10 tentativas
  - ✓ porta usada diferente da default → WARN no stdout com URL correta
  - ✓ `--port <N>` para porta específica
  - ✗ 10 tentativas falharam → erro: "No available port found (tried 3000-3009)"

- **RF04:** `mdprobe config author "Henry Avila"` configura author global
  - ✓ salva em `~/.mdprobe.json` → `{ "author": "Henry Avila" }`
  - ✓ `mdprobe config author` (sem valor) → mostra author atual
  - ✓ `mdprobe config` → mostra toda config
  - ✓ primeiro uso sem author → prompt interativo: "Qual seu nome para anotações?"
  - ✗ user cancela prompt → usa "anonymous"

### Rendering

- **RF05:** Markdown renderizado via remark/unified com posições inline (line:column por nó)
  - ✓ GFM: tabelas, task lists, strikethrough, autolinks
  - ✓ Syntax highlighting para code blocks (highlight.js ou Shiki)
  - ✓ Mermaid diagrams (client-side, bundled mermaid.min.js)
  - ✓ KaTeX para math/LaTeX (client-side)
  - ✓ YAML/TOML frontmatter detectado e stripped (não renderizado)
  - ✓ HTML passthrough em markdown
  - ✓ Imagens servidas do diretório do .md e subdiretórios
  - ✓ Cada elemento HTML renderizado tem `data-source-line` e `data-source-col` injetados via plugin remark customizado
  - ✗ arquivo não é .md → erro: "Not a markdown file"

- **RF06:** Live reload via WebSocket com preservação de scroll
  - ✓ file watcher (chokidar) detecta mudanças no .md
  - ✓ WebSocket envia update ao browser
  - ✓ browser re-renderiza conteúdo **preservando posição de scroll**
  - ✓ debouncing de 100ms para batch de mudanças rápidas
  - ✓ novo .md adicionado ao diretório → aparece na file list automaticamente
  - ✗ erro de parse no markdown → mostra último render válido + banner de erro

- **RF07:** 5+ themes com picker e persistência
  - ✓ themes inspirados em Catppuccin: Light, Dark, Latte, Macchiato, Mocha
  - ✓ theme picker acessível na UI (ícone no header)
  - ✓ seleção persiste via localStorage
  - ✓ anti-flash: inline script no `<head>` aplica tema ANTES do primeiro paint
  - ✓ Mermaid re-renderiza com tema correto ao trocar (dark ↔ light)
  - ✗ CSS customizado pelo user → v1.1 (fora do MVP)

### UI Layout

- **RF08:** Layout com dois painéis laterais colapsáveis + área de conteúdo central
  - ✓ Left panel: Files (directory mode) + TOC (seções do doc atual) na mesma sidebar
  - ✓ Right panel: Lista de anotações com filtros
  - ✓ Content: markdown renderizado com highlights de anotações
  - ✓ Ambos painéis colapsáveis para barra fina (48px) com ícone + atalho + badge
  - ✓ Estado dos painéis persiste via localStorage

- **RF09:** Atalhos de teclado sem modifier (teclas soltas, read-only context)
  - ✓ `[` → toggle left panel (Files/TOC)
  - ✓ `]` → toggle right panel (Annotations)
  - ✓ `\` → toggle ambos (focus mode)
  - ✓ `j` / `k` → próxima / anterior anotação
  - ✓ `r` → resolve anotação selecionada
  - ✓ `e` → editar anotação selecionada
  - ✓ `?` → modal com lista de atalhos
  - ✗ cursor em textarea (comment, reply) → atalhos desabilitados automaticamente

- **RF10:** Left panel: Files + TOC na mesma sidebar
  - ✓ seção "Files": lista de .md do diretório (directory mode)
  - ✓ seção "Sections": TOC do doc atual (headings extraídos do AST)
  - ✓ TOC mostra contagem de anotações open por seção (badge numérico)
  - ✓ click em heading no TOC → scroll para a seção no conteúdo
  - ✓ click em arquivo na file list → navega para o arquivo
  - ✓ single file mode → seção Files oculta, só TOC
  - ✓ indicador no painel colapsado: ícone `☰` + tecla `[`

- **RF11:** Right panel: lista de anotações com navegação bidirecional
  - ✓ lista todas anotações do doc atual, ordenadas por posição no doc (default) ou por data
  - ✓ click em anotação na lista → scroll para o trecho no conteúdo
  - ✓ click em highlight no conteúdo → scroll para a anotação na lista
  - ✓ filtros: por tag (dropdown), por author (dropdown), toggle resolved (checkbox)
  - ✓ anotações resolvidas ocultas por default. "Show resolved" link no status bar
  - ✓ indicador no painel colapsado: ícone `💬` + tecla `]` + badge com count de open

### Anotações

- **RF12:** Criar anotação via seleção de texto + popover + form
  - ✓ selecionar texto no conteúdo renderizado → popover "Annotate" aparece na posição da seleção
  - ✓ click no popover → form expande com: texto selecionado (readonly), dropdown tag (default: question), textarea comment (auto-focus)
  - ✓ salvar com `Cmd+Enter` / `Ctrl+Enter` → highlight aparece + card na lista + YAML salvo
  - ✓ cancelar com `Esc`
  - ✓ tags disponíveis: bug, question, suggestion, nitpick
  - ✗ seleção vazia → popover não aparece

- **RF13:** Anotações ancoradas via TextQuoteSelector híbrido (posição + citação + contexto)
  - ✓ ao criar: captura `position` (startLine, startColumn, endLine, endColumn) do markdown source via `data-source-line`/`data-source-col` nos elementos HTML
  - ✓ ao criar: captura `quote` (exact text selecionado) + `prefix` (30 chars antes) + `suffix` (30 chars depois) do markdown source
  - ✓ ao abrir doc com anotações existentes: tenta ancorar pelo position primeiro (rápido)
  - ✓ position falha → tenta exact match do quote no source
  - ✓ exact falha → fuzzy match via diff-match-patch `match_main()` com position como hint
  - ✓ fuzzy falha → marca como orphan, mostra na lista com indicador visual "unresolved anchor"
  - ✗ anotação orphan não mostra highlight no conteúdo (não sabe onde posicionar)

- **RF14:** Editar, resolver e excluir anotações
  - ✓ click no highlight ou card → form abre preenchido (mesma UI de criação)
  - ✓ pode editar: comment, tag. Não pode editar: selected text, author, id
  - ✓ botão "Resolve" → status muda para resolved, highlight desaparece (oculto por default)
  - ✓ botão "Reopen" em anotação resolved → status volta para open
  - ✓ botão "Delete" → confirmação → remove do YAML
  - ✓ `updated_at` atualizado em qualquer modificação
  - ✗ user que não é author → pode ver, não pode editar/deletar

- **RF15:** Threading — replies em anotações
  - ✓ cada anotação tem array `replies`
  - ✓ input de reply embaixo da anotação original (no card do right panel)
  - ✓ reply tem: author, comment, created_at
  - ✓ reply não tem: tag, status, selectors (herda da anotação pai)
  - ✗ reply em reply → flat (só 1 nível de profundidade)

- **RF16:** Section-level approval (inspirado em md-review-plus)
  - ✓ documento dividido em seções por `##` headings
  - ✓ cada seção: botão Approve (verde) / Reject (vermelho) / Pending (default)
  - ✓ status de seções salvo no YAML sidecar em campo `sections`
  - ✓ progress bar no header: "5/8 sections reviewed"
  - ✓ "Approve All" e "Clear All" buttons
  - ✗ doc sem `##` headings → section approval não disponível (só anotações inline)

### Persistência

- **RF17:** Anotações persistidas em YAML sidecar (`spec.annotations.yaml`) ao lado do .md
  - ✓ `spec.md` → `spec.annotations.yaml` (convenção de nome, mesmo diretório)
  - ✓ campo `source: spec.md` dentro do YAML (referência explícita)
  - ✓ campo `source_hash: sha256:...` (hash do .md no momento da última anotação)
  - ✓ campo `version: 1` (schema version)
  - ✓ anotações salvas em tempo real (cada ação = write imediato)
  - ✓ YAML suporta comentários (`#`) — human-readable e human-editable
  - ✗ YAML inválido (editado manualmente com erro) → erro com linha do problema

- **RF18:** Drift detection — detecta quando o .md mudou desde a última review
  - ✓ ao abrir: compara `source_hash` salvo vs hash atual do .md
  - ✓ match → anotações alinhadas, tudo normal
  - ✓ mismatch → banner: "Arquivo modificado desde a última revisão"
  - ✓ re-anchoring automático via fallback chain (RF13)
  - ✓ anotações que não re-ancoram → marcadas como orphan
  - ✗ após re-anchoring bem-sucedido → `source_hash` atualizado automaticamente

### Export

- **RF19:** Export de anotações via CLI e GUI em 4 formatos
  - ✓ CLI: `mdprobe export spec.md --report` → gera `spec.review-report.md` (relatório legível)
  - ✓ CLI: `mdprobe export spec.md --inline` → gera `spec.reviewed.md` (anotações como HTML comments no .md)
  - ✓ CLI: `mdprobe export spec.md --json` → gera `spec.annotations.json`
  - ✓ CLI: `mdprobe export spec.md --sarif` → gera `spec.annotations.sarif` (para VS Code/GitHub)
  - ✓ GUI: menu "Export" no header com 4 opções → download do arquivo / nova tab (report)
  - ✗ YAML sidecar ausente → erro: "No annotations found for spec.md"

### Library Mode

- **RF20:** `createHandler()` retorna HTTP handler embeddable em qualquer server Node.js
  - ✓ handler é `(req, res) => void` puro (Node http), sem dependência de framework
  - ✓ `resolveFile: (req) => string` — função que resolve qual .md servir (obrigatório para acesso direto)
  - ✓ `listFiles: () => Array<{id, path, label}>` — lista arquivos disponíveis (opcional, habilita picker/sidebar)
  - ✓ `basePath: string` — prefixo de URL para montar (default: '/')
  - ✓ `author: string` — override do `~/.mdprobe.json`
  - ✓ `onComplete: (result) => void` — callback quando humano clica "Finish Review"
  - ✓ `result` contém: `{ file, annotations, open, resolved }`
  - ✗ `resolveFile` retorna path inexistente → 404 com mensagem

```javascript
const { createHandler } = require('@henryavila/mdprobe')

const handler = createHandler({
  resolveFile: (req) => `/project/.ai/features/${req.params.id}/spec.md`,
  listFiles: () => [
    { id: '001', path: '/project/.ai/features/001/spec.md', label: '001-auth' },
    { id: '002', path: '/project/.ai/features/002/spec.md', label: '002-api' },
  ],
  basePath: '/review',
  author: 'Henry Avila',
  onComplete: (result) => {
    console.log(`Review done: ${result.open} open, ${result.resolved} resolved`)
  }
})

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/review')) return handler(req, res)
  // ... other routes
})
```

- **RF21:** Helper API para consumers programáticos (`AnnotationFile`)
  - ✓ `AnnotationFile.load(path)` → lê YAML sidecar, retorna instância
  - ✓ `.resolve(id)` → status = resolved
  - ✓ `.reopen(id)` → status = open
  - ✓ `.updateComment(id, text)` → edita comment
  - ✓ `.updateTag(id, tag)` → muda tag (valida contra enum)
  - ✓ `.delete(id)` → remove anotação
  - ✓ `.add({...})` → cria nova anotação (valida contra schema)
  - ✓ `.save()` → persiste no YAML
  - ✓ `.toJSON()` → exporta como JSON
  - ✓ `.toSARIF()` → exporta como SARIF
  - ✗ tag inválida → erro: `Invalid tag "critical". Valid: bug, question, suggestion, nitpick`
  - ✗ id inexistente → erro: `Annotation "xyz" not found`

- **RF22:** JSON Schema distribuído no pacote para validação por consumers
  - ✓ schema em `node_modules/@henryavila/mdprobe/schema.json`
  - ✓ valida: status enum, tag enum, campos obrigatórios, tipos
  - ✓ YAML valida contra JSON Schema (YAML é superset de JSON)
  - ✓ consumers em outras linguagens (Python, Go) usam o schema diretamente

### Plugin Claude Code

- **RF23:** Plugin/skill para Claude Code que ensina quando e como usar mdprobe
  - ✓ instalação: `mdprobe install --plugin` (copia SKILL.md para `.claude/skills/mdprobe/`)
  - ✓ skill ensina: use mdprobe quando output > 40-60 linhas, tabelas, diagramas, specs
  - ✓ skill ensina: NÃO use para respostas curtas, snippets simples
  - ✓ view mode: `mdprobe <file> --open` com `run_in_background: true`, continuar editando
  - ✓ review mode: `mdprobe <file> --once`, aguardar Finish, ler YAML
  - ✓ scopes: project (`.claude/skills/`), global (`~/.claude/skills/`)

---

## Regras de Negocio

- **RN01:** Anotações são YAML sidecar, nunca inline no .md source
  - ✓ `.md` permanece intocado — zero poluição
  - ✓ sidecar pode ser .gitignored (anotações privadas) ou commitado (anotações compartilhadas)
  - ✗ user quer inline → usa export `--inline` (gera cópia, não modifica original)

- **RN02:** Anchoring usa dual selector — position (rápido, frágil) + quote (lento, robusto)
  - ✓ position para lookup O(1) quando doc não mudou
  - ✓ quote + prefix + suffix para re-anchoring quando doc mudou
  - ✓ re-anchoring é transparente — user não percebe
  - ✗ anotação orphan permanece no YAML com flag `anchoring: stale`

- **RN03:** Author é trust-based — cada dev configura seu nome, sem auth
  - ✓ como git: `mdprobe config author "Name"` ≈ `git config user.name "Name"`
  - ✓ um user pode se passar por outro (trust-based, não security-based)
  - ✗ author vazio ou "anonymous" → anotações criadas sem atribuição

- **RN04:** Atalhos de teclado são teclas soltas (sem modifier) porque conteúdo é read-only
  - ✓ `[`, `]`, `\`, `j`, `k`, `r`, `e`, `?` — sem Ctrl/Cmd
  - ✓ quando cursor está em textarea (comment, reply) → atalhos desabilitados
  - ✗ conflito com browser shortcut → teclas escolhidas não conflitam em nenhum browser major

- **RN05:** Server é persistente por default, blocking por flag (`--once`)
  - ✓ default: server roda, user navega livremente, Ctrl+C para parar
  - ✓ `--once`: server bloqueia, "Finish Review" encerra, stdout com resultado
  - ✗ library mode: consumer controla lifecycle via `onComplete` callback

- **RN06:** Anotações resolvidas são ocultas por default na UI
  - ✓ só anotações open visíveis (highlights ativos)
  - ✓ "Show resolved" toggle no status bar para exibir
  - ✓ resolved visíveis: highlights atenuados (opacity ~30%)
  - ✓ filtro persiste na sessão via localStorage

---

## Edge Cases

- **EC01:** Markdown com emoji, unicode, tabelas complexas, code blocks longos
  - ✓ renderiza corretamente. Positions tracking funciona com unicode (remark suporta)

- **EC02:** YAML sidecar editado manualmente com erro de syntax
  - ✓ parse error → mostra erro com número da linha no YAML. Anotações indisponíveis até corrigir

- **EC03:** Dois processos mdprobe servindo o mesmo arquivo
  - ✓ port auto-increment — cada um em porta diferente
  - ✓ ambos leem/escrevem o mesmo YAML — last write wins (aceito para MVP single-dev)

- **EC04:** .md com 1000+ linhas
  - ✓ renderiza normalmente. TOC sidebar essencial para navegação
  - ✓ virtual scrolling NÃO necessário no MVP (browser lida com HTML longo)

- **EC05:** Sidecar existe mas source .md foi deletado
  - ✓ `mdprobe` detecta sidecar sem source → WARN: "Orphan sidecar: spec.annotations.yaml (source not found)"

- **EC06:** WSL2 — browser opening
  - ✓ `xdg-open` com Chrome configurado funciona
  - ✓ fallback: mostra URL no terminal para acesso manual
  - ✓ server escuta em `127.0.0.1` (localhost, WSL2 port forwarding automático)

- **EC07:** .md sem nenhum heading `##`
  - ✓ TOC fica vazio (ou mostra "No sections")
  - ✓ section-level approval desabilitado
  - ✓ anotações inline funcionam normalmente

- **EC08:** Anotação em texto dentro de code block
  - ✓ seleção funciona, positions capturados. Code block tem `data-source-line`
  - ✓ highlight visual aplicado sobre o code block

---

## Schema: YAML Sidecar

### Annotation file (`spec.annotations.yaml`)

```yaml
version: 1
source: spec.md
source_hash: sha256:abc123def456...

sections:
  - heading: "Requisitos Funcionais"
    status: approved    # approved | rejected | pending
  - heading: "Edge Cases"
    status: pending

annotations:
  - id: a1b2c3
    selectors:
      position:
        startLine: 12
        startColumn: 5
        endLine: 12
        endColumn: 42
      quote:
        exact: "O sistema valida todos os inputs"
        prefix: "- **RF01:** "
        suffix: "\n  - ✓ input"
    comment: "Quais inputs? Precisa especificar campos"
    tag: question         # bug | question | suggestion | nitpick
    status: open          # open | resolved
    author: Henry
    created_at: 2026-04-06T12:00:00Z
    updated_at: 2026-04-06T12:00:00Z
    replies:
      - author: Maria
        comment: "userId (string) e options (object)"
        created_at: 2026-04-06T12:05:00Z
```

### Config global (`~/.mdprobe.json`)

```json
{
  "author": "Henry Avila"
}
```

---

## Arquivos Envolvidos

- `package.json` — novo — npm package definition
- `bin/cli.js` — novo — CLI entry point (serve, config, export, install)
- `src/server.js` — novo — HTTP server + WebSocket + file watcher
- `src/renderer.js` — novo — remark/unified pipeline (parse → positions → HTML)
- `src/annotations.js` — novo — AnnotationFile helper API (load, save, CRUD)
- `src/anchoring.js` — novo — TextQuoteSelector creation + re-anchoring (diff-match-patch)
- `src/export.js` — novo — export to report/inline/JSON/SARIF
- `src/config.js` — novo — read/write ~/.mdprobe.json
- `src/handler.js` — novo — createHandler() para library mode
- `src/hash.js` — novo — SHA-256 utility para source_hash
- `src/ui/index.html` — novo — entry HTML (Vite dev) / single-file output (prod)
- `src/ui/app.jsx` — novo — root Preact component
- `src/ui/components/LeftPanel.jsx` — novo — Files + TOC sidebar (Preact)
- `src/ui/components/RightPanel.jsx` — novo — Annotations list + filters (Preact)
- `src/ui/components/Content.jsx` — novo — rendered markdown + highlights (Preact)
- `src/ui/components/AnnotationForm.jsx` — novo — create/edit annotation form (Preact)
- `src/ui/components/ReplyThread.jsx` — novo — reply list + input (Preact)
- `src/ui/components/SectionApproval.jsx` — novo — approve/reject/pending per section (Preact)
- `src/ui/components/ThemePicker.jsx` — novo — 5 themes Catppuccin (Preact)
- `src/ui/components/Popover.jsx` — novo — text selection popover (Preact)
- `src/ui/components/ExportMenu.jsx` — novo — export dropdown 4 formatos (Preact)
- `src/ui/hooks/useWebSocket.js` — novo — live reload + scroll preserve
- `src/ui/hooks/useKeyboard.js` — novo — keyboard shortcuts (context-aware)
- `src/ui/hooks/useAnnotations.js` — novo — annotation CRUD via HTTP
- `src/ui/hooks/useTheme.js` — novo — theme persist + anti-flash
- `src/ui/state/store.js` — novo — @preact/signals global state
- `src/ui/styles/themes.css` — novo — CSS (Catppuccin vars, layout, highlights, panels)
- `schema.json` — novo — contract — JSON Schema do YAML sidecar
- `skills/mdprobe/SKILL.md` — novo — Claude Code plugin skill
- `templates/review-report.md` — novo — template do export report
- `vite.config.js` — novo — Vite config (Preact preset + singlefile plugin)
- `vitest.config.js` — novo — Vitest test runner config

### Build Pipeline

```
src/ui/ (Preact + htm + CSS)
  → vite build
  → vite-plugin-singlefile
  → dist/index.html (single file, tudo inline)
  → copiado para src/ui-dist/index.html
  → embeddado no npm package
  → server.js serve este arquivo
  → consumer roda npx mdprobe e recebe HTML pronto
```

### Test Architecture

```
tests/
├── unit/                          # Sem I/O, sem server, sem browser
│   ├── hash.test.js               # RF18 — SHA-256, drift detection
│   ├── config.test.js             # RF04 — author config
│   ├── schema.test.js             # RF22 — JSON Schema validation
│   ├── renderer.test.js           # RF05 — remark pipeline, positions
│   ├── annotations.test.js        # RF14-17, RF21 — AnnotationFile CRUD
│   ├── anchoring.test.js          # RF13 — TextQuoteSelector, re-anchoring
│   └── export.test.js             # RF19 — 4 export formats
├── integration/                   # HTTP, WebSocket, filesystem
│   ├── server.test.js             # RF01-03 — server lifecycle, ports
│   ├── handler.test.js            # RF20 — createHandler library mode
│   ├── live-reload.test.js        # RF06 — chokidar + WebSocket
│   └── cli.test.js                # CLI arg parsing, subcommands
└── fixtures/                      # Arquivos de teste
    ├── sample.md                  # Spec simples com headings
    ├── complex.md                 # GFM, mermaid, KaTeX, frontmatter
    ├── shifted.md                 # sample.md com 5 linhas extras (re-anchoring)
    ├── edited.md                  # sample.md com edições (fuzzy match)
    ├── no-headings.md             # Sem headings (section approval disabled)
    ├── empty.md                   # Vazio
    ├── sample.annotations.yaml    # Sidecar válido com 3 anotações
    └── invalid.annotations.yaml   # YAML com erros de syntax
```

---

## Decisoes Tomadas

- **Node.js (não Rust):** remark/unified (JS) necessário para posições inline. Coerência com atomic-flow. `npx` para distribuição.
- **Inspired by mdserve (não fork):** mdserve rejeita extensibilidade. Fork que diverge é pior que projeto novo. Copiar ideias (plugin, themes, DX), não código.
- **YAML sidecar (não JSON, não inline, não DB):** YAML é human-readable, suporta comments, git diffs limpos. JSON não suporta comentários. Inline polui o source. DB é overkill para CLI.
- **TextQuoteSelector (W3C/Hypothesis pattern):** Proven em milhões de anotações. Position para fast path, quote+prefix+suffix para re-anchoring robusto.
- **remark/unified (não marked.js, não markdown-it):** remark fornece posições inline (line:column por nó). markdown-it só fornece block-level. marked.js idem.
- **diff-match-patch para fuzzy re-anchoring:** Proven no Google Docs. `match_main()` combina fuzzy match com position hint.
- **Teclas soltas para atalhos:** Conteúdo é read-only. Sem modifier = mais rápido. Padrão Gmail/GitHub. Desabilitam em textarea.
- **Server persistente (não blocking):** View mode é uso diário. Server fica rodando enquanto dev trabalha. `--once` para review pontual (automação/CI/agent loops).
- **Multi-user trust-based:** Como git. Cada dev configura nome. Sem auth/login.
- **Anotações resolvidas ocultas:** Foco nas pendentes. Toggle para exibir. Filtro persiste.
- **Section approval no YAML:** Status por seção (approved/rejected/pending) salvo junto com anotações. Uma fonte de verdade.
- **Preact + htm + @preact/signals (não React, não vanilla JS, não Lit):** Preact é 4.5KB (React é 42KB) com API idêntica. `htm` permite dev sem build step. Signals resolve state compartilhado (anotação criada atualiza 5+ componentes) sem event bus manual. Hypothesis (web annotator, 50M+ anotações) usa Preact pelo mesmo motivo. Lit eliminado porque Shadow DOM quebra `window.getSelection()` — inviável para RF12 (seleção → popover). Vanilla JS para 12+ componentes interativos resultaria em ~5000 linhas com event bus caseiro (essencialmente um framework reinventado). O consumer nunca vê o Preact — recebe HTML pre-built via `npx`.
- **Vite + vite-plugin-singlefile (build tooling):** Vite para dev (HMR instantâneo) e build. `vite-plugin-singlefile` gera um `index.html` único com tudo inline — servido pelo server HTTP. Build é problema do publisher, não do consumer. `@preact/preset-vite` para JSX/htm.
- **Vitest (não Jest):** ESM nativo, rápido, API compatível com Jest. Mesmo ecossistema Vite.
- **Anchoring layer em vanilla JS (não Preact):** Assim como Hypothesis, o código de anchoring (TextQuoteSelector, diff-match-patch, DOM↔source mapping) fica como módulo JS puro. Preact cuida só da UI.

## Alternativas Rejeitadas

- **Rust binary:** Precisamos de remark (JS) para posições inline. Rust server seria um file server glorificado + uma segunda linguagem para manter.
- **Fork do mdserve:** mdserve tem 790 linhas Rust. Nossas mudanças (annotations, remark, YAML) divergiriam completamente. Fork morto.
- **JSON sidecar:** JSON não suporta comentários. Git diffs mais ruidosos (chaves, vírgulas). YAML é superset de JSON — consumers JSON leem via helper API.
- **Inline annotations (CriticMarkup/HTML comments):** Polui o source. Precisa de decisão do user (commitar poluição?). YAML sidecar é opt-in (commit ou .gitignore).
- **SQLite para anotações:** Overkill para CLI tool. Binário não-diffable no git. YAML é text, diffable, human-editable.
- **Git notes:** Não pushed/fetched por default. Não clonado. Sem anchoring line-level.
- **localStorage (como md-review):** Perdido ao mudar browser/máquina. Não versionável. Não compartilhável.
- **marked.js / markdown-it:** Só block-level positions. Insuficiente para anchoring preciso de inline text.
- **`Cmd+J` para panel:** Conflita com Downloads no Chrome. Teclas soltas (`[`, `]`) são mais acessíveis.
- **nome `md-review`:** Tomado no npm (v1.3.2, ryo-manba).
- **React:** 42KB vs 4.5KB do Preact, API idêntica. Overhead injustificável para asset embutido em CLI tool. Features exclusivas do React (Server Components, Concurrent Mode, Suspense) irrelevantes para este caso.
- **Vanilla JS:** mdserve funciona com 753 linhas porque só faz preview. mdprobe tem 12+ componentes interativos — vanilla resultaria em ~5000 linhas com framework caseiro (event bus, DOM reconciliation manual). CodeMirror 6 e Monaco provam que escala, mas com investimento desproporcional para o escopo.
- **Lit (Web Components):** Shadow DOM quebra `window.getSelection()` across boundaries. Inviável para text selection → annotation (RF12). Dealbreaker.
- **Svelte:** Viável mas requer build step obrigatório. Preact + htm permite dev buildless. Ecossistema menor. Bundle slightly menor (~2KB vs 4.5KB) mas irrelevante ao lado do Mermaid (2.5MB).
- **Alpine.js:** 15KB (3x Preact) com menos capacidade. HTML-first é awkward para component composition complexa (threading, bidirectional scroll, fuzzy anchoring).

---

## Test Contracts

### RF01: Server persistente
- **TC-RF01-1** [business]: {`mdprobe spec.md`} → {server sobe, browser abre com spec.md renderizado, server continua rodando}
- **TC-RF01-2** [business]: {`mdprobe docs/`} → {server sobe, browser abre com file picker, lista .md recursivamente}
- **TC-RF01-3** [business]: {`mdprobe spec.md rfc.md`} → {browser abre com sidebar listando 2 arquivos}
- **TC-RF01-4** [edge]: {`mdprobe` em dir sem .md} → {erro: "No markdown files found"}
- **TC-RF01-5** [business]: {Ctrl+C no terminal} → {server para, exit 0}

### RF02: Review mode (--once)
- **TC-RF02-1** [business]: {`mdprobe spec.md --once`} → {server bloqueia, humano anota, Finish → stdout com paths, exit 0}
- **TC-RF02-2** [business]: {`mdprobe spec.md rfc.md --once`} → {Finish no último → server para}
- **TC-RF02-3** [edge]: {0 anotações + Finish} → {confirmação "Nenhuma anotação. Fechar?"}
- **TC-RF02-4** [error]: {browser fecha sem Finish} → {30s timeout, exit 1}
- **TC-RF02-5** [business]: {stdout após Finish} → {`spec.annotations.yaml    # 4 annotations (3 open, 1 resolved)`}

### RF03: Port auto-increment
- **TC-RF03-1** [business]: {porta 3000 livre} → {server em 3000}
- **TC-RF03-2** [edge]: {porta 3000 em uso} → {server em 3001, WARN no stdout}
- **TC-RF03-3** [error]: {portas 3000-3009 todas em uso} → {erro: "No available port"}

### RF04: Config author
- **TC-RF04-1** [business]: {`mdprobe config author "Henry"`} → {~/.mdprobe.json criado/atualizado}
- **TC-RF04-2** [business]: {`mdprobe config author`} → {stdout: "Henry"}
- **TC-RF04-3** [edge]: {primeiro uso sem config} → {prompt interativo}
- **TC-RF04-4** [edge]: {user cancela prompt} → {author = "anonymous"}

### RF05: Rendering
- **TC-RF05-1** [business]: {.md com tabela GFM} → {tabela HTML renderizada corretamente}
- **TC-RF05-2** [business]: {code block com `language-javascript`} → {syntax highlighted}
- **TC-RF05-3** [business]: {code block com `language-mermaid`} → {diagrama renderizado}
- **TC-RF05-4** [business]: {`$E=mc^2$` no .md} → {KaTeX renderiza fórmula}
- **TC-RF05-5** [business]: {YAML frontmatter no topo} → {stripped, não renderizado}
- **TC-RF05-6** [business]: {elementos HTML} → {cada um tem `data-source-line` e `data-source-col`}

### RF06: Live reload
- **TC-RF06-1** [business]: {editar spec.md em outro editor} → {browser atualiza em <500ms, scroll preservado}
- **TC-RF06-2** [edge]: {salvar 10x em 1 segundo} → {debounce, 1-2 reloads (não 10)}
- **TC-RF06-3** [edge]: {novo arquivo added.md no dir} → {aparece na file list}
- **TC-RF06-4** [error]: {markdown com syntax error} → {último render válido + banner de erro}

### RF07: Themes
- **TC-RF07-1** [business]: {trocar de Mocha para Light} → {UI atualiza imediato, Mermaid re-renderiza}
- **TC-RF07-2** [business]: {fechar e reabrir} → {tema persiste (localStorage)}
- **TC-RF07-3** [business]: {primeira abertura} → {sem flash de tema errado (anti-flash script)}

### RF09: Atalhos
- **TC-RF09-1** [business]: {tecla `[`} → {left panel toggle}
- **TC-RF09-2** [business]: {tecla `]`} → {right panel toggle}
- **TC-RF09-3** [business]: {tecla `\`} → {ambos toggle (focus mode)}
- **TC-RF09-4** [business]: {cursor em textarea + tecla `[`} → {caractere `[` digitado, panel não toggle}
- **TC-RF09-5** [business]: {tecla `j` com anotação selecionada} → {scroll para próxima}

### RF12: Criar anotação
- **TC-RF12-1** [business]: {selecionar "valida todos os inputs"} → {popover "Annotate" aparece}
- **TC-RF12-2** [business]: {preencher form + Cmd+Enter} → {highlight + card + YAML salvo}
- **TC-RF12-3** [business]: {Esc no form} → {form fecha, nenhuma anotação criada}
- **TC-RF12-4** [edge]: {seleção vazia} → {popover não aparece}

### RF13: Anchoring
- **TC-RF13-1** [business]: {abrir doc com anotações, doc não mudou} → {position match, highlights corretos}
- **TC-RF13-2** [business]: {abrir doc com anotações, 5 linhas adicionadas antes do trecho} → {position falha, quote exact match, highlights corretos}
- **TC-RF13-3** [business]: {abrir doc com anotações, trecho levemente editado} → {exact falha, fuzzy match, highlights corretos}
- **TC-RF13-4** [error]: {abrir doc com anotações, trecho completamente reescrito} → {todos falham, annotation marcada orphan}

### RF14: Editar/resolver/excluir
- **TC-RF14-1** [business]: {click highlight → Edit → mudar tag → Save} → {YAML atualizado, updated_at mudou}
- **TC-RF14-2** [business]: {click highlight → Resolve} → {highlight desaparece, anotação oculta}
- **TC-RF14-3** [business]: {toggle "Show resolved" → click → Reopen} → {anotação volta a open, highlight reaparece}
- **TC-RF14-4** [business]: {click highlight → Delete → confirmar} → {removido do YAML}
- **TC-RF14-5** [edge]: {user não é author → click highlight} → {view only, sem botões Edit/Delete}

### RF15: Replies
- **TC-RF15-1** [business]: {digitar reply + Enter} → {reply adicionado ao array, YAML salvo}
- **TC-RF15-2** [business]: {3 replies em sequência} → {todas exibidas em ordem cronológica}

### RF16: Section approval
- **TC-RF16-1** [business]: {click Approve em "Requisitos Funcionais"} → {seção verde, YAML sections atualizado}
- **TC-RF16-2** [business]: {click Reject em "Edge Cases"} → {seção vermelha, YAML sections atualizado}
- **TC-RF16-3** [business]: {"Approve All"} → {todas seções approved}
- **TC-RF16-4** [edge]: {doc sem ## headings} → {section approval não disponível}
- **TC-RF16-5** [business]: {3/5 seções reviewed} → {progress bar "3/5 sections reviewed"}

### RF17: YAML sidecar
- **TC-RF17-1** [business]: {criar primeira anotação em spec.md} → {spec.annotations.yaml criado}
- **TC-RF17-2** [business]: {campo source = "spec.md", version = 1, source_hash presente}
- **TC-RF17-3** [edge]: {YAML com syntax error} → {erro com linha do problema}

### RF18: Drift detection
- **TC-RF18-1** [business]: {abrir spec.md, hash match} → {tudo normal}
- **TC-RF18-2** [business]: {abrir spec.md, hash mismatch} → {banner "Arquivo modificado desde a última revisão"}
- **TC-RF18-3** [business]: {re-anchoring bem-sucedido} → {source_hash atualizado no YAML}

### RF19: Export
- **TC-RF19-1** [business]: {`mdprobe export spec.md --report`} → {spec.review-report.md legível}
- **TC-RF19-2** [business]: {`mdprobe export spec.md --inline`} → {spec.reviewed.md com HTML comments}
- **TC-RF19-3** [business]: {`mdprobe export spec.md --json`} → {spec.annotations.json}
- **TC-RF19-4** [business]: {`mdprobe export spec.md --sarif`} → {spec.annotations.sarif válido}
- **TC-RF19-5** [business]: {GUI Export → Report} → {nova tab com relatório renderizado}
- **TC-RF19-6** [error]: {export sem sidecar} → {erro: "No annotations found"}

### RF20: Library mode
- **TC-RF20-1** [business]: {`createHandler({resolveFile})`, request GET /review/001} → {spec.md renderizado}
- **TC-RF20-2** [business]: {`createHandler({listFiles})`, request GET /review} → {file picker}
- **TC-RF20-3** [business]: {onComplete callback} → {chamado com {file, annotations, open, resolved}}
- **TC-RF20-4** [error]: {resolveFile retorna path inexistente} → {404}

### RF21: Helper API
- **TC-RF21-1** [business]: {`AnnotationFile.load('spec.annotations.yaml')`} → {instância com anotações}
- **TC-RF21-2** [business]: {`.resolve('a1b2c3')` + `.save()`} → {YAML: status = resolved}
- **TC-RF21-3** [error]: {`.updateTag('a1b2c3', 'critical')`} → {erro: "Invalid tag"}
- **TC-RF21-4** [error]: {`.resolve('inexistente')`} → {erro: "Annotation not found"}

### RF22: JSON Schema
- **TC-RF22-1** [business]: {require('@henryavila/mdprobe/schema.json')} → {schema válido}
- **TC-RF22-2** [business]: {validar YAML correto contra schema} → {passa}
- **TC-RF22-3** [error]: {validar YAML com status "fixed" contra schema} → {falha: enum violation}

---

## Fora de Escopo

- Custom CSS/themes via arquivo do user — v1.1
- Export para PDF — v1.1
- LSP server (anotações como diagnostics no editor) — v1.1
- SARIF import (ler SARIF e converter para YAML sidecar) — v1.1
- MCP server — v1.1
- Modo inline bidirecional (sync inline ↔ sidecar) — v1.1
- Virtual scrolling para docs enormes (10K+ linhas) — v1.1
- Multi-user collaborative real-time (CRDT/WebSocket) — v2
- Auth/login — v2
- Diff view entre versões de anotações — v2
- Image annotation (selecionar regiões de imagem) — v2
- Video/audio annotation — fora do escopo completamente

---

## Competitive Positioning

| Need | Recommended tool |
|------|-----------------|
| Quick markdown preview while coding | [mdserve](https://github.com/jfernandez/mdserve) — fast Rust binary, zero config |
| Add quick comments to share with AI | [md-review](https://github.com/ryo-manba/md-review) — lightweight, clipboard-friendly |
| Section-level approval workflow | [md-review-plus](https://github.com/Seiraiyu/md-review-plus) — approve/reject sections |
| **Persistent annotations that survive git** | **mdprobe** |
| **View + Review in one tool** | **mdprobe** |
| **Structured feedback (YAML/JSON Schema)** | **mdprobe** |
| **Embeddable in other tools (library mode)** | **mdprobe** |

Key differentiators: YAML sidecar persistence, W3C TextQuoteSelector anchoring with fuzzy re-anchoring, JSON Schema contract, embeddable library mode, dual view+review tool.

Full competitive analysis: see `atomic-flow/docs/specs/competitive-analysis.md`

---

## Research References

- `atomic-flow/reference/research-annotation-anchoring.md` — Hypothesis, W3C, remark, diff-match-patch, VS Code sync
- `atomic-flow/docs/specs/research-annotation-persistence.md` — 15 persistence approaches (inline, sidecar, git, server, SARIF)
- `atomic-flow/docs/specs/research-mdserve-deep-dive.md` — mdserve architecture, plugin, gaps
- `atomic-flow/docs/specs/research-md-viewers-terminal.md` — grip, glow, Jupyter pattern, WSL2
- `atomic-flow/docs/specs/competitive-analysis.md` — md-review vs md-review-plus vs mdserve

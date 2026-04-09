![mdProbe](header.png)

# mdProbe

Visualizador e revisor de markdown com live reload, anotações persistentes e integração com agentes de IA.

Abra arquivos `.md` no browser, anote inline, aprove seções e exporte feedback estruturado em YAML — tudo pelo terminal.

---

## O que o mdProbe é

- Uma **ferramenta CLI** que renderiza markdown no browser com live reload
- Um **sistema de anotações** onde você seleciona texto e adiciona comentários com tags (bug, question, suggestion, nitpick)
- Um **workflow de revisão** com aprovação por seção (aprovar/rejeitar por heading)
- Um **servidor MCP** que permite agentes de IA (Claude Code, Cursor, etc.) abrir arquivos, ler anotações e resolver feedback programaticamente

## O que o mdProbe não é

- Não é um editor de markdown — você edita no seu editor, o mdprobe renderiza e anota
- Não é um gerador de sites estáticos — ele roda um servidor local para preview ao vivo
- Não é exclusivo para IA — funciona perfeitamente como ferramenta standalone de revisão

---

## Instalação

```bash
npm install -g @henryavila/mdprobe
mdprobe setup
```

O wizard de setup configura seu nome de autor, instala a skill de IA nas IDEs detectadas (Claude Code, Cursor, Gemini), registra o servidor MCP e adiciona um hook PostToolUse.

Para ambientes não-interativos: `mdprobe setup --yes --author "Seu Nome"`

Ou execute sem instalar:

```bash
npx @henryavila/mdprobe README.md
```

**Requisitos:** Node.js 20+, um browser.

---

## Início Rápido

### Visualizar e editar

```bash
mdprobe README.md
```

Abre o markdown renderizado no browser. Edite o arquivo fonte — o browser atualiza instantaneamente via WebSocket.

```bash
mdprobe docs/
```

Descobre todos os `.md` recursivamente e mostra um seletor de arquivos.

### Anotar

Selecione qualquer texto no browser → escolha uma tag → escreva um comentário → salve.

| Tag | Significado |
|-----|-------------|
| `bug` | Algo está errado |
| `question` | Precisa de esclarecimento |
| `suggestion` | Ideia de melhoria |
| `nitpick` | Detalhe menor de estilo/texto |

Anotações são armazenadas em arquivos sidecar `.annotations.yaml` — legíveis por humanos, amigáveis para git.

---

## Servidor Singleton

O mdProbe roda uma **única instância do servidor**. Múltiplas invocações compartilham o mesmo servidor ao invés de iniciar duplicatas:

```bash
mdprobe README.md          # Inicia servidor na porta 3000, abre browser
mdprobe CHANGELOG.md       # Detecta servidor rodando, adiciona arquivo, abre browser, sai
```

A segunda invocação adiciona seus arquivos ao servidor existente e sai imediatamente. O browser mostra todos os arquivos na sidebar.

**Como funciona:** Um lock file em `/tmp/mdprobe.lock` registra o PID, porta e URL do servidor rodando. Novas invocações leem o lock file, verificam se o servidor está vivo via health check HTTP, e entram via `POST /api/add-files`. Ao desligar (`Ctrl+C`), o lock file é removido automaticamente.

**Recuperação de lock stale:** Se uma instância anterior crashou, a próxima invocação detecta o processo morto e inicia normalmente.

---

## Dois Workflows de Revisão

O mdProbe suporta dois workflows de revisão distintos para contextos diferentes:

### 1. Revisão bloqueante (`--once`) — para CI/CD e scripts

```bash
mdprobe spec.md --once
```

Bloqueia o processo até você clicar **"Finish Review"** na UI. Ao finalizar, as anotações são salvas em `spec.annotations.yaml` e o processo sai com a lista de arquivos criados. Útil para pipelines que precisam de aprovação humana antes de continuar.

O modo `--once` sempre cria uma **instância isolada** — não participa do singleton. Isso garante que sessões de revisão tenham ciclo de vida independente.

### 2. Revisão assistida por IA (MCP) — para agentes de código

Ao trabalhar com agentes de IA (Claude Code, Cursor, etc.), o workflow é diferente. O agente **não usa `--once`**. Em vez disso:

```
Agente escreve spec.md
    ↓
Agente chama mdprobe_view → browser abre, servidor continua rodando
    ↓
Humano lê, anota, aprova/rejeita seções
    ↓
Humano diz ao agente via chat: "terminei de revisar"
    ↓
Agente chama mdprobe_annotations → lê todo o feedback
    ↓
Agente corrige bugs, responde perguntas, avalia sugestões
    ↓
Agente reporta mudanças, pede confirmação
    ↓
Agente chama mdprobe_update → resolve anotações
    ↓
Humano vê itens resolvidos em tempo real (esmaecidos)
```

O servidor continua rodando durante toda a conversa. O agente lê anotações sob demanda — sem bloqueio, sem sair do processo. Múltiplos arquivos podem ser revisados na mesma sessão via servidor singleton.

---

## Funcionalidades

### Renderização

Tabelas GFM, syntax highlighting (highlight.js), diagramas Mermaid, math/LaTeX (KaTeX), frontmatter YAML/TOML, HTML raw, imagens do diretório fonte.

### Live Reload

Mudanças detectadas via chokidar, enviadas por WebSocket. Debounce de 100ms. Posição de scroll preservada.

### Aprovação de Seções

Cada heading ganha botões de aprovar/rejeitar. Aprovar um pai cascateia para todos os filhos. Barra de progresso mostra seções revisadas vs total.

### Detecção de Drift

Banner de aviso quando o arquivo fonte muda após as anotações terem sido criadas.

### Temas

Cinco temas baseados no Catppuccin: Mocha (escuro, padrão), Macchiato, Frappe, Latte, Light.

### Atalhos de Teclado

| Tecla | Ação |
|-------|------|
| `[` | Toggle painel esquerdo (arquivos + TOC) |
| `]` | Toggle painel direito (anotações) |
| `\` | Modo foco (esconde ambos os painéis) |
| `j` / `k` | Próxima / anterior anotação |
| `?` | Overlay de ajuda |
| `Ctrl+Enter` | Salvar anotação |

### Exportação

```bash
mdprobe export spec.md --report   # Relatório de revisão em markdown
mdprobe export spec.md --inline   # Anotações inseridas no fonte
mdprobe export spec.md --json     # JSON puro
mdprobe export spec.md --sarif    # SARIF 2.1.0 (integração CI/CD)
```

---

## Integração com Agentes de IA

O mdProbe inclui um servidor MCP (Model Context Protocol) e um arquivo de skill (`SKILL.md`) que ensina agentes de IA a usar o workflow de revisão. Isso habilita um loop bidirecional: o agente escreve markdown, o humano anota, o agente lê o feedback e resolve.

### Setup

```bash
mdprobe setup
```

Wizard interativo que:
1. Instala o `SKILL.md` nas IDEs detectadas (Claude Code, Cursor, Gemini)
2. Registra o servidor MCP (`mdprobe mcp`) na config do Claude Code
3. Adiciona um hook PostToolUse que lembra o agente de usar mdprobe ao editar `.md`
4. Configura seu nome de autor

Não-interativo: `mdprobe setup --yes --author "Seu Nome"`
Remover tudo: `mdprobe setup --remove`

### Ferramentas MCP

Após o setup, agentes de IA podem chamar estas ferramentas:

| Ferramenta | Propósito |
|------------|-----------|
| `mdprobe_view` | Abrir `.md` no browser |
| `mdprobe_annotations` | Ler anotações e status das seções |
| `mdprobe_update` | Resolver, responder, adicionar ou deletar anotações |
| `mdprobe_status` | Verificar se o servidor está rodando |

O servidor MCP participa do singleton — se um servidor iniciado via CLI já estiver rodando, o agente o reutiliza.

### Registro Manual do MCP

Se preferir não usar `mdprobe setup`:

```bash
claude mcp add --scope user --transport stdio mdprobe -- mdprobe mcp
```

---

## Referência CLI

```
mdprobe [arquivos...] [opções]

Opções:
  --port <n>      Porta (padrão: 3000, auto-incrementa se ocupada)
  --once          Revisão bloqueante — servidor isolado, sai ao "Finish Review"
  --no-open       Não abrir browser automaticamente
  --help, -h      Mostrar ajuda
  --version, -v   Mostrar versão

Subcomandos:
  setup                  Setup interativo (skill + MCP + hook)
  setup --remove         Desinstalar tudo
  setup --yes [--author] Setup não-interativo
  mcp                    Iniciar servidor MCP (stdio, para agentes de IA)
  config [key] [value]   Gerenciar configuração
  export <path> [flags]  Exportar anotações (--report, --inline, --json, --sarif)
```

---

## API como Biblioteca

### Embutir no seu próprio servidor

```javascript
import { createHandler } from '@henryavila/mdprobe'

const handler = createHandler({
  resolveFile: (req) => '/path/to/file.md',
  listFiles: () => [
    { id: 'spec', path: '/docs/spec.md', label: 'Especificação' },
  ],
  basePath: '/review',
  author: 'Review Bot',
  onComplete: (result) => {
    console.log(`Revisão concluída: ${result.annotations} anotações`)
  },
})

import http from 'node:http'
http.createServer(handler).listen(3000)
```

### Trabalhando com anotações programaticamente

```javascript
import { AnnotationFile } from '@henryavila/mdprobe/annotations'

const af = await AnnotationFile.load('spec.annotations.yaml')

// Consultar
const open = af.getOpen()
const bugs = af.getByTag('bug')

// Modificar
af.add({
  selectors: {
    position: { startLine: 10, startColumn: 1, endLine: 10, endColumn: 40 },
    quote: { exact: 'texto selecionado', prefix: '', suffix: '' },
  },
  comment: 'Isso precisa de esclarecimento',
  tag: 'question',
  author: 'Henry',
})
af.resolve(bugs[0].id)
await af.save('spec.annotations.yaml')

// Exportar
import { exportJSON, exportSARIF } from '@henryavila/mdprobe/export'
const sarif = exportSARIF(af, 'spec.md')
```

---

## Schema de Anotações

Formato do arquivo sidecar (`<arquivo>.annotations.yaml`):

```yaml
version: 1
source: spec.md
source_hash: "sha256:abc123..."
sections:
  - heading: Introdução
    level: 2
    status: approved
annotations:
  - id: "a1b2c3d4"
    selectors:
      position: { startLine: 15, startColumn: 1, endLine: 15, endColumn: 42 }
      quote: { exact: "O sistema deve suportar usuários concorrentes" }
    comment: "Quantos usuários concorrentes?"
    tag: question
    status: open
    author: Henry
    created_at: "2026-04-08T10:30:00.000Z"
    replies:
      - author: Agente
        comment: "Meta é 500 concorrentes."
        created_at: "2026-04-08T11:00:00.000Z"
```

JSON Schema disponível em `@henryavila/mdprobe/schema.json`.

---

## API HTTP

Disponível quando o servidor está rodando:

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/files` | Listar arquivos markdown |
| `GET` | `/api/file?path=<arquivo>` | HTML renderizado + TOC + frontmatter |
| `GET` | `/api/annotations?path=<arquivo>` | Anotações + seções + status de drift |
| `POST` | `/api/annotations` | Criar/atualizar/deletar anotações |
| `POST` | `/api/sections` | Aprovar/rejeitar/resetar seções |
| `GET` | `/api/export?path=<arquivo>&format=<fmt>` | Exportar (json, report, inline, sarif) |
| `GET` | `/api/status` | Identidade do servidor, PID, porta, lista de arquivos |
| `POST` | `/api/add-files` | Adicionar arquivos a servidor rodando (singleton join) |

WebSocket em `/ws` para atualizações em tempo real.

---

## Desenvolvimento

```bash
git clone https://github.com/henryavila/mdprobe.git
cd mdprobe
npm install
npm run build:ui
npm test
```

### Estrutura do Projeto

```
bin/cli.js              Entry point da CLI
src/
  server.js             Servidor HTTP + WebSocket
  singleton.js          Lock file + coordenação singleton cross-process
  mcp.js                Servidor MCP (4 tools, transporte stdio)
  renderer.js           Markdown → HTML (unified/remark/rehype)
  annotations.js        CRUD de anotações + aprovação de seções
  export.js             Exportação: report, inline, JSON, SARIF
  setup.js              Registro de skill + MCP + hook nas IDEs
  setup-ui.js           Wizard interativo de setup
  handler.js            API de biblioteca para embedding
  config.js             Config do usuário (~/.mdprobe.json)
  open-browser.js       Abertura de browser cross-platform
  hash.js               Detecção de drift via SHA-256
  anchoring.js          Matching de posição de texto
  ui/
    components/         Componentes Preact
    hooks/              WebSocket, keyboard, tema, anotações
    state/store.js      Estado via Preact Signals
    styles/themes.css   Temas Catppuccin
schema.json             JSON Schema para YAML de anotações
skills/mdprobe/         Skill para agentes de IA (SKILL.md)
```

---

## Licença

MIT © [Henry Avila](https://github.com/henryavila)

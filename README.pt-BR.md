<p align="center">
  <img src="screenshot-hero.png" alt="Interface completa do mdProbe com anotações e destaques inline" />
</p>

# mdProbe

[![npm](https://img.shields.io/npm/v/@henryavila/mdprobe)](https://www.npmjs.com/package/@henryavila/mdprobe)
[![license](https://img.shields.io/npm/l/@henryavila/mdprobe)](LICENSE)

Visualizador e revisor de markdown com live reload, anotações persistentes e integração com agentes de IA.

[🇺🇸 Read in English](README.md)

Abra arquivos `.md` no browser, anote inline, aprove seções e exporte feedback estruturado em YAML — tudo pelo terminal. Funciona de forma standalone ou como servidor MCP para agentes de IA (Claude Code, Cursor, etc.).

---

## O que o mdProbe é

- Uma **ferramenta CLI** que renderiza Markdown no browser com live reload
- Um **sistema de anotações** onde você seleciona texto e adiciona comentários com tags (bug, question, suggestion, nitpick)
- Um **workflow de revisão** com aprovação por seção (aprovar/rejeitar por heading)
- Um **servidor MCP** que permite agentes de IA abrir arquivos, ler anotações e resolver feedback programaticamente

## O que o mdProbe não é

- Não é um editor de markdown — você edita no seu próprio editor, o mdProbe renderiza e anota
- Não é um gerador de sites estáticos — ele roda um servidor local para preview ao vivo
- Não é exclusivo para IA — funciona perfeitamente como ferramenta standalone de revisão

---

## Início Rápido

```bash
npm install -g @henryavila/mdprobe
mdprobe setup
mdprobe README.md
```

Ou execute sem instalar:

```bash
npx @henryavila/mdprobe README.md
```

**Requisitos:** Node.js 20+, um browser moderno (veja [Requisitos de Browser](#requisitos-de-browser)).

---

## Anotações 101

Selecione qualquer texto no browser, escolha uma tag, escreva um comentário e salve.

![Anotação atravessando blocos: destaque cobre cabeçalho e primeira linha do código](screenshot-cross-block.png)

| Tag | Significado |
|-----|-------------|
| `bug` | Algo está errado |
| `question` | Precisa de esclarecimento |
| `suggestion` | Ideia de melhoria |
| `nitpick` | Estilo ou redação menor |

### Estados da anotação

| Estado | Significado |
|--------|-------------|
| `open` | Anotação ativa, ancorada com confiança |
| `drifted` | O texto fonte mudou; a anotação foi relocalizada com correspondência aproximada, mas requer confirmação humana (exibida com sublinhado tracejado âmbar) |
| `orphan` | A ancoragem falhou completamente após todas as etapas de recuperação; exibida em uma seção do painel lateral sem destaque inline |
| `resolved` | Resolvida; aparece em cinza |

As anotações são armazenadas em arquivos sidecar `.annotations.yaml` — legíveis por humanos, amigáveis ao git. Veja [docs/SCHEMA.md](docs/SCHEMA.md) para a referência completa do schema.

---

## Workflows

### 5.1. Preview ao vivo standalone (foreground)

```bash
mdprobe README.md      # Abre um único arquivo
mdprobe docs/          # Descobre todos os arquivos .md recursivamente
```

Inicia um servidor, abre o browser e observa o arquivo fonte por mudanças. Edite no seu editor — o browser atualiza instantaneamente. Pressione `Ctrl+C` para parar.

Múltiplas chamadas compartilham o mesmo servidor em execução: uma segunda invocação do `mdprobe` detecta o processo existente via lock file, adiciona seus arquivos via `POST /api/add-files` e encerra — assim você nunca acumula processos obsoletos.

### 5.2. Servidor em background (`-d` / `--detach`)

```bash
mdprobe -d docs/            # Inicia em background e encerra imediatamente
mdprobe CHANGELOG.md        # Entra no servidor em execução e adiciona o arquivo
mdprobe stop                # Mata o servidor e limpa o lock file
```

`-d`/`--detach` inicia o processo do servidor desanexado do terminal. Invocações subsequentes entram nele normalmente. Use `mdprobe stop` (ou `mdprobe stop --force`) para encerrá-lo.

### 5.3. Revisão bloqueante para CI (`--once`)

```bash
mdprobe spec.md --once
```

![Modo blocking review com botão Finish Review](screenshot-once-review.png)

Bloqueia o processo até que você clique em **"Finish Review"** na interface. Encerra com a lista dos arquivos de anotação criados — útil para pipelines que precisam de aprovação humana antes de continuar. `--once` sempre cria uma instância de servidor isolada (não entra no singleton).

### 5.4. Revisão assistida por IA (MCP)

Ao trabalhar com agentes de IA, o agente usa as ferramentas MCP em vez de `--once`:

```
Agente escreve spec.md
    ↓
Agente chama mdprobe_view → browser abre, servidor continua rodando
    ↓
Humano lê, anota, aprova/rejeita seções
    ↓
Humano diz ao agente pelo chat: "done reviewing"
    ↓
Agente chama mdprobe_annotations → lê todo o feedback
    ↓
Agente corrige bugs, responde perguntas, avalia sugestões
    ↓
Agente relata as mudanças e pede confirmação ao humano
    ↓
Agente chama mdprobe_update → resolve as anotações
    ↓
Humano vê os itens resolvidos em tempo real (em cinza)
```

O servidor permanece ativo durante toda a conversa. Múltiplos arquivos podem ser revisados na mesma sessão.

---

## Funcionalidades

### Renderização

Tabelas GFM, realce de sintaxe (highlight.js), diagramas Mermaid, math/LaTeX (KaTeX), frontmatter YAML/TOML, passagem de HTML bruto, imagens do diretório fonte.

### Live Reload

Mudanças nos arquivos detectadas via chokidar, enviadas por WebSocket. Debounced em 100ms. Posição de scroll preservada.

### Aprovação por Seção

Cada heading recebe botões de aprovar/rejeitar. Aprovar um heading pai se propaga para todos os filhos. Barra de progresso acompanha as seções revisadas versus o total.

### Recuperação de Drift

Quando o arquivo fonte muda após as anotações serem criadas, o mdProbe executa um pipeline de 5 etapas para relocalizar cada span de anotação:

```
1. Hash check   — arquivo inalterado? usa offsets armazenados diretamente (~0ms)
2. Exact match  — texto da citação ainda aparece de forma única no fonte
3. Fuzzy match  — Myers bit-parallel, limiar ≥ 0.60 dentro de janela de ±2 kB
4. Tree path    — fingerprint de heading + parágrafo via mdast
5. Keyword dist — âncoras de palavras raras como último recurso
→ confident / drifted / orphan
```

Anotações `drifted` exibem sublinhado tracejado âmbar e requerem sua confirmação explícita (`acceptDrift`) antes de serem reancorádas como `open`. Anotações `orphan` aparecem em uma seção dedicada do painel sem destaque inline.

![Anotação em estado drifted com sublinhado tracejado âmbar + painel de drift](screenshot-drifted.png)

### Destaque com Precisão de Caractere

A v0.5.0 usa a **CSS Custom Highlight API** (zero mutação de DOM) para renderizar marcas de anotação. As seleções são ancoradas por offsets de caractere UTF-16 no fonte Markdown bruto, não por números de linha/coluna — portanto seleções entre blocos, código reformatado e edições de quebra de parágrafo não quebram as âncoras silenciosamente.

![Destaques inline com cores semânticas por tag](screenshot-highlight-inline.png)

### Temas

Cinco temas baseados no Catppuccin: Mocha (escuro, padrão), Macchiato, Frappe, Latte, Light.

### Atalhos de Teclado

| Tecla | Ação |
|-------|------|
| `[` | Alternar painel esquerdo (arquivos + TOC) |
| `]` | Alternar painel direito (anotações) |
| `\` | Modo foco (ocultar ambos os painéis) |
| `j` / `k` | Próxima / anotação anterior |
| `?` | Overlay de ajuda |
| `Ctrl+Enter` | Salvar anotação |

### Exportação

```bash
mdprobe export spec.md --report   # Relatório de revisão em Markdown
mdprobe export spec.md --inline   # Anotações inseridas no fonte
mdprobe export spec.md --json     # JSON simples (schema v2)
mdprobe export spec.md --sarif    # SARIF 2.1.0 (integração com CI/CD)
```

---

## Requisitos de Browser

A v0.5.0 requer a **CSS Custom Highlight API** para renderização inline de anotações.

| Browser | Versão mínima |
|---------|---------------|
| Chrome / Edge | 105+ |
| Firefox | 140+ |
| Safari | 17.2+ |

Em browsers mais antigos o mdProbe exibe um modal explicando a limitação e recorre a uma lista de anotações somente leitura. Os destaques inline ficam desabilitados.

---

## Referência da CLI

```
mdprobe [files...] [options]

Options:
  --port <n>         Número da porta (padrão: 3000, incrementa automaticamente se ocupada)
  --once             Revisão bloqueante — servidor isolado, encerra ao clicar "Finish Review"
  -d, --detach       Inicia o servidor em background e encerra
  --no-open          Não abre o browser automaticamente
  --help, -h         Exibe a ajuda
  --version, -v      Exibe a versão

Subcommands:
  setup                         Configuração interativa (skill + MCP + hook)
  setup --remove                Remove tudo
  setup --yes [--author <name>] Configuração não-interativa
  mcp                           Inicia o servidor MCP (stdio, para agentes de IA)
  config [key] [value]          Gerencia configuração
  export <path> [flags]         Exporta anotações (--report, --inline, --json, --sarif)
  migrate <path> [--dry-run]    Migra em lote anotações v1 para v2
  stop [--force]                Mata o servidor singleton e limpa o lock file
```

---

## Integração com Agentes de IA

<p align="center">
  <img src="screenshot-hero.png" alt="Interface completa do mdProbe com anotações e destaques inline" />
</p>

O mdProbe inclui um servidor MCP e um `SKILL.md` que ensina agentes de IA o workflow de revisão. Isso viabiliza um ciclo bidirecional: o agente escreve Markdown, o humano anota, o agente lê o feedback e o resolve.

### Configuração

```bash
mdprobe setup
```

Wizard interativo que:
1. Instala o `SKILL.md` nas IDEs detectadas (Claude Code, Cursor, Gemini)
2. Registra o servidor MCP (`mdprobe mcp`) no Claude Code (`~/.claude.json` ou `claude mcp`) e no Cursor (`~/.cursor/mcp.json` quando essa pasta existir)
3. Migra hooks legados Claude PostToolUse de versões anteriores do mdprobe (se houver)
4. Configura seu nome de autor

Não-interativo: `mdprobe setup --yes --author "Seu Nome"`  
Remover tudo: `mdprobe setup --remove`

### Ferramentas MCP

| Ferramenta | Propósito |
|------------|-----------|
| `mdprobe_view` | Abre arquivos `.md` no browser |
| `mdprobe_annotations` | Lê anotações e status de seções |
| `mdprobe_update` | Resolve, responde, adiciona ou exclui anotações |
| `mdprobe_status` | Verifica se o servidor está em execução |

### Registro MCP Manual

Se preferir não usar o `mdprobe setup`:

**Claude Code**

```bash
claude mcp add --scope user --transport stdio mdprobe -- mdprobe mcp
```

**Cursor** — mescle em `~/.cursor/mcp.json` (ou no `.cursor/mcp.json` do projeto):

```json
{
  "mcpServers": {
    "mdprobe": { "command": "mdprobe", "args": ["mcp"] }
  }
}
```

**WSL + Cursor no Windows:** O home do Node é seu home Linux (ex.: `/home/você`), enquanto o Cursor desktop lê o MCP do perfil Windows (`%USERPROFILE%\.cursor\mcp.json`). Ao executar `mdprobe setup` dentro do WSL, ele grava tanto o `~/.cursor/mcp.json` (Linux) quanto, via `/mnt/c/...`, o `mcp.json` do Windows com uma ponte `wsl.exe` para o binário `mdprobe` do Linux. `WSL_DISTRO_NAME` e `cmd.exe` precisam estar disponíveis (instalação normal do WSL2).

---

## Migração v0.4 → v0.5

O schema v1 usava `selectors.position { startLine, startColumn, endLine, endColumn }`. A v0.5.0 substitui isso por `range { start, end }` (offsets de caractere UTF-16), que é mais preciso e sobrevive a edições de quebra de linha.

**Automática:** `AnnotationFile.load()` detecta arquivos v1 e os migra no local, gravando primeiro um backup `.bak` (ex.: `spec.annotations.yaml.bak`).

**Em lote (recomendado antes de atualizar um repositório grande):**

```bash
mdprobe migrate docs/ --dry-run   # Visualiza as mudanças sem gravar
mdprobe migrate docs/             # Aplica a migração
```

**Rollback:** restaure o arquivo `.bak` ao lado do arquivo `.annotations.yaml`.

Veja [docs/SCHEMA.md](docs/SCHEMA.md) para a referência completa dos campos v2.

---

## Biblioteca & HTTP API

O mdProbe é distribuído como um pacote npm que você pode embutir no seu próprio servidor — sem processo separado.

- **[docs/EMBEDDING.md](docs/EMBEDDING.md)** — `createHandler` (middleware Express/Node), classe `AnnotationFile`, helpers de exportação, utilitários de ancoragem
- **[docs/HTTP-API.md](docs/HTTP-API.md)** — referência completa de endpoints REST + WebSocket
- **[docs/SCHEMA.md](docs/SCHEMA.md)** — schema YAML de anotações v2, referência campo a campo
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — estrutura do projeto, pipeline de renderização, principais decisões de design

---

## Desenvolvimento

```bash
git clone https://github.com/henryavila/mdprobe.git
cd mdprobe
npm install
npm run build:ui
npm test
```

Para estrutura do projeto e detalhes de arquitetura veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Licença

MIT © [Henry Avila](https://github.com/henryavila)

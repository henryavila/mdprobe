# Design: Fechar Arquivos no Servidor Singleton

**Data:** 2026-04-11
**Status:** Aprovado

## Problema

No servidor singleton do mdprobe, arquivos vão sendo adicionados ao longo do tempo (via CLI ou MCP `mdprobe_view`), mas não existe forma de removê-los da lista. A UI acumula arquivos indefinidamente.

## Decisões

1. **Abordagem A — Remoção completa do servidor** (escolhida sobre soft-close no frontend ou híbrido)
   - Motivo: usa mecanismos existentes (`file-added`/`file-removed`), zero complexidade adicional
   - Re-abertura via MCP funciona naturalmente (`addFiles` re-adiciona arquivo removido)

2. **Comportamento de re-abertura:** quando a IA chama `mdprobe_view` para um arquivo fechado, ele reaparece automaticamente (fluxo natural do `addFiles`)

## Arquitetura

### Backend — `DELETE /api/remove-file`

- Recebe `{ file: "spec.md" }` (basename)
- Encontra o path absoluto correspondente em `resolvedFiles`
- Remove do array `resolvedFiles`
- Remove do chokidar watcher via `watcher.unwatch(dirname)`
- Limpa debounce timers pendentes para esse path
- Broadcast `{ type: 'file-removed', file: 'spec.md' }` para todos os clients WS
- Retorna `{ ok: true, files: [...remaining] }`
- Retorna 404 se arquivo não encontrado na lista
- Guard: retorna 400 se `resolvedFiles.length === 1` (não permitir fechar o último arquivo)

### Frontend — Botão "×" no LeftPanel

- Cada item do file list ganha botão "×" visível no hover
- Botão só aparece quando `files.length > 1`
- Click faz `fetch('/api/remove-file', { method: 'DELETE', body: { file } })`
- Handler `file-removed` no `useWebSocket.js` já remove da lista (linhas 84-85)
- Se o arquivo fechado era o ativo (`currentFile`), seleciona automaticamente o próximo ou anterior

### Fluxo de re-abertura (já funciona)

```
IA chama mdprobe_view(path)
  → srv.addFiles([path])
  → arquivo não está em resolvedFiles
  → push + watcher.add + broadcast file-added
  → frontend adiciona de volta
```

Zero código adicional necessário.

## Fora do escopo

- Reabrir manualmente (lista de fechados não é persistida)
- Atalho de teclado (pode ser adicionado depois)
- Alterações no modo `--once` (review mode inalterado)

## Arquivos impactados

- `src/server.js` — novo endpoint, expor `removeFile` no objeto retornado
- `src/ui/components/LeftPanel.jsx` — botão "×" nos itens de arquivo
- `src/ui/styles/layout.css` — estilo do botão close (hover)
- `tests/` — testes unitários e de integração para o novo endpoint e UI

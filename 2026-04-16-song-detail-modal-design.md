# Song Detail Modal — Design Spec

## Overview

Substituir o sidebar de detalhe de música (`SongDetailPanel`) por um modal com blur Focus (12px) em todo o app. No planejamento, o sidebar criava uma terceira coluna inutilizável. No mobile, navegava para fora da página perdendo contexto. O modal resolve ambos os problemas com um único componente adaptável por contexto.

## Problemas Resolvidos

| # | Problema | Causa raiz | Solução |
|---|----------|------------|---------|
| P1 | Desktop planning: 3 colunas espremidas | Sidebar w-80 + review panel w-96 = tabela comprimida | Modal overlay (não afeta layout) |
| P2 | Mobile planning: perde contexto | `SongCard` navega para `/musicas/:artist/:title/:hash` | Modal fullscreen (permanece na página) |
| P3 | Insights de uso invisíveis | Dados enterrados abaixo da letra (Illusion of Completeness) | Insight chips no hero (100% above fold) |
| P4 | Líder não consegue ouvir a música | Player existente na listagem, mas sem destaque no detalhe | Player integrado no hero com toggle Vocal/Playback/YouTube |

## Decisões de Design

### 1. Componente Único com Contexto Adaptável

Um componente `SongDetailModal` com prop `context: 'planning' | 'catalog'` controla o conteúdo:

| Elemento | Planning | Catálogo |
|----------|----------|----------|
| Hero (avatar + título + player) | ✓ | ✓ |
| Insight chips (📅 🔄 ⚠️) | ✓ | — |
| Letra | ✓ | ✓ |
| Detalhes técnicos (tipo, tom, cifra...) | Desktop: split right | Mobile: grid 2×2 abaixo da letra |
| Ação primária | + Adicionar ao Culto | Ver Página Completa |
| Ação secundária | — | Abrir LouvorJA |

### 2. Layout por Viewport

#### Mobile (< lg) — Fullscreen

```
┌─────────────────────────────┐
│ ✕                           │
│ 🎵 Título da Música         │ ← Hero compacto
│    Artista · ★★★★☆ · Tipo  │    (avatar 40px inline)
│                             │
│ 📅 15sem  🔄 8×  ⚠ Agnd.   │ ← Insight chips (só planning)
│                             │
│ ▶ ━━━━━━━━━━ 1:04 │Vocal ▾│ ← Player + source merged
├─────────────────────────────┤
│                             │
│ Letra da música...          │ ← Scroll vertical
│ (conteúdo rolável)          │
│                             │
│ ─────────────               │ ← Divider (só catálogo)
│ Detalhes em grid 2×2        │ ← Só catálogo
│                             │
├─────────────────────────────┤
│ [+ Adicionar ao Culto]      │ ← Ação fixa no bottom
└─────────────────────────────┘
```

- Modal fullscreen (border-radius: 20px 20px 0 0)
- Sem tabs — conteúdo stacked (letra → insights inline no hero)
- Insight chips entre título e player: ~36px de altura, 100% visível
- Player e source toggle fundidos numa linha: `[▶] ━━━ 1:04 | Vocal ▾`

#### Desktop (≥ lg) — Modal 680px Centralizado

```
┌──────────────────────────────────────────────┐
│ ✕                                            │
│ 🎵 Título da Música                          │ ← Hero (idêntico ao mobile)
│    Artista · ★★★★☆ · Tipo                   │
│ 📅 15sem  🔄 8×  ⚠ Agendada                 │
│ ▶ ━━━━━━━━━━━━━━━ 1:04 │ Vocal ▾            │
├─────────────────────────┬────────────────────┤
│                         │ USO NO PLANEJ.     │
│ LETRA                   │ 📅 Há 15 sem.      │
│                         │ 🔄 8× este ano     │
│ Tudo que há de bom...   │ ⚠ Agendada 25/04  │
│ Vem de Ti, Senhor       │                    │
│ ...                     │ HISTÓRICO RECENTE  │
│                         │ · 15/03 Sábado     │
│ (scroll independente)   │ · 08/02 Domingo    │
│                         │ · 11/01 Sábado     │
│                         │                    │
│                         │ DETALHES           │
│                         │ ✓ Louvor · Suaves  │
│                         │ ✓ Banda toca       │
│                         │ Tom: G · 72 BPM    │
├─────────────────────────┴────────────────────┤
│ [+ Adicionar ao Culto]  [Ver Página]         │
└──────────────────────────────────────────────┘
```

- Modal 680px com backdrop blur Focus (12px)
- Hero idêntico ao mobile (consistência)
- Split abaixo: letra (flex-1, scroll próprio) | painel direito (220px, insights + histórico + detalhes)
- No contexto catálogo: split right mostra detalhes técnicos em vez de insights de uso

### 3. Hero — Anatomia (Opção 1 refinada)

O hero tem **4 camadas visuais** (~155px de altura):

1. **Identidade**: Avatar 40px + título + meta (artista · ★★★★☆ · tipo)
2. **Decisão** (só planning): Insight chips compactos (📅 Há 15 sem. · 🔄 8× · ⚠️ Agendada)
3. **Player + Source**: Linha única fundida — `[▶] ━━━━━ 1:04 | Vocal ▾`

Background: gradiente indigo sutil (`linear-gradient(160deg, #eef2ff, #e0e7ff, #c7d2fe)`)

### 4. Insight Chips (Planning Context)

Chips compactos no hero, entre o título e o player. Garantem visibilidade 100% (above fold).

| Chip | Fonte de dados | Condição de exibição |
|------|---------------|---------------------|
| `📅 Há N sem.` | `song.planning.last_used_weeks_ago` | Sempre (null → "Nunca tocada") |
| `🔄 N× este ano` | `song.planning.already_scheduled_count` | `count > 0` |
| `⚠️ Agendada DD/MM` | `song.planning.already_scheduled` | `already_scheduled === true` |

Chip de alerta (⚠️) usa estilo `warn` (fundo amarelo) para destaque visual.

### 5. Player Integrado

Player no hero com controles inline:

- **Play/Pause**: Botão circular 28px (usa `audioPlayerStore` existente)
- **Progress bar**: Barra fina (4px), clicável para seek
- **Tempo**: `1:04` (formato compacto, sem duração total no mobile)
- **Source toggle**: Dropdown compacto `Vocal ▾` que abre opções:
  - Vocal (áudio vocal do S3)
  - Playback (áudio instrumental do S3)
  - YouTube (abre `external_link` em nova aba — iframe embeds são bloqueados pelo YouTube em muitos dispositivos)

Lógica de disponibilidade:
- `audio_vocal_url` presente → Vocal disponível
- `audio_playback_url` presente → Playback disponível
- `external_link` com YouTube → YouTube disponível
- Nenhum áudio → Player escondido, hero fica mais compacto

### 6. Letra

- Renderiza `song.lyrics` como texto pré-formatado
- Se `synced_lyrics` disponível e player ativo: highlight na linha atual (classe `.hl`)
- Scroll independente no mobile (max-height calculado)
- No desktop split: scroll próprio na coluna esquerda

### 7. Detalhes Técnicos (Catálogo Context)

Grid 2×2 abaixo da letra no mobile, ou no split right no desktop:

| Campo | Fonte |
|-------|-------|
| Tipo | `song.song_type.name` |
| Tom / BPM | `song.key` · `song.tempo` |
| Banda toca | `song.band_plays` |
| Cifra | `song.has_chordpro` |

### 8. Ações

| Contexto | Ação primária | Ação secundária |
|----------|--------------|-----------------|
| Planning | `+ Adicionar ao Culto` → abre `PlanningMomentOverlay` | — |
| Catálogo | `Ver Página Completa` → navega para `/musicas/:artist/:title/:hash` | `Abrir LouvorJA` (se `louvorja_id` e app disponível) |

### 9. Blur e Transição

- Backdrop: Focus blur (12px), consistente com `PlanningMomentOverlay`
- Usa `UModal` do Nuxt UI com `content.class: 'max-w-[680px]'` no desktop
- Mobile: fullscreen via Nuxt UI modal behavior
- Transição: fade-in do overlay + slide-up do modal

## Componentes Envolvidos

### Novo: `SongDetailModal.vue`

Props:
- `song: Song` — dados da música
- `open: boolean` — controle de visibilidade (v-model)
- `context: 'planning' | 'catalog'` — determina conteúdo adaptável

Emits:
- `close` — fechar modal
- `add` — adicionar ao culto (planning context)

Internamente compõe:
- Hero section (sempre)
- Insight chips (planning context, dados de `song.planning`)
- Player inline (usa `useAudioPlayerStore`)
- Letra (`song.lyrics` ou `song.synced_lyrics`)
- Detalhes grid (catalog context)
- Action bar

### Modificados

| Arquivo | Mudança |
|---------|---------|
| `pages/planejamento/index.vue` | Trocar `selectedSong` + `SongDetailPanel` sidebar por `SongDetailModal` com `context="planning"` |
| `components/SongList.vue` | Desktop: remover sidebar `SongDetailPanel`. Emitir `select` → pai abre modal |
| `components/SongCard.vue` | Mobile: trocar `NuxtLink :to="songUrl(song)"` por `@click="emit('select', song)"` |
| `components/SongTable.vue` | Click na row emite `select` em vez de navegar |

### Removido (futuro)

- `SongDetailPanel.vue` — substituído pelo modal. Remover após migrar ambos os contextos.

## Dados Necessários

### Já existentes na API (`SongResource`)

- `title`, `artist`, `rating`, `song_type`, `lyrics`, `synced_lyrics`
- `audio_vocal_url`, `audio_playback_url`, `external_link`
- `tempo`, `key`, `band_plays`, `has_chordpro`, `duration_in_seconds`
- `planning.last_used_weeks_ago`, `planning.already_scheduled`, `planning.already_scheduled_count`, `planning.cold_song`

### Necessário adicionar na API

| Campo | Descrição | Endpoint |
|-------|-----------|----------|
| `planning.already_scheduled_event` | Nome + data do evento onde já está agendada | `GET /songs?planning=true` — já inclui `planning`, adicionar campo |
| `planning.usage_history` | Últimos 3-4 eventos (data + título) | Novo: incluir na resposta de `planning` |
| `planning.usage_count_year` | Total de vezes tocada no ano | Novo: incluir na resposta de `planning` |

## Escopo da Implementação

### Fase 1: Modal no Planning (este escopo)

1. Criar `SongDetailModal.vue` com hero, insight chips, player, letra, action bar
2. Integrar na página de planejamento (substituir sidebar)
3. Mobile: `SongCard` emite `select` em vez de navegar (no planning)
4. Desktop: modal 680px com split (letra | insights)
5. API: adicionar campos de histórico de uso no planning response

### Fase 2: Modal no Catálogo (escopo separado)

1. Migrar `/musicas` para usar o mesmo modal com `context="catalog"`
2. Remover `SongDetailPanel.vue`
3. Adaptar detalhes técnicos no grid

## Mockups

Mockups HTML interativos salvos em:
- `.superpowers/brainstorm/30177-1776336241/content/final-both-viewports.html` — Mobile + Desktop lado a lado
- `.superpowers/brainstorm/30177-1776336241/content/hero-refinements.html` — Comparação de 3 variações do hero
- `.superpowers/brainstorm/30177-1776336241/content/contexts-comparison.html` — Planning vs Catálogo
- `.superpowers/brainstorm/30177-1776336241/content/mobile-refined-insights-first.html` — Antes vs Depois (insights position)

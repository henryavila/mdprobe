# Validação Visual — Annotation Highlights

## Cenário 1: Lista com inline code (o bug original)

### Backend
- Migration: `praise_moments` simplificação (17 → 6) + atualização da pivot `event_song`
- Seed: novos 6 momentos com `order` correto
- API: nenhuma mudança de endpoint necessária (mesmos endpoints de planning mode)

### Frontend
- Componente `PlanningStepCard` com suporte a `drag-and-drop` via `@dnd-kit/core`
- Estado global via `useEventStore()` com ações `reorderSongs` e `assignMoment`
- CSS: variáveis `--step-bg`, `--step-border`, `--step-accent` no tema dark

## Cenário 2: Código inline denso

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | `BIGINT` | Primary key auto-increment |
| `event_id` | `UUID` | FK para `events` com `ON DELETE CASCADE` |
| `moment_id` | `INTEGER` | FK para `praise_moments` |
| `song_id` | `UUID` | FK para `songs` via `song_catalog` |
| `order` | `SMALLINT` | Posição no setlist (1-indexed) |

## Cenário 3: Parágrafos com formatação mista

O componente `MomentSelector` usa um **dropdown com backdrop** para evitar confusão visual. Quando o usuário clica em `assignMoment()`, o estado muda de `idle` → `selecting` → `assigned`. A transição usa `framer-motion` com `layoutId` para animação fluida entre os cards.

Cada `PlanningStepCard` recebe props `{ moment, songs, onReorder, onRemove }`. O `onReorder` dispara `reorderSongs(eventId, momentId, newOrder)` que faz um `PATCH /api/events/:id/songs` com o array reordenado.

## Cenário 4: Nested lists com code

- **Passo 1**: Configurar `docker-compose.yml`
  - Serviço `db`: imagem `postgres:16-alpine` com volume `pgdata`
  - Serviço `api`: build do `Dockerfile` com `--target production`
  - Serviço `web`: `nginx:alpine` com proxy reverso para `/api`
- **Passo 2**: Rodar migrations
  - `npx prisma migrate deploy` no container `api`
  - Verificar com `npx prisma db seed` que os dados iniciais estão corretos
- **Passo 3**: Validar endpoints
  - `curl http://localhost:3000/api/health` deve retornar `{ "status": "ok" }`
  - `curl http://localhost:3000/api/events` deve retornar array vazio `[]`

## Cenário 5: Headings com code

### Função `createEventPlan(eventId, moments[])`

Recebe o `eventId` e um array de `moments` com `{ momentId, songs: [songId] }`. Valida que:

1. O `eventId` existe e pertence ao usuário autenticado
2. Cada `momentId` está na lista de `praise_moments` ativos
3. Não há `songId` duplicado entre momentos diferentes
4. O total de músicas não excede `MAX_SONGS_PER_EVENT` (default: 30)

### Rota `PATCH /api/events/:id/plan`

```json
{
  "moments": [
    { "momentId": 1, "songs": ["uuid-1", "uuid-2"] },
    { "momentId": 3, "songs": ["uuid-3"] },
    { "momentId": 6, "songs": [] }
  ]
}
```

Retorna `200 OK` com o plano atualizado ou `422 Unprocessable Entity` com detalhes de validação.

## Cenário 6: Blockquotes com formatting

> **Nota importante**: O campo `order` na tabela `event_song` é calculado automaticamente
> baseado na posição do momento (`praise_moments.order`) multiplicado por 100, mais a
> posição da música dentro do momento. Isso permite inserções futuras sem reordenar tudo.
>
> Exemplo: momento `order=2`, música na posição 3 → `event_song.order = 203`

## Cenário 7: Code blocks para contraste

```typescript
interface PlanningState {
  eventId: string;
  moments: Map<number, { momentId: number; songs: string[] }>;
  isDirty: boolean;
  lastSaved: Date | null;
}

function usePlanningStore(eventId: string): PlanningState & {
  assignSong: (momentId: number, songId: string) => void;
  removeSong: (momentId: number, songId: string) => void;
  reorderSongs: (momentId: number, newOrder: string[]) => void;
  savePlan: () => Promise<void>;
};
```

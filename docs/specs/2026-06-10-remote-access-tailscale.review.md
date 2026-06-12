# Validação do spec — Remote access providers

> Spec: `docs/specs/2026-06-10-remote-access-tailscale.md` · Revisado contra o código em 2026-06-11

## Veredito

**Aprovado com ressalvas.** A revisão substitui o plano Tailscale-only por uma arquitetura de
providers. Isso reduz acoplamento e mantém o Tailscale como caso built-in, sem impedir `external`,
`lan`, `ngrok` e `cloudflare`.

O ponto mais importante da revisão: a feature precisa estar disponível nas duas superfícies,
**CLI direto** e **MCP**, usando a mesma lógica. O spec agora exige isso explicitamente.

## Confirmado contra o código

| Afirmação / touchpoint | Verificação |
|---|---|
| `server.js:117` port-check em `127.0.0.1` | Exato — `server.listen(port, '127.0.0.1')` |
| `server.js:391` listen hardcoded | Exato — `httpServer.listen(actualPort, '127.0.0.1', ...)` |
| `server.js:400,533` URLs locais montadas com `127.0.0.1` | Exato para telemetria e `serverObj.url` |
| MCP já respeita `urlStyle` | Exato — `buildUrl()` em `src/mcp.js:77-81` usa `localhost` ou `mdprobe.localhost` |
| `mdprobe config` grava strings sem validar | Exato — `bin/cli.js:181-184` chama `setConfig(key, value)` direto |
| MCP tem segundo site de server | Exato — `getOrCreateServer()` em `src/mcp.js:33-75` cria/reusa server fora do fluxo do CLI |
| Singleton usa `lock.url` para protocolo local | Exato — `discoverExistingServer()` pinga `lock.url` e `joinExistingServer()` usa essa URL local |
| UI WebSocket funciona atrás de HTTPS proxy | Exato — `src/ui/hooks/useWebSocket.js:34-35` troca `https:` por `wss:` |

## Decisões incorporadas

1. **Sem provider `command`.** Execução arbitrária configurável foi removida do desenho. Providers
   que executarem binários precisam ser código específico e auditável.
2. **Tailscale é provider, não arquitetura.** A camada comum é `src/expose/index.js`; Tailscale entra
   como `src/expose/providers/tailscale.js`.
3. **CLI e MCP têm paridade.** `mdprobe` direto e `mdprobe_view`/`mdprobe_status` devem retornar
   URLs locais/remotas equivalentes.
4. **Ngrok não usa URL fixa no plano gratuito.** `remoteBaseUrl` é runtime para ngrok: descoberta
   depois que o tunnel sobe e gravada no lockfile enquanto o singleton vive.
5. **`lock.url` permanece local.** Metadados remotos ficam em campos separados para não quebrar
   `ping`/`join` locais.

## Gaps que a implementação ainda precisa respeitar

### 1. Paridade CLI/MCP pode divergir se a lógica não for centralizada

Há dois caminhos de criação/reuso de server: CLI (`bin/cli.js`) e MCP (`src/mcp.js`). Se cada um
montar exposição remota por conta própria, os comportamentos vão divergir.

**Recomendação:** implementar `src/expose/index.js` como único reconciliador. CLI e MCP chamam o
mesmo módulo em start e attach.

### 2. `remoteUrl` deve ser deep-link, não só base URL

O MCP já retorna deep-link local por arquivo (`buildUrl(port, urlStyle, basename(file))`). A URL
remota precisa espelhar isso:

- `remoteBaseUrl`: `https://host:8443`
- `remoteUrl`: `https://host:8443/spec.md`

Quando houver múltiplos arquivos, `remoteUrl` pode ser igual a `remoteBaseUrl`.

### 3. Config conhecida precisa de validação/coerção

Hoje `mdprobe config exposePort 8443` gravaria `"8443"` como string. Isso quebraria providers que
esperam número.

**Obrigatório validar/coagir:** `expose`, `exposePort`, `bindHost`, `remoteBaseUrl`,
`allowPublicUnauthenticated`.

### 4. Attach ao singleton precisa reconciliar expose

Se o server já está rodando e o config muda depois, uma segunda chamada pode anexar sem passar por
start. Isso afeta CLI e MCP.

**Obrigatório:** reconciliar provider também no attach. Se o provider gerar ou atualizar
`remoteBaseUrl`, atualizar o lockfile.

### 5. Tailscale precisa validar estado, não só binário

Detectar `tailscale` no PATH não basta. Antes do `serve`, rodar `tailscale status --json` e exigir:

- `BackendState === "Running"`
- `Self.DNSName` presente

Caso contrário: warning único + fallback local-only.

### 6. LAN bind precisa evitar `0.0.0.0` como primeira opção

`0.0.0.0` expõe o mdProbe sem auth para todas as interfaces. O spec agora permite IP específico de
interface. A implementação deve preferir esse caminho quando possível e só usar `0.0.0.0` com opt-in
explícito.

### 7. Ngrok exige URL runtime e política de risco

Em conta gratuita, a URL pública do ngrok pode mudar a cada sessão. Portanto `remoteBaseUrl` não deve
ser exigido nem persistido como config estática para `ngrok`.

**Obrigatório:** gravar URL descoberta no lockfile e incluir `exposeRisk` quando houver exposição
pública sem autenticação confirmada.

### 8. Cloudflare deve começar como `external` se não houver validação segura

Cloudflare Tunnel com hostname estável cabe no provider `external`. Um provider próprio só vale
quando a implementação conseguir validar setup/proteção de forma útil. Quick tunnel público não deve
virar default.

## Observações menores

- `src/cli/stop-cmd.js:136` monta URL local durante orphan scan; isso deve continuar local.
- `docs/HTTP-API.md` ainda diz que todos os endpoints são em `http://127.0.0.1:<port>`; quando a
  feature for implementada, a doc deve explicar local vs remote.
- O template do skill instalado por `setup` precisa orientar agentes a mostrar as duas URLs quando
  `remoteUrl` existir.

## Status final

O plano está pronto para virar implementação, desde que o primeiro slice mantenha o escopo seguro:

- implementar `external`, `tailscale` e `lan`;
- deixar `ngrok` e `cloudflare` especificados, mas só implementar quando houver validação segura de
  auth/proteção ou warning/opt-in explícito;
- garantir paridade CLI/MCP desde o início.

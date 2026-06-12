# Spec — Remote access providers (Tailscale, external, LAN, ngrok/cloudflare)

> **Handoff de 2026-06-10** (sessão no repo `arch`). Status: proposta revisada, pronta para implementação.
> Motivação real: revisar documentos do mdProbe pelo celular, sem depender de setup manual por máquina.
> O Tailscale continua sendo o caso que motivou o trabalho, mas a feature não deve ficar acoplada a Tailscale.

## Problema

O server binda **hardcoded em `127.0.0.1`** (`src/server.js:117` no port-check e `:391` no
`httpServer.listen`). O CLI exibe URLs locais a partir de `server.url`; o MCP já monta deep-links
com `localhost` ou `mdprobe.localhost` conforme `urlStyle` (`src/mcp.js:77-81`). Não há um conceito
unificado de URL remota para outro device.

O workaround manual atual na máquina `device-example` usa Tailscale:

```bash
sudo tailscale set --operator=$USER
tailscale serve --bg --https=8443 3000
# -> https://device.example.ts.net:8443  (tailnet-only) -> proxy 127.0.0.1:3000
```

Esse workaround funciona, mas é invisível ao mdProbe:

- o CLI não imprime a URL remota;
- o MCP não retorna `remoteUrl`;
- se o server sobe em porta custom, o mapping persistente não acompanha;
- o conhecimento fica fora do projeto, em nota manual.

verified_by:

- `src/server.js:117`: `server.listen(port, '127.0.0.1')`
- `src/server.js:391`: `httpServer.listen(actualPort, '127.0.0.1', ...)`
- `src/server.js:400,533`: a URL local retornada pelo server usa `http://127.0.0.1:${actualPort}`.
- `src/mcp.js:77-80`: `buildUrl()` monta deep-links MCP com `localhost` ou `mdprobe.localhost`.
- `src/config.js:39-51` e `bin/cli.js:181-184`: `mdprobe config` grava o valor recebido sem validação/coerção por chave conhecida.
- `src/mcp.js:35-75` e `bin/cli.js:432-467`: MCP e CLI têm caminhos separados de criação/attach do server.
- `src/singleton.js:176-188,197-201`: `lock.url` alimenta ping/join locais.
- `src/ui/hooks/useWebSocket.js:34-35`: WebSocket já troca `https:` para `wss:`.

## Decisão de design

Implementar uma camada genérica de **remote access providers**. O core do mdProbe conhece apenas:

- a URL local usada para `ping`, `join`, browser local e singleton;
- o provider de exposição ativo;
- a URL remota base quando existir;
- a URL remota por arquivo quando aplicável.

Tailscale vira um provider built-in, não a arquitetura inteira.

### Slice de implementação

O primeiro slice implementa somente os providers executáveis com contrato completo:

- `off`
- `external`
- `tailscale`
- `lan`

`ngrok` e `cloudflare` permanecem especificados como providers planejados. A CLI e o MCP não devem
anunciar esses providers como funcionais até existirem handlers testados que entreguem as regras de
segurança descritas abaixo. Se `expose` receber `ngrok` ou `cloudflare` antes disso, a validação deve
falhar com erro acionável de provider planejado, sem iniciar exposição remota.

### Providers

| Provider | Escopo | Gerencia processo/tunnel? | URL remota |
|---|---|---:|---|
| `off` | default local-only | não | nenhuma |
| `external` | proxy/tunnel já configurado pelo usuário | não | `remoteBaseUrl` configurado |
| `tailscale` | tailnet privada via `tailscale serve` | sim, provider-specific | derivada de `tailscale status --json` + `exposePort` |
| `lan` | rede local confiável | não | derivada do IP local + porta |
| `ngrok` | tunnel temporário/protegido | sim, provider-specific | descoberta em runtime; nunca fixa no config gratuito |
| `cloudflare` | Cloudflare Tunnel/Access | planejado; fora do primeiro slice | `remoteBaseUrl` estável do hostname Cloudflare |

Não haverá provider `command`. Execução arbitrária configurável é invasiva demais para esta feature.
Providers que executam binários devem fazer isso por código específico e auditável (`tailscale`,
futuro `ngrok`), com argumentos controlados pelo mdProbe.

## Config (`~/.mdprobe.json`, via `mdprobe config`)

Config base:

```jsonc
{
  "expose": "off",              // off | external | tailscale | lan no primeiro slice
  "remoteBaseUrl": null,        // usado por external/cloudflare; nunca exigido para ngrok free
  "exposePort": 8443,           // porta pública HTTPS para tailscale
  "bindHost": "127.0.0.1",      // muda só em lan explícito
  "allowPublicUnauthenticated": false
}
```

Exemplos:

```jsonc
{ "expose": "external", "remoteBaseUrl": "https://mdprobe.example.com" }
{ "expose": "tailscale", "exposePort": 8443 }
{ "expose": "lan", "bindHost": "192.168.1.50" }
```

Validação obrigatória no comando `mdprobe config`:

- `expose`: enum conhecido;
- `exposePort`: number inteiro, 1024-65535;
- `bindHost`: `127.0.0.1`, `0.0.0.0` ou IP local detectável;
- `remoteBaseUrl`: URL `https://` sem path final obrigatório para `external`/`cloudflare`;
- `allowPublicUnauthenticated`: booleano, default `false`;
- `ngrok`/`cloudflare`: rejeitados no primeiro slice com mensagem de provider planejado;
- keys desconhecidas continuam permitidas para compatibilidade, mas keys conhecidas são validadas/coagidas.

## Superfícies obrigatórias: CLI e MCP

O recurso deve funcionar tanto em chamada direta do `mdprobe` quanto via MCP. Não pode existir um
caminho "MCP-only" ou "CLI-only".

### CLI

- `mdprobe foo.md --expose=tailscale`
- `mdprobe foo.md --expose=external --remote-base-url=https://mdprobe.example.com`
- `mdprobe foo.md --expose=lan --bind-host=192.168.1.50`
- `mdprobe config expose tailscale`
- `mdprobe config remoteBaseUrl https://mdprobe.example.com`
- `mdprobe stop --unexpose`

Exemplos planejados, bloqueados até os handlers existirem:

- `mdprobe foo.md --expose=ngrok` (URL descoberta em runtime)
- `mdprobe foo.md --expose=cloudflare --remote-base-url=https://mdprobe.example.com`

Output de start/join:

```text
Local:  http://localhost:3000/spec.md
Remote: https://remote-host.example/spec.md
```

Se não houver URL remota válida, omitir `Remote:` e emitir no máximo um warning acionável.

### MCP

`mdprobe_view` deve retornar:

```json
{
  "url": "http://localhost:3000/spec.md",
  "remoteUrl": "https://remote-host.example/spec.md",
  "remoteBaseUrl": "https://remote-host.example",
  "expose": "tailscale",
  "files": ["spec.md"]
}
```

`mdprobe_status` deve retornar os mesmos metadados quando o server estiver rodando:

```json
{
  "running": true,
  "url": "http://127.0.0.1:3000",
  "remoteBaseUrl": "https://remote-host.example",
  "remoteUrl": "https://remote-host.example/spec.md",
  "expose": "tailscale",
  "files": ["spec.md"]
}
```

Quando houver zero ou múltiplos arquivos ativos, `mdprobe_status` deve omitir `remoteUrl` e manter
`remoteBaseUrl` como metadado base.

O MCP deve usar o mesmo reconciliador de exposição do CLI, inclusive quando apenas anexa a um
singleton já existente.

## Semântica de URL

- `localUrl`: URL local usada internamente e exibida conforme `urlStyle` (`localhost` ou
  `mdprobe.localhost`) quando a superfície for MCP.
- `remoteBaseUrl`: URL remota base, sem arquivo.
- `remoteUrl`: deep-link remoto por arquivo quando há exatamente um arquivo, espelhando o
  comportamento local de `buildUrl()`.
- `lock.url`: continua sendo a URL local usada por `pingServer()`/`joinExistingServer()`.
- `lock.remoteBaseUrl`, `lock.expose`, `lock.exposePort`, `lock.bindHost`: metadados separados.

Isso evita que o protocolo local do singleton passe a depender de tailnet/tunnel.

## Provider `external`

Para usuários que já têm Caddy, Nginx, Traefik, Cloudflare, ngrok, SSH reverse tunnel ou outro
proxy configurado fora do mdProbe.

Regras:

- mdProbe não inicia processo;
- exige `remoteBaseUrl`;
- gera `remoteUrl` por arquivo a partir de `remoteBaseUrl`;
- imprime warning se `remoteBaseUrl` for `http://` ou se `allowPublicUnauthenticated` for `true`.

## Provider `tailscale`

No start ou attach do singleton, se `expose === "tailscale"`:

1. Detectar `tailscale` no PATH; se ausente, warn + fallback local-only.
2. Rodar `tailscale status --json` antes do `serve`.
   - Exigir `.BackendState === "Running"`.
   - Exigir `.Self.DNSName` presente.
   - Se estiver `Stopped`, `NeedsLogin` ou sem DNS, warn único + fallback local-only.
3. Garantir o mapping:
   `tailscale serve --bg --https={exposePort} {actualPort}`.
   - Se falhar com "Access denied", warn único instruindo
     `sudo tailscale set --operator=$USER`.
   - Não tentar `sudo`.
4. Resolver:
   `https://{trim(Self.DNSName, ".")}:{exposePort}`.
5. Gravar metadados no lockfile.

`mdprobe stop` mantém o mapping por default. `mdprobe stop --unexpose` roda
`tailscale serve --https={lock.exposePort} off`, usando a porta gravada no lockfile, não a config atual.

## Provider `lan`

Modo explícito para rede local confiável:

- valores aceitos para `bindHost`: `0.0.0.0` ou IP específico de interface local;
- default LAN: IP específico, não `0.0.0.0`;
- o port-check deve usar o mesmo host do listen;
- exibe `http://{primaryLanIp}:{port}`;
- sempre imprime warning: HTTP sem auth, conteúdo legível e annotations graváveis por quem alcançar a rede.

## Provider `ngrok` (planejado)

Ngrok gratuito usa URLs temporárias. Portanto:

- `remoteBaseUrl` não deve ser configurado como URL fixa no caso gratuito;
- o provider deve iniciar ou anexar ao agent ngrok de forma provider-specific;
- depois do tunnel subir, descobrir a URL pública em runtime;
- gravar a URL descoberta no lockfile;
- CLI e MCP usam essa URL runtime enquanto o singleton estiver vivo;
- ao reiniciar, a URL é tratada como variável e deve ser redescoberta.

Segurança:

- não expor por ngrok sem proteção por default;
- aceitar apenas se o provider conseguir confirmar auth/proteção ou se
  `allowPublicUnauthenticated: true` estiver explicitamente configurado;
- quando `allowPublicUnauthenticated` for true, imprimir warning forte em CLI e incluir `exposeRisk` no MCP.

## Provider `cloudflare` (planejado)

Cloudflare deve ser tratado como provider de hostname estável:

- `remoteBaseUrl` obrigatório;
- usar tunnel nomeado e Cloudflare Access/Zero Trust;
- não implementar quick tunnel público como default;
- no primeiro slice, Cloudflare entra via `external`; provider próprio só entra quando houver validação útil de setup/proteção.

## Segurança

- `off` é default.
- `bindHost` default continua `127.0.0.1`.
- Não implementar provider `command`.
- Não usar `tailscale funnel` por default.
- Não assumir que `external`, `ngrok` ou `cloudflare` são privados sem configuração/verificação.
- Toda URL remota deve ser propagada como metadado separado da URL local.
- Docs devem deixar claro que o conteúdo dos arquivos e as annotations podem ser expostos.

### Control-plane gate (implementado)

mdProbe não tem autenticação própria (e isso continua fora de escopo). Enquanto o bind era
loopback-only, os endpoints de mutação eram acessíveis apenas localmente. Como a exposição remota
torna o server alcançável por outros hosts, os endpoints que **alteram quais arquivos do host o server
lê** ficam restritos ao loopback quando `expose !== "off"`:

- `POST /api/add-files` e `POST /api/broadcast` exigem origem loopback (singleton join local continua
  funcionando; cliente remoto recebe `403`).
- Leitura, annotations e `remove-file` permanecem abertos — é o fluxo de revisão remota pretendido.
  `remove-file` só altera o conjunto em memória (sem deletar do disco), então não habilita LFI.
- `allowPublicUnauthenticated: true` desativa essa restrição explicitamente (opt-in), e nesse caso o
  provider emite warning/`exposeRisk`.

Sem esse gate, um cliente remoto poderia usar `add-files` com caminho arbitrário e então ler arquivos
do host via `GET /api/asset`/`/api/source` (leitura arbitrária de arquivos). O gate fecha essa cadeia
no modo exposto sem opt-in.

## Touchpoints no código

| Arquivo | Mudança |
|---|---|
| `src/expose/index.js` | novo reconciliador comum de providers |
| `src/expose/providers/tailscale.js` | provider Tailscale |
| `src/expose/providers/external.js` | provider externo/manual |
| `src/expose/providers/lan.js` | provider LAN |
| `src/server.js:117,391,400,533` | host de bind parametrizado + URL local preservada |
| `src/config.js` / `bin/cli.js` | validação/coerção de config conhecida |
| `bin/cli.js` | flags `--expose`, `--remote-base-url`, `--bind-host`; output Local/Remote |
| `src/cli/stop-cmd.js` | `stop --unexpose`; orphan scan continua local |
| `src/mcp.js` | `remoteUrl`, `remoteBaseUrl`, `expose`, `exposeRisk` em `mdprobe_view`/`mdprobe_status` |
| `src/singleton.js` | lockfile com metadados remotos separados de `url` |
| `src/setup.js` + template do skill | regra "mostre local + remote URL quando disponível" |

Observação: a flag nova deve ser `--remote-base-url`; `--remote-url` não deve ser introduzida para
configurar base URL, porque `remoteUrl` neste spec significa deep-link por arquivo.

## Plano de implementação

1. **Config e CLI de entrada.**
   - Adicionar coerção/validação de chaves conhecidas em `src/config.js`.
   - Parsear `--expose`, `--remote-base-url`, `--bind-host` e `--unexpose` em `bin/cli.js`.
   - Rejeitar `ngrok`/`cloudflare` até os handlers planejados existirem.
   - verified_by: `src/config.js:39-51`, `bin/cli.js:161-187`, `bin/cli.js:300-319`, `bin/cli.js:97-103`.

2. **Reconciliador comum.**
   - Criar `src/expose/index.js` e providers `off`, `external`, `tailscale`, `lan`.
   - O reconciliador recebe config efetiva, porta real do server e lock atual; retorna metadados remotos
     separados de `localUrl`.
   - verified_by: `src/mcp.js:35-75` e `bin/cli.js:432-467` têm caminhos separados que precisam chamar
     o mesmo módulo.

3. **Bind/listen/local URL.**
   - Parametrizar `bindHost` em `src/server.js` para LAN explícito.
   - Preservar `server.url` e `lock.url` como URLs locais para ping/join/singleton.
   - verified_by: `src/server.js:117,391,400,533`, `src/singleton.js:176-188,197-201`.

4. **Attach e lockfile remoto.**
   - Gravar `lock.remoteBaseUrl`, `lock.expose`, `lock.exposePort`, `lock.bindHost` e, quando existir,
     `lock.remoteUrl`.
   - Reconciliar expose em start e attach no CLI e no MCP.
   - Implementar `mdprobe stop --unexpose` passando a flag de `bin/cli.js` para `src/cli/stop-cmd.js`.
   - verified_by: `bin/cli.js:432-467`, `src/mcp.js:48-67`, `src/cli/stop-cmd.js:96-147`.

5. **Superfície MCP.**
   - Retornar `remoteBaseUrl`, `remoteUrl` quando houver arquivo único, `expose` e `exposeRisk` em
     `mdprobe_view` e `mdprobe_status`.
   - Usar o reconciliador comum ao criar server novo ou anexar a singleton existente.
   - verified_by: `src/mcp.js:155-183`, `src/mcp.js:297-313`.

6. **Tailscale e LAN.**
   - Tailscale: validar PATH, `tailscale status --json`, `BackendState`, `Self.DNSName`, erro de operador
     e `stop --unexpose`.
   - LAN: usar `bindHost` no port-check/listen, preferir IP de interface e emitir warning de risco.
   - verified_by: `src/server.js:110-118,388-400`.

7. **Setup, docs e testes.**
   - Atualizar `src/setup.js` e o template do skill para orientar agentes a mostrar `Local` e `Remote`
     quando a URL remota existir.
   - Cobrir os testes listados abaixo antes de considerar o slice pronto.
   - verified_by: `src/setup.js` existe e `package.json:25-31` define scripts de teste.

## Testes

- Unit: enum/coerção de config conhecida; `remoteBaseUrl` -> deep-link por arquivo; lockfile preserva
  `url` local e grava metadados remotos separados.
- Unit Tailscale: parse de `tailscale status --json`; `BackendState !== Running` faz fallback;
  DNSName com `.` final é normalizado.
- Integração Tailscale: PATH shim valida `serve --bg --https={port} {actualPort}`; erro "Access denied"
  gera warning e fallback local-only; `stop --unexpose` usa `lock.exposePort`.
- Integração attach: CLI e MCP reconciliam expose ao anexar em singleton existente.
- LAN: port-check usa o mesmo host do listen; `bindHost` por IP específico funciona; warning aparece.
- MCP: `mdprobe_view` e `mdprobe_status` retornam URLs locais e remotas consistentes.
- UI: WebSocket já deriva `ws/wss` de `location`, então live reload funciona atrás de HTTPS proxy sem mudança.

## Fora de escopo

- Auth próprio no server.
- `tailscale funnel`.
- Provider `command`.
- Multi-server simultâneo.
- Provider ngrok/cloudflare completo no primeiro slice se não houver validação segura de proteção.

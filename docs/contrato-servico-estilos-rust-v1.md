# Serviço experimental de estilos Rust — V1

## 1. Escopo e fronteiras

Esta é a 22ª fatia da migração. `rustPixelPocStyleService.ts` organiza **um
consumidor, um Worker exclusivo e um slot de fonte**. O serviço produz PNG de
uma camada/região através da sessão e do pipeline Rust existentes; não compõe
a pilha do documento. Não substitui `renderLayerStyle`, `renderDocument.ts`,
preview, exportação, histórico ou persistência `.axia`.

O núcleo do serviço não depende de DOM/Vite. A factory em
`frontend/src/services/rustPixelPocStyleService.ts` carrega o WASM local do
bundle e abre o Worker somente no primeiro pedido válido. Não usa CDN nem
baixa fontes. No ponto de entrega desta fatia, o chamador browser era o diagnóstico
`?axiaRustPoc=1`; importar a factory não cria Worker nem faz fetch.

A 23ª fatia liga um [consumidor real do canvas atrás de flag](contrato-preview-estilos-rust-v1.md),
com URL/handoff/fallback, sem ativação padrão ou compositor documental único.

A 24ª fatia adiciona um [agendador multicamadas isolado](contrato-agendador-estilos-rust-v1.md)
com um serviço privado compartilhado. A 25ª liga essa fila ao preview opt-in,
com preparação deferida e orçamento conjunto. O
preflight foi extraído sem mudar validações e `whenIdle()` permite esperar
drenagem física após cancelamento; reconexão espera o término anterior.

Rust, ABI, algoritmos e versões da stack permanecem iguais. Texto ainda é
desenhado pelas APIs browser e pelo desenhador existente, não por Rust.

## 2. API e identidade

```ts
const service = createRustPixelPocStyleService()
const lease = await service.render({
  sourceIdentity, sourceWidth, sourceHeight, styles, globalLight,
  source: { type: 'raster', blob }, // ou texto editorial + drawScaleX/Y
  patterns, region, resolutionScale, quality,
})
// Usar lease.result.blob, width/height, offsets e timings.
lease.release() // Somente depois de deixar de usar o resultado.
await service.dispose()
```

`source` é um Blob pronto ou descrição de texto, não um loader externo. Isso
evita reter loaders arbitrários/incontroláveis na fila. A sessão baixo nível
continua compatível com loaders. O serviço captura geometria, região, texto,
estilos normalizados, luz e mapa de assets antes de abrir Worker; alterações
posteriores nesses objetos não modificam o pedido. Blobs são imutáveis e são
emprestados por referência, sem decode ou cópia RGBA na UI.

`sourceIdentity` deve incluir a versão real do conteúdo. Reutilizar identidade
e geometria após modificar pixels/texto pode reutilizar a fonte antiga: o
serviço não calcula hash do Blob. A chave exata da preparação continua usando
identidade, dimensões, insets, escala e qualidade. Fill/cor/padrão/tiles podem
recompor com mesmo handle. Assets atuais são enviados/decodificados em cada
render; **não existe cache de resultado ou cache persistente de assets**.

A região continua em coordenadas locais do raster com padding, não do documento.
Resultados têm offsets locais compatíveis com a sessão. PNG atravessa Canvas,
portanto não promete igualdade byte a byte universal com RGBA puro ou hashes
PNG entre plataformas. Ver [contrato da preparação](contrato-preparacao-estilos-v1.md).

## 3. Último pedido vence

Há no máximo **um trabalho ativo e um pedido pendente**. Novo `render`:

1. Rejeita o pendente anterior e torna o ativo obsoleto.
2. Executa preflight e captura a entrada; falha também não permite publicar o
   resultado antigo.
3. Guarda somente o novo pendente e inicia quando o ativo terminar/for retirado.

O cancelamento invalida a revisão visual da sessão. Se o render já foi enviado,
envia `cancel` pelo ID original, sem criar RPC aguardando um ack separado.
Preparação de fonte e barreiras de lifecycle não são canceladas por esse método.
Decode/encoder já ativos não são magicamente interrompidos: o resultado é
descartado após a operação e os temporários são limpos pelo Worker.

Pedidos substituídos usam `RustPixelPocStyleCancelledError`; consumidores devem
tratar essa rejeição como obsolescência, sem toast de erro e sem deixar uma
Promise rejeitada sem handler. Cancelar não significa publicar fallback antigo.

`cancel()` descarta pedidos visuais mantendo fonte reutilizável.
`invalidate()` cancela pedidos e invalida a fonte; durante abertura, aborta e
retira a conexão ainda não adotada. `dispose()` é terminal/idempotente, cancela
pedidos, aborta abertura e termina o Worker de posse do serviço.

`whenIdle()` espera não haver ativo/pendente e aguarda as barreiras de término
físico. Não é bloqueio exclusivo: outro chamador ainda pode iniciar trabalho.
O agendador possui o serviço privadamente e só despacha após essa espera.

## 4. RPC, falhas e retomada

`RustPixelPocWorkerClient` correlaciona respostas por ID, ignora mensagens sem
pedido correspondente e limita RPCs pendentes a oito. Falha de post/clone retira
apenas o pedido; erro/messageerror/encerramento, resposta correlacionada sem tag
válida ou timeout rejeitam todos os pendentes, removem listeners e terminam o
Worker uma vez. Tags/payloads de domínio continuam validados pela sessão/gates.

Mensagens de cancelamento são fire-and-forget; `send({type:'cancel'})` é inválido.
`cancel(id)` ignora IDs desconhecidos/encerrados e barreiras de staging/lifecycle.
Não transfere buffers do editor; a inicialização transfere um buffer WASM próprio.

O watchdog do serviço cobre abertura + staging + efeitos + encode, com padrão
de **30 segundos** (configurável de 1 a 60.000 ms). O client RPC tem timeout de
10 segundos por mensagem. Estourar qualquer deadline retira o Worker; não
publica pixels antigos e o **próximo pedido**, não um retry automático, pode
abrir conexão nova e preparar fonte novamente.

Abertura recebe `AbortSignal`. O serviço não espera indefinidamente uma factory
que ignora abort: sua espera é abortável, e uma conexão que resolver tarde é
terminada sem adoção. Uma época de conexão impede que abertura antiga substitua
a nova. A factory deve limpar seus recursos próprios quando rejeitar; a factory
browser faz isso no fetch/init. Não há loop de reconexão ou rollout silencioso.

## 5. Orçamento lógico e leases

Limites padrão por instância:

| Parcela | Limite |
| --- | --- |
| Reserva agregada | 256 MiB, configurável de 96 a 512 MiB |
| PNGs ainda em uso | 64 MiB, configurável até 64 MiB |
| Leases simultâneas | 64, configurável até 64 |
| Metadados capturados | 4 MiB estimados, profundidade 16 e 100.000 nós |
| Identidade da fonte | 4.096 caracteres |
| Reserva da fase ativa | 96 MiB |

Mantêm-se os preflights de dimensões/PNG/assets da sessão e do Worker.
Metadados estimam strings/chaves UTF-16 e escalares, não o tamanho real dos
objetos no heap. A entrada cobra Blob original + todos os Blobs de assets
fornecidos + metadados. Assets inativos fornecidos também custam bytes.

Contabilidade por estado:

```text
ativo: 96 MiB + entrada ativa + entrada pendente + PNGs com lease
ocioso: fonte staged padded + entrada pendente + PNGs com lease
```

Os 96 MiB substituem a cobrança separada da fonte staged durante trabalho,
evitando dupla contagem dessa parcela. Novo pedido é recusado antes de abrir/
enviar quando a entrada, o ativo ainda não drenado e os resultados retidos não
cabem. Antes de iniciar pendente, o orçamento é conferido novamente. Publicação
confere tamanho acumulado de PNG, quantidade de leases e estado ocioso resultante.
Falhar na publicação não cria lease, não retira as anteriores e conserva fonte.

`stats` expõe ativo/pendente (0 ou 1), bytes de fonte, resultados retidos,
quantidade de leases, reserva lógica e estado de dispose. `release()` é
idempotente. O serviço guarda somente token/tamanho das leases; o consumidor
guarda o Blob. Dispose termina o Worker, **não revoga Blobs já entregues**:
leases continuam contabilizadas e liberáveis depois do fechamento.

Após release, não continuar usando/cachando o resultado fora do contrato.
Liberar uma lease não força GC. URLs de objeto, bitmap de apresentação e handoff
são responsabilidade do consumidor futuro e ainda não existem neste serviço.

**Não é limite global do aplicativo nem teto de RSS.** Não inclui páginas WASM
já crescidas, cópias implícitas do decoder/Canvas/encoder/structured clone,
objetos internos, imagens intrínsecas antes do resize, fontes browser, outros
Workers/serviços ou armazenamento editorial externo. Mesmo que vários pedidos
usem o mesmo Blob, a cobrança é conservadora por pedido. Resultados comprimidos
são cobrados após encode; essa checagem não evita a alocação anterior do encoder.

## 6. Validação e próximos passos

Testes de serviço usam Worker/WASM reais sob Node; Canvas/decoder/encoder são
doubles explícitos. Cobrem reuso, snapshots, rajadas, entrada inválida após pedido
ativo, padrões atuais, texto, contas/leases, retry, invalidate, dispose, morte do
Worker, deadline e abertura tardia/travada. RPC tem testes próprios de correlação,
capacidade, transferências, cancelamento, falha/timeout e remoção de listeners.

O diagnóstico Wails/WebView2 usa a factory browser, verifica PNG **real**
integral/tile/Fill, reuso, leases/release e obsolescência. Não é benchmark de FPS,
medição de pico de RAM ou validação de todas as fontes/cores/ambientes.

O consumidor real atrás de flag, com URL/handoff/fallback e métricas agrupadas,
está descrito no contrato da 23ª fatia. Antes do rollout,
definir compartilhamento/pool e orçamento global entre camadas, cache/eviction,
limites intrínsecos de mídia, tolerâncias visuais, decode → preparação → efeitos
→ encode → pintura e QA manual. Não criar um Worker exclusivo por camada sem
essa política. C0/C1/C2 continuam abertos; C3 é a pilha documental e C4 o canvas
único. Nenhum renderizador antigo foi removido.

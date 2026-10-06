# Preparação e sessão de estilos Rust — experimental

Esta fronteira aceita fonte RGBA **original** ou mídia/texto editorial, calcula as margens e executa o
[STG1](contrato-estagios-v1.md) pelo Worker existente. Não é compositor da pilha
documental nem troca do preview normal. A ABI WASM e os algoritmos Rust não
mudam. O contrato continua privado, sem estabilidade prometida para mods.

## 1. Fronteira e responsabilidades

- `rustPixelPocStylePreparation.ts`: normalização editorial, parâmetros,
  insets, geometria, região e preflight sem DOM/Canvas; layout compartilhado
  entre consumidor/Worker e padding em buffer próprio no Worker.
- `rustPixelPocStyleSession.ts`: um consumidor com posse exclusiva do slot de
  fonte de um Worker, preparação assíncrona compartilhada, upload e descarte.
- `rustPixelPocMedia.ts`/`rustPixelPocMediaQueue.ts`: decode browser de imagens e
  assets, desenho de texto existente, recursos temporários e fila serial limitada.
- Worker/runtime/STG1: fonte staged, filtros regionais, conteúdo, ordem dos
  estágios, preparação do padding, publicação atômica e liberação das alocações.
- Chamador: identidade de conteúdo, origem RGBA ou Blob/texto, assets, qualidade,
  escala e transformação posterior. Rust não recebe strings/fontes nem assume
  shaping/layout; texto continua usando `drawTextLayerContent` do navegador.

Entrada de `compose`:

```ts
{
  sourceIdentity, sourceWidth, sourceHeight,
  source: () => Promise<LayerStyleRaster>,
  styles, globalLight,
  resolutionScale?, quality?, patterns?, region?
}
```

`sourceIdentity` deve distinguir documento, camada, revisão de pixels e qualquer
mudança no raster de texto/forma. Não basta o ID da camada. Dimensões da fonte
decodificada devem coincidir com as declaradas; o buffer é `Uint8ClampedArray`
RGBA8, incluindo RGB oculto sob alfa zero, com comprimento exato.

O loader é lazy: não é chamado se a fonte staged compatível já existir. Fontes
com a mesma identidade são uma promessa de mesmos pixels, não são verificadas
por hash. O chamador não pode editar/transferir os pixels ou assets emprestados
durante o pedido; uma edição exige nova revisão e pedido. A sessão não modifica
nem transfere o buffer pertencente ao editor.

Entrada alternativa de `composeMedia`:

```ts
{
  sourceIdentity, sourceWidth, sourceHeight,
  source: () => Promise<
    { type: 'raster', blob: Blob } |
    { type: 'text', text: TextLayerContent, drawScaleX, drawScaleY }
  >,
  styles, globalLight,
  resolutionScale?, quality?, patterns?: Record<string, Blob>, region?
}
```

Este loader obtém mídia codificada ou descrição de texto, **não** decodifica
pixels na UI. Blob passa por structured clone, sem transfer de RGBA do editor.
Identidade de texto inclui conteúdo, fonte/fallback, métricas e escalas de desenho;
fontes carregadas/trocadas também exigem revisão nova. Texto e seus parâmetros
devem permanecer estáveis até o envio. Texto usa os limites existentes de conteúdo,
linhas/família e exige escalas/métricas finitas positivas. A camada continua editável.

Fonte raster é redimensionada para as dimensões solicitadas pelo decoder browser,
como no Worker normal: qualidade `medium` em interação e `high` em final.
Texto usa o desenhador atual no `OffscreenCanvas` com contexto fornecido, sem
introduzir um segundo shaping. Canvas pode alterar RGB invisível e antialiasing;
a promessa de preservar RGB oculto byte a byte pertence ao caminho **RGBA**, não
ao decode/browser. Ausência de APIs retorna `wasm-unavailable`, mídia corrompida
retorna `invalid-input`; não há fallback novo nesta sessão experimental.

`stage-style-media` recebe fonte e a mesma descrição reduzida de geometria.
`style-media-staged-region` recebe handle, descrição editorial completa de estilos,
região e Blobs dos assets por ID. Worker valida identidade/dimensões da fonte,
decodifica assets e prepara o plano STG1; não depende de pixels decodificados na UI.
O consumidor conserva preflight leve de geometria/região/metadata dos assets.

Somente padrões/texturas usados pelo pipeline ativo são decodificados: overlay,
traçado de padrão e textura de bisel habilitada. Mesmo ID com metadata de origem
ou dimensões conflitantes falha; usos compatíveis compartilham um decode por
pedido. Assets são decodificados **sequencialmente**. Dimensões reais devem
coincidir com metadata antes de criar Canvas/readback. Não há fetch de URL no
Worker, cache de assets ou cache de resultado: mudança de Blob recompõe a partir
dos pixels atuais, sem invalidar a fonte se suas margens continuarem iguais.

### Saída PNG no Worker

`composeMediaPng` aceita a mesma entrada de `composeMedia`, mas envia
`style-media-staged-png`. O processamento de fonte/assets/região/STG1 é o mesmo;
a saída RGBA permanece no Worker e é codificada em PNG por `OffscreenCanvas`.
Não existe outro algoritmo de efeitos para o PNG nem nova rasterização de texto.
Rust continua produzindo os pixels; o encoder é do navegador, não um codec Rust.

Resposta `encoded-staged-region` contém `blob`, dimensões, sourceId, geração,
timings do adapter e `encoding: { canvasUploadMs, pngEncodeMs }`, sem RGBA.
A sessão acrescenta as mesmas dimensões originais/expandidas e offsets locais.
O PNG é somente o raster compacto da região pedida, sem aplicação de transform
documental, opacidade da camada, DPI de exportação ou composição da pilha.

Formato de saída não entra na chave de fonte. Alternar RGBA/PNG preserva handle
se conteúdo/geometria/escala/qualidade forem os mesmos. O gate exige o formato
solicitado além de pedido/sourceId/geração/versão visual; RGBA não satisfaz pedido
PNG e vice-versa. Blob vazio, MIME diferente de `image/png`, geometria/timings
inválidos ou ack obsoleto não são resultados publicáveis. A sessão não cria URLs
de objeto: o consumidor futuro será responsável por criação/revogação e handoff.

Decode → STG1 → encode ocupa **um trabalho na fila serial existente**, não outra
fila de encoders paralelos. Barreiras de lifecycle e cancelamento continuam fora
dela. Converter um PNG ativo não é interrompível; após o await, Worker e sessão
conferem atualidade antes de devolver. Canvas é reduzido em `finally`, inclusive
em erro/cancelamento. Falha de encode não invalida fonte e permite retry.

ImageData usa uma view da saída RGBA, respeitando byteOffset/comprimento, sem
nova cópia completa no JS e sem transferir/destacar o buffer. Canvas ainda copia
os pixels e pode convertê-los para representação premultiplicada. PNG é lossless
**para os pixels entregues ao encoder**; o caminho Canvas pode alterar RGB oculto
ou arredondar cores com alfa parcial. Não prometer comparação universal byte a
byte entre RGBA puro e PNG redecodificado, nem hash PNG estável entre browsers.

## 2. Preparação e coordenadas

Styles/luz usam os normalizadores existentes. A escala segue
`composeLayerStyleRaster`: valor positivo finito limitado a 8, caso contrário 1;
não há o clamp inferior 0,01 do serviço de Blob. Esse serviço deverá fornecer
sua escala efetiva quando for integrado. Qualidade padrão: `final`.

Insets usam `layerStyleInsets`, incluindo luz global e sombras direcionais.
O preflight editorial leve permanece no consumidor antes de chamar o loader.
Após o decode, o consumidor valida/copía apenas RGBA original para um buffer
próprio transferível. Não aloca nem percorre o raster expandido na UI.

`stage-style-source` envia original, geração e descrição editorial de geometria
(identidade, dimensões, estilos/luz, escala, qualidade). Não envia planos STG1
nem pixels/URLs codificadas de texturas. A descrição conserva somente os campos
de sombra externa, brilho externo, traçado e bisel que influenciam insets, via
pipeline exaustivo; não duplica a matemática das margens. O Worker refaz
layout/preflight de preparação, cria o
padding transparente e copia cada linha integralmente, sem alterar alfa/Fill
ou descartar RGB invisível. Fill só ocorre no estágio de conteúdo do STG1.

O ack `source-staged` inclui `prepared` com chave exata, dimensões expandidas,
offsets e `preparationMs`. A sessão valida esses campos antes de adotar o handle.
O caminho `stage-source` de baixo nível permanece compatível e não tem esse
campo; um ack antigo não satisfaz o contrato da sessão de estilos.

No caminho RGBA, `preparationMs` mede layout/padding dentro do Worker. No caminho
de mídia, inclui layout, decode/desenho, readback e padding, **sem espera na fila**.
`stagingMs` mede somente alocação/cópia da fonte no WASM. Timings do tile medem
o adapter/kernel, incluindo cópia do pacote, mas não decode de assets/fila/RPC.
Nenhum é tempo total de UI; não somar como benchmark end-to-end.

`canvasUploadMs` inclui criação do Canvas/contexto/ImageData e `putImageData`;
`pngEncodeMs` mede `convertToBlob` até sua resolução. Não incluem decode de
fonte/assets, espera na fila, normalização editorial, RPC ou handoff/pintura.

Região omitida significa raster expandido inteiro. Região fornecida é absoluta
na **grade expandida da camada**, não no documento. Gradientes, padrões, ruído
e filtros continuam ancorados à grade inteira; um tile não reinicia amostragem.

Saída conserva RGBA, dimensões compactas, sourceId, geração e timings do
Worker. Adiciona dimensões originais/expandidas e offsets do tile:

```text
offsetX = region.x - insets.left
offsetY = region.y - insets.top
```

O chamador ainda transforma essas coordenadas locais para o documento.
Não há rotação/reamostragem, opacidade externa ou mesclagem da pilha aqui.

## 3. Cache da fonte versus aparência

A única entrada retida é o handle da fonte original expandida no WASM. Não
é cache de resultado, máscara filtrada, textura, backdrop ou documento.

Chave exata, sem hash de 32 bits, concatenação ambígua ou arredondamento:

```text
JSON([sourceIdentity, originalWidth, originalHeight,
      left, top, right, bottom, exactScale, quality])
```

A sessão distingue namespaces `raw:` e `media:` para não confundir origens
Canvas e RGBA com a mesma descrição editorial. Trocar o modo refaz o upload.

| Mudança | Upload |
| --- | --- |
| Cor, Fill, Blend If desta camada, ordem/parâmetros que mantêm margens | Reusa fonte; prepara novo plano e recompõe |
| Pixels de padrão/textura, mantendo geometria | Reusa fonte; plano envia os assets atuais, sem cache de resultado |
| Região/tile, mantendo fonte/escala/qualidade | Reusa fonte; executa pedido regional |
| Revisão de conteúdo ou dimensões originais | Invalida antes do decode e faz novo upload |
| Escala/qualidade, mesmo se padding não mudar | Novo upload conservador, sem quantização da escala |
| Margens diferentes por tamanho/posição/luz de efeito | Novo padding e upload |

Não confundir com `styledRasterPreviewSnapshot`: aquele adaptador identifica
**pixels já estilizados** antes do Blend If. Esta chave identifica a **máscara
original expandida**, antes de qualquer efeito. Dependências diferentes.

Uma fonte pendente é compartilhada por pedidos compatíveis. Falha de decode,
dimensões ou upload retira somente a entrada correspondente. A próxima
tentativa começa geração nova. Uma falha de render mantém fonte reutilizável.

## 4. Concorrência, invalidação e lifecycle

Uma sessão atende **um consumidor, último pedido vence**. Não é agendador de
tiles simultâneos; para montar uma imagem, pedir tiles sequencialmente. Criar
duas sessões para o mesmo slot de Worker não é suportado.

1. Cada compose avança revisão visual e gate, inclusive se o preflight falhar.
2. Troca de fonte avança geração e envia `invalidate-source` antes do loader.
3. Após cada await, a preparação confere se a entrada ainda é atual.
4. Upload usa geração reservada; RGBA transfere cópia original própria, mídia
   envia Blob/texto. Runtime invalida antes da factory de preparação do Worker.
5. Só ack atual com chave/geometria/preparationMs válidos pode ser adotado.
6. Render confere revisão, entrada, pedido, sourceId, geração, dimensões e
   comprimento RGBA antes de devolver pixels.

Um loader antigo que termine após troca/fechamento não sobe pixels. Um render
antigo que termine depois de outro pedido rejeita com
`RustPixelPocStyleCancelledError`; nunca vira resultado publicável.

`invalidate()` retira a entrada, invalida pedidos e libera a fonte staged pelo
protocolo. `dispose()` faz o mesmo, impede novos pedidos e retorna a mesma
promessa de limpeza em chamadas repetidas. Não termina o Worker, que pertence
ao chamador. Depois de reiniciar o Worker, criar sessão nova e fazer upload;
nunca reaproveitar handles/gates do runtime anterior.

Se timeout/crash impedir confirmar a limpeza, o proprietário deve terminar o
Worker. Uma rejeição de RPC não comprova que a fonte foi liberada remotamente.

Erro estruturado do Worker preserva código `RustPixelPocError`. Resposta fora do
contrato retorna `wasm-failure`. Obsolescência é erro separado, não falha de
pixels. O RPC fornecido à sessão deve rejeitar timeout/crash e preservar IDs.

O kernel é síncrono: obsolescência **não** interrompe trabalho ativo nem retira
pedidos já enviados da fila. Coalescência/prioridade/cancelamento cooperativo
continuam pendentes antes de integrar interações do editor.

O runtime tem factory assíncrona com ticket de geração. Invalidação, substituição
e dispose tornam esse ticket obsoleto; ele é verificado após cada await e antes
de alocar/copiar no WASM. Factory que falha consome geração e não pode repor fonte
anterior. Decoder browser já ativo não é interrompido; seu bitmap é fechado ao
terminar mesmo se obsoleto, sem readback/upload posteriores.

Uma fila exclusiva de mídia permite até **oito trabalhos, incluindo o ativo**.
Decode e render com assets são serializados; falha não paralisa o próximo.
Barreiras de fonte/init/dispose não entram nessa fila e continuam imediatas.
Render cancelado é checado antes/depois do decode; não libera a fonte válida.
Trabalhos de runtime anterior não publicam após reinit. A fila é limitada por
quantidade, sem prioridade/coalescência ou orçamento agregado em bytes ainda.

## 5. Preflight de memória

Antes do loader ou padding, validar dimensões, margens, região, assets e plano
STG1. Original e expandido têm limite individual de 64 MiB. Preparação cobra:

```text
preparationBytes = originalRGBA + 2 × expandedRGBA
```

Os dois rasters expandidos representam padding JS no Worker e fonte staged WASM.
A fonte WASM anterior é invalidada antes da preparação. Limite: 96 MiB nesta fase.
Isso também pode impedir uma fonte grande cujo tile de saída seja pequeno;
tiles de fonte/decodificação são trabalho futuro, não reduzir qualidade ocultamente.

No caminho atual, o original transferido é a entrada no Worker, os dois rasters
expandidos são padding JS do Worker e fonte WASM. O buffer emprestado do editor
é memória externa à fase. A cópia original no consumidor continua sendo O(N),
com dois originais vivos durante a cópia; esse pico também cabe na estimativa
pois o expandido nunca é menor que o original. Isso não elimina todas as cópias.

No caminho de mídia, bitmap e Canvas são fechados/reduzidos a 1×1 em `finally`,
antes de preparar padding. Na fase de decode, três originais representam bitmap,
Canvas e readback; cabem na mesma estimativa pois expanded ≥ original. A fase
posterior cobra original lido, padding e staged. Referências externas, coleta de
lixo e buffers internos do decoder não são um limite rígido de memória.

Cada Blob de fonte tem limite codificado de 64 MiB. Um pedido de assets permite
até 64 Blobs e 64 MiB codificados no total, **incluindo Blobs extras** que não serão
decodificados. Preflight de decode de assets cobra, até 96 MiB:

```text
stagedSource + retainedDecodedAssets + 3 × largestAssetRGBA
```

Após decode e antes de serializar/executar STG1, o caminho de mídia também cobra
`workingBytes + decodedAssetsBytes + packetBytes` até 96 MiB: soma retenção JS de
assets e a cópia JS do pacote ao orçamento do núcleo. Estimativa conservadora;
não elimina a diferença entre memória lógica e RSS.

Metadata não comprova as dimensões intrínsecas de um Blob. O browser pode alocar
memória de decode antes de redimensionar/rejeitar uma imagem incompatível.
Validar cabeçalhos/limites intrínsecos e orçamento global de filas/cache permanece
necessário antes do rollout. Não tratar limite de Blob como proteção completa
contra imagens de descompressão excessiva.

PNG tem preflight próprio antes de criar Canvas e, no Worker, antes do kernel:

```text
retainedBytes = stagedSource + decodedAssets + packetBytes
pngWorkingBytes = retainedBytes + 3 × tileRGBA
```

As três parcelas do tile estimam saída RGBA, Canvas e margem de trabalho do
encoder. Limite lógico de 96 MiB; RGBA e Blob individuais continuam limitados a
64 MiB. Após encode, `pngWorkingBytes + blob.size` também deve caber em 96 MiB
para publicar. Consumidor faz o preflight leve sem pacote antes do loader;
Worker cobra pacote depois do decode e antes de executar STG1/encode.

Tamanho comprimido e memória interna real do encoder não são conhecidos antes
da conversão: rejeitar o Blob pronto não evita essa alocação anterior. Canvas/
encoder/GC podem exceder a estimativa; isso **não** é teto rígido de RSS nem
orçamento agregado entre pedidos/Workers. Fila de quantidade limitada não
substitui o futuro agendamento/orçamento em bytes.

`stagePreparedSource` valida/consome geração antes da factory e retira a fonte
anterior, mesmo se layout/padding/bytes falharem. Geração inválida/atrasada não
executa a factory nem retira fonte atual. Factory que falha consome a geração;
retry exige geração nova. Liberação antes de preparar evita duas fontes WASM
staged simultâneas. Callbacks deste runtime são internos, não uma ABI WASM.

O orçamento STG1 regional continua separado e obrigatório: fonte staged,
pacote, três tiles, metadata e pico dos filtros, até 96 MiB. Não alocar pacote
grande só para descobrir depois que excede o limite.

Esses valores são contabilidade lógica conservadora por fase, **não RSS nem
teto global do app**. Cobrem somente os buffers explicitamente cobrados em cada
caminho: não incluem armazenamento de Blob, buffers implícitos do decoder/Canvas,
metadata/URLs, páginas WASM já crescidas, filas ou outros Workers. No caminho
RGBA, assets/pacote/resultado JS continuam externos ao orçamento do núcleo;
no caminho de mídia, assets e pacote JS têm a cobrança adicional descrita acima.
Orçamento agregado, leases de cache e pressão de memória continuam abertos.

## 6. Validação e próxima integração

Testes usam a sessão real e o Worker/WASM real, sem preparar padding na fixture:
16 goldens históricos, estilos combinados, offsets direcionais, tiles, RGB
invisível, transferência sem destacar buffer do editor, escalas/flags e limites.
Reuso conta uploads/loaders; concorrência e falhas cobrem decode compartilhado,
resposta tardia, retry, invalidate/dispose e reinício de Worker. O diagnóstico
Wails/WebView2 tem entrada/resultado RGBA fixos e confirma reuso com Fill/tile.

Ainda não liga esta sessão a `renderLayerStyle`, exportação ou preview normal.
Padding/layout e decode raster/texto/assets já executam no Worker na alternativa
`composeMedia`. O caminho RGBA continua compatível. Testes Node de mídia usam
doubles explícitos de Canvas/decoder e Worker/WASM reais; não provam fidelidade
do decoder browser. O diagnóstico Wails/WebView2 usa **PNG real**, confere bytes
opacos fixos, padding, tiles/reuso, mudança de padrão e texto não vazio. Isso não
comprova paridade de fontes/antialiasing entre plataformas.

`composeMediaPng` completa decode → efeitos Rust → Blob no Worker experimental.
Testes Node de encode usam doubles explícitos, não um codec PNG real. O smoke
WebView2 confere assinatura/dimensões e redecodifica PNG real de integral/tile,
Fill, padrão atualizado e texto não vazio, com reuso da fonte e offsets. Casos
fixos têm pixels representáveis no Canvas; não são uma promessa de paridade
universal de alfa/cores ou desempenho do encoder.

Faltam serviço/integração do consumidor, coalescência/prioridade, cache/orçamento agregado, limites
intrínsecos das imagens e integração/medição do serviço real. Medir decode
→ preparação → Worker → encode → handoff e verificar regressões na interface.
Não basta os testes desta fatia para fechar C2; pilha/backdrop/transforms são
C3, canvas único é C4. Nenhuma aceleração/FPS foi medido nesta mudança.

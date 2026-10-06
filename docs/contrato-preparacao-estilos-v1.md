# Preparação e sessão de estilos Rust — experimental

Esta fatia aceita uma fonte RGBA **original**, calcula as margens e executa o
[STG1](contrato-estagios-v1.md) pelo Worker existente. Não é compositor da pilha
documental nem troca do preview normal. A ABI WASM e os algoritmos Rust não
mudam. O contrato continua privado, sem estabilidade prometida para mods.

## 1. Fronteira e responsabilidades

- `rustPixelPocStylePreparation.ts`: normalização editorial, parâmetros,
  insets, geometria, região e preflight sem DOM/Canvas; padding em buffer próprio.
- `rustPixelPocStyleSession.ts`: um consumidor com posse exclusiva do slot de
  fonte de um Worker, decode assíncrono compartilhado, upload e descarte.
- Worker/runtime/STG1: fonte staged, filtros regionais, conteúdo, ordem dos
  estágios, publicação atômica e liberação das alocações temporárias.
- Chamador: identidade de conteúdo, origem RGBA, assets decodificados, qualidade,
  escala e transformação posterior. Texto/forma permanecem rasterizados pelos
  caminhos atuais; Rust não recebe strings/fontes nem assume shaping/layout.

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

## 2. Preparação e coordenadas

Styles/luz usam os normalizadores existentes. A escala segue
`composeLayerStyleRaster`: valor positivo finito limitado a 8, caso contrário 1;
não há o clamp inferior 0,01 do serviço de Blob. Esse serviço deverá fornecer
sua escala efetiva quando for integrado. Qualidade padrão: `final`.

Insets usam `layerStyleInsets`, incluindo luz global e sombras direcionais.
O padding é transparente; cada linha da fonte é copiada integralmente, sem
alterar alfa/Fill ou descartar RGB invisível. Fill só ocorre no estágio de
conteúdo do STG1, uma vez.

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
4. Upload usa geração reservada e transfere apenas padding próprio.
5. Só um ack staged atual pode ser adotado pelo gate.
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

## 5. Preflight de memória

Antes do loader ou padding, validar dimensões, margens, região, assets e plano
STG1. Original e expandido têm limite individual de 64 MiB. Preparação cobra:

```text
preparationBytes = originalRGBA + 2 × expandedRGBA
```

Os dois rasters expandidos representam JS/transfer e cópia staged WASM. A fonte
WASM anterior é invalidada antes da preparação. Limite: 96 MiB nesta fase.
Isso também pode impedir uma fonte grande cujo tile de saída seja pequeno;
tiles de fonte/decodificação são trabalho futuro, não reduzir qualidade ocultamente.

O orçamento STG1 regional continua separado e obrigatório: fonte staged,
pacote, três tiles, metadata e pico dos filtros, até 96 MiB. Não alocar pacote
grande só para descobrir depois que excede o limite.

Esses valores são contabilidade lógica conservadora por fase, **não RSS nem
teto global do app**. Não incluem buffers externos de Canvas/Blob, cópias JS de
assets/pacote/resultado, páginas WASM já crescidas, filas ou outros Workers.
Orçamento agregado, leases de cache e pressão de memória continuam abertos.

## 6. Validação e próxima integração

Testes usam a sessão real e o Worker/WASM real, sem preparar padding na fixture:
16 goldens históricos, estilos combinados, offsets direcionais, tiles, RGB
invisível, transferência sem destacar buffer do editor, escalas/flags e limites.
Reuso conta uploads/loaders; concorrência e falhas cobrem decode compartilhado,
resposta tardia, retry, invalidate/dispose e reinício de Worker. O diagnóstico
Wails/WebView2 tem entrada/resultado RGBA fixos e confirma reuso com Fill/tile.

Ainda não liga esta sessão a `renderLayerStyle`, exportação ou preview normal.
Preparação/normalização/padding executam no ambiente do chamador; mover ou
hospedar essa fronteira num Worker antes do rollout evita trabalho de raster
grande no thread da UI. Falta adaptar decode raster/texto e assets, controlar
fila/orçamento agregado, medir decode → preparação → Worker → encode → handoff
e verificar regressões na interface. Não basta os testes desta fatia para
fechar C2; pilha/backdrop/transforms são C3, canvas único é C4.

# ABI privada DCP1 — pilha documental preparada

Estado: **C3, fatia 2 implementada**, em Rust nativo, WASM, runtime TypeScript
e Worker de diagnóstico. Sem consumidor editorial ou rollout. Continua com
escala 1 e translação inteira do [núcleo inicial](contrato-pilha-documental-rust-v1.md).
Não é a ABI completa de [ComposeRequestV1](contrato-compositor-v1.md).

A fatia 3 adiciona [DCP2](contrato-transformacoes-documentais-rust-v1.md),
grade global e transformação afim, sem estender silenciosamente este layout
DCP1. O mesmo export aceita ambas as versões; consulta de capacidade distingue
WASM anterior. As provas abaixo registram a entrega original da fatia 2.

## 1. Entrada e saída

```text
axia_poc_document_region(packet_ptr, packet_len, output_ptr, output_len) -> u32
```

Quatro parâmetros inteiros, ponteiros/lengths locais à memória WASM. Usar pares
vivos de `axia_poc_alloc`, liberar com `axia_poc_free` uma única vez, sem overlap
entre pacote e saída. O export é `unsafe` para callers nativos; não comprova que
um endereço arbitrário corresponde a uma alocação viva. O adapter verifica
comprimentos e limites da memória. A função segura `compose_document_packet`
valida os offsets internos antes de construir slices/rodar o núcleo.

Saída compacta RGBA8 com alfa reto, stride `region.width * 4`, comprimento
exato `region.width * region.height * 4`. Formato, cor, clipping e ordem seguem
o núcleo inicial. Fontes chegam prontas; nada de decode, texto, estilos,
rotação, reamostragem ou `Blend If` implícitos.

## 2. Pacote little-endian

Todos os offsets são relativos ao início do pacote, **não ponteiros**. Header
de 48 bytes, seguido de `count` records de 40 bytes e todos os rasters em ordem,
sem gaps, bytes finais extras ou compartilhamento de offsets. Duplicar fontes
repetidas conserva o orçamento de referências do núcleo.

| Offset header | Campo | Tipo/valor |
| --- | --- | --- |
| 0 | magic | bytes ASCII `DCP1` |
| 4 | versão | `u32 = 1` |
| 8 | tamanho header | `u32 = 48` |
| 12 | número de camadas | `u32`, 0–1.024 |
| 16 / 20 | largura / altura documento | `u32` positivo |
| 24 / 28 | X / Y região global | `u32`, origem não negativa |
| 32 / 36 | largura / altura região | `u32` positivo |
| 40 | resolutionScale | `f64 = 1.0` |

| Offset record | Campo | Tipo/valor |
| --- | --- | --- |
| 0 / 4 | offset / comprimento RGBA | `u32`; raster compacto e contíguo |
| 8 / 12 | largura / altura fonte | `u32` positivo |
| 16 / 20 | X / Y camada | `i32`, complemento de dois |
| 24 | visible | `u32 = 0 ou 1`, sem bits extras |
| 28 | blendMode | `u32`: normal=0, multiply=1, screen=2, overlay=3, darken=4, lighten=5 |
| 32 | opacity | `f64` finito em `[0,100]`, frações permitidas |

Pilha vazia tem exatamente 48 bytes e gera transparência. Para cada record,
offset deve coincidir com o fim do raster anterior (primeiro começa após todos
os records). Somar com verificação antes de fatiar. Rejeitar comprimento zero,
não múltiplo de quatro, truncamento, dimensão incompatível e último fim
diferente de `packet_len`, inclusive para camadas invisíveis/fora da região.

Não estender a V1 silenciosamente com flags, transformações ou novos modos;
versionar e testar o adapter. Origem/escala editorial fracionária não pode ser
arredondada para caber neste formato.

## 3. Preflight e budgets

Pacote e saída têm teto individual de 64 MiB; eixos até 16.384. Teto lógico
Rust por chamada: `packet_len + output_len + count * 128 <= 96 MiB`, incluindo
metadata do pacote e reserva de descritores. Núcleo também aplica seus limites.
Reserva/alocação dos descritores usa `try_reserve_exact`, com erro recuperável.
Todos os erros do parser/núcleo preservam a saída anterior.

O runtime TS valida o job **antes de criar o pacote**, e valida novamente um
pacote recebido **antes de alocar WASM**. Recusa `SharedArrayBuffer` para impedir
mutação concorrente durante leitura; fontes `Uint8Array` em subviews normais
são aceitas. Não transfere/detacha buffers editoriais: encoder faz cópia própria.

Se já existir fonte staged no runtime, acrescentar seus bytes ao preflight de
96 MiB sem liberá-la ou alterar sua geração. Alocar pacote e saída, recriar
views após as alocações (`memory.grow` pode destacar views antigas), copiar a
saída para buffer JS próprio e liberar os pares em `finally`, inclusive em
falha da segunda alocação ou trap do kernel. Views de WASM não escapam ao caller.

Esse teto **não é RSS nem admission global**: fontes JS originais, pacote JS,
resultado JS, memória reservada do WASM, mídia em decode e outros jobs/serviços
podem coexistir. `composeDocumentRegion` empacota em JS antes do preflight que
inclui fonte staged. Integrar essas cópias/concorrência ao serviço/scheduler
antes de qualquer consumidor real; não somar um orçamento independente ao
preview. Esta V1 faz upload completo por chamada, não reutilização de pilha.
Não é caminho otimizado de preview/tiles nem prova de ganho de desempenho.

## 4. Erros e compatibilidade

| Status | Significado |
| --- | --- |
| 0 | sucesso |
| 1 | comprimento de buffers inválido |
| 2 | pacote/campos/geometria/escala não suportados |
| 3 | ponteiro nulo |
| 5 | overlap entre pacote e saída |
| 6 | orçamento ou reserva de memória |

Preflight TS usa `RustPixelPocError('invalid-input' | 'memory-limit')`.
Depois dele, status inesperado do kernel vira `wasm-failure`; status 6 continua
`memory-limit`. Worker converte traps/exceções desconhecidas em `wasm-failure`.
Todos os pares já alocados são liberados; erro não altera fonte staged.

O export documental é opcional na validação geral do runtime: WASM antigo
ainda pode atender os estilos existentes. Ao pedir pilha, exigir export de
arity quatro ou retornar `wasm-unavailable`, sem fallback oculto de pixels.
A verificação de bundle novo exige esse export. O aplicativo ainda não tem
rollout/fallback editorial de composição documental porque não o chama.

## 5. TypeScript e Worker

`rustDocumentComposite.ts` fornece `RustDocumentCompositeJob`,
`RustDocumentRasterLayer`, `encodeDocumentComposite` e
`documentCompositePacketLayout`. Runtime expõe `composeDocumentRegion(job)` e
`composeDocumentPacket(packet)`; retornam RGBA próprio, região, dimensões e
timings de alocação/copy-in/kernel/copy-out/liberação. Esses timings não cobrem
encoder/preflight completo, transfer, fila, decode ou apresentação.

Protocolo de diagnóstico:

```text
compose-document-region { id, packet: ArrayBuffer }
rendered-document-region { id, rgba: ArrayBuffer, region, width, height, timings }
```

Caller pode transferir o pacote próprio. Worker transfere RGBA de saída. Não
modificar fonte, token/generation staged ou controles de lifecycle. Pedido
entra nos renders canceláveis e nos guards de init/dispose; o kernel síncrono
não é interrompível durante o tile. Cancelamento que chega durante WASM só
pode ser atendido depois: caller precisa recusar resposta obsoleta por revisão/
ID e cancelar entre tiles. Ainda não há scheduler de documento, revisions de
documento no protocolo, cache de pilha ou integração com admission do serviço.

## 6. Diagnóstico e próximos gates

Diagnóstico explícito `axiaRustPoc=1` envia duas camadas, posiciona uma delas
no segundo pixel e confere Multiplicação contra bytes fixos, transferência e
dimensões. Não desenha esses pixels no editor. A factory/preview normal não
ganhou consumidor documental nem ativação default.

Testes abrangem parser Rust nativo, layout/encoder TS, ABI WASM direta e
Worker real pelo harness Node. Verificam pacote adulterado, offsets extremos,
overlap, campos tardios inválidos, fontes originais preservadas, memória
crescendo, falhas com cleanup, coexistência com staging e pacote vazio.
Goldens fixos de modos/alpha repetem os casos nativos; tiles irregulares têm
comparação byte a byte com o render inteiro WASM. Não são comparação Canvas
completa, teste de FPS ou QA de documentos reais.

Transformação/reamostragem inicial por grade global está implementada na fatia
DCP2; qualidade de minificação e paridade Canvas continuam gates. Próximos
passos: estilos/Fill e
`Blend If` sobre backdrop; scheduler/ownership/admission da pilha; consumidor
offscreen atrás de flag com matriz de paridade e cancelamento. Não plugar
esta V1 diretamente em export/preview e reconstruir/uploadar tudo a cada tile.
C0/C1/C2/C3/C4 permanecem abertos. Nenhuma remoção de legado, mudança de stack,
arquivo `.axia`, idioma, texto ou instalador nesta fatia.

## 7. Validação local — 2026-10-07

- `cargo test --offline --locked --manifest-path rust/axia-pixel-core/Cargo.toml`:
  **86** testes nativos; cinco casos novos do parser DCP1. Os **25** casos
  documentais (núcleo + pacote) também passaram com `--release`.
- `cargo fmt --check`, `go test ./...` e `git diff --check` passaram.
- `npm test`: **587** casos frontend e verificação de tipos.
- `npm run test:rust-poc`: **377** casos — cinco standalone, um smoke Worker
  e **371** scripts. Os **11** novos casos DCP1 incluem preflight/layout,
  goldens WASM, tiles, ABI direta/corrupção/overlap, staging, transfer,
  falhas de alocação/kernel, `memory.grow` e ausência do export novo.
- Esses **11** casos passaram em três execuções consecutivas. Repetição não
  é benchmark nem prova de desempenho.
- Build/integridade do bundle passaram; WASM **102.927 bytes**,
  `axia_pixel_core-B27FCRAV.wasm`; Worker `rustPixelPoc.worker-CyglXhzp.js`.
  Gate de bundle exige export documental de arity quatro e comando no Worker.
  Aviso preexistente de chunk >500 kB permanece.
- Diagnóstico Wails/Worker/WASM passou com a nova composição de duas camadas
  no WebView2 `Edg/154.0.4258.62`. É prova de cálculo/transfers nesse runtime,
  não do preview documental ainda não integrado.
- Smokes do preview **Rust opt-in, WASM bloqueado/fallback e padrão** passaram.
  Preservaram buffers durante seleção/pan; um Worker para três consumidores
  Rust e cleanup sem leases/consumidores/cache retidos. Caminho DOM e compositor
  legado continuam sendo usados conforme configuração, sem retirada nesta fatia.

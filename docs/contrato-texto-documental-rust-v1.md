# Texto no consumidor documental Rust — C3, fatia 12

Estado: **camadas de texto simples passam pelo compositor Rust sob o flag
documental experimental** (`axiaRustDocument=1`). Antes desta fatia, qualquer
camada de texto levava o documento inteiro ao fallback (`non-image-layer`).
Não habilita Rust por padrão, não altera o preview ao vivo, a tipografia, a
nitidez de texto do editor, o `.axia` nem o compositor legado.

Relacionado às [formas](contrato-formas-documentais-rust-v1.md), cujo desenho
esta fatia espelha, à [sessão persistente](contrato-sessao-documental-rust-v1.md)
e ao [consumidor editorial](contrato-consumidor-documental-rust-v1.md).

## 1. Onde o texto nasce

Como decidido no roadmap, o texto continua nascendo do renderizador do
navegador; o contrato só recebe raster. Diferente das formas, que o Worker traça
em `OffscreenCanvas`, o texto é rasterizado na **thread principal**: fontes
declaradas por `@font-face` pertencem ao documento e não existem no Worker.

O fluxo tem três etapas, com responsabilidades separadas:

| Etapa | Onde | O que carrega |
| --- | --- | --- |
| plano (`planRustDocumentText`) | thread principal, síncrono | descritor sem pixels: conteúdo, transformação, bounds inteiros, opacidade |
| carga (`drawRustDocumentText`) | thread principal | pixels RGBA da grade documental, como `ArrayBuffer` |
| preparo (`prepareRustDocumentMedia`) | Worker | validação e composição 1:1, sem decoder, Canvas nem STG1 |

O descritor é a identidade da sessão: dois pedidos com o mesmo texto,
transformação e bounds reutilizam a preparação e **não rasterizam de novo**;
mudar o conteúdo prepara outra vez. Pixels viajam como `ArrayBuffer`, que não
tem propriedades enumeráveis próprias: um `Uint8ClampedArray` seria percorrido
byte a byte pela contagem de metadados do Worker e estouraria seu limite.

## 2. Mesma sequência do legado

`drawRustDocumentText` repete as operações do texto em `drawPreparedLayer`:
opacidade em `globalAlpha`, translação ao centro, rotação, escala da caixa base
para a transformação, translação de meia caixa, recorte retangular e
`drawTextLayerContent` — a mesma função de desenho do legado, sem cópia. A única
diferença é uma translação **inteira** pela origem da fonte, que preserva a fase
subpixel dos glifos. A quebra de linha usa o mesmo contexto de desenho para
medir, então sai igual nos dois caminhos com a mesma fonte.

A rasterização é transitória, na resolução documental, como na exportação
legada: o conteúdo da camada não muda e a estratégia de nitidez do preview não
é tocada. Opacidade é incorporada uma vez; o Rust compõe a fonte 1:1 com
opacidade 100, sem reamostrar — portanto sem depender da sonda da fatia 11.

## 3. Recorte desta fatia e motivos

| Condição | Resultado | Motivo |
| --- | --- | --- |
| efeitos ou Fill < 100 | `text-style` | o legado manda esse texto por um raster de estilo reamostrado, não pelo desenho direto |
| `Mesclar se` diferente do padrão | `text-style` | caminho separado no legado |
| modo de mesclagem diferente de Normal | Rust (desde 2026-10-27) | mesclado uma vez, como o preview; ver seção 4 |
| fonte de `@font-face` ainda carregando | `text-font-pending` | ver seção 5 |
| camada `text` sem conteúdo | `non-image-layer` | inalterado |

Toda recusa refaz a chamada inteira no Canvas anterior.

## 4. Mesclagem de texto não Normal (decidida em 2026-10-27)

`drawTextLayerContent` faz várias operações (`fillText` por linha, `fillRect`
de sublinhado/riscado). O legado aplica o modo de mesclagem a cada operação, em
sequência, direto sobre o fundo; este caminho desenha o texto isolado e mescla
uma vez. Para Normal os dois são idênticos, porque *source-over* é associativo.
Para Multiplicação e afins, onde operações se sobrepõem — sublinhado cruzando
descendentes, glifos sobrepostos em itálico ou com espaçamento negativo,
linhas que se tocam —, o legado aplica a mesclagem **duas vezes** na
sobreposição.

O preview ao vivo aplica `mix-blend-mode` ao elemento da camada, isto é, mescla
a camada isolada, como o Photoshop. Nesse caso a exportação legada é que diverge
do preview, não o Rust.

**Decisão do produto (2026-10-27): vale a semântica do preview.** O texto é
desenhado isolado, com a opacidade incorporada, e mesclado uma vez com o modo da
camada; o que aparece na tela é o que se exporta. A exportação legada continua
divergindo nas sobreposições até ser removida. O oráculo browser confere 45
casos (três fontes, três variantes com sublinhado, rotação e parágrafo, cinco
modos) contra o documento sem o texto mais o texto isolado mesclado pelo Canvas,
dentro da tolerância 2/3; o pior caso segue sendo de Normal (1/2,81).

## 5. Fontes ainda carregando

Se o primeiro render ocorrer antes de uma `@font-face` terminar, a sessão
reutilizaria o documento preparado com a fonte de fallback mesmo depois da
carga — o legado redesenharia corretamente na chamada seguinte.
`rustDocumentTextFontsReady` usa `document.fonts.check()`, que só responde falso
para fonte declarada e ainda não carregada; fontes do sistema e famílias
inexistentes respondem verdadeiro, como no `fillText` do legado. Uma fonte já
carregada não volta a faltar, então o reuso posterior é seguro.

## 6. Provas

- Node (`tests/rustDocumentText.test.ts`): descritor 1:1 com opacidade
  incorporada e snapshot imune a edições posteriores; os cinco motivos de
  fallback; sonda de fontes (pendente, pronta, `check` lançando erro, ausente);
  bounds recortados no documento e deslocados na aparência; sequência exata de
  operações de desenho com double de Canvas; liberação do canvas em falha;
  validação de geometria e tamanho do buffer no Worker.
- WASM (`scripts/tests/rustDocumentText.test.ts`): composição byte a byte sem
  decoder/Canvas; rejeição de opacidade, Fill, modo, matriz, dimensões e buffer
  adulterados; Worker real compondo tiles; sessão que rasteriza uma vez para o
  mesmo descritor e de novo quando o conteúdo muda; carga sem busca de URL.
- Oráculo browser (Edge headless): **18 casos** — Arial, Georgia e Consolas ×
  seis variantes (ponto, multilinha centralizado em itálico, parágrafo com
  quebra alinhado à direita, negrito sublinhado em caixa alta com espaçamento,
  riscado com espaçamento negativo ampliado 1,6×, texto em elipse), com rotações
  de 0°, 37°, −90°, 180° e 12°, posições fracionárias, opacidade parcial, recorte
  na borda e fundos transparente, branco e forma semitransparente. Máximo de
  **1** em alfa e **2,81** em RGB premultiplicado, para tolerância 2/3. Cada caso
  precisa alterar ao menos 20 pixels em relação ao mesmo documento sem o texto
  (mínimo observado: 254), para que dois renders vazios não passem por
  coincidência. O conta-gotas reutilizou a sessão duas vezes sem rerasterizar.
- Wails/WebView2 real: Segoe UI e Arial, com rotação e opacidade parcial sobre
  fundo semitransparente, dentro de 2/3 e com a mesma guarda de tinta.

A margem de 2,81 contra 3 é estreita, e sua origem **não foi medida**. A hipótese
mais provável são as bordas antialiasadas: o legado mescla em armazenamento
premultiplicado de 8 bits, enquanto este caminho lê o texto isolado com
`getImageData`, que despremultiplica e quantiza antes de o Rust compor. Se uma
fonte ou tamanho novo ultrapassar a tolerância, verificar essa hipótese antes de
suspeitar da geometria — e não ampliar a tolerância para acomodar o caso.

## 7. Gates restantes

Texto com efeitos ou Fill < 100 (exige a densidade e o raster de estilo do
legado), modos de mesclagem não Normal (seção 4), `Mesclar se` em texto, escalas
de saída diferentes de 1:1, outras fontes e scripts (bidi, CJK, emoji), canvases
acelerados por GPU na exportação legada e QA com documentos do usuário.

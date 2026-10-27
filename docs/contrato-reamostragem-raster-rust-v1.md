# Reamostragem raster compatível com Canvas — C3, fatia 11

Estado: **ampliação, redução, translação fracionária e quartos de volta passam pelo
Rust sob o flag documental experimental**; redução abaixo de 0,5 usa média de área
(seção 6.1). Rotação arbitrária continua em fallback integral. Não habilita Rust por padrão nem altera o
compositor legado, o `.axia` ou o preview.

Relacionado à [aparência e mesclagem](contrato-aparencia-mesclagem-rust-v1.md)
(fatia 10, que introduziu o gate 1:1 aqui relaxado),
[transformações documentais](contrato-transformacoes-documentais-rust-v1.md)
(sampler de cobertura DCP2) e ao
[consumidor editorial](contrato-consumidor-documental-rust-v1.md).

## 1. Problema

A fatia 10 encontrou divergência real (alfa/RGB premultiplicado 119/119) entre o
sampler afim de cobertura do DCP2 e o `drawImage` do Canvas para imagem
rotacionada/fracionária, e passou a exigir matriz raster alinhada 1:1 à grade.
Isso empurrava para o fallback qualquer imagem ampliada ou posicionada em
coordenada fracionária — casos frequentes em documentos reais.

O sampler DCP2 calcula **cobertura geométrica** do quadrilátero transformado
(antialiasing analítico nas bordas). O Canvas, para `drawImage` alinhado a eixos
com `imageSmoothingQuality = 'low'` (padrão, usado pelo legado), faz **bilinear
no centro do pixel com recorte por retângulo de pixels**, sem antialiasing de
borda. São semânticas diferentes; aproximar uma pela outra com tolerância maior
mascararia o problema.

## 2. Modos de amostragem

`DocumentSampling` acrescenta três modos ao sampler existente; o padrão continua
sendo cobertura, de modo que DCP1–DCP3 e os consumidores anteriores não mudam.

| Modo | Kernel | Quando o adapter escolhe |
| --- | --- | --- |
| `CoverageBilinear` | cobertura geométrica + bilinear (DCP2) | fonte 1:1 alinhada à grade e formas |
| `RasterBilinear` | bilinear no centro, clamp na borda, fração quantizada em 1/16, recorte retangular | modo Normal sem rotação |
| `RasterBilinearPrecise` | igual, sem quantização da fração | demais modos ou com quarto de volta/espelhamento |
| `RasterArea` | média de caixa exata sobre a pegada do pixel, em espaço premultiplicado | redução abaixo de 0,5 em algum eixo |

O recorte retangular inclui o pixel `i` quando `i ≥ floor(borda + 0,5)` na
borda inicial e `i < floor(borda + 0,5)` na final. A quantização em 1/16 e a
escolha por modo de mesclagem reproduzem o pipeline que o Skia usa em cada caso;
ambas foram fixadas empiricamente pelo oráculo, não por documentação do Chrome.

O sampler recusa os modos raster quando a grade de saída não é 1:1 com origem
inteira (`UnsupportedScale`) ou quando a matriz não é alinhada a eixos, admitindo
quartos de volta (`InvalidTransform`). Os bilineares exigem `|escala| ≥ 0,5` em cada
eixo (`RASTER_BILINEAR_MIN_SCALE`); a área exige `0 < |escala| ≤ 1` nos dois.
Componentes com módulo até `1e-12` são tratados como zero.

## 3. ABI — DCP4

O pacote DCP4 (versão 4, cabeçalho de 80 bytes, registro de camada de 96 bytes)
carrega o modo no byte 92 do registro: `0` cobertura, `1` `RasterBilinear`,
`2` `RasterBilinearPrecise`, `3` `RasterArea`. Qualquer outro valor rejeita o
pacote inteiro.
O TypeScript só emite DCP4 quando ao menos uma camada pede reamostragem; os
demais pedidos continuam com a versão anterior, preservando compatibilidade com
WASM que não exporte o DCP4.

## 4. Gates do adapter editorial

Em ordem, para cada camada raster:

| Condição | Resultado |
| --- | --- |
| matriz alinhada à grade (fatia 10) | composição 1:1, sem modo raster |
| alinhada a eixos ou quarto de volta, as duas escalas ≥ 0,5 | bilinear |
| alinhada a eixos ou quarto de volta, escalas ≤ 1 e alguma < 0,5 | média de área |
| qualquer outra transformação | `source-transform-quality` |
| reamostragem combinada a `Mesclar se: camada abaixo` no documento | `source-transform-blend-if` |

Toda recusa refaz a chamada inteira no Canvas anterior; não há composição mista.

## 5. Sonda de plataforma

A paridade depende do Canvas real que o WebView2 do usuário entrega (CPU ou GPU,
versão do Skia). Antes do primeiro documento com camada reamostrada, o renderer
executa uma sonda única por página: desenha uma fonte 2×2 conhecida em canvases
de 16 e 512 px, a partir de `HTMLImageElement` e `ImageBitmap`, nas escalas 1 e
1,5 com translação fracionária, e compara pixels de canto e de miolo com o
esperado (tolerância 2). Falha, exceção ou estouro de 2 s resultam em
`source-transform-platform` e fallback integral; o resultado fica em cache.

Desde a seção 5.2, a sonda **não** exige direção de empate nem precisão de peso,
que o próprio Chromium varia. Ela usa escalas 1 e 2 em posições sem empate e com
frações múltiplas de 1/16 — onde pesos quantizados e exatos coincidem — e exige
que nada vaze para fora da fonte. Reprova plataformas que filtrem de outro modo
(vizinho mais próximo, mipmap, blur).

### 5.1 WebView2 medido: sonda reprova, fatia inativa (2026-10-26)

O smoke Wails (executável de produção, WebView2 real desta máquina) mostrou que
**o Canvas do WebView2 decide empates de borda para o lado negativo**, ao
contrário do Edge headless usado pelo oráculo. Na translação `(2,5; 2,25)`, a
imagem inteira sai deslocada uma coluna: o Canvas pinta a coluna 2 (centro na
borda inicial) e não pinta a 4 (centro na borda final). Alfa diverge em até 93.

Consequências medidas:

- **Usuários protegidos:** a sonda reprova neste WebView2, então toda camada
  reamostrada cai no Canvas legado. Nenhuma saída errada chega ao usuário.
- **Fatia inativa aqui:** neste ambiente a reamostragem Rust nunca é usada; os
  288 casos verdes do oráculo headless **não se transferem** ao app instalado.
- **Diagnóstico corrigido:** o diagnóstico Wails exigia paridade de reamostragem
  incondicionalmente e reprovava o smoke inteiro, embora o comportamento fosse
  seguro. Agora só a exige onde a sonda aprovou; onde reprovou, o laço raster
  anterior já verifica o fallback `source-transform-platform`. O smoke imprime
  em qual dos dois estados a plataforma está, para que um caminho inteiro em
  fallback não volte a ficar invisível.
- **Sonda reforçada:** antes ela testava só o empate da borda inicial em `y` e
  acertou aqui porque o WebView2 erra nos dois eixos. Agora cobre os quatro.

Caminho para ativar a fatia neste WebView2 (superado pela seção 5.2): detectar a
direção do empate na sonda e transmiti-la ao sampler. A medição mostrou que a
direção nem é constante dentro do mesmo WebView2, então esse caminho não serve.

### 5.2 Mecanismo medido e ativação no WebView2 (2026-10-26)

`scripts/recordCanvasReferences.mjs` (`npm run record:canvas-references --
--target webview2 --suite resampling`) grava a saída real do Canvas do WebView2 do executável de produção nos mesmos
288 casos, em contexto CPU (`willReadFrequently`, 16×12) e padrão (512×512, que
pode ser acelerado por GPU como o canvas de exportação): 576 referências em
`frontend/tests/fixtures/webview2Resampling.v1.json`, gravadas no Chromium 155.
O Edge headless do oráculo é o 156.

A análise contra o WASM mostrou que o Chromium varia em **exatamente dois
pontos**, e que eles mudam com versão, contexto e conteúdo:

| | contexto CPU | contexto padrão, fonte opaca | contexto padrão, fonte com alfa | Edge headless 156 |
| --- | --- | --- | --- | --- |
| empate de borda | negativo | negativo | positivo | positivo |
| precisão dos pesos | exata | varia | varia | quantizada no Normal |

Excluídos apenas os pixels cujo centro cai exatamente numa borda, **os 576 casos
casam estritamente (2/3) com uma das duas variantes que o Rust já tinha**:
máximo 2 de alfa e 2,39 de RGB premultiplicado. Nenhuma tolerância foi ampliada.

Decisão: não há uma regra única a emular, então o Rust **define** a convenção — a
atual, empate positivo e precisão por modo — e ela fica dentro da variação que o
próprio Chromium produz. A paridade com Canvas passa a significar: estrita fora
dos pixels de empate, contra a precisão de peso que a plataforma escolheu.
`rustRasterParity.ts` implementa só essas duas exceções e é usado pelo
diagnóstico de 288 casos (headless e Wails) e pelo laço documental do Wails.
Nesse laço o modo Normal é delegado aos 288 casos, porque o pipeline completo só
expõe a variante fixa do Rust; os outros cinco modos seguem estritos.

Consequência: a sonda aprova este WebView2 e **a fatia 11 fica ativa no app
instalado**, confirmado pelo smoke Wails ("Rust (sonda aprovou)") com o
diagnóstico completo verde. Em pixels de empate a saída Rust pode diferir em uma
coluna ou linha da exportação legada — que, por sua vez, já difere entre CPU e
GPU no mesmo WebView2. O teste `scripts/tests/rustRasterParity.test.ts` fixa as
576 gravações como regressão e prova que, sem a máscara de empate, o caso
medido diverge. Regravar a fixture quando o WebView2 distribuído mudar de versão.

O smoke Wails também se mostrou sensível a carga da máquina: em uma janela de
lentidão (execuções de 72 s e 129 s contra ~15 s normais), o limite de 5 s por
chamada DevTools e a janela de 30 s do status reprovaram execuções sem defeito.
Sete execuções seguidas fora dessa janela passaram. É fragilidade do harness,
anterior a esta mudança.

## 6. Minificação — primeira medição (2026-10-26; decisão superada pela seção 6.1)

Antes de relaxar `source-minification`, a hipótese de que o kernel raster casaria
também na redução foi testada no Edge headless contra Canvas CPU (24×20,
`willReadFrequently`) e Canvas padrão 512×512, com fonte 16×16 de alfa parcial,
13 escalas entre 0,501 e 0,99, seis translações fracionárias, anisotropia,
quarto de volta, espelhamento e os seis modos: **3.744 casos**. Resultado:

- **Escala ≤ 0,51:** divergência em praticamente todos os pixels (alfa até 109).
  É a assinatura de **mipmap**: o Chrome troca de nível ao reduzir à metade. A
  única coincidência é escala exatamente 0,5 com translação inteira, em que o
  bilinear no ponto médio de 4 texels equivale à média 2×2 do nível 1.
- **Modo Normal sem rotação** em 0,55–0,99: 390 falhas com o modo preciso e
  falhas intermitentes com o quantizado (casa em 0,75/0,9, falha em 0,6). O
  pipeline que o Chrome usa aqui não foi identificado.
- **Quarto de volta** com escala ≥ 0,55, modo preciso: 792 casos, **0 falhas**.
- Demais modos: falhas residuais de linha inteira (alfa até 162) quando uma
  borda cai exatamente em `,5` — empate decidido pelo arredondamento float32
  interno do Skia — e um caso sem explicação em 0,99 com translação inteira.

Os dois contextos deram resultados idênticos; o headless provavelmente não usa
GPU, então isso **não** prova o comportamento do canvas acelerado no WebView2.

Decisão original, superada pela seção 6.1: manter `source-minification`. O subconjunto provadamente seguro seria
estreito, dependente de empates de float32 e conteria um caso inexplicado.
Suporte futuro exige, nesta ordem: emular a pirâmide de mipmap do Skia e seu
critério de nível (limiar entre 0,51 e 0,55 neste ambiente), identificar o
pipeline do modo Normal na redução, reproduzir o arredondamento de borda e
explicar o caso de 0,99 — **ou** decidir conscientemente trocar o oráculo byte a
byte por paridade visual com tolerância e heatmap para minificação, decisão de
produto que não cabe tomar implicitamente. O código experimental foi revertido.

### 6.1 Redução implementada: bilinear até 0,5, área abaixo (2026-10-26)

Com a semântica de paridade da seção 5.2, uma nova gravação
(`recordCanvasReferences.mjs --suite minification`, 1.152 casos por ambiente, 16
escalas entre 0,3 e 0,99) mostrou que a redução **também** não tem alvo único:

| escala | WebView2 155, CPU | WebView2 155, GPU | Edge headless 156 |
| --- | --- | --- | --- |
| 0,54 – 0,99 | bilinear, 0 falhas | resíduos ≤ 6/10 | resíduos ≤ 6/10 |
| 0,505 – 0,53 | bilinear, 0 falhas | mipmap | mipmap |
| 0,4 – 0,5 | bilinear, 0 falhas | resíduos ≤ 6/10 | mipmap |

O WebView2 distribuído usa bilinear puro em toda a faixa; o Chromium 156 passou a
usar mipmap abaixo de ~0,53. Com isso a escolha fica no critério de qualidade:
abaixo de 0,5 o bilinear amostra com passo maior que dois texels e há texels que
nunca contribuem (aliasing); a partir de 0,5 todos contribuem. O Rust define:

- **≥ 0,5 nos dois eixos:** os modos bilineares, que casam estritamente com o
  WebView2 distribuído (regressão em `webview2Minification.v1.json`, 36 casos);
- **< 0,5 em algum eixo:** `RasterArea`, a média exata da fonte sobre o quadrado do
  pixel, com texels de fora contando como transparentes — bordas recebem cobertura
  de área exata em vez do recorte duro.

`RasterArea` não tem paridade com nenhum Canvas e não passa pela sonda. Ele é
validado por uma **referência independente** em TypeScript, escrita a partir da
definição, que casa **byte a byte** com o Rust em 192 casos (escalas de 0,1 a 1,
quarto de volta, espelho, borda fora do documento, origem de grade não nula,
opacidade parcial e tiles). Contra o Canvas, abaixo de 0,5, a diferença média de
RGB premultiplicado fica entre 0,9 e 2,3 (de 255) e o máximo chega a 75–107 nas
bordas da camada; sem 1,5 px junto às bordas, a média cai para 0,5–0,95, mas o
máximo ainda chega a ~60 em conteúdo de alta frequência, que é exatamente onde o
Canvas pula texels e a área não. Esses números são informativos, não critério.

O custo da área por pixel é a pegada em texels; o orçamento de trabalho conta
`(⌈pegada u⌉ + 1)(⌈pegada v⌉ + 1)` por pixel, igual no Rust e na pré-checagem TS.
No total, um render inteiro lê cada texel da fonte poucas vezes, qualquer que seja
a escala. Desde 2026-10-27 o orçamento de fontes do consumidor é de 47 MiB e uma
foto de 4000×3000 entra no Rust (ver o contrato do consumidor documental, seção 4).

### 6.2 Rotação arbitrária (2026-10-27)

Medição (`npm run smoke:document-rotation`, Edge 156): o modo de cobertura do
Rust — bilinear no centro do pixel com clamp, multiplicado pela cobertura
geométrica exata do quadrilátero da fonte — contra `drawImage` com
`setTransform` rotacionado, numa fonte 6×4 (opaca e com alfa variado), oito
matrizes (15° a 200°, escalas de 0,6 a 2, translações fracionárias) e os seis
modos: 96 casos. Cada pixel é classificado por 8×8 subamostras em interior,
borda (o contorno cruza o pixel) ou fora.

| Classe | Máximo medido (alfa / RGB premultiplicado) |
| --- | --- |
| interior | 2 / 2,53 |
| borda | 9 / 11,86 |
| fora (anel junto à borda) | 2 / 3,21 |

O interior casa com o Canvas dentro da tolerância de sempre; a borda difere
porque o Skia aproxima a cobertura analítica e o Rust a calcula exata. Como o
legado será removido, a convenção é a do Rust: rotação arbitrária sem
cisalhamento, com as duas escalas ≥ 0,5, usa o modo de cobertura, sem sonda de
plataforma (`rustRotationCoverageSupported`). O portão exige 2/3 no interior e
12/16 na borda e no anel. De ponta a ponta pelo app (imagem 37°, imagem −112°
com sombra em Multiplicação, texto 23° com contorno), o pior foi 0/2 no interior
e 0/8 na borda.

Rotação com redução abaixo de 0,5: o bilinear pularia texels. A imagem passa a
ser decodificada já reduzida (`resizeWidth`/`resizeHeight` de
`createImageBitmap`, qualidade alta, como as fontes de preview do pipeline de
estilos), no menor tamanho que devolve as duas escalas a ≥ 0,5, e então segue
pelo modo de cobertura. Numa fonte 120×80 a 0,25 e 20°, o interior difere do
`drawImage` legado em 0/4 — filtros de redução diferentes, como na seção 6.1 —
com teto informativo de 2/8; a borda fica em 0/8. Só uma camada com menos de
meio pixel de lado continua sem modo.
`Mesclar se` de baixo com fonte rotacionada também segue em fallback
(`source-transform-blend-if`), como com as demais reamostragens.

## 7. Provas

- Rust nativo (`document_sampling_tests.rs`): translação não aplica alfa de borda
  geométrico duas vezes; bordas em meio pixel arredondam para coordenadas
  positivas; pesos bilineares preservam isolamento do RGB oculto sob alfa zero;
  quantização em 4 bits é dos pesos, não redução de profundidade de cor; quarto
  de volta fracionário preserva orientação; tiles globais iguais ao render
  inteiro nos seis modos sem buffers extras; modo raster sem suporte é recusado
  mesmo em camada oculta, e DCP4 com modo malformado preserva a saída.
- TS/WASM (`rustDocumentSampling.test.ts`): DCP4 não altera os layouts DCP1–DCP3;
  preflight recusa flags, reserva, redução, shear e grade sem suporte; WASM DCP3
  continua utilizável e recusa DCP4 cru antes de alterar o residente; Worker
  transfere DCP4/SDP1 respeitando geração; tiles irregulares mantêm os pixels.
- Oráculo browser `smoke:document-resampling`: 3 fontes 2×2 (opaca, alfa parcial,
  alfa variado) × 16 matrizes (translações fracionárias e negativas, ampliações
  uniformes e anisotrópicas, quartos de volta, espelhamentos) × 6 modos =
  **288 casos**, todos dentro de 2/3; máximo observado 2 de alfa e 2,39 de RGB
  premultiplicado.
- Planner (`rustDocumentEditorial.test.ts`): escolha de modo por mesclagem e
  rotação, escolha entre bilinear e área por escala, recusa de redução forte
  combinada com ampliação e de rotação arbitrária,
  rotação arbitrária e combinação com `Mesclar se` abaixo.

## 8. Gates restantes

Fotos acima do orçamento de 47 MiB de fontes (24 MP ou mais), reamostragem com `Mesclar se` abaixo, escala de saída diferente de
1:1, WebView2 com GPU em outras máquinas e QA com documentos do usuário. Texto
entrou no consumidor na fatia 12 sem reamostragem (ver
[texto documental](contrato-texto-documental-rust-v1.md)).

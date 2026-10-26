# Reamostragem raster compatível com Canvas — C3, fatia 11

Estado: **ampliação raster, translação fracionária e quartos de volta passam pelo
Rust sob o flag documental experimental**. Minificação e rotação arbitrária
continuam em fallback integral. Não habilita Rust por padrão nem altera o
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

`DocumentSampling` acrescenta dois modos ao sampler existente; o padrão continua
sendo cobertura, de modo que DCP1–DCP3 e os consumidores anteriores não mudam.

| Modo | Kernel | Quando o adapter escolhe |
| --- | --- | --- |
| `CoverageBilinear` | cobertura geométrica + bilinear (DCP2) | fonte 1:1 alinhada à grade e formas |
| `RasterBilinear` | bilinear no centro, clamp na borda, fração quantizada em 1/16, recorte retangular | modo Normal sem rotação |
| `RasterBilinearPrecise` | igual, sem quantização da fração | demais modos ou com quarto de volta/espelhamento |

O recorte retangular inclui o pixel `i` quando `i ≥ floor(borda + 0,5)` na
borda inicial e `i < floor(borda + 0,5)` na final. A quantização em 1/16 e a
escolha por modo de mesclagem reproduzem o pipeline que o Skia usa em cada caso;
ambas foram fixadas empiricamente pelo oráculo, não por documentação do Chrome.

O sampler recusa os modos raster quando a grade de saída não é 1:1 com origem
inteira (`UnsupportedScale`) ou quando a matriz não é alinhada a eixos com
`|escala| ≥ 1` em cada eixo, admitindo quartos de volta (`InvalidTransform`).
Componentes com módulo até `1e-12` são tratados como zero.

## 3. ABI — DCP4

O pacote DCP4 (versão 4, cabeçalho de 80 bytes, registro de camada de 96 bytes)
carrega o modo no byte 92 do registro: `0` cobertura, `1` `RasterBilinear`,
`2` `RasterBilinearPrecise`. Qualquer outro valor rejeita o pacote inteiro.
O TypeScript só emite DCP4 quando ao menos uma camada pede reamostragem; os
demais pedidos continuam com a versão anterior, preservando compatibilidade com
WASM que não exporte o DCP4.

## 4. Gates do adapter editorial

Em ordem, para cada camada raster:

| Condição | Resultado |
| --- | --- |
| largura ou altura de destino menor que a fonte | `source-minification` |
| matriz alinhada à grade (fatia 10) | composição 1:1, sem modo raster |
| ampliação alinhada a eixos ou quarto de volta, grade 1:1 inteira | modo raster |
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

## 6. Minificação — medida e recusada (2026-10-26)

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

Decisão: manter `source-minification`. O subconjunto provadamente seguro seria
estreito, dependente de empates de float32 e conteria um caso inexplicado.
Suporte futuro exige, nesta ordem: emular a pirâmide de mipmap do Skia e seu
critério de nível (limiar entre 0,51 e 0,55 neste ambiente), identificar o
pipeline do modo Normal na redução, reproduzir o arredondamento de borda e
explicar o caso de 0,99 — **ou** decidir conscientemente trocar o oráculo byte a
byte por paridade visual com tolerância e heatmap para minificação, decisão de
produto que não cabe tomar implicitamente. O código experimental foi revertido.

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
  rotação, recusa de minificação nas políticas `document` e `appearance`,
  rotação arbitrária e combinação com `Mesclar se` abaixo.

## 8. Gates restantes

Minificação (seção 6), rotação arbitrária, reamostragem com `Mesclar se` abaixo,
escala de saída diferente de 1:1, sonda em WebView2 com GPU real e QA com
documentos do usuário. Texto continua fora do consumidor experimental.

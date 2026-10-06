# Contrato lógico do compositor de documento — rascunho V1

Estado: **contrato de comportamento para C0/C1; ainda não é a ABI binária
Rust/WASM**. Relacionado ao [roadmap](roadmap-compositor-rust-internacionalizacao.md).
O objetivo é que preview, exportação, miniatura, conta-gotas, rasterização e
mesclagem façam pedidos diferentes ao **mesmo** compositor, sem duplicar regras
de aparência. Qualquer alteração deste contrato requer versão e teste de paridade.

O [lote local experimental](contrato-lote-local-v1.md) tem ABI própria para
fill/overlays/filtro terminal. Ainda não implementa a pilha ou transformações
documentais especificadas aqui.

A [máscara alfa regional](contrato-mascara-alfa-v1.md) tem ABI experimental
separada para spread/blur com contexto. Ainda não implementa sombras/brilhos
completos nem a expansão documental de camadas.

A [sombra externa regional](contrato-sombra-externa-v1.md) já calcula esse
efeito sobre máscara/target preparados, em ABI separada. Não resolve a pilha
do documento nem integra o lote local/preview normal.

A [sombra interna regional](contrato-sombra-interna-v1.md) compartilha os
filtros, mas preserva direção/contração/recorte próprios e o estágio anterior
aos overlays. Seu pacote separado também não constitui um executor documental.

Os [brilhos regionais](contrato-brilhos-v1.md) externos/internos compartilham
filtros e interpolação, mas têm recortes/estágios próprios. O degradê segue
intensidade, não coordenadas do documento; a gestão da pilha continua pendente.

O [acetinado regional](contrato-acetinado-v1.md) calcula a diferença assinada
de duas máscaras espelhadas, antes dos overlays. Inclui terceira máscara no
orçamento enquanto filtra a segunda; não integra a pilha nem o preview normal.

O [traçado regional](contrato-tracado-v1.md) compartilha pinturas espaciais
com overlays, mas gera sua própria máscara circular/erosão e compõe depois
deles. Suas três posições também não constituem um executor documental.

O [bisel/relevo regional](contrato-bisel-v1.md) calcula rampa/textura e luz
com diferenças centrais, preservando um pixel extra de halo. Completa os dez
tipos de efeito em passes isolados; conteúdo/executor documental, integração
ao preview e cache/orçamento global continuam pendentes.

## 1. Vocabulário e unidades

- Documento: espaço contínuo em pixels documentais, origem `(0, 0)` no canto
  superior esquerdo, X para a direita e Y para baixo. Um documento `W × H`
  ocupa `[0, W) × [0, H)`. Bounds e interseções são semiabertos; apenas tocar
  a borda não constitui interseção, como já exige `renderBounds.ts`.
- Transformação de camada: posição/tamanho/rotação no documento. Espessura de
  traçado, blur, distância de sombra e guias são especificados em **pixels do
  documento**, não em pixels de tela. Não multiplicar um estilo duas vezes ao
  aplicar zoom ou transformar texto/forma.
- Grade de saída: pixels inteiros com coordenadas **globais** para a renderização
  corrente. Cada pixel tem uma amostra definida pelo mapeamento de saída para
  documento. Tiles adjacentes devem usar o mesmo mapeamento global, inclusive
  em escala fracionária e DPR não inteiro; nunca arredondar a origem de cada
  tile de maneira independente.
- `documentToOutput`: transformação de viewport/escala, independente do raster
  fonte. Exportação plena é o caso `(scaleX=1, scaleY=1, origin=0)`; preview
  combina zoom e DPR. `sourceDensity` descreve quantos pixels reais existem na
  imagem/texto fonte e não deve ser inferido do zoom.
- Região pedida: retângulo de saída semiaberto em pixels inteiros globais, junto
  do mapeamento para o documento. A implementação deriva a região documental
  necessária, incluindo halo e bounds de camadas. A resposta identifica tanto
  a região pedida quanto a região efetivamente coberta; regiões fora do
  documento retornam transparência/fundo conforme a política do consumidor.

## 2. Formato de pixel e invariantes de aparência

- Fronteira CPU V1: RGBA8 intercalado, linha a linha (row-major), `stride`
  explícito, alfa **reto** (não premultiplicado) e intervalos 0–255. Os
  fixtures atuais vêm de `Uint8ClampedArray` e registram bytes após o
  compositor TS. Qualquer conversão na fronteira Canvas/GPU deve ser medida
  e testada; não interpretar bytes premultiplicados como retos.
- Cor: usar a semântica atual do Canvas/arquivos como referência observável,
  sem afirmar paridade P3/ICC ainda. Antes da ABI definitiva, medir como
  `ImageData`, decode, PNG e WebView tratam perfis e transparência; registrar
  espaço de cor do buffer. Não reescrever `document.colorSpace` ao renderizar.
- Ordem: fundo → camadas inferiores para superiores → fonte transformada →
  efeitos externos → conteúdo/fill opacity → efeitos internos → overlays →
  efeitos superiores → Blend If/opacidade de camada → modo de mesclagem sobre
  backdrop. A ordem exata entre Blend If e opacidade/mesclagem deve ser
  congelada a partir de fixtures de documento, não apenas deste resumo.
- Efeitos e cores são ancorados no espaço apropriado (camada ou documento),
  nunca na origem local do tile. Gradientes, padrões, ruído determinístico e
  luz global devem coincidir quando o mesmo documento é renderizado inteiro
  ou dividido. Efeitos que dependem das dimensões globais da camada recebem
  seus bounds completos, mesmo que só um tile seja produzido.
- Alfa 0 não autoriza ler RGB oculto como cor visível; RGB oculto é preservado
  somente onde o formato/algoritmo atual o requer. Definir conversões de
  `Math.round` e `Uint8ClampedArray` individualmente no porte, sem pressupor
  que `round()` de Rust é equivalente.

## 3. Solicitação lógica (antes da escolha de layout binário)

```text
ComposeRequestV1 {
  protocolVersion,
  documentId, documentRevision, documentSize, background,
  outputRect, documentToOutput, sourceDensityPolicy,
  layersBottomToTop: [
    { layerId, revision, visible, opacity, blendMode, transform,
      source: RasterHandle | DecodedRGBA | PreparedTextOrShape,
      sourceBounds, styles, patternAssets, smartRevision? }
  ],
  quality: interactive | final,
  generation, cacheHandle?, budget
}

ComposeResultV1 {
  protocolVersion, outputRect, width, height, stride,
  pixelFormat, colorSpace, alphaMode, rgba, generation,
  diagnostics? | error: { code, params }
}
```

É uma representação **lógica**, não um compromisso com JSON em cada frame.
Passar listas/descritores de controle em lote e buffers grandes por transferência
ou memória WASM com vida útil explícita; benchmark deve escolher a forma de
serialização. Nenhuma chamada por pixel. IDs são strings estáveis do documento;
Rust não adquire ownership do modelo nem do histórico. `RasterHandle` é local
ao Worker, opcional, não persistido e inválido após restart.

## 4. Região de influência e invalidação

Para cada camada, calcular a área de **saída que pode mudar** e a área de
**entrada necessária** para reproduzi-la. Elas não são necessariamente iguais:

| Passo | Dependência fora do tile |
| --- | --- |
| Sombra/brilho/blur/traçado/bisel | Halo derivado do suporte do efeito, incluindo offset direcional e escala; se não houver limite conservador seguro, processar área maior/camada inteira. |
| Gradiente/padrão/ruído | Coordenadas e dimensões de referência da camada/documento, seed estável, assets decodificados; recortar só depois da amostragem correta. |
| `Blend If` da camada abaixo | Pixels já compostos do backdrop na mesma região, no estágio correto. Uma edição inferior invalida tiles superiores dependentes. |
| Transformação/rotação | Bounds antigos e novos, filtro de reamostragem e pixel vizinho necessário; não confiar só na caixa original sem rotação. |
| Texto/forma | Raster de origem na densidade pedida, métricas/fonte e efeitos em pixels documentais; qualidade interativa não substitui fonte plena de exportação. |

Ao editar: invalidar união dos bounds antigos/novos mais halos; visibilidade,
opacidade, modo de mesclagem, fundo, padrão ou ordem podem afetar todo o
backdrop relevante. Undo/redo, troca de documento e conclusão de rasterização
de texto incrementam revisões. Resultado de geração antiga nunca é publicado.
Se a análise de dependência for incerta, invalidar mais pixels; nunca menos.

O cache deve distinguir pelo menos fonte decodificada, aparência da camada e
composição da pilha. A chave precisa da versão do algoritmo/contrato, revisões,
efeitos normalizados, origem/escala da grade global, região, qualidade e
dependências inferiores quando houver. O `layerStyleCacheKey` atual cobre só
parte disso; não copiá-lo como chave de documento.

## 5. Política dos consumidores

| Consumidor | Pedido | Proibição |
| --- | --- | --- |
| Preview | tiles visíveis e sujos, qualidade interativa, prioridade alta; quadro anterior pode aparecer durante refinamento | não possuir um compositor CSS alternativo após migração |
| Exportação/mesclagem | documento inteiro em tiles de resolução plena, qualidade final, cancelável entre tiles | não usar miniatura/cache degradado do preview |
| Miniatura | documento inteiro em resolução de saída menor, mesma ordem/composição | não mudar semântica de efeito para parecer “mais rápido” |
| Conta-gotas | região mínima que contenha a amostra e suas dependências | não amostrar pixels de um preview obsoleto |
| Rasterização de camada | aparência isolada com política explícita para opacidade/blend externo | não aplicar mesclagem externa duas vezes |

Limites de bytes por request, cache e trabalho simultâneo serão fechados após
medição em Windows/Linux. O Worker controla fila, coalescência, cancelamento
cooperativo entre tiles e descarte de gerações. Falha de WASM/Worker libera
handles/buffers e devolve erro recuperável; um render em andamento não pode
corromper o documento nem bloquear salvar.

## 6. Oráculo e critérios antes do primeiro porte

- `frontend/tests/fixtures/layerStyleGoldens.v1.json` contém entradas e bytes
  RGBA fixados. `frontend/tests/layerStyleGoldens.test.ts` compara função pura
  TS byte a byte; o mesmo JSON será consumido pelos testes Rust. A saída pode
  ser inspecionada com `node --experimental-strip-types
  scripts/print-layer-style-goldens.mjs` a partir de `frontend/`, mas **não**
  atualizar esperados automaticamente em CI: diferenças exigem revisão.
- O corpus agora tem 17 casos: ao menos um de cada um dos dez tipos atuais de
  efeito, além dos filtros `Blend If` da própria camada e subjacente e uma
  sobreposição de cor isolada com preenchimento parcial para validar o porte
  Rust e quatro gradientes isolados (refletido, diamante, radial e angular).
  Inclui padrão decodificado, halo,
  arredondamento e ordem de passes. Um teste de tipos exige atualizar a matriz
  quando um novo efeito for acrescentado. Ainda faltam combinações mais amplas,
  zoom/escala e casos de erro antes de apagar o compositor antigo.
- `frontend/tests/fixtures/documentOracle.v1.json` congela três documentos
  pequenos renderizados por Canvas no Edge/Windows: formas e mesclagem,
  `Blend If` e estilos combinados. `npm run smoke:document-oracle` compara
  canais RGBA com tolerância de 2 e verifica rejeição explícita de estilo
  incompatível com forma. É uma referência ambiental de exportação, não prova
  de paridade do preview nem de outros navegadores.
- Para comparar um candidato independente, produzir uma linha JSON por caso no
  formato `{ "id": "...", "expected": { "width": ..., "height": ...,
  "offsetX": ..., "offsetY": ..., "rgba": [...] } }` (para `Blend If`, apenas
  `rgba`) e executar `node scripts/compare-layer-style-goldens.mjs` em
  `frontend/`, passando um arquivo como argumento ou linhas por stdin. O script
  não importa o compositor TS; informa IDs ausentes/duplicados e a primeira
  divergência por caso. Verificação da referência atual:
  `node --experimental-strip-types scripts/print-layer-style-goldens.mjs |
  node scripts/compare-layer-style-goldens.mjs`.
- Invariante futuro: render inteiro e render em tiles da mesma grade são
  idênticos no núcleo CPU, inclusive bordas. Se a fonte atravessa Canvas 2D,
  comparação visual com tolerância explícita; nunca tratar PNG comprimido como
  hash de pixels. Exportação e preview precisam de fixtures de documento
  próprios, não só de efeito isolado.

## 7. Questões abertas que bloqueiam a ABI binária, não o oráculo

1. Conversão exata de cor/alpha e pixels invisíveis na fronteira WebView ↔ WASM.
2. Amostragem de transformação fracionária/rotação e filtro de escala compatível
   com a aparência atual, sem emendas entre tiles.
3. Fonte de raster de texto/forma em cada densidade e política de fallback de
   fonte. A edição de texto segue no navegador.
4. Tamanho inicial de tile, halo máximo, limites de memória e cache por
   plataforma, determinados por benchmark, não por constante arbitrária.
5. Como testar/desligar o novo caminho por build/flag até a validação manual.

Fechar essas decisões com testes antes de integrar a superfície única. Não
promover este rascunho a ABI V1 só porque os tipos acima parecem completos.

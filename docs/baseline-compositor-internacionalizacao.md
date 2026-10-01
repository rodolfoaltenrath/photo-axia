# Linha de base: compositor e internacionalização

Coleta: 2026-09-29. Referência para o [roadmap de Rust e idiomas](roadmap-compositor-rust-internacionalizacao.md).
Este inventário é do worktree atual, que já contém alterações de texto e UI não
relacionadas ao marco zero. Não é uma promessa de desempenho ou de paridade visual.

## Ferramentas e verificação

- `go.mod`: Go 1.26.5; Wails v3.0.0-beta.12. CLI local consultada:
  v3.0.0-beta.12.
- Scripts de setup: Node 24.14.1; distribuição local consultada: npm 11.11.0.
- PATH desta máquina durante a medição: Go 1.27.0 e Node 24.19.0. `rustc` e
  `cargo` não estavam instalados. Logo os testes atuais **não** validam ainda a
  build com toolchains fixadas.
- Pacotes frontend diretos foram fixados nas versões já resolvidas pelo
  `package-lock.json`; `npm ci --dry-run --ignore-scripts --no-audit --no-fund`
  confirmou consistência do manifesto e do lockfile.
- `node scripts/check-toolchains.mjs` confirma as declarações. O modo
  `--installed` é propositalmente separado: só passa após instalar e ativar as
  versões fixadas no PATH. O build agora usa `npm ci` em vez de `npm install`.

## Testes e build nesta coleta

| Comando | Resultado |
| --- | --- |
| `go test ./...` | passou |
| `npm.cmd test` em `frontend/` | 440 passaram, 0 falharam; incluiu typecheck dos testes |
| `npm.cmd run build` em `frontend/` | passou; Vite avisou de chunk acima de 500 kB |
| `node scripts/check-toolchains.mjs` | passou para versões declaradas |

Após adicionar a negociação pura de idioma, `npm.cmd test` passou novamente:
**445/445 testes**, incluindo os cinco casos novos de preferência, fallback,
chinês tradicional e pacote externo. A mesma suíte passou com a distribuição
local fixada de Node 24.14.1/npm 11.11.0. O build de produção também passou após
a fixação das dependências, sem alteração do bundle da interface.

Com o primeiro corpus RGBA versionado, a suíte chegou a **451/451 testes**;
os seis casos de golden passaram também no Node 24.14.1 fixado. Esses casos
congelam o núcleo puro, não substituem fixtures visuais de documento/Canvas.

Ampliando o corpus para os dez tipos atuais de efeito, a suíte passou com
**458/458 testes**. O comparador independente validou os 11 casos RGBA. Esta
medição continua no Node do PATH; a versão fixada deve ser repetida no gate C0.

## Medição CPU reproduzível (primeira amostra)

`frontend/benchmarks/layerStyleBaseline.mjs` mede diretamente as funções puras
de estilos, com raster sintético de 512 × 512, duas passagens de aquecimento e
cinco amostras por caso. Com Node **24.14.1 fixado**, kernel Windows 10.0.26200 x64,
Intel i7-3770 (8 threads), foram observadas estas medianas **nesta execução**:

| Caso | Mediana | p95 amostral |
| --- | ---: | ---: |
| Fill opacity | 10,94 ms | 14,70 ms |
| Sombra projetada | 28,84 ms | 29,98 ms |
| Sobreposição de gradiente | 99,94 ms | 131,88 ms |
| Bisel | 43,65 ms | 60,38 ms |
| Sobreposição de padrão | 39,89 ms | 41,12 ms |
| `Blend If` subjacente | 22,58 ms | 23,14 ms |

Reproduzir em `frontend/` com
`../.toolchains/node-v24.14.1-win-x64/node.exe --experimental-strip-types benchmarks/layerStyleBaseline.mjs 512 5`
(ou o executável fixado equivalente na plataforma). O script emite ambiente,
tempos, tamanho de saída, RSS e checksum por caso em JSONL. O p95 com apenas
cinco amostras é o máximo observado, **não** uma estimativa confiável da cauda.
Esses números não incluem decode, Canvas, Worker, transferência, handoff,
renderização do documento nem GC controlado; não são uma meta de desempenho
para Rust nem uma comparação entre engines.

`frontend/benchmarks/documentOracle.html` prepara três documentos pequenos
(formas/fundo/mesclagem, pixels/`Blend If` e estilos combinados sobre uma
camada inferior) através de `renderDocumentPNG`. Confere também que um
traçado não suportado em forma é rejeitado explicitamente.
Em 2026-09-30, o runner por DevTools conseguiu ler o resultado no Edge
**154.0.4258.37** em Windows. Após inspeção das cores/posições, os 8 × 6
pixels por caso foram congelados em
`frontend/tests/fixtures/documentOracle.v1.json`, em linhas RGBA
hex legíveis, com tolerância máxima de **2 por canal** para diferenças do
Canvas entre ambientes. `npm run smoke:document-oracle` inicia Vite e Edge,
compara a saída e encerra os processos; `npm run record:document-oracle` apenas
imprime uma nova proposta de fixture, sem sobrescrever a referência. A
comparação dos três casos passou duas vezes localmente, inclusive com Node
24.14.1 fixado. Ainda falta observar essa mesma fixture na CI e em outro
browser/SO; ela não é um oráculo universal nem cobre texto, combinações mais
amplas ou documentos reais.

### Primeira medição do pipeline de documento

`frontend/benchmarks/documentPipeline.html` exercita o caminho real de
`renderDocumentPNG` no Edge, com duas imagens rasterizadas sintéticas e uma
variante que aplica sombra projetada e sobreposição de cor à camada superior.
O runner é `npm run benchmark:document-pipeline -- 512 512 5` em `frontend/`;
os argumentos são largura, altura e amostras. Há duas passagens de aquecimento
por série. A saída JSON inclui amostras, mediana, p95 **observado**, tamanho
do PNG, checksum e ambiente. A geração das imagens de origem é medida
separadamente e não entra no tempo de renderização.

Em 2026-09-30, com Node 24.14.1, Edge headless **154.0.4258.37**
(`--disable-gpu`), Windows 10.0.26200 x64, Intel i7-3770 (8 threads), DPR 1:

| Documento sintético | `renderDocumentPNG` 512², 5 amostras | `renderDocumentPNG` 1024², 3 amostras |
| --- | ---: | ---: |
| Duas camadas de pixels | 7,9 ms mediana / 9,7 ms máximo | 20,7 ms / 21,8 ms |
| Camada estilizada sobre pixels, cache aquecido | 11,5 ms / 12,2 ms | 36,8 ms / 40,3 ms |

A conversão de `data:` URL de origem para `ImageBitmap` teve medianas de
5,4 ms (512²) e 15,5 ms (1024²). Converter o PNG final em `ImageBitmap`,
desenhá-lo em Canvas e ler os pixels teve medianas de 6,9/10,6 ms (512²,
sem/com estilo) e 22,2/25,7 ms (1024²). Essas são **sondas separadas**, não
parcelas somáveis do tempo de exportação; incluem conversão de `data:` URL.
O p95 com 3–5 amostras é apenas o maior valor observado. Ainda faltam
instrumentação isolada do Worker e do handoff no preview, documentos grandes
e reais, memória/FPS, execução sem `--disable-gpu` e outras plataformas.

Em 2026-10-01, a sonda passou a medir também uma **falha de cache de estilo
forçada** por `editToken` novo em cada renderização. No mesmo Edge/Windows, uma
nova execução obteve estas medianas e máximos observados:

| Caminho | 512², 5 amostras | 1024², 3 amostras |
| --- | ---: | ---: |
| `renderDocumentPNG`, estilo em cache | 12,1 / 15,1 ms | 34,3 / 36,0 ms |
| `renderDocumentPNG`, estilo recomposto | 119,8 / 136,8 ms | 410,1 / 468,5 ms |
| Núcleo puro `composeLayerStyleRaster` | 78,0 / 92,6 ms | 295,4 / 301,9 ms |
| Ida e volta direta ao Worker de estilos | 123,9 / 129,5 ms | 343,7 / 455,9 ms |

O benchmark direto do Worker usa o **mesmo Worker de produção**, com Blob de
origem e estilos idênticos, mas ignora cache e serviço de orquestração; inclui
clone da mensagem, decode, Canvas, composição, encode PNG e resposta. O núcleo
puro recebe RGBA já decodificado. Esses tempos não são parcelas do mesmo
evento e **não devem ser subtraídos** para estimar overhead do Worker. A
exportação com cache aquecido mede uma situação diferente da recomposição;
ambos os caminhos produziram o mesmo checksum. Faltam o handoff do preview
e amostras suficientes para uma cauda p95 robusta.

A sonda foi então ampliada com `benchmarkTimings` opcional no protocolo do
Worker de estilos; solicitações normais não coletam esses relógios. Uma nova
execução no mesmo ambiente retornou as seguintes **medianas internas**:

| Etapa do Worker | 512², 5 amostras | 1024², 3 amostras |
| --- | ---: | ---: |
| Decodificar padrões (nenhum neste cenário) | 0,0 ms | 0,0 ms |
| Decodificar fonte e ler Canvas | 5,5 ms | 18,5 ms |
| Compor raster de estilos | 72,0 ms | 305,6 ms |
| Escrever Canvas de saída e codificar PNG | 11,2 ms | 30,7 ms |
| Total dentro do Worker | 88,6 ms | 354,8 ms |
| Ida e volta vista pelo chamador | 89,4 ms | 356,5 ms |

As medianas de etapas individuais não somam necessariamente à mediana do
total. A etapa de raster domina **neste cenário sintético**; não extrapolar
para texto, padrões, outras combinações ou hardware. Continua pendente o
handoff do preview e a medição em documentos reais.

### Handoff de imagem do preview

`frontend/benchmarks/layerHandoff.html` monta o composable real
`useLayerImageBuffer` em um componente Vue mínimo com os dois `<img>` do
buffer. O runner é `npm run benchmark:layer-handoff -- 512 512 5`. Cada amostra
troca para um PNG diferente, verifica que a imagem anterior continua ativa
até o callback e que a nova classe ativa aparece no DOM após o callback.
Geração dos PNGs e duas trocas de aquecimento ficam fora das amostras.

Em 2026-10-01, no mesmo Edge headless/Windows com `--disable-gpu`, foram
observadas estas medianas:

| Marco desde a troca da fonte | 512², 5 amostras | 1024², 3 amostras |
| --- | ---: | ---: |
| Evento `load` | 1,0 ms | 1,0 ms |
| `image.decode()` concluído | 3,3 ms | 9,3 ms |
| Callback `imageLoaded` após dois `requestAnimationFrame` | 33,4 ms | 32,8 ms |
| Classe ativa publicada no DOM | 33,6 ms | 33,0 ms |
| Próxima oportunidade de frame | 49,8 ms | 49,9 ms |

O intervalo próximo de dois frames é esperado pelo protocolo atual; não é
isoladamente um gargalo. A sonda **não mede pintura efetiva da GPU**, Wails,
estilos calculados pelo Worker, exportação nem latência ponta a ponta do
editor. `data:` URLs já em memória também não representam leitura de arquivo.
Ainda é necessário validar o handoff visual e FPS com documentos reais no app.

Um segundo smoke agora executa **o próprio editor Wails/WebView2** em um
executável de produção temporário: `npm run smoke:preview-wails` em
`frontend/`. Ele usa perfil WebView2 separado, abre um PNG sintético de
512² como documento por drop, seleciona a camada, espera o preset ficar
habilitado, aplica “Sombra suave” e observa os dois buffers da camada no DOM.
O executável/perfil temporários são removidos ao terminar; nenhum projeto é
salvo. Duas execuções consecutivas passaram em 2026-10-01 no WebView2
**154.0.4258.48**, Windows, DPR 1, 8 threads:

| Marco após clicar no preset | Execução 1 | Execução 2 |
| --- | ---: | ---: |
| Nova fonte publicada no buffer inativo | 203,5 ms | 186,0 ms |
| Novo buffer ativo | 234,9 ms | 214,4 ms |
| Intervalo publicação → ativação | 31,4 ms | 28,4 ms |

Não houve momento observado sem buffer ativo. Os tempos de clique até a
publicação incluem a recomposição do estilo e não são medidas isoladas do
handoff. O smoke usa imagem simples e **não prova pintura na GPU, FPS nem
comportamento em documentos reais**. Uma corrida inicial da automação clicou
num preset ainda desabilitado durante a importação; o runner agora aguarda o
estado habilitado antes de iniciar a observação.

O mesmo smoke passou a capturar **a região do canvas pelo DevTools WebView2**
antes e depois de aplicar o estilo, sem salvar screenshots em disco. Três
execuções adicionais em 2026-10-01 retornaram PNGs de 859 × 859 pixels com
**3.176 pixels RGB diferentes** (diferença acima de 2 por canal), além de
confirmarem a continuidade do buffer ativo. Isso confirma uma mudança visível
na superfície do app, não somente no DOM; não é um golden visual do efeito e
continua sem medir duração de pintura ou FPS.
A terceira execução usou o Node fixado **24.14.1**, mas ainda compilou com o
Go **1.27.0** do PATH. Os dois smokes Wails agora extraem a versão exata de
`go.mod` e forçam `GOTOOLCHAIN=go1.26.5` sem substituir o Go global. Uma
quarta execução com Node **24.14.1** e Go **1.26.5** também passou e encontrou
os mesmos 3.176 pixels alterados; o runner registra ambos na saída.

Há agora 64 arquivos em `frontend/tests/`, incluindo fixtures e benchmarks, e 11
Workers em `frontend/src/workers/`. Esses totais não medem cobertura de cenários
de composição. Falta executar os mesmos checks com o Go/Node fixados, em Linux,
e medir tempo/RAM/FPS em hardware identificado.

## Caminhos de renderização a unificar

| Consumidor | Implementação atual | Dependência a cobrir no contrato |
| --- | --- | --- |
| Preview comum | `CanvasSurface.vue` + `CanvasLayer.vue`: camada DOM/imagem e composição CSS | pilha, blend, estilos, transformações, texto e ferramentas interativas |
| Preview de `Blend If` com camada abaixo | `useDocumentBlendIfPreview.ts` chama `renderDocumentInteractiveBlendIfPreview` e exibe imagem composta | backdrop, cancelamento, geração e qualidade interativa |
| Efeitos por camada | `layerStyleCompositor.ts`/Worker → `composeLayerStyleRaster` | raster de fonte, máscara, padrões, halo, cache e erro explícito |
| Exportação PNG/Blob | `renderDocument.ts`: `renderDocumentPNG`, `renderDocumentBlob`, `renderDocumentExportBlob` | resolução plena, cor/alpha, sem usar preview reduzido |
| Conteúdo inteligente e aparência de camada | `renderSmartLayerContentBlob`, `renderLayerAppearance` | aninhamento, revisão, rasterização e ordem de efeitos |
| Conta-gotas e miniatura | `sampleDocumentColor`, `renderDocumentThumbnail` | região de 1 px, escala de miniatura e semântica idêntica |
| Mesclagem | `renderMergedLayers` | bounds, resultado editável e undo/redo |

O núcleo puro já oferece `composeLayerStyleRaster` e
`applyLayerStyleBlendIfUnderlying` em `frontend/src/editor/layerStyleRaster.ts`.
Mesmo ali, a paridade byte a byte de um porte exigirá reproduzir `Math.round`,
funções trigonométricas e escrita em `Uint8ClampedArray`; não assumir que Rust
produzirá bytes iguais por definição.

## Inventário inicial de idioma

- Não existe biblioteca/catálogo de i18n em `frontend/package.json`.
- Ocorrências explícitas de `pt-BR`/`toLocaleString`/`DateTimeFormat` ou
  `localeCompare` estão em `App.vue`, `RecentProjectCard.vue`,
  `exportSettings.ts`, `guides.ts`, `layerStylePresets.ts` e `mediaDocument.ts`.
  Este é apenas o inventário **de formatação**, não de todas as frases da UI.
- A UI principal e a janela de estilos contêm mensagens em português; o Go
  produz erros e rótulos de diálogos em português (`app.go`, `project.go`,
  `export_upload.go`). Será preciso classificar mensagens exibidas e logs.
- `frontend/src/i18n/locale.ts` já define negociação pura e preferência
  persistível. A consulta nativa ao SO existe, mas ainda **não determina** o
  idioma da UI. Catálogos
  oficiais começaram em `frontend/src/i18n/catalogs.ts`, com 20 chaves da tela
  inicial; troca sem reinício e pacotes externos ainda não estão implementados.

A primeira fatia de catálogo elevou a suíte para **461/461 testes** e o build
passou. Com o adaptador nativo de idiomas, chegou a **462/462 testes**;
`go test ./...` com Go 1.26.5 fixado e o build frontend também passaram.
Os componentes iniciais continuam em PT-BR por padrão; não há UI multilíngue
anunciada. O método nativo foi exercitado no Windows; Linux/macOS ainda
precisam de teste nos ambientes correspondentes. Ver
[inventário](inventario-strings-i18n.md).

Com o menu superior extraído, os catálogos oficiais somam 74 chaves e a suíte
passou com **463/463 testes**; o build frontend também passou. Layout com
textos longos em inglês/chinês permanece pendente de QA visual.

Com o diálogo Novo documento extraído, os catálogos somam **128 chaves** e a
suíte passou com **466/466 testes**; `vue-tsc` e o build frontend passaram.
Essas checagens não substituem QA visual em inglês/chinês. O valor persistido
`Sem título` e os presets criados pelo usuário não foram traduzidos; o idioma
alternativo ainda não foi ativado globalmente.

Próximas medições exigidas: corpus de imagens/fontes autorizado, matriz de
documentos 1080p/4K/8K, 10–300 camadas, zoom/pan com DPR variável, estilos,
`Blend If`, PDF, texto e memória/latência p95. Guardar máquina, driver, SO,
WebView e toolchains em cada execução para poder comparar os marcos futuros.

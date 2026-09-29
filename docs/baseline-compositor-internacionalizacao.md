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

Há agora 62 arquivos em `frontend/tests/`, incluindo fixtures e benchmarks, e 11
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
  persistível, ainda **não conectadas** à UI ou à leitura real do SO. Catálogos
  oficiais, troca sem reinício e pacotes externos ainda não estão implementados.

Próximas medições exigidas: corpus de imagens/fontes autorizado, matriz de
documentos 1080p/4K/8K, 10–300 camadas, zoom/pan com DPR variável, estilos,
`Blend If`, PDF, texto e memória/latência p95. Guardar máquina, driver, SO,
WebView e toolchains em cada execução para poder comparar os marcos futuros.

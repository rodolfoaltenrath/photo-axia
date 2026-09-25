# Roadmap — Camada PDF Inteligente

## Metadados

- Criado em: 2026-09-24
- Estado geral: `EM ANDAMENTO`
- Plataformas: Windows e Linux
- Dependência de renderização: `pdfjs-dist`, já usada pelo importador

## Objetivo

Permitir adicionar uma página de PDF sem transformar o PNG inicial em sua única fonte
de verdade. A camada conserva o PDF, a página e as opções de fundo; o raster passa a
ser um cache descartável e pode ser refeito em outra resolução para preview ou
exportação, sem perda acumulada.

PDF vetorial continua vetorial dentro do arquivo preservado, mas a tela e a exportação
do editor rasterizam uma representação no tamanho solicitado. PDF escaneado não ganha
detalhe inexistente no original.

## Decisões iniciais

- A importação raster atual continua disponível e compatível.
- A nova opção será uma Camada PDF Inteligente, construída sobre o tipo `smart` já
  existente; não será criado um novo tipo de camada paralelo.
- O `.axia` incorpora o PDF original para que reabrir o projeto não dependa do caminho
  local nem de uma URL temporária do Wails.
- A página inicial recebe um raster seguro apenas para aparecer imediatamente. Ele é
  cache e não substitui o PDF no arquivo do projeto.
- Não haverá importação semântica de objetos, fontes ou edição de texto/vetor de PDF.
- Renderização em mosaicos é uma fase posterior: o primeiro incremento precisa impedir
  canvases gigantes e manter os limites atuais para cada raster individual.

## Fases

### Fase 0 — Contrato e persistência

Estado: `CONCLUÍDA`

- [x] Adicionar origem PDF versionável ao conteúdo inteligente.
- [x] Persistir e restaurar o asset `application/pdf` no `.axia`.
- [x] Manter compatibilidade integral com projetos nas versões 1–3.
- [x] Cobrir manifesto, deduplicação e restauração por testes.

### Fase 1 — Importação como PDF Inteligente

Estado: `CONCLUÍDA`

- [x] Ao adicionar como camada, informar que a fonte será preservada no diálogo.
- [x] Criar objeto inteligente com o PDF preservado e cache raster inicial.
- [x] Fazer undo/redo, duplicação e descarte de URLs tratarem fonte e cache corretamente.

### Fase 2 — Re-renderização controlada

Estado: `CONCLUÍDA`

- [x] Recriar o cache em DPI escolhido, sem alterar o arquivo original.
- [x] Re-renderizar para exportação na resolução solicitada.
- [x] Cancelar o processamento em andamento e manter o cache anterior em caso de falha.

### Fase 3 — Preview por zoom e mosaicos

Estado: `NÃO INICIADO`

- [ ] Renderizar somente a região visível quando uma página exceder o orçamento de um
  canvas único.
- [ ] Manter cache LRU de mosaicos por página, escala e fundo.
- [ ] Medir PDF vetorial, escaneado, A4, prancha grande e projeto salvo/reaberto.

## Critérios de aceite finais

- [ ] Reabrir um `.axia` preserva o PDF e permite renderizá-lo novamente.
- [ ] Alterar DPI não degrada uma renderização anterior.
- [ ] Exportação usa a fonte PDF quando a camada inteligente estiver presente.
- [ ] Cancelamento e falhas preservam o cache já confirmado.
- [ ] Windows e Linux validados manualmente com PDFs vetoriais e escaneados.

## Registro de evolução

### 2026-09-24 — Início

- O importador atual foi auditado: ele já lê PDF no worker, mas converte a página em PNG
  e libera a fonte em seguida. O limite de 48 MiB protege o pico do canvas, não o
  tamanho comprimido do PDF.
- A taxonomia existente permite usar `smart` como invólucro. A primeira entrega será
  persistir a origem PDF dentro do projeto, mantendo o raster existente como cache.

### 2026-09-24 — Fundação e importação concluídas

- O `.axia` foi elevado à versão 4, preservando o PDF como asset sem recompressão;
  a versão continua abrindo projetos 1–3.
- Ao adicionar uma página como camada, o PDF original, página, fundo e dimensões em
  pontos passam a pertencer ao objeto inteligente. A imagem PNG inicial continua sendo
  apenas o cache que mantém o editor responsivo.
- O PDF selecionado no desktop é copiado para uma URL de objeto antes de o token nativo
  ser liberado. URLs de objeto são retidas por camada e histórico e liberadas quando não
  são mais necessárias.
- Testes cobrem a serialização/restauração no frontend e a validação/extração do PDF no
  backend.

### 2026-09-24 — Re-renderização manual do cache

- O menu **Camada > Re-renderizar PDF…** aparece somente para camadas inteligentes
  que conservam uma origem PDF. Ele oferece 96, 150, 300 ou DPI personalizado, exibe
  dimensões/memória estimadas e mantém os mesmos limites seguros da importação.
- A página é novamente rasterizada a partir do PDF incorporado, nunca do PNG anterior.
  A escala, rotação e posição externas da camada permanecem inalteradas; desfazer/refazer
  também restaura os caches correspondentes.
- Cancelamento, senha incorreta ou falha de renderização não substituem o cache já
  confirmado. O cache interno passa a ter um identificador persistido, com fallback
  compatível para projetos criados antes desse identificador.

### 2026-09-25 — Exportação a partir da fonte PDF

- O diálogo de exportação agora recebe DPI e mostra as dimensões reais do raster final.
  O DPI deixou de ser apenas metadado no PNG: 300 DPI gera mais pixels que 72 DPI,
  sempre dentro de 16.384 px por dimensão e 64 megapixels.
- Cada camada PDF inteligente visível é reconstruída temporariamente a partir do PDF
  incorporado na qualidade necessária para a saída. O cache usado no editor, o projeto
  salvo e o histórico não são modificados.
- Se um canvas único não comportar a qualidade ideal da página, a exportação usa o maior
  DPI seguro disponível para o PDF. Mosaicos continuam sendo a próxima fase para remover
  essa limitação em páginas muito grandes.

### 2026-09-25 — Fase 2 validada na prática

- Re-renderização manual e exportação a partir da fonte PDF foram validadas pelo
  mantenedor. A camada mantém o PDF incorporado; mudar DPI não reaproveita o PNG anterior.
- A Fase 3 permanece propositalmente adiada: mosaicos só passam a ser prioridade se PDFs
  grandes demonstrarem um limite real de memória ou fluidez no uso cotidiano.

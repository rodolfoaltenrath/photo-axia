# Roadmap de Guias Inteligentes e alinhamento magnético

> Documento vivo da evolução do sistema de réguas, guias e alinhamento do Axia.
> Toda mudança de comportamento, implementação, validação ou limitação deve ser
> registrada aqui na mesma alteração de código.

## Metadados

- Criado em: 2026-08-26
- Estado geral: núcleo implementado, aguardando validação manual; indicadores de distância adiados
- Referência de interação: Guias Inteligentes do Adobe Photoshop
- Plataformas obrigatórias: Windows e Linux

## Decisões de produto

- A origem padrão das réguas permanece em `0,0`, no canto superior esquerdo do
  documento. Isso mantém coordenadas raster, web e de exportação previsíveis e evita
  números negativos no uso comum.
- O centro do documento será tratado como um alvo de alinhamento de primeira classe,
  sem mudar a origem da régua.
- As Guias Inteligentes ficam habilitadas por padrão e aparecem automaticamente;
  não será necessário conhecer ou manter uma tecla pressionada para descobri-las.
- `Shift + arraste` restringe a movimentação a incrementos de 45 graus e continua
  permitindo o encaixe inteligente no eixo resultante.
- Durante o arraste de uma guia manual, `Shift` preserva o encaixe nas subdivisões da
  régua e `Ctrl`/`Command` força a posição exata de `50%` do eixo correspondente.
- As linhas temporárias de alinhamento usam rosa/magenta para se distinguir das guias
  manuais permanentes e nunca aparecem na exportação.

## Alvos e prioridades

Cada objeto móvel oferece três âncoras por eixo: início, centro e fim. Elas podem
encaixar, nesta ordem de prioridade, em:

1. Guias manuais visíveis.
2. Centro e bordas do documento.
3. Centro e bordas visuais de outras camadas visíveis.

Vence sempre o alvo que exige o menor deslocamento; a prioridade resolve apenas
empates. Centros encaixam em centros, bordas em bordas e guias manuais aceitam qualquer
âncora. A tolerância híbrida é de 4 pixels de tela, limitada a 12 pixels do documento,
para impedir saltos grandes em zoom baixo. Camadas pertencentes ao grupo que está sendo
movido são excluídas dos alvos. Camadas rotacionadas usam seus limites visuais alinhados
aos eixos nesta fase.

## Comportamento de grupo

- Uma única camada usa suas próprias bordas e centro.
- Várias camadas selecionadas usam a caixa visual externa do grupo.
- O encaixe aplica um único delta ao grupo, preservando posições relativas.
- O histórico continua recebendo uma única ação atômica para todo o movimento.

## Fases

### Fase 0 — Contrato e testes do motor

- [x] Modelar alvos, prioridades e resultado visual do snapping.
- [x] Cobrir documento, guias, camadas, zoom, empates e exclusões.
- [x] Cobrir restrição de movimento em 45 graus.

### Fase 1 — Movimento de camadas

- [x] Integrar o motor ao arraste comum da ferramenta Mover.
- [x] Integrar à movimentação dentro do `Ctrl+T`.
- [x] Usar a caixa externa ao mover várias camadas.
- [x] Exibir linhas rosas somente durante um encaixe inteligente ativo.

### Fase 2 — Réguas e guias manuais

- [x] Fazer guias manuais encaixarem magneticamente no centro do documento.
- [x] Fazer `Ctrl`/`Command` forçar exatamente `50%` durante o arraste da guia.
- [x] Preservar `Shift` para subdivisões da régua e `Alt` para trocar orientação.

### Fase 3 — Preferências e acabamento

- [x] Expor “Guias Inteligentes” separadamente de “Encaixar nas guias”.
- [x] Persistir a preferência em projetos `.axia`, com padrão ligado em projetos antigos.
- [x] Avaliar indicadores de distância entre objetos sem poluir o canvas: adiados até a
  validação prática das linhas, para não sobrecarregar a primeira entrega.
- [ ] Validar manualmente contraste, zoom extremo e documentos com muitas camadas.

## Fora do escopo inicial

- Alterar a origem padrão da régua para o centro.
- Alinhamento baseado no conteúdo opaco interno do raster.
- Alinhamento automático que modifica várias camadas sem arraste.
- Distribuição automática de espaçamento entre três ou mais objetos.

## Registro de implementação

### 2026-08-26 — Planejamento iniciado

- Confirmada a manutenção da origem `0,0` no canto superior esquerdo.
- Separadas as responsabilidades de `Shift`, Guias Inteligentes e guias manuais.
- Mapeado o motor existente: o snapping atual considera apenas guias manuais, já usa
  tolerância em pixels de tela e representa camadas rotacionadas por limites visuais.
- Identificado que o arraste múltiplo deve enviar a caixa do grupo ao snapping; usar
  apenas a camada âncora produziria alinhamento visual incorreto.

### 2026-08-26 — Fases 0 a 3 implementadas

- Criado `frontend/src/editor/smartGuides.ts`, separando o cálculo geométrico da UI.
- O motor gera alvos para guias manuais, documento e outras camadas, aplica a ordem de
  prioridade documentada e resolve os eixos de forma independente com tolerância de
  8 pixels de tela.
- Bordas e centros de camadas rotacionadas usam seus limites visuais; camadas ocultas,
  sem transformação ou pertencentes ao grupo móvel são descartadas.
- A lista de alvos é criada uma vez por gesto e reutilizada em cada `pointermove`.
  Benchmark sintético local com 10 mil camadas: 60 mil alvos construídos em 12,97 ms
  e snapping médio de 1,85 ms por frame em 100 movimentos.
- O arraste comum e a movimentação no `Ctrl+T` passaram a usar a caixa visual do grupo.
  O mesmo delta continua sendo aplicado a todos os membros e confirmado atomicamente
  no histórico.
- `Shift` restringe o deslocamento a passos de 45 graus tanto no arraste comum quanto
  dentro do `Ctrl+T`, sem desligar o snapping.
- O overlay ganhou linhas magenta temporárias para alinhamento com documento e outras
  camadas. Elas são limpas no fim ou cancelamento do gesto e não pertencem ao raster.
- Guias manuais encaixam no centro dentro da tolerância normal. `Ctrl`/`Command` força
  exatamente 50% do eixo; `Shift` continua encaixando nos ticks e `Alt` continua
  alternando a orientação.
- Adicionada a preferência “Guias inteligentes” no menu Réguas, independente de
  “Encaixar nas guias”. O valor é persistido no `.axia`; arquivos antigos usam ligado.
- Adicionados testes puros para prioridades, documento, outras camadas, exclusões,
  zoom, grupo, centro forçado, compatibilidade de projeto e restrição de 45 graus.
- Validação automatizada: 278 testes frontend, `vue-tsc --noEmit`, build Vite,
  `go test ./...`, `go vet ./...` e `git diff --check` aprovados.

### 2026-08-26 — Ajuste após validação manual

- Identificado que 8 pixels de tela podiam representar cerca de 50 pixels do documento
  em zoom baixo, causando um salto desproporcional ao movimento do ponteiro.
- Reduzida a zona magnética para 4 pixels de tela e adicionado limite absoluto de
  12 pixels do documento.
- Restringidas as combinações: centro procura centro e bordas procuram bordas; guias
  manuais continuam aceitando qualquer âncora.
- O menor deslocamento passou a vencer sempre, usando a prioridade apenas em empates.
- Removido o brilho das linhas magenta e reduzida sua espessura para 0,5 pixel CSS.
- Validação automatizada atualizada: 279 testes frontend, verificação TypeScript,
  build de produção do Vite e `git diff --check` aprovados.

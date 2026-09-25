# Roadmap — Ferramenta de Texto Profissional

## Metadados

- Criado em: 2026-09-25
- Estado geral: `EM ANDAMENTO`
- Prioridade: alta
- Plataformas: Windows e Linux
- Dependências: modelo de camadas, compositor de documento, persistência `.axia`, histórico e exportação

## Objetivo

Transformar a ferramenta Texto do Axia de um editor funcional de propriedades em
uma ferramenta tipográfica não destrutiva, direta e previsível. O mesmo texto deve
permanecer editável no canvas, no painel, após salvar/reabrir, no histórico, em
camadas inteligentes e na exportação.

O objetivo não é copiar toda a interface do Photoshop de uma vez. A primeira
entrega deve resolver o uso cotidiano com qualidade: criar e editar no canvas,
controlar tipografia e trabalhar com blocos de parágrafo sem transformar texto em
imagem. Recursos de composição avançada por intervalo ficam para fases posteriores.

## Baseline confirmado

O editor já possui camada `text` persistida e não destrutiva com:

- conteúdo multilinha;
- família, tamanho, peso, cor, alinhamento e entrelinha globais;
- medição em Canvas 2D e renderização no canvas/exportação;
- histórico agrupado para alterações de texto;
- suporte a transformação, estilos de camada, rasterização e projetos `.axia`.

As limitações atuais são deliberadamente registradas:

- a edição acontece somente no textarea do painel lateral;
- há apenas quatro famílias de fonte expostas;
- não há itálico, sublinhado, espaçamento entre letras, caixa alta, antialiasing
  configurável ou alinhamento justificado;
- todo texto é tratado como texto pontual que cresce com o conteúdo;
- não há caixa de texto de largura fixa, quebra automática ou espaçamento entre
  parágrafos;
- não há estilos diferentes dentro de uma mesma camada;
- o preview DOM e a renderização Canvas precisam compartilhar uma métrica mais
  explícita antes de a tipografia ganhar complexidade.

## Decisões de produto e arquitetura

1. Texto continua vetorial/editável no modelo do Axia. Rasterizar é uma ação
   explícita e nunca consequência de editar fonte ou parágrafo.
2. A primeira entrega terá dois modos: **texto pontual**, criado com clique, e
   **texto de parágrafo**, criado ao arrastar uma caixa. Texto pontual cresce com
   o conteúdo; texto de parágrafo preserva largura, faz quebra automática e pode
   crescer verticalmente.
3. O modo de edição principal será direto no canvas. O painel lateral continua
   útil para edição longa e propriedades, mas não será a única forma de digitar.
4. Canvas, preview, miniatura, exportação, rasterização, mesclagem e conta-gotas
   devem usar as mesmas regras de linhas, largura e alinhamento. Não é aceitável
   o cursor aparentar uma composição e a exportação produzir outra.
5. A primeira versão formata a camada inteira. Estilos por caractere ou intervalo
   exigem uma árvore de runs, seleção de texto e um motor de layout próprio; são
   uma fase posterior, não um conjunto de campos opcionais improvisados.
6. Não enumerar fontes instaladas de maneira insegura ou diferente entre WebViews.
   A primeira versão expõe uma biblioteca curada de stacks CSS e permite informar
   uma família manualmente. Importar/incorporar fontes depende de licença e terá
   escopo separado.
7. Mudanças contínuas no editor de canvas viram uma única entrada de histórico ao
   confirmar a edição; cancelar restaura o snapshot integral. Controles contínuos
   de tipografia também precisam de agrupamento e cancelamento previsíveis.

## Fases

### Fase 0 — Contrato de texto, métrica e compatibilidade

Estado: `EM ANDAMENTO`

- [x] Formalizar `TextLayerContent` com modo `point`/`paragraph` e defaults
  compatíveis com projetos existentes. Bounds de parágrafo entram junto da caixa
  de texto na Fase 1.
- [ ] Extrair layout de linhas e medição para um núcleo puro, compartilhado por
  Canvas, DOM, preview, exportação e miniaturas.
- [ ] Cobrir alinhamento, linhas vazias, Unicode, quebras CRLF, largura máxima,
  transformações e migração de projetos antigos.
- [ ] Definir limites seguros de tamanho, linhas, caracteres e área para evitar
  travamentos por conteúdo malformado.

### Fase 1 — Edição direta no canvas

Estado: `NÃO INICIADO`

- [x] Clique com `T` cria texto pontual e entra imediatamente em edição.
- [x] Arrastar com `T` cria caixa de parágrafo e entra em edição.
- [x] Duplo clique em camada de texto abre a edição no canvas sem mover ou
  selecionar outra camada acidentalmente.
- [x] `Esc` cancela a sessão e restaura o conteúdo anterior; `Ctrl+Enter` confirma.
  Troca de ferramenta e camada será consolidada junto da caixa de parágrafo.
- [ ] Seleção de caracteres, cursor, copiar/colar, IME e atalhos comuns funcionam
  sem capturar atalhos globais do editor enquanto o campo estiver ativo.
- [ ] O overlay de edição não entra no preview, exportação, histórico ou `.axia`.

### Fase 2 — Controles tipográficos essenciais

Estado: `EM ANDAMENTO`

- [ ] Barra contextual para família, estilo normal/itálico, peso, tamanho, cor,
  alinhamento e entrelinha.
- [x] Adicionar espaçamento entre letras, caixa alta opcional, sublinhado e
  tachado, com representação persistida e renderização equivalente.
- [ ] Biblioteca curada de fontes e campo manual de família com fallback CSS
  visível; fontes indisponíveis precisam resultar em fallback previsível.
- [ ] Painel lateral acompanha a seleção ativa sem roubar foco da edição no canvas.
- [ ] Alterações em controles, Undo/Redo, duplicação e conversão em camada
  inteligente preservam todas as propriedades.

### Fase 3 — Texto de parágrafo e layout

Estado: `EM ANDAMENTO`

- [x] Quebra automática respeita a largura interna da caixa e preserva quebras
  manuais do usuário.
- [ ] Alinhamentos esquerdo, centro, direito e justificado são definidos no núcleo
  de layout e usados igualmente em todos os renderizadores.
- [ ] Ajustar largura/altura do parágrafo por alças sem escalar glifos; transformar
  a camada continua sendo uma ação distinta e explícita.
- [ ] Implementar recuo inicial, espaçamento antes/depois do parágrafo e controles
  de alinhamento vertical somente depois de validar a base de quebra automática.

### Fase 4 — Robustez e integração profissional

Estado: `NÃO INICIADO`

- [ ] Salvar/reabrir documentos novos e antigos sem alterar aparência ou bounds.
- [ ] Preview, miniatura, exportação, rasterização, mesclagem e estilos de camada
  apresentam paridade visual em zoom baixo e alto.
- [ ] Texto em camada inteligente pode ser editado, confirmado e cancelado sem
  compartilhar sessões ou URLs transitórias com o documento pai.
- [ ] Testar conteúdo grande, Unicode, emojis, RTL quando suportado pelo WebView e
  fontes ausentes sem congelar o editor.

### Fase 5 — Tipografia avançada, somente após a base estar estável

Estado: `NÃO INICIADO`

- [ ] Runs por caractere/intervalo (família, peso, cor, tamanho e decoração).
- [ ] Painéis Caractere e Parágrafo completos, kerning, tracking, escala e baseline.
- [ ] Texto em caminho, conversão em forma e importação de fontes autorizadas.
- [ ] OpenType avançado, hifenização, composição multilíngue e recursos de layout
  que exigirem motor dedicado.

Esses itens não devem entrar antes de uma decisão explícita de produto, benchmark e
validação de licença quando envolverem fontes ou bibliotecas adicionais.

## Critérios de aceite da primeira entrega

- [ ] Criar, editar, confirmar e cancelar texto pontual e de parágrafo no canvas.
- [ ] Digitar com teclado comum, colar conteúdo e usar IME sem atalhos conflitantes.
- [ ] Preview, exportação e miniatura coincidem visualmente em linhas, alinhamento,
  largura e transformação.
- [ ] Undo/Redo restaura conteúdo, propriedades e bounds sem criar entradas por tecla.
- [ ] Salvar, fechar e reabrir preserva texto e compatibilidade com `.axia` antigo.
- [ ] Camadas com texto, estilos, smart content e rasterização não apresentam
  piscada, vazamento ou perda de editabilidade inesperada.
- [ ] Testes automatizados, build e validação manual em Windows e Linux aprovados.

## Ordem de execução

1. Fase 0 com testes e migração, sem alterar a experiência existente.
2. Texto pontual editável diretamente no canvas.
3. Caixa de parágrafo e quebra automática.
4. Barra de propriedades tipográficas essenciais.
5. Auditoria de paridade, performance e persistência.
6. Só então decidir se a Fase 5 justifica um motor de layout mais complexo.

## Registro de evolução

### 2026-09-25 — Fundação da Fase 0 iniciada

- Criado o roadmap depois da auditoria do fluxo atual: a camada de texto já é
  editável, mas a experiência ainda está concentrada no painel lateral.
- `TextLayerContent` agora reconhece `point` e `paragraph`; projetos antigos sem
  o campo são restaurados como `point`, preservando exatamente seu comportamento.
- A normalização de quebras e a métrica de texto receberam testes independentes
  do DOM para proteger o uso em exportação e demais contextos sem `document`.
- Validação: 425 testes do frontend e build Vite aprovados.
- Próximo passo: extrair o layout puro de linhas antes de montar o editor direto
  no canvas, para não duplicar lógica entre DOM e Canvas 2D.

### 2026-09-25 — Primeira edição direta no canvas

- A ferramenta `T` abre um editor sobre a camada criada ao clicar no documento;
  o texto inicial já vem selecionado para ser substituído sem uma etapa extra.
- Duplo clique em uma camada de texto abre o mesmo editor no lugar. O overlay usa
  a transformação da camada, não participa da exportação e não grava cada tecla
  no histórico.
- `Ctrl+Enter` confirma uma única alteração de conteúdo; `Esc` descarta o
  rascunho. Perder o foco confirma, seguindo o comportamento usual de editores
  gráficos, sem publicar mudanças antes disso.
- Validação automatizada: 425 testes do frontend e build Vite aprovados.
- Próximo passo: caixa de parágrafo por arraste e layout compartilhado de quebra
  automática antes de expor controles tipográficos adicionais.

### 2026-09-25 — Tipografia e layout de parágrafo iniciados

- O modelo persistido agora cobre itálico, espaçamento entre letras, sublinhado,
  tachado e caixa alta; projetos antigos recebem os defaults sem migração manual.
- O painel expõe uma biblioteca inicial de famílias CSS, peso, estilo, decoração,
  espaçamento, alinhamento e largura de parágrafo.
- A medição e a renderização de exportação passaram a usar o mesmo algoritmo de
  quebra por palavras para texto de parágrafo. Testes cobrem largura fixa, CRLF,
  linhas vazias, caixa alta e fallback sem DOM.
- A criação de caixa por arraste, a distribuição real de texto justificado no
  Canvas e controles rápidos na barra contextual continuam pendentes antes da
  validação manual consolidada.

### 2026-09-25 — Caixa de parágrafo por gesto

- Clique simples com `T` mantém o texto pontual. Arrastar passa a criar texto de
  parágrafo, usando a largura horizontal do gesto e abrindo a edição imediatamente.
- A interação usa captura de ponteiro e só cria a camada no `pointerup`; cancelar
  o gesto não deixa camada vazia nem entrada de histórico.
- Validação: typecheck, build Vite e `git diff --check` aprovados.

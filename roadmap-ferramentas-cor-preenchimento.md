# Roadmap de ferramentas de cor e preenchimento

> Documento vivo de implementação do Axia. Este arquivo deve ser atualizado na
> mesma alteração de código sempre que uma etapa deste roadmap avançar, mudar de
> escopo, encontrar um bloqueio ou for concluída.

## Metadados

- Última atualização: 2026-08-26
- Estado geral: Fases 1 e 2 implementadas, aguardando validação prática; continuidade antes do teste de fogo autorizada pelo mantenedor
- Ordem aprovada: Degradê linear -> Degradê radial -> Varinha Mágica -> Balde de Tinta
- Plataformas obrigatórias: Windows e Linux
- Stack atual: Go 1.23, Wails 2.12, Vue 3, TypeScript e Vite

## Objetivo

Entregar uma família coerente de ferramentas raster que aproveite as cores
principal e secundária do editor:

1. Degradê linear com prévia ao vivo e aplicação destrutiva em uma única etapa de histórico.
2. Degradê radial usando o mesmo motor, estado e fluxo de interação.
3. Varinha Mágica tratada como feature futura, auditada e aceita formalmente apesar da infraestrutura experimental já presente.
4. Balde de Tinta construído sobre o mesmo motor de análise de regiões aprovado para a Varinha Mágica.

O Degradê não deve depender da Varinha Mágica nem do Balde. Varinha e Balde devem
compartilhar a lógica de comparação de cores e descoberta de regiões, evitando
dois algoritmos de flood fill que possam divergir.

## Protocolo obrigatório para qualquer IA ou pessoa

Antes de alterar código relacionado a este roadmap:

1. Ler este arquivo por completo.
2. Conferir `git status --short` e preservar mudanças que já estejam no worktree.
3. Ler novamente os arquivos citados na fase em execução; os caminhos são guias, não substitutos para inspeção do código atual.
4. Atualizar a seção **Estado atual** marcando a etapa como `EM ANDAMENTO` antes ou junto da primeira alteração material.
5. Implementar em incrementos testáveis, sem misturar refatorações não relacionadas.
6. Atualizar testes na mesma alteração que muda o comportamento.
7. Executar as verificações descritas em **Validação obrigatória**.
8. Atualizar este arquivo antes de encerrar: estado, decisões tomadas, arquivos realmente criados ou alterados, testes adicionados, riscos restantes e próximo passo exato.
9. Adicionar uma entrada em **Registro de evolução** com data e resumo objetivo.

Não marcar uma etapa como concluída apenas porque compila. `CONCLUÍDO` exige todos
os critérios de aceite da etapa, testes automatizados e teste manual no aplicativo
Wails em Windows e Linux. Quando uma plataforma ainda não tiver sido testada, usar
`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`.

Estados permitidos neste documento:

- `NÃO INICIADO`
- `EM ANDAMENTO`
- `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`
- `BLOQUEADO`
- `CONCLUÍDO`

Ao mudar uma decisão já registrada, não apagar silenciosamente a decisão anterior.
Registrar a nova decisão em **Registro de decisões** e explicar o motivo.

## Estado atual

| Entrega | Estado | Próximo passo verificável |
| --- | --- | --- |
| Base de cores principal/secundária | `CONCLUÍDO` | Manter compatibilidade com os novos consumidores |
| Conta-gotas contínuo | `CONCLUÍDO` | Usar como referência para pointer capture e coalescência |
| Degradê linear | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Executar teste de fogo no Wails após completar as ferramentas planejadas |
| Degradê radial | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar preview, commit e cancelamento no Windows/Linux no teste de fogo |
| Auditoria e aceite da Varinha Mágica | `EM ANDAMENTO` | Extrair e validar o contrato neutro de análise de regiões |
| Balde de Tinta | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar fluxo completo no Windows/Linux e corrigir achados práticos |

## Baseline confirmado em 2026-08-23

### Recursos estáveis que devem ser preservados

- Cores principal e secundária editáveis em `frontend/src/components/ToolBar.vue`.
- Conta-gotas contínuo: botão esquerdo coleta a principal e botão direito coleta a secundária.
- Seleções retangular, elíptica e por laço, representadas em espaço do documento.
- Pintura e borracha com prévia, worker, fallback e uma entrada atômica no histórico.
- `MutationBarrier` protegendo desfazer/refazer e mutações raster assíncronas.
- Assets raster com `sourceUrl`, preview derivado, `editToken` e descarte controlado de object URLs.
- Transformações de camada que podem incluir escala, deslocamento e rotação.
- Camadas raster compactas, que não necessariamente ocupam todo o documento.
- Camadas de texto e inteligentes, que precisam seguir o fluxo existente de rasterização antes de edição destrutiva.
- Builds do aplicativo validadas pelo mantenedor no Windows e no Linux.

### Situação especial da Varinha Mágica

A decisão de produto é: **a Varinha Mágica ainda é uma feature futura e não deve
ser considerada concluída**.

Entretanto, o código atual contém uma implementação experimental extensa:

- `SelectionMode` inclui `magic-wand`.
- `CanvasContextBar.vue` atualmente mostra a opção, tolerância e modo contíguo.
- `selection.ts` contém descoberta de spans.
- `selectionEngine.ts` e `magicWand.worker.ts` executam a análise.
- `App.vue` contém `selectWithMagicWand`.
- O README atualmente anuncia a Varinha como recurso disponível.

Uma IA não deve interpretar a presença desse código como aceite da feature. Na fase
da Varinha será obrigatório auditar comportamento, UX, desempenho, transformações,
testes e documentação. Até essa fase, preservar a infraestrutura existente e não
fazer o Degradê depender dela. Caso a opção esteja visível em builds distribuídas,
o mantenedor deve decidir separadamente se ela permanece experimentalmente visível
ou se será temporariamente ocultada; este roadmap não autoriza removê-la por conta própria.

## Mapa da arquitetura relevante

| Área | Arquivos principais | Responsabilidade |
| --- | --- | --- |
| Estado e orquestração | `frontend/src/App.vue` | Cores, ferramenta ativa, commits raster, histórico, status e ciclo de assets |
| Tipos de domínio | `frontend/src/types/editor.ts` | `EditorTool`, camadas, transforms e modelos compartilhados |
| Barra de ferramentas | `frontend/src/components/ToolBar.vue` | Ícones, ativação de ferramentas e amostras de cor |
| Barra contextual | `frontend/src/components/canvas/CanvasContextBar.vue` | Opções da ferramenta ativa |
| Entrada do canvas | `frontend/src/components/CanvasViewport.vue` | Conversão tela/documento, pointer capture, início/fim das interações |
| Contratos do canvas | `frontend/src/components/canvas/canvas.types.ts` | Props, emits, view state e actions |
| Superfície visual | `frontend/src/components/canvas/CanvasSurface.vue` | Camadas DOM e canvases transitórios de prévia |
| Padrão de interação raster | `frontend/src/components/canvas/composables/useBrushInteraction.ts` | Referência para sessão de ponteiro e handoff da prévia |
| Motor raster | `frontend/src/services/brushEngine.ts` e `frontend/src/workers/brushStroke.worker.ts` | Referência para worker, fallback, abort e resultado raster |
| Seleções e matrizes | `frontend/src/editor/selection.ts` | Máscaras, paths, spans e conversão camada/documento |
| Histórico | `frontend/src/editor/editorHistory.ts` e `frontend/src/editor/history.ts` | Delta `layer:patch`, retenção de assets e undo/redo |
| Exclusão/movimento de pixels | `frontend/src/services/selectionEngine.ts` e workers relacionados | Referência para mutações limitadas por seleção |
| Testes | `frontend/tests/*.test.mjs` | Testes Node dos módulos TypeScript puros |

## Regras técnicas globais

Estas regras valem para todas as fases:

1. Coordenadas de interação são definidas em espaço do documento. Conversões para o raster da camada devem usar as matrizes existentes em `selection.ts`; não duplicar fórmulas ad hoc.
2. A aplicação final deve usar a fonte original (`sourceUrl`), nunca um preview reduzido.
3. A prévia interativa pode ser reduzida conforme zoom, densidade e orçamento de pixels, mas deve permanecer alinhada ao resultado final.
4. Uma interação completa gera no máximo uma entrada no histórico.
5. Um preview nunca pode alterar `layer.image`, `layer.transform`, dirty state ou histórico.
6. Toda mutação final precisa passar pela `MutationBarrier` e ser cancelável com `AbortController` quando houver operação pendente equivalente.
7. Undo e redo devem restaurar tanto `image` quanto `transform`, inclusive quando o raster for expandido.
8. Object URLs criadas precisam entrar no rastreamento existente e ser liberadas somente quando não forem mais referenciadas pelo documento ou histórico.
9. Seleções existentes devem limitar a mutação. A ferramenta não deve apagar nem substituir a seleção do usuário.
10. Sem seleção, a área de efeito do Degradê será o documento inteiro, recortada aos limites do documento. Isso permite que uma camada raster compacta seja expandida de forma previsível.
11. Degradês lineares e radiais são calculados em espaço do documento, mesmo quando a camada ativa está escalada ou rotacionada.
12. Camadas invisíveis, bloqueadas ou não editáveis devem seguir exatamente as restrições já aplicadas ao Pincel. Não inventar um segundo fluxo de elegibilidade.
13. Texto e camadas inteligentes só podem receber a mutação após passar pelo fluxo existente de rasterização. Não editar silenciosamente o conteúdo interno de uma camada inteligente.
14. Não bloquear a thread principal com loops proporcionais a imagens grandes. Cálculo final deve ter worker e fallback compatível.
15. O fallback sem `Worker` precisa produzir os mesmos pixels do worker.
16. Não adicionar dependência externa para interpolação, flood fill ou desenho 2D; os algoritmos são pequenos e o projeto já tem infraestrutura apropriada.
17. Preservar navegação temporária por Espaço, botão do meio e atalhos existentes.
18. `Esc` durante uma interação cancela apenas a prévia atual e restaura o estado anterior.
19. Trocar de ferramenta, documento ou camada durante uma interação deve cancelar ou concluir explicitamente a sessão; nunca deixar um canvas transitório órfão.
20. Erros devem restaurar o asset anterior, liberar recursos temporários e apresentar mensagem em português pelo fluxo existente de `showError`.

## Fase 1 — Degradê linear

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

### Progresso da fase

- [x] Núcleo puro de geometria, interpolação sRGB, inversão e snap angular.
- [x] Motor raster com worker e fallback. (`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` integrada no Wails)
- [x] Interação por ponteiro e preview ao vivo. (`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` manual)
- [x] Integração com toolbar e barra contextual. (`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` manual)
- [x] Commit raster, histórico e ciclo de assets. (`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` manual)
- [ ] Validação automatizada e manual completa.

### Resultado esperado

Adicionar uma ferramenta `gradient` à barra. O usuário pressiona e arrasta no
documento. O ponto inicial representa a cor principal; o ponto final representa a
cor secundária. Durante o arraste aparece uma prévia ao vivo. Ao soltar, a aplicação
é gravada na camada ativa como uma única mutação raster.

### Escopo funcional obrigatório

- Novo valor `gradient` em `EditorTool`.
- Ícone próprio seguindo o padrão SVG de `frontend/src/assets/icons/`.
- Atalho `G` quando o foco não estiver em campo editável.
- Degradê linear da cor principal para a secundária.
- Interpolação RGB em sRGB, canal por canal.
- Progresso linear:
  - vetor `v = end - start`;
  - para um pixel `p`, `t = dot(p - start, v) / dot(v, v)`;
  - limitar `t` ao intervalo `[0, 1]`;
  - antes do ponto inicial usar a cor principal;
  - depois do ponto final usar a cor secundária.
- `Shift` durante o arraste encaixa o ângulo em incrementos de 15 graus.
- Arraste menor que 0,5 pixel do documento é cancelado como no-op; não criar histórico.
- Prévia atualizada durante `pointermove`, limitada a um frame por `requestAnimationFrame`.
- Pointer capture para continuar a interação mesmo se o cursor sair do documento.
- `pointerup` confirma; `pointercancel`, `lostpointercapture`, `Esc` ou troca de ferramenta cancelam.
- Seleção existente recorta preview e resultado final.
- Sem seleção, o efeito cobre o documento inteiro e pode expandir o raster compacto da camada.
- O resultado usa composição `source-over` com cores opacas. Nesta fase não haverá controle de opacidade do degradê.
- Após concluir, mostrar status `Degradê aplicado`.

### Decisões de UX

- A barra contextual deve mostrar um controle segmentado `Linear | Radial`, inicialmente com apenas `Linear` habilitado até a Fase 2.
- Incluir um botão de ícone para inverter o sentido das cores. Inverter afeta somente a ferramenta, sem trocar globalmente as amostras principal/secundária.
- Não exibir texto de tutorial permanente no canvas.
- Mostrar sobre o documento uma linha fina entre início e fim, com controles circulares estáveis nas extremidades.
- A linha e os controles são parte da prévia e não aparecem no export nem no histórico.
- O cursor deve identificar a ferramenta sem depender de texto; `crosshair` é fallback aceitável no primeiro incremento.
- Botão esquerdo cria o degradê. Botão direito não inicia aplicação nesta fase, para não conflitar com o menu nativo já bloqueado nem criar semântica não aprovada.

### Estrutura recomendada

Criar ou alterar, respeitando os padrões encontrados no momento da implementação:

- `frontend/src/editor/gradient.ts`
  - tipos puros de modo, geometria e configuração;
  - cálculo de `t` linear e interpolação sRGB;
  - snap de ângulo;
  - cálculo de bounds e no-op;
  - nenhuma referência a DOM, Vue, Worker ou object URL.
- `frontend/src/components/canvas/composables/useGradientInteraction.ts`
  - estado da sessão de ponteiro;
  - captura, movimento, cancelamento e confirmação;
  - canvas de preview e overlay da linha;
  - handoff equivalente ao padrão do Pincel.
- `frontend/src/services/gradientEngine.ts`
  - API assíncrona de aplicação final;
  - carregamento do asset, transformação de coordenadas, recorte pela seleção;
  - worker, fallback, abort e codificação PNG/WebP de preview;
  - resultado compatível com atualização de `ImageAsset` e `LayerTransform`.
- `frontend/src/workers/gradient.worker.ts`
  - processamento final fora da thread principal;
  - mensagens tipadas e cancelamento, seguindo o padrão dos workers existentes.
- `frontend/tests/gradient.test.mjs`
  - cobertura do módulo puro.

Alterações esperadas:

- `types/editor.ts`: adicionar a ferramenta.
- `ToolBar.vue`: ícone e ativação.
- `CanvasContextBar.vue`: modo e inversão.
- `canvas.types.ts`: props/emits/view/actions necessários.
- `CanvasViewport.vue`: integrar o composable e respeitar precedência das interações.
- `CanvasSurface.vue`: canvas de preview e overlay de controles.
- `App.vue`: estado da configuração, commit, histórico, barreira e assets.
- `style.css`: dimensões estáveis, cursores, linha e controles sem sobreposição.

Os nomes acima são recomendados. Se a arquitetura tiver mudado, atualizar este
roadmap antes de usar nomes diferentes e registrar a decisão.

### Pipeline final recomendado

1. Validar ferramenta, botão esquerdo, camada editável e ausência de operação raster concorrente.
2. Converter o ponto inicial e o atual da tela para espaço do documento.
3. Capturar uma cópia imutável da seleção e da configuração de cores no início da interação.
4. Renderizar somente a prévia durante o movimento; não alterar a camada.
5. No `pointerup`, descartar interação degenerada.
6. Aguardar qualquer mutação protegida pela barreira.
7. Preparar a camada pelo mesmo fluxo usado pelo Pincel para camadas que exigem rasterização.
8. Aplicar o degradê no worker usando a imagem original e matrizes camada/documento.
9. Gerar `blob` final e preview derivado.
10. Criar object URLs, pré-carregar o preview e somente então publicar `layer.image` e `layer.transform` juntos.
11. Registrar `layer:patch` com label `Degradê`.
12. Liberar URLs temporárias sem remover assets ainda retidos pelo histórico.
13. Em erro ou aborto, restaurar imagem e transformação anteriores.

### Testes mínimos da Fase 1

- `t = 0`, `0.5` e `1` gera as cores esperadas.
- Valores antes/depois dos endpoints são limitados corretamente.
- Direções horizontal, vertical e diagonal produzem progressão correta.
- Vetor de comprimento zero é no-op.
- Snap com `Shift` usa passos de 15 graus e preserva o comprimento.
- Inversão troca somente os stops usados no cálculo.
- Worker e fallback retornam pixels idênticos em fixture pequena.
- Retângulo, elipse, laço e seleção por pixels recortam a mutação.
- Camada transformada, escalada e rotacionada recebe o degradê no lugar visual correto.
- Raster compacto expande sem ultrapassar o documento.
- Undo restaura asset e transform anteriores; redo restaura o degradê.
- Cancelar não cria histórico, dirty state nem object URL retida.
- Trocar de ferramenta no meio do arraste remove preview e captura.
- Documento grande não bloqueia a UI durante o commit.

### Critérios de aceite da Fase 1

- [ ] Ferramenta e atalho funcionam.
- [ ] Preview acompanha o cursor sem deslocamento em zoom fracionário e alta densidade.
- [ ] Resultado final coincide visualmente com o preview.
- [ ] Seleções são respeitadas.
- [ ] Undo/redo são atômicos.
- [ ] Não há vazamento aparente de object URLs após aplicar, desfazer, refazer e fechar documento.
- [ ] Testes automatizados passam.
- [ ] Build Wails validada manualmente no Windows.
- [ ] Build Wails validada manualmente no Linux.
- [ ] README atualizado somente após aceite do produto.

## Fase 2 — Degradê radial

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

### Dependência

Começar somente quando o Degradê linear estiver `CONCLUÍDO` ou quando o mantenedor
autorizar explicitamente trabalho paralelo. Não duplicar pipeline, worker, preview,
histórico ou asset lifecycle.

### Escopo funcional obrigatório

- Habilitar `Radial` no controle segmentado existente.
- Ponto inicial é o centro e usa a cor principal.
- Distância entre início e fim define o raio e alcança a cor secundária.
- Para um pixel `p`, `t = distance(p, start) / distance(end, start)`, limitado a `[0, 1]`.
- Antes do raio não existe região especial: o centro é `t = 0`; fora do raio permanece `t = 1`.
- O modo inicial é circular em pixels do documento. Degradê elíptico fica fora do MVP.
- A mesma inversão, seleção, preview, cancelamento, worker, histórico e tratamento de erros do linear devem funcionar.
- O modo selecionado pode permanecer apenas em memória nesta fase; não alterar o formato `.axia`.

### Testes mínimos da Fase 2

- Centro, metade do raio, borda e exterior produzem cores esperadas.
- O resultado é circular mesmo em zoom não uniforme da tela.
- Raio degenerado é no-op.
- Inversão e seleção funcionam como no modo linear.
- Alternar Linear/Radial durante uma interação cancela a prévia anterior.
- Worker e fallback permanecem equivalentes.

### Critérios de aceite da Fase 2

- [ ] Linear continua sem regressões.
- [ ] Radial coincide entre preview e commit.
- [ ] Testes automatizados passam.
- [ ] Windows e Linux validados manualmente.
- [ ] Estado e registro deste roadmap atualizados.

## Fase 3 — Auditoria e aceite da Varinha Mágica

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

### Objetivo

Transformar a implementação experimental existente em uma feature conscientemente
aceita, ou registrar com precisão o que falta. Não reescrever tudo antes da auditoria.

### Auditoria obrigatória

1. Testar a opção atualmente exposta em um documento real no Windows e Linux.
2. Conferir seleção em camadas raster normais, background, rasters compactos, imagens transformadas e rotacionadas.
3. Conferir comportamento em transparência e bordas com antialiasing.
4. Medir interação em imagens pequenas, 4K e no limite de megapixels aceito pelo editor.
5. Confirmar cancelamento e proteção contra resultados obsoletos ao trocar camada, documento ou tolerância.
6. Comparar worker e fallback.
7. Revisar a escala de tolerância atual e documentar a métrica de distância de cor realmente usada.
8. Decidir com o mantenedor se o padrão é contíguo ou global.
9. Decidir se a amostragem considera somente a camada ativa ou a composição visível. O baseline atual aparenta usar a camada ativa; não mudar sem decisão explícita.
10. Decidir modos de combinação da seleção: substituir, adicionar, subtrair e intersectar. Se ficarem fora do primeiro aceite, registrar como backlog.
11. Corrigir README e UI para refletirem o status real após a decisão.

### Refatoração compartilhada permitida

Depois da auditoria, extrair um contrato único de análise de regiões para uso futuro
pelo Balde. Esse contrato deve receber pixels, dimensões, ponto inicial, tolerância,
modo contíguo/global e sinal de cancelamento, retornando spans/bounds/pixelCount.

Não acoplar o motor ao estado Vue nem fazer o Balde depender de uma `SelectionRegion`
temporariamente publicada na UI. O motor retorna dados; cada ferramenta decide como
consumi-los.

### Critérios de aceite da Fase 3

- [ ] Comportamento e métrica de tolerância documentados.
- [ ] Worker/fallback e cancelamento validados.
- [ ] Transformações e transparência cobertas por testes.
- [ ] Decisões de UX registradas.
- [ ] README reflete o estado verdadeiro.
- [ ] Windows e Linux validados.
- [ ] Motor compartilhável com o Balde sem alterar a seleção do usuário por efeito colateral.

## Fase 4 — Balde de Tinta

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

### Dependência

Iniciar após a Fase 3 estabilizar o contrato de análise de regiões. O Balde não deve
copiar o algoritmo experimental para outro arquivo.

### Escopo inicial proposto

- Ferramenta `paint-bucket` agrupada com Degradê sob o atalho `G`.
- Definir UX do grupo antes da implementação: clique prolongado/menu ou alternância por `Shift+G`. Não fazer o atalho `G` alternar de forma invisível sem indicação da ferramenta ativa.
- Clique esquerdo preenche com a cor principal.
- Clique direito preenche com a cor secundária.
- Tolerância configurável na barra contextual.
- Opção contígua/global reaproveitando o motor aceito da Varinha.
- Análise inicial sobre a camada ativa, salvo nova decisão explícita de produto.
- Respeitar a seleção já existente pela interseção entre spans encontrados e máscara da seleção.
- Não substituir nem modificar a seleção visual do usuário.
- Clique executa uma mutação e uma entrada `Balde de Tinta` no histórico.
- Cor de preenchimento inicial é opaca. Opacidade e modo de mistura da ferramenta ficam fora do MVP.
- Pixels transparentes precisam de regra explícita na métrica de tolerância; reutilizar exatamente a decisão da Varinha.
- Camadas não raster seguem o mesmo fluxo de rasterização do Pincel e Degradê.

### Pipeline recomendado

1. Validar ponto dentro do documento e camada editável.
2. Capturar cor, tolerância, modo contíguo e seleção no clique.
3. Aguardar `MutationBarrier`.
4. Converter o ponto do documento para o raster da camada.
5. Executar o motor compartilhado para obter spans.
6. Intersectar os spans com a seleção existente sem publicar uma nova seleção.
7. Aplicar a cor em worker e gerar asset/preview.
8. Publicar imagem e transformação atomicamente.
9. Registrar `layer:patch` com label `Balde de Tinta`.
10. Restaurar estado e liberar recursos em erro ou cancelamento.

### Testes mínimos da Fase 4

- Preenchimento contíguo não atravessa uma barreira de cor.
- Modo global preenche todas as regiões equivalentes.
- Tolerância zero e tolerâncias intermediárias têm resultado determinístico.
- Botões esquerdo/direito usam as amostras corretas.
- Seleção retangular, elíptica, laço e pixels limitam o preenchimento.
- Transparência segue a mesma métrica da Varinha.
- Camada transformada recebe preenchimento no pixel visual clicado.
- Undo/redo e ciclo de URLs são corretos.
- Clique sem pixels elegíveis é no-op sem histórico.
- Worker e fallback são equivalentes.

### Critérios de aceite da Fase 4

- [x] Balde compartilha o motor da Varinha.
- [x] Não altera a seleção do usuário.
- [x] Cores principal/secundária e tolerância funcionam.
- [x] Undo/redo são atômicos.
- [x] Testes automatizados passam.
- [ ] Windows e Linux validados manualmente.
- [ ] README e atalhos atualizados.

## Melhorias posteriores, fora do escopo aprovado

Não implementar estas melhorias junto do MVP sem decisão explícita:

- Degradês refletido, angular e diamante.
- Stops de cor editáveis além das duas amostras globais.
- Stops de opacidade e transparência.
- Dithering, ruído e interpolação perceptual.
- Presets de degradê persistentes.
- Degradê elíptico ou transformação posterior não destrutiva.
- Camada de preenchimento/degradê não destrutiva.
- Balde com suavização, expansão/contração de borda ou preenchimento por padrão.
- Varinha amostrando todas as camadas.
- Feather, expandir, contrair e suavizar seleção.
- Persistência das opções das ferramentas no formato `.axia`.

Esses itens podem ser promovidos para uma fase quando houver decisão do mantenedor.

## Validação obrigatória

Executar a partir da raiz, usando as toolchains do projeto:

```bash
source scripts/env.sh
go test ./...
```

Executar no frontend:

```bash
cd frontend
source ../scripts/env.sh
npm test
npm run build
```

Também executar:

- `git diff --check`.
- Teste manual em desenvolvimento no viewport mínimo suportado e em janela maximizada.
- Documento transparente, branco e preto.
- Documento pequeno, imagem 4K e camada compacta transformada.
- Zoom baixo, 100%, zoom fracionário e zoom alto.
- Seleção ausente, retângulo, elipse, laço e pixels quando disponível.
- Aplicar, desfazer, refazer, salvar `.axia`, reabrir e exportar PNG.
- Fechar ou trocar documento durante operação pendente.
- Build nativa Windows e Linux antes de marcar uma fase como concluída.

Se algum comando não puder ser executado no ambiente atual, registrar isso no estado
da fase e não declarar validação completa.

## Registro de decisões

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-08-23 | Implementar Degradê antes de Balde | Aproveita imediatamente as duas cores e não depende de flood fill/tolerância |
| 2026-08-23 | Entregar Linear antes de Radial | Reduz o primeiro incremento e estabiliza preview, worker, histórico e assets uma única vez |
| 2026-08-23 | Tratar Varinha como futura apesar do código existente | Decisão explícita do mantenedor; código presente ainda não equivale a aceite do produto |
| 2026-08-23 | Construir Balde após Varinha | As duas features devem compartilhar análise de cor, spans e regiões contíguas/globais |
| 2026-08-23 | Degradê usa principal no início e secundária no fim | Semântica direta para as duas amostras já existentes |
| 2026-08-23 | Sem seleção, Degradê cobre o documento | Resultado previsível para rasters compactos e coerente com uma ferramenta de preenchimento |
| 2026-08-24 | Continuar as fases antes do teste de fogo | O mantenedor optou por validar a família de ferramentas em conjunto e corrigir bugs práticos depois da implementação completa |
| 2026-08-26 | Pincel e Borracha usam opções na barra contextual | Segue o padrão de ferramentas do Photoshop e evita controles duplicados ou transformações imutáveis no painel lateral |

## Registro de evolução

### 2026-08-26 — Opções contextuais de Pincel e Borracha

- Tamanho de Pincel/Borracha foi movido do painel Propriedades para a barra superior,
  com slider e entrada numérica sincronizados entre 1 e 128 px.
- A cor do Pincel passou a ser editada na mesma barra e continua ligada à amostra
  principal global; a Borracha mostra sua semântica de apagar para transparência.
- O painel Propriedades deixou de repetir essas opções e não exibe a transformação
  somente leitura enquanto Pincel ou Borracha estiverem ativos.
- Contratos de props e eventos foram propagados por `CanvasContextBar`,
  `CanvasViewport`, `canvas.types.ts` e `App.vue`.
- Validações concluídas: 266 testes frontend, testes e `vet` do Go, TypeScript
  estrito, build Vite de produção e `git diff --check` aprovados.

### 2026-08-23 — Base matemática do Degradê linear

- Criado `frontend/src/editor/gradient.ts`, sem dependências de DOM ou Vue.
- Formalizados `GradientConfig`, `GradientGeometry`, tipo linear e configuração padrão preto/branco.
- Implementados parsing estrito `#RRGGBB`, interpolação sRGB, inversão, progresso linear limitado, comprimento mínimo de 0,5 pixel, bounds da linha e snap angular de 15 graus.
- Criado `frontend/tests/gradient.test.mjs` com 8 testes para cores, direções, limites, no-op, bounds, inversão e snap preservando comprimento.
- Verificações executadas com sucesso: 194 testes frontend, build Vue/TypeScript e testes Go.
- Estado da Fase 1 mantido como `EM ANDAMENTO`; ainda não existe ferramenta visível nem mutação raster.
- Próximo passo: criar `gradientEngine.ts` e o protocolo do worker/fallback usando este módulo puro como fonte única para cálculo dos pixels.

### 2026-08-24 — Motor raster do Degradê linear implementado

- Incremento limitado ao processamento final: UI, interação, commit, histórico e ciclo de object URLs permanecem para os próximos incrementos.
- Criado `frontend/src/editor/gradientRaster.ts` com composição RGBA opaca, cálculo em espaço do documento, máscaras para retângulo, elipse, laço e spans, geometria de expansão e processamento por lotes.
- Criado `frontend/src/services/gradientEngine.ts` com leitura exclusiva de `sourceUrl`, fallback cooperativo, `AbortSignal`, codificação PNG/WebP e protocolo de descarte.
- Criado `frontend/src/workers/gradient.worker.ts`; o worker usa o mesmo núcleo RGBA, processa linhas em lotes para atender cancelamentos e produz o mesmo contrato do fallback.
- A expansão sem seleção converte os quatro cantos do documento pela matriz existente de documento para source e une o resultado aos bounds do raster original. Com seleção, os limites atuais do raster são preservados, como no Pincel.
- A máscara é avaliada no centro de cada pixel e a cor opaca substitui o pixel elegível, equivalendo a `source-over` com alfa 255.
- A escala da prévia derivada acompanha a densidade da prévia do asset original mesmo quando o raster final é expandido.
- `frontend/tests/gradient.test.mjs` passou de 8 para 14 testes de degradê, cobrindo RGBA, expansão, todas as formas de seleção, rotação e equivalência entre execução integral e em lotes.
- Verificações executadas com sucesso: 208 testes frontend, build Vue/TypeScript/Vite, testes Go e `git diff --check`.
- Mudanças locais já existentes na transformação de grupos foram preservadas sem refatoração ou mistura com este incremento.
- Risco restante: o serviço e o worker compilam, mas ainda não podem ser exercitados manualmente no Wails porque a ferramenta não está conectada à UI; por isso o motor permanece `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`.
- Estado da Fase 1 mantido como `EM ANDAMENTO`.
- Próximo passo exato: criar `useGradientInteraction.ts`, o canvas transitório e o overlay da linha, inicialmente emitindo a geometria confirmada sem publicar mutação no histórico.

### 2026-08-24 — Degradê linear integrado de ponta a ponta

- Adicionado `gradient` a `EditorTool`, à barra de ferramentas com ícone próprio e ao mapa de atalhos como `G`.
- A barra contextual exibe `Linear | Radial`, mantendo Radial desabilitado até a Fase 2, e inversão local que não troca as amostras globais.
- Criado `frontend/src/components/canvas/composables/useGradientInteraction.ts` com captura exclusiva do botão esquerdo, snapshot de cores/inversão/seleção, atualização limitada a um `requestAnimationFrame`, snap de 15° com `Shift` e cancelamento em `pointercancel`, `lostpointercapture`, `Esc`, troca de ferramenta, camada, documento, navegação temporária ou início concorrente de operação.
- `CanvasSurface.vue` recebeu canvas transitório limitado a 1.048.576 pixels e overlay SVG com linha e controles de tamanho visual estável em qualquer zoom.
- A prévia usa `CanvasGradient` acelerado e as máscaras/matrizes existentes; o commit continua usando o núcleo RGBA determinístico compartilhado por worker e fallback.
- A prévia permanece durante o processamento final e é removida quando a operação termina, evitando reaparecimento momentâneo do asset anterior.
- `App.vue` agora prepara camadas raster vazias também para o Degradê, executa o motor dentro da `MutationBarrier`, publica `ImageAsset` e `LayerTransform` juntos, registra um único `layer:patch` com label `Degradê`, coleta URLs sem referência e restaura o estado anterior em erro ou aborto.
- Desfazer durante um commit pendente aborta o degradê sem criar uma entrada de histórico; desmontar o editor também aborta e encerra o worker.
- `gradientResultTransform` centraliza e testa o ajuste da transformação quando o raster compacto é expandido.
- Adicionado teste de decisão de encerramento do gesto; o conjunto específico do degradê agora possui 15 testes.
- Verificações executadas com sucesso: 209 testes frontend, build Vue/TypeScript/Vite com bundle `gradient.worker`, testes Go e `git diff --check`.
- Arquivos criados neste estágio: `frontend/src/assets/icons/gradient.svg` e `frontend/src/components/canvas/composables/useGradientInteraction.ts`.
- Arquivos alterados neste estágio: `App.vue`, `ToolBar.vue`, `CanvasViewport.vue`, `CanvasContextBar.vue`, `CanvasSurface.vue`, `canvas.types.ts`, `useCanvasShortcuts.ts`, `gradient.ts`, `gradientRaster.ts`, `editor.ts`, `style.css`, `gradient.test.mjs` e este roadmap.
- Mudanças locais anteriores na transformação de grupos continuam preservadas.
- Riscos restantes: preview/commit, pointer capture, desempenho real, undo/redo e ciclo de URLs ainda precisam do teste manual conjunto em Windows e Linux; a Fase 1 não está `CONCLUÍDO`.
- Estado da Fase 1: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`.
- Próximo passo exato: iniciar a Fase 2 habilitando o cálculo radial no núcleo compartilhado, conforme autorização do mantenedor para continuar antes do teste de fogo.

### 2026-08-24 — Degradê radial integrado ao pipeline compartilhado

- `GradientType` passou a aceitar `radial`; o progresso radial usa a distância do
  pixel ao ponto inicial dividida pelo raio definido pelo arraste, limitado a `[0, 1]`.
- O raster compartilhado escolhe o cálculo linear ou radial pela configuração, sem
  duplicar expansão, máscaras de seleção, processamento em lotes, worker ou fallback.
- O seletor `Linear | Radial` foi habilitado na barra contextual e o modo permanece
  apenas em memória, conforme o escopo aprovado.
- A prévia usa `CanvasGradient` radial com o ponto inicial como centro e a linha de
  controle existente como indicação do raio. Um raio transitório zero é protegido na
  prévia e continua sendo descartado como no-op ao encerrar o gesto.
- Trocar Linear/Radial durante um arraste cancela a interação e remove a prévia antiga.
- Inversão, seleções, transformações, histórico, cancelamento e ciclo de assets continuam
  no mesmo fluxo já implementado pelo linear.
- Adicionados testes para centro, metade do raio, borda, exterior, raio degenerado e
  simetria circular horizontal/vertical. O conjunto de degradê passou de 15 para 17 testes.
- Validações executadas: 226 testes frontend, `vue-tsc --noEmit`, build Vite, testes Go,
  build Wails Windows/amd64 e `git diff --check`.
- Arquivos alterados: `App.vue`, `CanvasViewport.vue`, `CanvasContextBar.vue`,
  `canvas.types.ts`, `useGradientInteraction.ts`, `gradient.ts`, `gradientRaster.ts`,
  `gradient.test.mjs` e este roadmap.
- Estado da Fase 2: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` manual no Windows e Linux.
- Próximo passo exato: iniciar a Fase 3 pela auditoria da implementação existente da
  Varinha Mágica, sem reescrever o motor antes de mapear lacunas e decisões de produto.

### 2026-08-24 — Auditoria técnica da Varinha e início do Balde

- A implementação existente da Varinha foi auditada como base do motor compartilhado.
  Ela analisa somente a camada ativa e converte o clique do documento para o raster
  usando as matrizes existentes, inclusive para escala e rotação.
- A tolerância atual é aplicada independentemente aos canais RGBA, limitada a 0–255.
  Pixels com alfa zero são equivalentes mesmo quando carregam RGB oculto diferente.
- O modo contíguo usa vizinhança ortogonal de quatro pixels; o modo global percorre
  todo o raster e reúne todas as regiões equivalentes em spans ordenados.
- O padrão existente `contiguous = true`, tolerância 32 e amostragem da camada ativa
  foi preservado para o MVP; decisões de combinação de seleção permanecem na auditoria.
- Extraído `frontend/src/editor/colorRegion.ts`, contrato neutro que recebe pixels,
  dimensões, ponto, tolerância e modo, retornando spans, bounds e contagem de pixels.
- `magicWandSpans` permanece como wrapper compatível, enquanto worker e fallback da
  Varinha já consomem diretamente o núcleo neutro.
- Iniciada a Fase 4 com `frontend/src/editor/paintBucket.ts`: o núcleo aplica cor opaca
  aos spans encontrados, intersecta a região com a seleção existente no espaço do
  documento, não modifica a seleção e reconhece preenchimento idêntico como no-op.
- Criados `colorRegion.test.mjs` e `paintBucket.test.mjs`, cobrindo equivalência com a
  Varinha, contíguo/global, transparência, preenchimento, seleção e no-op.
- Validação deste incremento: 30 testes direcionados e `vue-tsc --noEmit` aprovados.
- Próximo passo exato: criar worker/serviço do Balde com cancelamento e codificação do
  asset; depois conectar clique esquerdo/direito, UI, `MutationBarrier` e histórico.

### 2026-08-24 — Balde de Tinta integrado de ponta a ponta

- Adicionado `paint-bucket` a `EditorTool`, botão próprio adjacente ao Degradê e atalho
  `Shift+G`; `G` continua selecionando o Degradê sem alternância invisível.
- Clique esquerdo usa a cor principal e clique direito usa a secundária. O menu de
  contexto é bloqueado no canvas durante a interação.
- A barra contextual reutiliza tolerância e modo contíguo/global da Varinha, deixando
  explícita a semântica dos dois botões do mouse.
- Criados `paintBucketEngine.ts` e `paintBucket.worker.ts`. O worker lê a fonte original,
  executa o motor compartilhado, intersecta a seleção, codifica PNG e gera preview WebP.
- Abort interrompe a operação descartando o worker ativo; fallback mantém o mesmo núcleo
  de pixels e verifica o sinal antes/depois do processamento.
- Camadas raster vazias passam pelo mesmo preparo do Pincel/Degradê. Texto e conteúdo
  inteligente continuam sujeitos ao fluxo de rasterização já existente.
- O commit usa `MutationBarrier`, publica asset e transform juntos, cria uma única etapa
  `Balde de Tinta`, preserva a seleção e restaura tudo em erro ou cancelamento.
- Preenchimento que não altera nenhum pixel não cria histórico nem novo object URL.
- Validações: 232 testes frontend, `vue-tsc --noEmit`, build Vite com worker dedicado,
  testes Go, build Wails Windows/amd64 e `git diff --check`.
- Estado da Fase 4: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` manual no Windows e Linux.
- Próximo passo exato: teste prático com regiões contíguas/globais, transparência,
  seleções, camadas transformadas, botões esquerdo/direito e undo/redo.

### 2026-08-23 — Roadmap criado

- Documentada a sequência Degradê linear, Degradê radial, auditoria da Varinha e Balde.
- Registrada a discrepância entre a decisão de produto e a implementação experimental da Varinha presente no repositório.
- Mapeados contratos de interação, raster, worker, seleção, histórico e assets.
- Definidos critérios de aceite, testes mínimos e protocolo obrigatório de atualização.
- Próximo passo: iniciar a Fase 1 pelo módulo puro `frontend/src/editor/gradient.ts` e seus testes, sem integrar UI antes de validar geometria e interpolação.

### 2026-08-24 — Auditoria pós-implementação: correções funcionais

- Corrigida a divergência entre prévia e commit do Degradê quando uma seleção ultrapassa
  o raster compacto da camada. O resultado agora expande o raster até a interseção da
  seleção com o documento, em vez de limitar a pintura aos pixels preexistentes.
- A expansão com seleção permanece limitada aos seus limites visíveis, evitando alocar
  desnecessariamente um raster do tamanho completo do documento.
- O Balde de Tinta agora rejeita camadas invisíveis tanto no tratamento do ponteiro
  quanto na barreira defensiva do commit, mantendo consistência com Pincel e Degradê.
- Adicionado teste de regressão para seleção parcialmente fora do documento sobre uma
  camada compacta, incluindo geometria, pixels gerados e transformação resultante.
- Próximo passo exato: validar estas correções e iniciar as otimizações de no-op, cópias
  de raster, representação de spans e cálculo do Degradê radial.

### 2026-08-24 — Otimização do no-op do Balde

- O núcleo do Balde passou a copiar o raster somente ao encontrar o primeiro pixel que
  realmente mudará, eliminando a cópia redundante e qualquer alocação de saída no no-op.
- Worker e fallback agora retornam imediatamente quando nada muda, sem recompor canvas,
  codificar PNG ou gerar preview WebP.
- A geração de preview do Balde passou a solicitar interpolação de alta qualidade.
- O contrato do serviço admite resultado sem blob apenas no no-op; o commit valida
  defensivamente a presença da imagem para todo preenchimento efetivo.
- Adicionada asserção de regressão garantindo que um no-op não produza raster de saída.
- Próximo passo exato: validar o conjunto completo e então otimizar a representação de
  regiões fragmentadas antes de mexer no laço matemático do Degradê radial.

### 2026-08-24 — Otimização de regiões fragmentadas e Degradê radial

- O motor de regiões recebeu `visitColorRegionSpans`, uma varredura incremental que
  entrega cada segmento por callback e calcula bounds/contagens sem criar objetos.
- A Varinha preserva `PixelSpan[]`, necessário para seleção, contorno e histórico. O
  Balde passou a pintar diretamente durante a varredura e não materializa os segmentos.
- Em padrão xadrez Full HD global, o fluxo anterior gastava cerca de 409 ms apenas para
  criar 1.036.800 spans e usava aproximadamente 160,8 MB de RSS. O novo fluxo completo
  de localizar e pintar os mesmos pixels mediu cerca de 106 ms, 72,4 MB de RSS e 8,8 MB
  de heap no benchmark local.
- O laço do raster do Degradê passou a incrementar coordenadas do documento diretamente,
  pré-calcular deltas/divisores/canais e evitar pontos e matrizes temporárias por pixel.
- O cálculo radial interno usa raiz quadrada sobre a distância ao quadrado e raio
  pré-calculado, preservando os arredondamentos e os pixels esperados pelos testes.
- No benchmark local 4K, o Degradê radial caiu de aproximadamente 1.634 ms para 291 ms,
  redução próxima de 82% no tempo do núcleo.
- Adicionado teste do caminho incremental do Balde em região global fragmentada.
- Validações: 234 testes frontend e build TypeScript/Vite aprovados.
- Risco remanescente: seleções extremamente fragmentadas da Varinha ainda precisam
  materializar spans por fazerem parte do modelo editável; isso exige uma evolução
  específica do formato de seleção, não necessária para o Balde.
- Próximo passo exato: revisar cancelamento/fallback e cobertura integrada das duas
  ferramentas antes da validação manual.

### 2026-08-24 — Fallback cooperativo e isolamento do botão direito

- A varredura compartilhada passou a expor um iterador retomável de spans. Worker e
  APIs síncronas continuam consumindo-o sem pausas adicionais.
- O fallback do Balde agora processa lotes de spans, devolve periodicamente o controle
  ao navegador e verifica cancelamento antes e depois de cada pausa.
- Adicionado teste que dispara cancelamento durante uma pausa cooperativa e exige
  rejeição `AbortError`, comprovando que a interface pode interromper o fallback.
- O menu de contexto do canvas agora é bloqueado somente quando o Balde está ativo;
  nas demais ferramentas, o botão direito volta ao comportamento normal da plataforma.
- Próximo passo exato: executar a validação completa final e revisar as decisões de UX
  ainda abertas (agrupamento visual e preferências compartilhadas) com o mantenedor.

### 2026-08-24 — UX alinhada ao agrupamento do Photoshop

- Conforme decisão do mantenedor, Degradê e Balde passaram a ocupar um único grupo
  visual `G` na barra de ferramentas, seguindo o padrão documentado pelo Photoshop.
- O botão principal mostra e reativa a última ferramenta usada no grupo; o acionador
  secundário abre uma lista explícita com Degradê e Balde e seus respectivos atalhos.
- `G` continua selecionando Degradê e `Shift+G` continua selecionando Balde, além de
  atualizar qual ícone permanece visível como o último utilizado no grupo.
- Varinha e Balde agora possuem estados independentes de tolerância e modo contíguo.
  Ambos mantêm os mesmos padrões iniciais (`32` e contíguo ativo), sem sincronização
  silenciosa depois que o usuário ajusta uma das ferramentas.
- A separação foi propagada por `App`, viewport, contrato de props/eventos e barra
  contextual; o commit do Balde consome exclusivamente suas próprias preferências.
- Validações: 235 testes frontend e build TypeScript/Vite aprovados.
- Próximo passo exato: validar manualmente abertura/fechamento e posicionamento do flyout
  no Windows, além da alternância por mouse, `G` e `Shift+G`.

### 2026-08-24 — Seleções fragmentadas compactadas

- A Varinha mantém arrays de objetos para seleções comuns e migra automaticamente para
  `Int32Array` acima de 20 mil spans, armazenando cada segmento como três inteiros.
- O formato compacto continua pixel-exato e foi propagado para clonagem, máscaras de
  canvas, Pincel, Degradê, Balde, hit-test e desenho da seleção.
- Consultas de ponto em seleções compactas e ordenadas usam busca binária, evitando uma
  varredura de milhões de spans para cada pixel consultado.
- Para impedir strings SVG gigantes, o overlay acima de 20 mil spans representa apenas
  os limites da seleção; operações raster continuam usando a máscara pixel-exata.
- O worker da Varinha transfere o buffer compacto ao processo principal sem cloná-lo.
- Benchmark xadrez Full HD com 1.036.800 spans: 11,9 MB de dados compactos, cerca de
  189 ms, 90 MB de RSS e 10,2 MB de heap; antes eram cerca de 409 ms e 160,8 MB de RSS.
- Benchmark xadrez 4K com 4.147.200 spans: concluído em cerca de 684 ms, usando 47,5 MB
  para a seleção compacta, sem o risco anterior de milhões de objetos no heap.
- Adicionado teste que força e valida a transição automática para o formato compacto.
- Validações: 236 testes frontend e build TypeScript/Vite aprovados antes da otimização
  final de transferência do worker; a checagem completa será repetida em seguida.
- Próximo passo exato: executar validação completa e incluir o caso fragmentado no teste
  manual da Varinha, observando que o contorno visual será simplificado nesses extremos.

### 2026-08-25 — Correção do envio do Degradê ao worker e ajustes visuais

- Corrigido o erro `Object could not be cloned` ao confirmar um Degradê: geometria,
  configuração, transformação e seleção agora são convertidas em snapshots planos antes
  de atravessar a fronteira de `postMessage`, sem proxies reativos do Vue.
- O mesmo snapshot é usado pelo fallback, mantendo worker e processamento cooperativo
  com entradas equivalentes e independentes do estado vivo da interface.
- Os novos PNGs de Mover e Degradê receberam contraste claro pela apresentação da
  toolbar, preservando integralmente os pixels e o canal alfa fornecidos. O contraste
  claro também permanece no estado ativo, acompanhando os demais ícones do tema.
- O SVG do Balde passou a declarar seu traço claro diretamente, pois `currentColor` não
  herda a cor do botão quando o arquivo SVG é consumido externamente por uma tag `img`.
- O alerta global passou para `z-index: 10000`, acima de toolbar, réguas, painéis,
  flyouts e janelas do editor, evitando que a mensagem seja parcialmente encoberta.
- Validação automatizada: 259 testes frontend, TypeScript, build Vite e
  `git diff --check` aprovados. Validação manual do gesto real no Wails permanece pendente.

### 2026-08-25 — Comando Preencher com cor

- Adicionado ao menu Editar um preenchimento integral com a cor principal ou secundária,
  separado do Balde de Tinta para preservar a semântica equivalente à do Photoshop.
- `Alt+Backspace` usa a cor principal e `Ctrl+Backspace` usa a secundária. Os comandos
  também aparecem por extenso no menu para usuários que não conhecem os atalhos.
- Com seleção, todos os pixels da máscara são preenchidos sem consultar cor, tolerância
  ou contiguidade; sem seleção, todo o raster da camada ativa é preenchido.
- O processamento reutiliza worker, geração de preview, cancelamento, URLs e histórico
  atômico do Balde. Pixels que já possuem a cor final são tratados como no-op.
- Adicionados testes puros para conteúdo heterogêneo, transparência e máscara retangular.
- Validação automatizada: 261 testes frontend, TypeScript, build Vite e
  `git diff --check` aprovados; validação manual no Wails permanece pendente.

### 2026-08-25 — Transição visual contínua ao confirmar o Degradê

- A prévia do Degradê deixou de ser removida imediatamente quando o processamento
  termina. Ela permanece até o Vue publicar a nova URL da camada e o navegador alcançar
  o próximo frame, evitando mostrar o raster anterior por um instante no `pointerup`.
- A proteção verifica se a interação ainda é a mesma e se nenhuma nova operação ficou
  ocupada antes de limpar a prévia, impedindo que uma finalização antiga afete outro gesto.
- A primeira tentativa aguardava apenas um frame, mas a validação manual mostrou que o
  buffer duplo de `CanvasLayer` prepara a textura por dois frames. A prévia agora é
  removida pelo evento real de ativação do novo buffer; um timeout de segurança cobre
  somente falhas e commits sem troca de imagem.

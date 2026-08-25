# Roadmap das seleções Marquee, de Objeto, Rápida e Varinha

> Documento vivo de implementação do Axia. Este arquivo deve ser atualizado na
> mesma alteração de código sempre que uma etapa avançar, mudar de escopo,
> encontrar um bloqueio ou for concluída.

## Metadados

- Criado em: 2026-08-24
- Última atualização: 2026-08-24
- Estado geral: Fases 0 e 1 implementadas, aguardando validação; Fase 2 é o próximo incremento
- Grupo Marquee: Retangular, Elíptica, Linha única e Coluna única
- Grupo inteligente: Seleção de Objeto, Seleção Rápida e Varinha Mágica no slot `W`
- Ordem inicial: infraestrutura comum -> grupo Marquee -> grupo `W` e Varinha -> Seleção Rápida -> Seleção de Objeto -> homologação
- Plataformas obrigatórias: Windows e Linux
- Stack atual: Go 1.23, Wails 2.12, Vue 3, TypeScript e Vite

## Objetivo

Evoluir o sistema único de seleção do Axia por duas frentes complementares:

1. Alinhar a seleção de área ao grupo Marquee do Photoshop: Retangular, Elíptica,
   Linha única e Coluna única. O Laço livre continua existindo, mas não é um Marquee.
2. Criar um grupo de três ferramentas baseadas em pixels que ocupe um único lugar
   na barra lateral e permita alternância explícita, seguindo a ergonomia de grupos
   de ferramentas do Photoshop:

   - **Seleção de Objeto**: o usuário delimita aproximadamente um objeto com Retângulo
     ou Laço e o motor encontra seus pixels dentro da região indicada.
   - **Varinha Mágica**: seleciona pixels semelhantes à amostra clicada.
   - **Seleção Rápida**: o usuário pinta sementes e a seleção cresce até bordas
     visuais detectadas na imagem.

Todas as formas e ferramentas alimentam o mesmo `SelectionRegion` já consumido pelo
editor. Elas devem compartilhar combinação de seleção, representação de máscara,
cancelamento e feedback visual. Criar ou ajustar uma seleção não modifica pixels da
imagem, não cria dirty state e não entra no histórico raster.

## Ferramentas Marquee aprovadas

- **Seleção Retangular**: comportamento atual; `Shift` produz um quadrado.
- **Seleção Elíptica**: comportamento atual; `Shift` produz um círculo.
- **Seleção de Linha única**: seleciona uma linha horizontal de exatamente um pixel.
- **Seleção de Coluna única**: seleciona uma coluna vertical de exatamente um pixel.

Quadrado e Círculo não viram tipos duplicados: são restrições de Retângulo e Elipse.
Triângulo, Polígono e Estrela pertencem às ferramentas de forma do Photoshop e ficam
fora deste roadmap de seleção.

## Interpretação corrigida da terceira ferramenta

Neste roadmap, “a ferramenta que seleciona com um risco de forma livre” significa
**Seleção de Objeto em modo Laço**.

- O **Laço livre** desenha o contorno fechado e usa exatamente a área delimitada.
- A **Seleção de Objeto em modo Laço** recebe um contorno aproximado e usa análise de
  imagem para encontrar o objeto dentro dele.
- A **Seleção Rápida** também recebe traços, mas os usa como sementes para encontrar
  limites visuais enquanto o usuário pinta sobre o objeto.
- O **Pincel de Seleção** do Photoshop é outra ferramenta, localizada no grupo do
  Laço, e não faz parte deste roadmap.

Se o mantenedor mudar essa interpretação, registrar a nova decisão antes de alterar
tipos ou interface. Não substituir silenciosamente Seleção de Objeto por Laço comum
ou Pincel de Seleção.

## Referência de produto

A referência de interação é a documentação oficial do Adobe Photoshop:

- Marquee: Retangular, Elíptica, Linha única e Coluna única.
- Seleção de Objeto: detecção dentro de Retângulo ou Laço aproximado.
- Varinha Mágica: tolerância, contíguo, adicionar, subtrair e intersectar.
- Seleção Rápida: pincel ajustável que cresce e acompanha bordas.

Referências consultadas em 2026-08-24:

- <https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/select-areas-by-color-with-the-magic-wand-tool.html>
- <https://helpx.adobe.com/africa/photoshop/web/edit-images/make-selections/automate-selections-with-quick-selection-tool.html>
- <https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html>
- <https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html>
- <https://helpx.adobe.com/sg/photoshop/using/making-quick-selections.html>

Essas páginas definem expectativa de UX, não licença para copiar assets, código,
nomes internos ou algoritmos proprietários.

Igualdade com o Photoshop significa preservar a separação entre Marquee, Laço e o
grupo inteligente `W`. Este roadmap não adiciona formas vetoriais ao seletor de área.

## Protocolo obrigatório para qualquer IA ou pessoa

Antes de alterar código relacionado a este roadmap:

1. Ler este arquivo por completo.
2. Ler `roadmap-ferramentas-cor-preenchimento.md`, especialmente a auditoria da
   Varinha e o contrato de regiões compartilhado com o Balde.
3. Conferir `git status --short` e preservar mudanças existentes.
4. Inspecionar novamente os arquivos citados na fase em execução. Os caminhos deste
   documento são guias e podem ter mudado.
5. Marcar a fase como `EM ANDAMENTO` antes ou junto da primeira alteração material.
6. Implementar em incrementos testáveis, sem misturar refatorações não relacionadas.
7. Atualizar testes na mesma alteração que muda comportamento.
8. Executar as verificações da seção **Validação obrigatória**.
9. Atualizar antes de encerrar: estado, arquivos realmente alterados, decisões,
   medições, riscos restantes e próximo passo exato.
10. Adicionar uma entrada datada em **Registro de evolução**.

Não marcar uma fase como concluída apenas porque compila. `CONCLUÍDO` exige critérios
de aceite, testes automatizados e validação manual no Wails em Windows e Linux.
Enquanto faltar uma plataforma, usar `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`.

Estados permitidos:

- `NÃO INICIADO`
- `EM ANDAMENTO`
- `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`
- `BLOQUEADO`
- `CONCLUÍDO`

Ao mudar uma decisão registrada, não apagar a decisão anterior. Acrescentar a nova
decisão ao registro e explicar o motivo.

## Estado atual

| Entrega | Estado | Próximo passo verificável |
| --- | --- | --- |
| Contrato e UX do grupo `W` | `EM ANDAMENTO` | Conectar os identificadores já criados ao slot visual na Fase 2 |
| Operações de máscara compartilhadas | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Integrar às ferramentas conforme cada fase avançar |
| Grupo Marquee fiel ao Photoshop | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar manualmente no Wails em Windows e Linux |
| Varinha Mágica no grupo `W` | `NÃO INICIADO` | Migrar a implementação existente sem reescrever o motor |
| Seleção Rápida | `NÃO INICIADO` | Executar spike comparativo do algoritmo de bordas |
| Seleção de Objeto | `NÃO INICIADO` | Avaliar segmentação por ROI Retângulo/Laço e dependência apropriada |
| Integração e homologação | `NÃO INICIADO` | Iniciar depois das três ferramentas estarem integradas |

## Baseline confirmado em 2026-08-24

### Comportamento existente que deve ser preservado

- `EditorTool` ainda não possui ferramentas de seleção dedicadas. Retângulo,
  elipse, laço e Varinha são modos da ferramenta `crop`.
- `SelectionMode` contém `rectangle`, `ellipse`, `lasso` e `magic-wand`.
- Retângulo e Elipse já compartilham bounds de arraste; `Shift` produz Quadrado ou
  Círculo. O Laço já representa um path fechado por pontos.
- A Varinha já possui tolerância de 0 a 255, opção contígua/global, worker, fallback,
  proteção por geração e suporte a camadas transformadas.
- `colorRegion.ts` é o núcleo neutro compartilhado pela Varinha e pelo Balde.
- Regiões globais muito fragmentadas usam `PackedPixelSpans` acima de 20 mil spans.
- `SelectionRegion` aceita retângulo, elipse, laço e seleção por pixels.
- Seleções por pixels carregam a matriz `sourceToDocument`, permitindo seleção em
  rasters compactos, escalados ou rotacionados.
- `SelectionOverlay.vue` desenha marching ants e simplifica somente a visualização de
  seleções extremamente fragmentadas; a máscara raster continua pixel-exata.
- O Laço livre já usa pointer capture, simplificação de pontos e preview transitório.
- Pincel, Degradê e Balde já respeitam seleções vetoriais ou por pixels.
- `Ctrl+D` limpa a seleção; `Delete` apaga os pixels selecionados.
- O grupo `G` de Degradê/Balde é a referência local para botão principal, última
  ferramenta usada, flyout e estilos da barra.

### Lacunas atuais

- A Varinha está escondida dentro do seletor de modo de `crop`, sem ferramenta ou
  ícone próprios na barra lateral.
- Ainda não existem operações gerais de substituir, adicionar, subtrair e
  intersectar seleções heterogêneas.
- Ainda não existem os modos de Linha única e Coluna única.
- A proteção por `selectionGeneration` impede publicação obsoleta, mas o trabalho da
  Varinha não é necessariamente interrompido assim que perde relevância.
- O modelo atual representa máscara binária; não há alfa parcial para feather,
  dureza ou opacidade de seleção.
- Não existe análise incremental guiada por traço e bordas para Seleção Rápida.
- Não existe segmentação de objeto a partir de uma região Retangular ou por Laço.
- Não há fixtures específicas de bordas, cabelos, transparência e baixo contraste.

## Decisões de produto e UX

### Grupo Marquee

- Criar um slot próprio `M` com Retangular, Elíptica, Linha única e Coluna única.
- O botão principal mostra e ativa a última ferramenta Marquee utilizada.
- `M` ativa a ferramenta lembrada; `Shift+M` percorre a ordem aprovada.
- Retangular e Elíptica preservam o gesto atual de canto a canto.
- Linha única seleciona toda a largura do documento na linha clicada.
- Coluna única seleciona toda a altura do documento na coluna clicada.
- Linha/Coluna são seleções de exatamente um pixel do documento, independentemente
  de zoom ou densidade da tela.
- O Laço atual não entra neste grupo. Sua reorganização com Laço Poligonal, Magnético
  e Pincel de Seleção pertence a outro roadmap.

### Grupo único na toolbar

- Criar um único slot visual contendo `object-selection`, `quick-selection` e
  `magic-wand`.
- O slot deve ficar próximo da ferramenta de seleção de área existente.
- O botão principal mostra o ícone da última ferramenta utilizada no grupo.
- Clicar no botão principal ativa a ferramenta lembrada.
- O acionador secundário abre um flyout explícito com ícone, nome e atalho das três.
- O flyout fecha ao selecionar, clicar fora, pressionar `Esc`, trocar documento ou
  entrar em edição de conteúdo inteligente.
- Não criar três botões permanentes nem colocar o flyout dentro de outro card.
- Reutilizar o padrão visual e de acessibilidade do grupo `G`, extraindo um componente
  genérico somente se isso reduzir duplicação real sem alterar seu comportamento.

### Atalhos

- `W` ativa a última ferramenta usada no grupo.
- Quando nenhuma preferência existe, `W` começa pela Seleção de Objeto.
- `Shift+W` percorre Seleção de Objeto -> Seleção Rápida -> Varinha -> Seleção de Objeto.
- A troca deve atualizar imediatamente ícone, `aria-pressed`, cursor e barra contextual.
- Não executar atalhos quando o foco estiver em `input`, `select`, `textarea` ou
  conteúdo editável, nem quando um modal bloquear o editor.
- Não persistir a última ferramenta no formato `.axia`; memória da sessão é suficiente.

### Combinação de seleção

Todas as três ferramentas devem expor o mesmo controle de quatro modos:

1. `replace`: substitui a seleção anterior.
2. `add`: adiciona pixels à seleção anterior.
3. `subtract`: remove pixels da seleção anterior.
4. `intersect`: mantém somente a interseção.

Regras de modificadores:

- `Shift` força `add` somente durante o gesto.
- `Alt` força `subtract` somente durante o gesto.
- `Shift+Alt` força `intersect` somente durante o gesto.
- Sem modificador, usar o modo escolhido na barra contextual.
- Capturar o modo efetivo no `pointerdown`; soltar a tecla durante o processamento não
  pode mudar o resultado da operação já iniciada.
- Se não houver seleção anterior, `add` equivale a `replace`; `subtract` e `intersect`
  resultam em seleção vazia sem erro.
- Operação vazia deve ser no-op e não produzir mensagens enganosas.

### Feedback visual

- Varinha mostra estado ocupado durante análise e publica marching ants ao concluir.
- Seleção Rápida mostra máscara transitória enquanto processa o traço.
- Seleção de Objeto mostra o Retângulo ou Laço aproximado e depois a máscara detectada.
- O overlay transitório nunca entra na exportação nem altera pixels da camada.
- Ao confirmar, a seleção volta ao overlay padrão de marching ants.
- Cursor da Seleção Rápida mostra tamanho e sinal de adicionar/remover.
- `Esc` durante um gesto cancela somente o draft atual e preserva a seleção confirmada.
- `Ctrl+D` continua limpando toda a seleção.

## Regras técnicas globais

1. Interação e seleção final são expressas em coordenadas do documento.
2. Amostragem de pixels da camada usa as matrizes existentes de `selection.ts`; não
   duplicar fórmulas para rotação, escala ou raster compacto.
3. As três ferramentas produzem `SelectionRegion`; consumidores existentes não devem
   conhecer qual ferramenta criou a máscara.
4. Marquees e Laço produzem seleções vetoriais; Varinha, Seleção Rápida e Seleção de
   Objeto produzem seleções por pixels. Todos terminam no mesmo `SelectionRegion`.
5. A combinação deve aceitar qualquer par de seleções atuais: vetorial/vetorial,
   vetorial/pixels e pixels/pixels, inclusive com matrizes diferentes.
6. Converter para máscara apenas nos bounds necessários. Não alocar automaticamente
   dois buffers do tamanho integral de um documento de 64 megapixels.
7. O resultado combinado deve ser determinístico, ordenado e compatível com
   `PixelSpan[]` e `PackedPixelSpans`.
8. Preservar o limiar de compactação existente, salvo benchmark e decisão registrados.
9. Seleções não alteram `ImageAsset`, `LayerTransform`, histórico ou dirty state.
10. Workers recebem dados transferíveis quando possível; evitar clones integrais
   repetidos de RGBA e spans compactos.
11. Worker e fallback devem compartilhar o mesmo núcleo puro e produzir o mesmo resultado.
12. Fallbacks demorados processam lotes, cedem controle ao navegador e verificam abort.
13. Cada solicitação assíncrona deve aceitar cancelamento real, além de ignorar resposta
    obsoleta por geração.
14. Trocar ferramenta, camada ou documento cancela tarefas e drafts pendentes.
15. Erros não apagam a seleção confirmada anterior e são apresentados em português.
16. Preview deve ser limitado a um frame por `requestAnimationFrame`.
17. Pointer capture deve manter o gesto ao sair do documento.
18. `pointerup` confirma; `pointercancel` e `lostpointercapture` cancelam o draft.
19. Não depender de APIs exclusivas do Chromium sem fallback validado na WebView Linux.
20. Não adicionar biblioteca, WASM ou modelo sem medir tamanho, memória, licença,
    compatibilidade com worker e qualidade sobre fixtures versionadas.
21. Não prometer equivalência algorítmica com o Photoshop; critérios devem ser objetivos
    e reproduzíveis no Axia.

## Arquitetura recomendada

### Arquivos existentes a revisar

| Área | Arquivos | Responsabilidade |
| --- | --- | --- |
| Estado principal | `frontend/src/App.vue` | Ferramenta ativa, seleção confirmada, tarefas e mensagens |
| Tipos | `frontend/src/types/editor.ts` | Novos valores de `EditorTool` |
| Modelo de seleção | `frontend/src/editor/selection.ts` | Regiões, matrizes, spans, paths e máscaras |
| Regiões por cor | `frontend/src/editor/colorRegion.ts` | Núcleo da Varinha, preservado para o Balde |
| Serviço | `frontend/src/services/selectionEngine.ts` | Worker/fallback da Varinha e operações raster de seleção |
| Worker | `frontend/src/workers/magicWand.worker.ts` | Análise de cor fora da UI |
| Toolbar | `frontend/src/components/ToolBar.vue` | Grupo visual `W` e ferramenta lembrada |
| Barra contextual | `frontend/src/components/canvas/CanvasContextBar.vue` | Combinação e opções específicas |
| Viewport | `frontend/src/components/CanvasViewport.vue` | Precedência de ponteiro e coordenação das interações |
| Contratos | `frontend/src/components/canvas/canvas.types.ts` | Props, emits, estados e sessões |
| Interação existente | `frontend/src/components/canvas/composables/useSelectionInteraction.ts` | Retângulo, elipse e laço |
| Superfície | `frontend/src/components/canvas/CanvasSurface.vue` | Overlay confirmado e canvas transitório |
| Overlay | `frontend/src/components/SelectionOverlay.vue` | Marching ants de seleções vetoriais e pixels |
| Atalhos | `frontend/src/components/canvas/composables/useCanvasShortcuts.ts` | Cancelamento e modificadores no canvas |
| Estilos | `frontend/src/style.css` | Slot, flyout, cursores e máscara de preview |

### Novos módulos recomendados

- `frontend/src/editor/selectionCombine.ts`
  - `SelectionCombineMode`;
  - normalização das regiões para spans nos bounds mínimos;
  - união, subtração e interseção;
  - compactação e cálculo de bounds/pixelCount;
  - nenhuma dependência de Vue, DOM, Worker ou object URL.
- `frontend/src/editor/marqueeSelection.ts`
  - criação de Linha única e Coluna única em pixels do documento;
  - normalização de clique, bounds e no-op;
  - nenhuma dependência de Vue ou DOM.
- `frontend/src/editor/quickSelection.ts`
  - contratos de sementes positivas/negativas;
  - cálculo ou consumo do mapa de bordas;
  - crescimento determinístico limitado pela região de interesse;
  - nenhuma dependência de Vue.
- `frontend/src/components/canvas/composables/useSelectionBrushInteraction.ts`
  - sessão, pointer capture, coalescência, preview e confirmação do Pincel.
- `frontend/src/components/canvas/composables/useQuickSelectionInteraction.ts`
  - traços de sementes, debounce de análise, preview progressivo e cancelamento.
- `frontend/src/services/quickSelectionEngine.ts`
  - carregamento da fonte original, transformação, worker/fallback, abort e geração.
- `frontend/src/workers/quickSelection.worker.ts`
  - análise de bordas e região fora da thread principal.
- `frontend/src/editor/objectSelection.ts`
  - contratos de ROI Retângulo/Laço e máscara segmentada;
  - normalização e validação da saída do segmentador.
- `frontend/src/components/canvas/composables/useObjectSelectionInteraction.ts`
  - criação do ROI, preview, pointer capture, confirmação e cancelamento.
- `frontend/src/services/objectSelectionEngine.ts`
  - carregamento da composição/amostra, runtime de segmentação, abort e geração.
- `frontend/src/workers/objectSelection.worker.ts`
  - pré-processamento, inferência/segmentação e pós-processamento fora da UI.
- `frontend/src/assets/icons/object-selection.svg`
- `frontend/src/assets/icons/magic-wand.svg`
- `frontend/src/assets/icons/quick-selection.svg`
- `frontend/tests/selectionCombine.test.mjs`
- `frontend/tests/marqueeSelection.test.mjs`
- `frontend/tests/quickSelection.test.mjs`
- `frontend/tests/objectSelection.test.mjs`

Os nomes são recomendados. Se a arquitetura atual indicar uma divisão melhor,
registrar a mudança neste documento antes de criar nomes diferentes.

## Fase 0 — Contrato comum e migração do modelo

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

### Objetivo

Preparar o modelo para que ferramentas diferentes criem e combinem máscaras sem
duplicar lógica ou depender do estado Vue.

### Entregas

- Adicionar `object-selection`, `quick-selection` e `magic-wand` a `EditorTool`.
- Separar modos geométricos dos identificadores de ferramenta. A Varinha deixa de ser
  uma opção do dropdown de `crop` quando sua ferramenta dedicada estiver funcional.
- Introduzir `SelectionCombineMode` e resolver modificadores em uma função pura.
- Definir representação explícita para máscaras em espaço do documento sem usar um
  `layerId` enganoso. Preservar leitura de seleções de camada já existentes.
- Implementar operações booleanas por linhas/spans sobre bounds recortados.
- Garantir clonagem e transferência de spans compactos.
- Adicionar testes antes de conectar qualquer nova UI.

### Critérios de aceite

- [x] Todos os pares de tipos de seleção podem ser combinados.
- [x] Matrizes diferentes produzem resultado correto em espaço do documento.
- [x] União, subtração e interseção são determinísticas.
- [x] Resultado vazio é normalizado para `null` na borda do estado Vue.
- [x] Documento grande usa memória proporcional aos bounds processados.
- [x] Consumidores atuais continuam aceitando a seleção resultante.

## Fase 1 — Grupo Marquee

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

### Objetivo

Alinhar a seleção de área com o grupo Marquee do Photoshop, reutilizando integralmente
o sistema de `SelectionRegion` existente.

### Entregas

- Criar o grupo visual `M` com Retangular, Elíptica, Linha única e Coluna única.
- Preservar Retângulo e Elipse/Círculo existentes.
- Adicionar `single-row` e `single-column` aos modos Marquee.
- Linha única cria uma seleção por pixels de largura integral e altura 1.
- Coluna única cria uma seleção por pixels de largura 1 e altura integral.
- Converter a posição clicada com `Math.floor` e recortar ao documento.
- Reutilizar preview, cancelamento e overlay existentes quando aplicável.
- Aplicar os modos comuns de substituir, adicionar, subtrair e intersectar.
- Retirar o Laço do grupo Marquee visual sem remover sua funcionalidade.

### Testes mínimos

- Retangular e Elíptica não sofrem regressão nos quatro sentidos de arraste.
- `Shift` continua produzindo Quadrado e Círculo.
- Linha em `y = 0`, no centro e na última linha possui exatamente um pixel de altura.
- Coluna em `x = 0`, no centro e na última coluna possui exatamente um pixel de largura.
- Zoom e densidade não alteram a espessura em pixels do documento.
- Apagar, copiar, mover, Pincel, Degradê e Balde respeitam Linha/Coluna.
- Combinações com Marquee, Laço e seleção por pixels são exatas.

### Critérios de aceite

- [x] O slot `M` contém exatamente as quatro ferramentas Marquee.
- [x] Retangular, Elíptica e Laço não sofrem regressão funcional.
- [x] Linha e Coluna mantêm exatamente um pixel em qualquer zoom.
- [x] Marching ants e operações raster coincidem com a seleção.
- [ ] Windows e Linux validados manualmente.

## Fase 2 — Grupo `W` e Varinha Mágica

Estado: `NÃO INICIADO`

### Objetivo

Promover a Varinha existente para ferramenta dedicada e entregar o grupo visual que
receberá as outras duas ferramentas.

### Entregas

- Criar os três ícones seguindo `frontend/src/assets/icons/README.md`.
- Implementar slot único, ferramenta lembrada e flyout acessível.
- Entregar atalhos `W` e `Shift+W` com a ordem aprovada.
- Remover Varinha do dropdown geométrico somente depois do novo caminho estar ativo.
- Preservar tolerância 32, contíguo ativado e amostragem da camada ativa no primeiro MVP.
- Expor os quatro modos de combinação na barra contextual.
- Tornar o serviço cancelável. Ignorar resposta por geração continua como segunda defesa.
- Preservar `colorRegion.ts` e o comportamento do Balde.
- Não criar novo algoritmo de flood fill.

### Testes mínimos

- Clique em camada normal, compacta, escalada e rotacionada.
- Tolerância 0, 32, 255 e valores normalizados.
- Modos contíguo e global.
- Transparência total ignora RGB oculto conforme contrato existente.
- `replace`, `add`, `subtract` e `intersect` contra seleção vetorial e por pixels.
- Troca de camada, documento ou ferramenta cancela a tarefa.
- Worker e fallback retornam spans idênticos.
- Atalhos e ferramenta lembrada respeitam campos editáveis e modais.
- Balde mantém os mesmos resultados após a migração.

### Critérios de aceite

- [ ] Varinha aparece no grupo `W` e não permanece duplicada no dropdown antigo.
- [ ] Flyout funciona por mouse e teclado sem sobreposição.
- [ ] Seleção anterior é preservada em erro ou cancelamento.
- [ ] Combinações e modificadores funcionam.
- [ ] Balde não sofre regressão.
- [ ] Windows e Linux validados manualmente.

## Fase 3 — Seleção Rápida

Estado: `NÃO INICIADO`

### Definição funcional

O usuário pinta sobre a área desejada. O traço fornece sementes; o motor compara cor,
textura local e bordas para expandir a seleção até limites visuais. No modo subtrair,
o traço fornece sementes negativas e remove a região correspondente.

### Gate obrigatório de algoritmo

Antes da integração, criar fixtures e comparar pelo menos duas abordagens:

1. Crescimento de região guiado por cor e mapa de gradiente/bordas, implementado como
   núcleo determinístico sobre a infraestrutura atual.
2. Biblioteca estabelecida com segmentação por sementes, caso a primeira abordagem
   não atinja os critérios. Avaliar uma opção como GrabCut/OpenCV em worker, sem
   assumir sua adoção antes de medir.

Para qualquer dependência ou WASM, registrar:

- licença e redistribuição;
- tamanho adicionado ao instalador e ao carregamento;
- suporte offline;
- compatibilidade nas WebViews Windows e Linux;
- tempo, memória e cancelamento em 4K;
- qualidade contra as fixtures;
- manutenção e fallback quando o recurso não carregar.

Não criar um modelo de IA próprio. Se uma fase futura exigir segmentação neural,
usar runtime e modelo comprovados, licenciáveis e versionados, após autorização.

### Fixtures obrigatórias

- objeto opaco com borda de alto contraste;
- objeto e fundo com cores próximas;
- gradiente suave;
- borda com antialiasing e transparência;
- cabelo, folhas ou detalhes finos;
- ruído fotográfico;
- múltiplas regiões semelhantes separadas;
- camada compacta, escalada e rotacionada;
- imagem 4K e limite de megapixels suportado.

As fixtures devem possuir máscaras esperadas e métricas objetivas, como interseção
sobre união, pixels extras, pixels ausentes, tempo e pico de memória. Inspeção visual
continua necessária, mas não pode ser o único critério.

### Escopo inicial

- Amostrar somente a camada ativa no MVP.
- Ponta e tamanho compartilhados conceitualmente com o Pincel, mas opções mantidas
  separadas quando tiverem semântica diferente.
- Preview progressivo ou estado de processamento sem congelar a UI.
- Reaproveitar análise entre traços enquanto asset, transform e configuração forem iguais.
- Invalidar cache ao mudar asset, `editToken`, camada, transform ou documento.
- Suportar sementes positivas e negativas em múltiplos traços.
- Publicar somente resultados da geração mais recente.

### Testes mínimos

- Seleção cresce até borda forte sem atravessá-la.
- Adicionar segundo traço expande a seleção existente.
- Subtrair remove região indicada.
- Mesmo input produz a mesma máscara.
- Worker e fallback ficam dentro da tolerância de equivalência definida pelo algoritmo.
- Cancelamento interrompe processamento real e impede publicação.
- Transformações mapeiam sementes e seleção para os pixels visuais corretos.
- Reutilização de cache não mistura revisões ou camadas.
- Documento grande mantém a UI responsiva.

### Critérios de aceite

- [ ] Abordagem e métricas escolhidas estão registradas.
- [ ] Fixtures simples e fotográficas atingem os limites aprovados.
- [ ] Preview e seleção final permanecem alinhados.
- [ ] Adicionar e subtrair são previsíveis em vários traços.
- [ ] Falha do worker possui fallback ou mensagem recuperável.
- [ ] Windows e Linux validados manualmente.

## Fase 4 — Seleção de Objeto

Estado: `NÃO INICIADO`

### Definição funcional

A ferramenta identifica objetos ou regiões da imagem. O usuário pode apontar um
objeto destacado pelo localizador ou delimitar aproximadamente a região por:

- `rectangle`: arrastar uma caixa ao redor do objeto;
- `lasso`: riscar livremente um contorno aproximado ao redor do objeto.

O Retângulo/Laço desta ferramenta é apenas uma região de interesse para o motor de
segmentação. A seleção final deve aderir aos pixels do objeto, não conservar o
retângulo nem o contorno grosseiro.

### Gate obrigatório de tecnologia

Seleção de Objeto é segmentação de imagem, não uma variação de flood fill. Antes da
integração, avaliar runtime e modelo estabelecidos que funcionem offline e possam ser
redistribuídos legalmente. Não implementar uma rede neural ou um substituto chamado
“IA” do zero.

Registrar para cada candidato:

- origem, versão, licença do runtime e licença dos pesos;
- tamanho dos arquivos e impacto no instalador;
- CPU, memória e duração em imagens pequenas, Full HD e 4K;
- suporte a Windows e Linux sem GPU dedicada;
- uso opcional de aceleração quando disponível, com fallback de CPU;
- qualidade das máscaras nas fixtures versionadas;
- forma de carregar, manter em cache, cancelar e descarregar o modelo;
- comportamento quando o modelo estiver ausente ou corrompido.

Nenhuma dependência entra no projeto antes desse relatório e da aprovação explícita
do mantenedor.

### Escopo compatível com o Photoshop

- Modos de ROI `Retângulo` e `Laço`, com Retângulo como padrão.
- Localizador de objetos ativável: ao passar o cursor, destacar uma máscara candidata;
  clicar confirma essa máscara.
- Modos substituir, adicionar, subtrair e intersectar.
- Opção `Amostrar todas as camadas`; desativada usa somente a camada ativa.
- Opção de borda rígida quando suportada pelo pós-processamento.
- `Esc` cancela ROI ou análise atual sem apagar a seleção confirmada.
- A seleção final é binária no modelo atual; feather/refinamento ficam para um fluxo
  futuro de Select and Mask.

### Pipeline recomendado

1. Capturar asset/composição, transform, ROI, combinação e opções no início.
2. Preparar uma entrada reduzida para localização sem perder o mapeamento ao documento.
3. Executar detecção/segmentação no worker ou runtime isolado.
4. Projetar a máscara para a resolução original e limitar à ROI quando aplicável.
5. Pós-processar somente conforme opções documentadas; não inventar pixels ocultamente.
6. Converter a máscara para spans compactáveis no espaço do documento.
7. Combinar com a seleção anterior e publicar somente a geração mais recente.
8. Liberar tensores, buffers, bitmaps e resultados cancelados.

### Fixtures e testes mínimos

- Um objeto e vários objetos separados.
- Pessoa, roupa, cabelo, animal, veículo e objeto cotidiano.
- Objeto claro em fundo escuro e objeto/fundo de cores semelhantes.
- Bordas suaves, transparência, sombra e detalhes finos.
- Retângulo contendo um objeto e contendo vários objetos.
- Laço aproximado que atravessa parte do objeto, mas fornece contexto suficiente.
- Localizador não confirma seleção apenas pelo hover.
- Camada ativa versus composição visível produz resultados da fonte escolhida.
- Adicionar, subtrair e intersectar máscaras detectadas.
- Cancelamento durante carregamento, inferência e pós-processamento.
- Transformação, escala, rotação e raster compacto mantêm alinhamento.
- Worker/runtime não deixa memória crescente depois de uso repetido.

### Critérios de aceite

- [ ] Runtime, modelo, licenças e medições estão registrados.
- [ ] Retângulo e Laço encontram o objeto dentro da ROI.
- [ ] Localizador destaca e confirma objetos de forma previsível.
- [ ] Amostragem da camada ativa e de todas as camadas funciona.
- [ ] Interface continua responsiva durante análise.
- [ ] Falha ou ausência do modelo é recuperável e explicada em português.
- [ ] Windows e Linux validados manualmente, inclusive sem GPU dedicada.

## Fase 5 — Integração, documentação e homologação

Estado: `NÃO INICIADO`

### Roteiro funcional comum

- Criar Marquee Retangular e Elíptica nos quatro sentidos de arraste.
- Criar Linha única e Coluna única nas bordas e no centro do documento.
- Alternar Marquees por botão, flyout, `M` e `Shift+M`.
- Alternar Seleção de Objeto, Rápida e Varinha por botão, flyout, `W` e `Shift+W`.
- Confirmar última ferramenta lembrada e ícone correto.
- Operar em viewport mínimo, maximizado e alta densidade.
- Testar zoom baixo, 100%, fracionário e alto.
- Testar documento transparente, branco, preto e fotografia.
- Testar camada normal, compacta, invisível, vazia, transformada e rotacionada.
- Trocar ferramenta, camada e documento durante tarefa pendente.
- Testar Seleção de Objeto por Retângulo, Laço e localizador por hover.
- Aplicar Pincel, Degradê, Balde, apagar, copiar e mover usando a seleção criada.
- Salvar/reabrir `.axia` e confirmar que seleção temporária não foi persistida por engano.
- Confirmar que exportação não inclui overlays.
- Verificar uso prolongado para detectar workers, buffers ou canvases retidos.

### Critérios finais

- [ ] O grupo `M` contém exatamente os quatro Marquees do Photoshop.
- [ ] Seleção de Objeto, Rápida e Varinha dividem exatamente o slot `W`.
- [ ] Ambos os flyouts são operáveis por mouse e teclado.
- [ ] Barra contextual não desloca ou sobrepõe controles no viewport mínimo.
- [ ] Combinação é consistente entre as três ferramentas.
- [ ] Cancelamento nunca apaga seleção confirmada.
- [ ] Testes automatizados passam.
- [ ] Build Wails validada no Windows.
- [ ] Build Wails validada no Linux.
- [ ] README e tabela de atalhos refletem o produto aceito.
- [ ] Roadmaps relacionados apontam para o estado final correto.

## Validação obrigatória

Na raiz:

```bash
source scripts/env.sh
go test ./...
git diff --check
```

No frontend:

```bash
cd frontend
source ../scripts/env.sh
npm test
npm run build
```

Também executar:

- testes direcionados dos módulos alterados durante cada incremento;
- benchmark versionável da Seleção Rápida, Seleção de Objeto e máscaras fragmentadas;
- teste manual em desenvolvimento antes do instalador;
- build Wails Windows/amd64;
- build Wails Linux na distribuição suportada;
- teste real com mouse, touchpad e, quando disponível, caneta;
- inspeção de memória depois de criar/cancelar dezenas de seleções.

Se uma validação não puder ser executada, registrar a limitação e não marcar a fase
como concluída.

## Riscos conhecidos

1. Combinar seleções com matrizes diferentes pode forçar rasterização em espaço do
   documento e elevar uso de memória.
2. Linha/Coluna de um pixel podem ficar pouco visíveis em zoom baixo; o overlay deve
   comunicar a seleção sem aumentar sua máscara real.
3. Qualidade da Seleção Rápida depende fortemente do algoritmo e das fixtures; um
   flood fill com outro nome não atende ao objetivo.
4. Seleção de Objeto exige runtime/modelo robusto; dependências WASM e pesos podem
   aumentar significativamente instalador, carregamento e memória.
5. Reprocessar toda a imagem em cada `pointermove` bloqueará a interface; sementes,
   bounds e mapas intermediários precisam ser incrementais ou reutilizados.
6. `Path2D` ou SVG gigantes não são adequados para milhões de regiões fragmentadas.
7. Ignorar resultado obsoleto sem cancelar o processamento ainda desperdiça CPU e memória.
8. A migração da Varinha não pode alterar o núcleo compartilhado pelo Balde sem testes
   de regressão.

## Melhorias futuras fora do escopo inicial

- Amostrar todas as camadas visíveis na Varinha e na Seleção Rápida.
- Selecionar assunto automaticamente.
- Feather, suavização, expansão e contração de seleção.
- Pincel de Seleção com máscara, dureza e opacidade no grupo de Laço.
- Laço magnético e laço poligonal.
- Select and Mask dedicado com refinamento de cabelo.
- Persistência das preferências no `.axia`.
- Histórico próprio de alterações de seleção.

Não incluir esses itens no MVP sem decisão explícita e atualização deste roadmap.

## Registro de decisões

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-08-24 | Criar um único grupo `W` para as três ferramentas | Economiza espaço e oferece alternância explícita no padrão solicitado |
| 2026-08-24 | Decisão substituída: interpretar o traço livre como Pincel de Seleção | A leitura inicial foi corrigida quando o mantenedor exigiu igualdade com o Photoshop |
| 2026-08-24 | Manter o Laço fora do grupo Marquee | No Photoshop, Laço e Marquee pertencem a grupos diferentes |
| 2026-08-24 | Decisão cancelada: adicionar Triângulo e Estrela à Seleção de área | O mantenedor decidiu reproduzir as opções Marquee do Photoshop |
| 2026-08-24 | Representar Círculo como Elipse restrita | Evita tipo e comportamento duplicados para a mesma geometria |
| 2026-08-24 | Decisão cancelada: Estrela de cinco pontas no MVP | Estrela é ferramenta de forma e saiu deste roadmap |
| 2026-08-24 | Grupo Marquee terá Retangular, Elíptica, Linha única e Coluna única | É o conjunto documentado no Photoshop desktop |
| 2026-08-24 | Grupo `W` terá Seleção de Objeto, Seleção Rápida e Varinha | Corrige a terceira ferramenta para o agrupamento do Photoshop |
| 2026-08-24 | O risco livre é o modo Laço da Seleção de Objeto | O contorno fornece uma ROI e o motor detecta o objeto dentro dela |
| 2026-08-24 | Seleção Rápida começa pela camada ativa | Limita custo e ambiguidade no MVP; todas as camadas fica para decisão futura |
| 2026-08-24 | `W` ativa a lembrada e `Shift+W` percorre o grupo | Mantém acesso rápido sem alternância invisível em um simples `W` |
| 2026-08-24 | Combinações reais produzem spans em espaço do documento | Permite operar entre vetores, rasters e matrizes diferentes sem atribuir o resultado a uma camada falsa |
| 2026-08-24 | Varinha permanece temporariamente no modo legado | Removê-la antes do slot `W` estar funcional deixaria a feature atual inacessível |
| 2026-08-24 | Linha e Coluna usam `RectangleSelection` vetorial de 1 px | Reutiliza marching ants e todos os consumidores raster sem criar outro formato de máscara |
| 2026-08-24 | Laço e Varinha ficam no seletor contextual de compatibilidade durante a migração | O flyout `M` permanece exato sem retirar acesso antes dos grupos dedicados |

## Registro de evolução

### 2026-08-24 — Roadmap criado

- Confirmado que a Varinha atual é um modo de `crop`, enquanto `EditorTool` ainda não
  possui ferramentas de seleção dedicadas.
- Confirmados o motor compartilhado `colorRegion.ts`, worker/fallback da Varinha,
  spans compactos e suporte atual a transformações.
- A interpretação inicial registrava Pincel de Seleção, Triângulo e Estrela; essas
  decisões foram posteriormente substituídas e não representam mais o escopo ativo.
- Definidos grupo `W`, flyout, ferramenta lembrada, atalhos e modos de combinação.
- Planejada primeiro a base de máscaras, depois Marquees, Varinha, Seleção Rápida e
  Seleção de Objeto com gates técnicos de algoritmo e modelo.
- Nenhum código funcional foi alterado nesta etapa.
- Próximo passo exato: iniciar a Fase 0 criando `SelectionCombineMode`, resolução de
  modificadores e fixtures de operações booleanas entre seleções.

### 2026-08-24 — Escopo corrigido para igualdade com o Photoshop

- Triângulo e Estrela foram removidos do escopo de seleção; são ferramentas de forma.
- O grupo Marquee passou a conter Retangular, Elíptica, Linha única e Coluna única.
- A terceira ferramenta do grupo `W` foi corrigida de Pincel para Seleção de Objeto.
- O “risco livre” foi formalizado como ROI em modo Laço da Seleção de Objeto.
- O roadmap e o nome do arquivo foram atualizados para refletir o novo contrato.
- Próximo passo permanece a Fase 0, pois nenhum código funcional foi iniciado.

### 2026-08-24 — Base compartilhada de combinação implementada

- Adicionados `object-selection`, `quick-selection` e `magic-wand` a `EditorTool`,
  ainda sem exposição na toolbar.
- Criado `frontend/src/editor/selectionCombine.ts` com `SelectionCombineMode`,
  precedência de `Shift`/`Alt` e operações `replace`, `add`, `subtract` e `intersect`.
- Combinações entre representações diferentes são avaliadas pelos centros dos pixels
  apenas nos bounds envolvidos e publicadas como spans em espaço do documento.
- Seleções por pixels passaram a usar `sourceLayerId` opcional como proveniência; o
  resultado combinado não finge pertencer a uma camada específica.
- Resultados acima de 20 mil spans migram durante a construção para `Int32Array`, sem
  manter milhões de objetos temporários.
- Criado `frontend/tests/selectionCombine.test.mjs` com 10 testes para modificadores,
  semântica vazia, modos booleanos, todos os pares de representação, escala, rotação,
  bounds mínimos e compactação fragmentada.
- Validação: 247 testes frontend, `vue-tsc --noEmit`, build Vite, testes Go e
  `git diff --check` passaram.
- A Varinha continua no dropdown atual até a Fase 2 entregar o grupo `W`; essa
  compatibilidade transitória evita regressão de acesso.
- Risco restante: o custo de CPU cresce com a área dos bounds combinados. A memória
  permanece proporcional aos spans, e ferramentas assíncronas grandes deverão usar
  worker/fallback cooperativo nas fases correspondentes.
- Estado da Fase 0: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` manual no Wails.
- Próximo passo exato: iniciar a Fase 1 por `marqueeSelection.ts` e testes puros de
  Linha única/Coluna única antes de integrar o grupo visual `M`.

### 2026-08-24 — Grupo Marquee implementado

- Criado `frontend/src/editor/marqueeSelection.ts` com as quatro Marquees, ordem de
  ciclo, validação de documento e recorte determinístico em coordenadas do documento.
- Linha Única ocupa toda a largura na linha calculada com `Math.floor`; Coluna Única
  ocupa toda a altura e ambas mantêm exatamente um pixel de espessura.
- Retangular e Elíptica passaram a usar o mesmo núcleo puro, preservando quatro
  sentidos de arraste e a restrição para Quadrado/Círculo com `Shift`.
- O slot `M` da toolbar contém exatamente Retangular, Elíptica, Linha Única e Coluna
  Única, mostra a última ferramenta usada e fecha o flyout após uma escolha.
- `M` ativa a Marquee lembrada e `Shift+M` percorre a ordem aprovada durante a sessão.
- A barra contextual expõe substituir, adicionar, subtrair e intersectar para
  Marquee/Laço. O modo efetivo é capturado no `pointerdown` com a precedência de
  `Shift` e `Alt` definida na Fase 0.
- `Esc`, `pointercancel` e perda de captura cancelam somente o draft ativo; a seleção
  confirmada anterior volta a aparecer sem ser apagada.
- Laço e Varinha permanecem temporariamente no seletor contextual de compatibilidade.
  A Varinha não mostra combinação até a Fase 2 conectar esse contrato ao worker.
- Adicionados quatro ícones Marquee e `frontend/tests/marqueeSelection.test.mjs` com
  9 testes sobre ordem, ciclo, direções, restrição, bordas, no-op e combinações.
- Validação automatizada: 256 testes frontend e build TypeScript/Vite passaram.
- Estado da Fase 1: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` manual no Wails.
- Risco restante: Linha/Coluna podem ser visualmente discretas em zoom muito baixo,
  embora a máscara e o overlay preservem a espessura correta no documento.
- Próximo passo exato: iniciar a Fase 2 criando os ícones e o slot visual `W`, depois
  migrar a Varinha existente para sua ferramenta dedicada sem alterar `colorRegion.ts`.

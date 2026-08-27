# Roadmap — Degradê com múltiplas paradas e transparência

> Documento vivo de implementação do Axia. Atualizar este arquivo na mesma alteração
> de código sempre que uma fase avançar, mudar de escopo ou encontrar um bloqueio.

## Metadados

- Criação: 2026-08-25
- Estado geral: Fases 0 e 1 `CONCLUÍDAS`; Fases 2 a 6
  `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`
- Prioridade: após a validação e estabilização das ferramentas de seleção atuais
- Plataformas obrigatórias: Windows e Linux
- Dependências funcionais: Degradê linear/radial, cores principal/secundária,
  preview raster, worker/fallback, seleção e histórico
- Limite inicial: até 32 paradas de cor e 32 paradas de opacidade

## Objetivo

Evoluir a ferramenta Degradê de duas cores fixas para um editor de múltiplas paradas,
seguindo o modelo conhecido do Photoshop:

- o motor mantém cor e opacidade independentes para interpolação e compatibilidade;
- a interface apresenta um único ponto com cor e transparência para reduzir a
  complexidade percebida;
- qualquer posição pode ficar parcial ou totalmente transparente;
- preview interativo, worker e fallback produzem os mesmos pixels;
- degradês atuais continuam funcionando sem configuração ou migração manual.

O nome adotado na interface será **Pontos do degradê**. No código e na documentação
técnica, os termos serão `colorStops` e `opacityStops`.

## Protocolo obrigatório

1. Ler este roadmap completo e conferir `git status --short`.
2. Preservar mudanças pendentes e revisar o código atual antes de cada fase.
3. Marcar a fase como `EM ANDAMENTO` antes da primeira alteração material.
4. Implementar modelo e testes puros antes da interface.
5. Manter preview, worker e fallback apoiados no mesmo núcleo de interpolação.
6. Atualizar testes, documentação e este roadmap em cada incremento.
7. Não marcar uma fase como concluída sem os critérios automatizados e manuais dela.

Estados permitidos: `NÃO INICIADO`, `EM ANDAMENTO`,
`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`, `BLOQUEADO` e `CONCLUÍDO`.

## Baseline confirmado

- `GradientConfig` contém tipo, cor principal, cor secundária e inversão.
- O gesto linear/radial e sua geometria já são estáveis.
- A prévia usa `CanvasGradient`; o resultado final usa interpolação própria no raster.
- O processamento definitivo possui worker, fallback, cancelamento e lotes por linha.
- Seleções vetoriais e raster limitam corretamente a aplicação.
- A troca visual entre preview e raster final já aguarda o próximo frame.
- Estilos de camada já possuem um modelo separado com `colorStops` e `opacityStops`;
  ele serve como referência, mas não deve ser acoplado diretamente sem normalização.

## Decisões de produto

1. Cor e opacidade terão trilhas independentes no motor, mas uma única fileira de
   pontos na interface. Cada ponto visual edita sua cor e transparência em conjunto.
2. Toda configuração válida terá ao menos duas paradas de cor.
3. Opacidade sem paradas válidas será normalizada para 100% nas duas extremidades.
4. Posições usam intervalo normalizado de `0` a `1`.
5. Interpolação de cor permanece sRGB na primeira versão.
6. Interpolação de opacidade é linear e aplicada ao alfa resultante.
7. Inverter espelha posições (`1 - posição`) e mantém todos os valores.
8. Transparência significa alfa real no raster, não mistura com branco ou fundo.
9. Paradas das extremidades podem ser editadas, mas não removidas se isso deixar menos
   de duas paradas de cor.
10. Novas paradas recebem o valor interpolado exatamente na posição de inserção.
11. A configuração vive na sessão do editor; persistência em presets fica para fase
    posterior explicitamente aprovada.

## Modelo de dados proposto

```ts
interface GradientColorStop {
  id: string
  position: number
  color: string
}

interface GradientOpacityStop {
  id: string
  position: number
  opacity: number // 0..100
}

interface GradientConfig {
  type: 'linear' | 'radial'
  colorStops: GradientColorStop[]
  opacityStops: GradientOpacityStop[]
  reversed: boolean
  interpolation: 'srgb'
}
```

IDs pertencem à interface e ao histórico de edição, mas não participam do cálculo de
pixels. O núcleo deve ordenar cópias normalizadas sem reordenar arrays reativos durante
um gesto.

## Migração e compatibilidade

- O estado atual preto→branco vira duas paradas nas posições `0` e `1`.
- Cor principal e secundária continuam alimentando as extremidades do preset padrão.
- Chamadas ou testes antigos que ainda entreguem `foregroundColor` e
  `backgroundColor` serão normalizados temporariamente no limite do motor.
- A migração deve ser removida somente após todos os consumidores internos adotarem o
  novo contrato e os testes comprovarem equivalência pixel a pixel.
- Projetos `.axia` atuais não são afetados porque a configuração da ferramenta ainda
  não é persistida no documento.

## Experiência do usuário

### Faixa do degradê

- Exibir uma faixa sobre padrão xadrez para tornar transparência visível.
- Exibir uma única fileira de pontos abaixo da faixa.
- Clique na faixa ou na trilha adiciona outra cor com a transparência interpolada.
- Clique em um marcador seleciona; arraste horizontal altera a posição.
- `Alt+arrastar` duplica o ponto e permite editar a cópia independentemente.
- Posição pode ser ajustada numericamente de 0% a 100%.
- Marcador selecionado recebe foco e indicação visual inequívoca.

### Edição

- Cada ponto apresenta seletor de cor, visibilidade de 0% a 100%, posição e Remover.
- A ação “Sem cor (transparente)” alterna diretamente entre 0% e 100% sem exigir que
  o usuário compreenda canais alfa ou paradas de opacidade.
- `Delete` remove a parada ativa somente quando o foco está no editor.
- Setas movem a parada em 1%; `Shift` + setas, em 10%.
- Duplo clique no marcador abre o controle principal correspondente.
- O botão Inverter espelha a configuração completa.

### Descoberta para usuários leigos

- A barra contextual mostra uma miniatura clicável e o texto “Editar degradê”.
- O editor explica “Clique na faixa para adicionar um ponto”.
- Transparência será apresentada como “Opacidade”, evitando exigir conhecimento de alfa.
- Controles possuem rótulos, tooltips e valores visíveis, não apenas ícones.

## Fases

### Fase 0 — Contrato, normalização e fixtures

Estado: `CONCLUÍDO`

- Criar tipos próprios da ferramenta e limites formais.
- Normalizar posições, cores, opacidades, ordem e IDs duplicados.
- Garantir cópias independentes para objetos reativos e `postMessage`.
- Criar fixtures com 2, 3, 8 e 32 paradas, posições coincidentes e transparência.

Aceite: entradas inválidas nunca produzem `NaN`, arrays vazios ou menos de duas cores.

### Fase 1 — Interpolação compartilhada

Estado: `CONCLUÍDO`

- Localizar os vizinhos por busca ordenada.
- Interpolar RGB e opacidade separadamente.
- Definir comportamento determinístico para paradas na mesma posição.
- Preservar clamp antes da primeira e depois da última parada.
- Validar inversão por espelhamento da posição.

Aceite: tabelas de pixels esperados passam para linear, radial, alfa parcial e zero.

### Fase 2 — Raster, worker e fallback

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

- Propagar o novo config até `gradientRaster`, serviço e worker.
- Enviar snapshots clonáveis, nunca proxies Vue.
- Pré-calcular segmentos por lote para evitar busca completa por pixel.
- Manter cancelamento, orçamento da prévia e expansão raster existentes.
- Confirmar equivalência entre processamento integral, em lotes e worker.

Aceite: resultado idêntico nos três caminhos e sem regressão relevante no benchmark 4K.

### Fase 3 — Preview interativo

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

- Adicionar todas as paradas de cor e alfa ao preview.
- Quando `CanvasGradient` não representar exatamente o modelo combinado, gerar uma
  LUT compartilhada ou preview raster para manter fidelidade com o resultado final.
- Preservar máscara de seleção, zoom, DPR e handoff sem piscada.

Aceite: matriz visual de posições 0/25/50/75/100%, transparência e inversão coincide
com o raster final.

### Fase 4 — Editor visual de paradas

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

- Criar componente isolado para faixa, marcadores e propriedades.
- Implementar adicionar, selecionar, duplicar com `Alt`, mover, editar e remover em uma
  única fileira visual.
- Fechar ao clicar fora sem conflitar com toolbar, réguas ou atalhos do canvas.
- Tratar teclado, foco, leitores de tela e alvos mínimos de ponteiro.

Aceite: fluxo completo funciona por mouse e teclado sem perder a configuração.

### Fase 5 — Integração e compatibilidade

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

- Substituir os dois campos implícitos pelo novo estado no `App` e contratos do canvas.
- Manter as cores principal/secundária no preset padrão.
- Garantir que trocar tipo, ferramenta, camada ou documento cancele somente o gesto.
- Manter uma única entrada de histórico por aplicação.

Aceite: degradês antigos continuam visualmente idênticos e múltiplas paradas funcionam
com retângulo, elipse, laço e seleção raster transformada.

### Fase 6 — Validação, desempenho e documentação

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

- Rodar testes frontend, TypeScript, Vite, Go e builds Windows/Linux.
- Medir preview e aplicação 4K com 2, 8 e 32 paradas.
- Testar documentos transparentes e camadas rotacionadas/escaladas.
- Atualizar README, atalhos e ajuda contextual.
- Registrar resultados manuais e limitações restantes.

Aceite: sem divergência visual conhecida, vazamento de URLs, bloqueio perceptível da UI
ou regressão nos projetos existentes.

## Testes automatizados obrigatórios

- normalização, clonagem e ordenação;
- equivalência exata do caso legado de duas cores;
- interpolação com três ou mais cores;
- opacidade 100→0, 0→100 e múltiplos picos;
- paradas coincidentes e posições fracionárias;
- inversão dupla retorna ao resultado original;
- linear e radial;
- seleção vetorial e raster transformada;
- worker/fallback/lotes equivalentes;
- cancelamento e no-op;
- limite de 32 paradas e payload clonável;
- interação do editor: adicionar, mover, remover e teclado.

## Validação manual obrigatória

### Windows

- Criar degradê de 3, 8 e 32 cores.
- Criar transição cor→transparente→cor.
- Arrastar marcadores rapidamente e aplicar em imagem 4K.
- Testar seleção retangular, elíptica, laço e Varinha.
- Testar desfazer/refazer, troca de camada, cancelamento e reinstalação.

### Linux

- Repetir criação, transparência, aplicação e histórico no Flatpak.
- Conferir seletores de cor, foco, escala de interface e performance do WebKitGTK.

## Riscos e mitigação

- Divergência CanvasGradient/raster: usar núcleo/LUT compartilhado no preview.
- Busca cara por parada a cada pixel: pré-calcular LUT ou cursor de segmento.
- Muitos eventos ao arrastar: coalescer com `requestAnimationFrame`.
- Proxies em worker: snapshot explícito na fronteira.
- Marcadores sobrepostos: seleção por ordem visual e edição numérica.
- Transparência imperceptível: faixa xadrez e valor de opacidade explícito.
- Estado excessivo no `App.vue`: componente e módulo de domínio próprios.

## Fora do escopo inicial

- interpolação perceptual Lab/OKLab;
- midpoint ajustável entre duas paradas;
- ruído/dithering configurável;
- presets persistidos, importação/exportação de `.grd`;
- degradês angulares, refletidos ou diamante;
- edição não destrutiva como camada de preenchimento.

## Registro de decisões

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-08-25 | Separar cor e opacidade | Reproduz transparência real e o modelo conhecido do Photoshop |
| 2026-08-25 | Limitar cada trilha a 32 paradas | Evita payload/UI sem limite e já cobre composições complexas |
| 2026-08-25 | Preservar sRGB inicialmente | Mantém equivalência com o motor atual e limita o escopo |
| 2026-08-25 | Não persistir presets no primeiro ciclo | A ferramenta ainda não possui configuração serializada no projeto |

## Registro de evolução

### 2026-08-25 — Roadmap criado

- Confirmado o nome “pontos de parada do degradê”.
- Definidas trilhas independentes de cor e opacidade, incluindo transparência total.
- Mapeadas migração, editor, preview, worker, fallback, testes e validação multiplataforma.
- Nenhum código funcional do Degradê foi alterado nesta etapa.
- Próximo passo exato: iniciar a Fase 0 com tipos, normalização e fixtures puras.

### 2026-08-27 — Fases 0 e 1 iniciadas

- Repositório confirmado limpo no commit `3104d6d` antes da implementação.
- Relidos integralmente o roadmap e o motor atual (`gradient.ts`, raster, serviço,
  worker, preview e testes).
- Decidido preservar temporariamente `GradientConfig` como contrato legado consumido
  pela interface e introduzir um contrato canônico separado para as paradas. A troca
  dos consumidores permanece na Fase 5, evitando quebrar preview, worker e aplicação
  durante a construção do núcleo.
- Fases 0 e 1 marcadas como `EM ANDAMENTO`; nenhuma alteração de raster ou UI faz
  parte deste incremento.

### 2026-08-27 — Contrato e interpolação compartilhada concluídos

- Criados `GradientColorStop`, `GradientOpacityStop` e `GradientStopsConfig`, com
  trilhas independentes, posições normalizadas, inversão e interpolação sRGB explícita.
- Mantido temporariamente o `GradientConfig` legado para não alterar consumidores antes
  da integração coordenada de raster, worker, preview e interface.
- A normalização agora limita cada trilha a 32 pontos, descarta valores não numéricos,
  restringe posições a `0..1` e opacidade a `0..100`, normaliza hexadecimal, ordena
  cópias e torna IDs vazios ou repetidos únicos.
- Entradas vazias recebem duas cores padrão e opacidade total; um único ponto é
  duplicado na extremidade oposta sem alterar seu valor.
- O formato legado é convertido para duas paradas e comprovado como equivalente pixel
  a pixel, inclusive com inversão e progressos fora do intervalo.
- Implementada busca binária dos segmentos e interpolação independente de RGB e alfa.
  Em posições coincidentes, vence deterministicamente o último ponto naquela posição,
  permitindo transições duras previsíveis.
- Criado um interpolador compilado que normaliza e converte cores uma única vez e mantém
  snapshot próprio. A Fase 2 poderá reutilizá-lo por pixel sem depender de proxies Vue
  ou repetir parsing e normalização.
- Adicionadas fixtures de 2, 3, 8 e 32 pontos e testes para entradas adulteradas,
  clonagem estruturada, limites, transparência, inversão e pontos coincidentes.
- Validação automatizada: 289 testes frontend, `vue-tsc --noEmit` e build Vite de
  produção aprovados. O comportamento visível permanece inalterado nesta etapa.
- Próximo passo exato: Fase 2, propagando snapshots canônicos ao raster, serviço e
  worker e comprovando equivalência entre execução integral, em lotes e worker.

### 2026-08-27 — Fase 2 iniciada

- Revisados novamente os contratos completos de `gradientRaster.ts`,
  `gradientEngine.ts`, `gradient.worker.ts` e a chamada legada da interface.
- Definida a fronteira: a interface ainda pode entregar `GradientConfig` legado; o
  serviço o normaliza imediatamente para um snapshot `GradientStopsConfig` simples e
  clonável. Worker e fallback recebem exatamente esse mesmo snapshot.
- O estado raster passará a compilar o interpolador uma única vez por operação e a
  reutilizá-lo em todos os pixels e lotes.

### 2026-08-27 — Fase 2 integrada e validada automaticamente

- `GradientRasterRequest` passou a aceitar o contrato legado ou canônico na fronteira;
  o estado raster normaliza os dados e compila um interpolador reutilizado por todos os
  pixels, tanto no processamento integral quanto em lotes.
- O raster grava os quatro canais retornados pelo núcleo. Pontos com opacidade zero
  agora produzem alfa realmente transparente, sem misturar com branco ou com o fundo.
- O serviço converte imediatamente a configuração recebida em um snapshot canônico
  simples. Worker e fallback recebem o mesmo `GradientStopsConfig`, sem proxies Vue e
  com arrays e objetos independentes.
- O worker foi tipado para aceitar apenas o snapshot canônico e continua usando o mesmo
  estado e renderizador de linhas do fallback. Cancelamento e liberação das requisições
  permaneceram inalterados.
- Testes novos cobrem pixels RGBA esperados com três cores, transparência no centro,
  preservação do raster fora da seleção, isolamento contra mutação posterior e
  equivalência integral/lotes com 32 pontos de cor e 32 de opacidade.
- Adicionado `gradientRaster.benchmark.mjs` para repetir medições sintéticas 4K. Em uma
  execução local de 3840×2160: 2 pontos em 888,61 ms; 8 em 880,62 ms; 32 em 934,05 ms.
  O caso máximo ficou cerca de 5% acima do caso de duas cores e todos produziram o
  mesmo raster RGBA de 33.177.600 bytes. Os números são comparativos, não garantia de
  tempo absoluto entre máquinas.
- Validação automatizada: 293 testes frontend, `vue-tsc --noEmit`, build Vite de
  produção, `go test ./...`, `go vet ./...` e `git diff --check` aprovados; o bundle
  específico do worker foi gerado corretamente.
- A fase aguarda validação prática do caminho Worker/fallback no aplicativo instalado.
  Próximo incremento de código: Fase 3, preview interativo fiel às múltiplas paradas.

### 2026-08-27 — Fase 3 iniciada

- Confirmado que `CanvasGradient` não é suficiente para trilhas independentes de cor e
  opacidade: a interpolação de RGBA do navegador pode divergir do RGB + alfa calculados
  separadamente pelo raster definitivo.
- Definido um preview raster baseado no mesmo interpolador, com LUT criada uma vez por
  gesto e raster limitado ao orçamento visual já usado pelo editor.
- O canvas auxiliar será reutilizado durante o arraste; seleção, zoom, DPR e o handoff
  após a confirmação continuarão no fluxo existente.

### 2026-08-27 — Fase 3 integrada e validada automaticamente

- Substituído o `CanvasGradient` da prévia por um raster RGBA que usa o mesmo
  interpolador canônico do resultado definitivo. Cor e opacidade independentes,
  inversão e degradês lineares/radiais agora seguem uma única regra de pixels.
- A configuração é normalizada e congelada como snapshot no início do gesto. Uma LUT
  RGBA de 4.096 amostras é criada uma vez e reutilizada em todos os quadros, sem fazer
  busca nas paradas para cada pixel.
- O buffer de pixels, o canvas auxiliar e a LUT são reaproveitados enquanto as
  dimensões não mudam. A prévia interativa foi limitada a 524.288 pixels; o raster
  confirmado continua sendo calculado na resolução integral do documento.
- O gesto degenerado não esconde mais a camada nem desenha uma cor sólida no primeiro
  clique. Isso evita um clarão antes de o usuário efetivamente arrastar o degradê.
- Sem seleção, a camada original só é ocultada quando a prévia estiver pronta, deixando
  alfa real revelar as camadas inferiores. Com seleção, a imagem atual da camada é
  copiada para a prévia, a área selecionada é removida e o novo degradê é composto sob
  a mesma máscara antes do handoff para o raster definitivo.
- Os controles sobre o canvas passaram a obter suas cores nos extremos pelo
  interpolador compartilhado, inclusive quando a extremidade possui transparência.
- Testes específicos cobrem LUT, alfa, linear, radial, compatibilidade legada,
  equivalência com o raster final e reutilização do buffer.
- Adicionado `gradientPreview.benchmark.mjs`. Em medição local linear, a renderização
  reutilizando a LUT levou de 5,51 a 13,94 ms em 512×512, de 11,33 a 12,58 ms no teto
  prático de 724×724 e de 23,93 a 25,72 ms em 1024×1024 para 2, 8 e 32 paradas. O custo
  permaneceu praticamente independente da quantidade de pontos; os valores são
  comparativos e variam entre máquinas.
- Validação automática: 298 testes frontend, `vue-tsc --noEmit`, build Vite de
  produção, `go test ./...` e `go vet ./...` com Go 1.26.5, além de
  `git diff --check`, aprovados. A fase aguarda a validação visual no aplicativo; o
  próximo incremento é a Fase 4, que torna as novas paradas editáveis pela interface.

### 2026-08-27 — Fase 4 iniciada

- Relidos integralmente o roadmap, o estado canônico, a barra contextual e os
  contratos entre `App`, viewport e motor antes da primeira alteração de interface.
- Confirmado que a Fase 3 e a preferência recém-adicionada da ferramenta Mover estão
  pendentes no mesmo worktree e devem ser preservadas sem separação destrutiva.
- Definida a implementação em duas partes: operações puras e testáveis para editar as
  trilhas, seguidas de um componente isolado com faixa xadrez, marcadores, propriedades,
  teclado, arraste e fechamento ao clicar fora.

### 2026-08-27 — Fase 4 integrada e validada automaticamente

- Criado `gradientEditor.ts` como domínio imutável do editor visual. Ele adiciona
  pontos com o valor interpolado na posição clicada, move no espaço visual mesmo com
  inversão, edita cor/opacidade, protege o mínimo de dois pontos e respeita o limite
  de 32 por trilha.
- Criado `GradientStopsEditor.vue`, isolado do `App`, com faixa sobre xadrez, pontos de
  opacidade acima, pontos de cor abaixo, seleção inequívoca e propriedades numéricas.
- A interface permite adicionar por clique, selecionar, arrastar, editar, remover e
  posicionar de 0% a 100%. Marcadores aceitam setas em passos de 1%, `Shift` + setas
  em 10%, `Home`, `End`, `Delete` e duplo clique para focar o valor principal.
- O popover fecha pelo botão, `Escape` ou clique fora. O limite de fechamento considera
  o próprio acionador para permitir alterná-lo sem reabrir por propagação do evento e
  não interfere nas réguas ou no canvas.
- Incluídos rótulos para leitores de tela, estado `aria-expanded`, foco visível e alvos
  de ponteiro com pelo menos 26 pixels.
- `App`, viewport e barra contextual agora compartilham um único
  `GradientStopsConfig`; a configuração mostrada no editor é enviada diretamente à
  prévia, ao worker e ao raster. Tipo e inversão também fazem parte desse snapshot.
- As cores principal e secundária continuam atualizando as extremidades enquanto o
  degradê permanece no preset simples de duas cores. Depois de adicionar um terceiro
  ponto, a composição personalizada deixa de ser sobrescrita por essas cores globais.
- Testes novos cobrem inserção interpolada, movimento invertido, edição imutável,
  remoção protegida, limite de 32 pontos e faixa CSS com alfa.
- Validação automática concluída: 308 testes frontend, verificação TypeScript, build
  Vite de produção, `go test ./...` e `go vet ./...` com Go 1.26.5 aprovados. A fase
  aguarda validação manual do fluxo visual no aplicativo.

### 2026-08-27 — Fase 5 iniciada

- Confirmado que todos os consumidores internos visíveis já recebem
  `GradientStopsConfig`; o contrato legado permanece somente nas fronteiras puras do
  motor para comprovar compatibilidade pixel a pixel.
- A auditoria verificará como uma unidade o preset simples ligado às cores globais,
  snapshots de gesto, cancelamento por mudança de contexto, seleções e histórico.

### 2026-08-27 — Fase 5 integrada e validada automaticamente

- Criado `gradientToolState.ts` para centralizar a criação do preset simples e sua
  sincronização com as cores principal/secundária. O `App` deixou de duplicar essa
  regra em observadores independentes.
- O preset canônico de duas cores foi comparado ao contrato legado em cinco posições e
  permaneceu pixel a pixel idêntico, inclusive preservando tipo radial e inversão.
- Configurações personalizadas com três ou mais cores mantêm identidade e conteúdo ao
  alterar as cores globais, evitando perda silenciosa do trabalho do usuário.
- O gesto recebe um snapshot normalizado no `pointerdown`; alterações posteriores não
  mudam uma aplicação em andamento. Trocar tipo, ferramenta, camada ou documento
  continua cancelando somente a interação transitória.
- A aplicação definitiva continua registrando um único `layer:patch` chamado
  `Degradê`, portanto `Ctrl+Z` e refazer permanecem atômicos independentemente da
  quantidade de pontos ou do tipo de seleção.
- Retângulo, elipse, laço e máscara de pixels transformada continuam no predicado
  compartilhado do raster; múltiplas paradas não criam um caminho de seleção paralelo.
- Todos os contratos internos entre `App`, canvas, preview e worker agora são
  canônicos. `GradientConfig` legado permanece somente como entrada compatível do
  núcleo e em testes de regressão.

### 2026-08-27 — Fase 6 iniciada

- Atualizado o README com o editor de múltiplos pontos, transparência, seleções, balde
  de tinta e atalhos `G`/`Shift+G`.
- A validação automatizada completa e os benchmarks reproduzíveis serão repetidos
  antes de entregar o conjunto para a inspeção manual integral do usuário.

### 2026-08-27 — Fase 6 implementada, aguardando validação manual

- A repetição inicial do benchmark 4K revelou crescimento de aproximadamente 35% no
  caso de 32 pontos. A causa eram objetos temporários criados duas vezes por pixel para
  representar os segmentos de cor e opacidade.
- O interpolador compilado passou a calcular índices, vizinhos e proporções diretamente,
  sem alocar objetos no laço quente. Os 41 testes direcionados comprovaram que os pixels,
  pontos coincidentes, inversão, seleções e compatibilidade permaneceram idênticos.
- Na medição após a correção, o raster linear 3840×2160 levou 803,49 ms com 2 pontos,
  823,02 ms com 8 e 836,26 ms com 32. O caso máximo ficou cerca de 4,1% acima do preset
  simples, com o mesmo buffer RGBA de 33.177.600 bytes.
- A prévia permaneceu dentro do orçamento: no teto prático de 724×724, levou entre
  9,69 e 12,35 ms para 2, 8 e 32 pontos; em 1024×1024, entre 19,83 e 20,87 ms.
- Validação final aprovada com 311 testes frontend, `vue-tsc --noEmit`, build Vite,
  `go test ./...`, `go vet ./...`, `git diff --check` e build Wails 3 de produção no
  Windows usando Go 1.26.5 e Node.js 24.14.1.
- Gerado o instalador `bin/axia-amd64-installer.exe`, com 7.019.956 bytes e SHA-256
  `6E9FEC000B5DD2BB7FB99E48A916511C2671FF87F1A6FD76F434499FAF466847`.
- A build Linux/Flatpak e a matriz visual/manual permanecem pendentes porque esta
  execução ocorreu no Windows. Conforme combinado, o usuário fará a inspeção integral
  do aplicativo após todas as fases implementadas.

### 2026-08-27 — Auditoria de desempenho após uso prático

- A validação prática apontou travamento perceptível no degradê. A fase 6 voltou para
  `EM ANDAMENTO` até a nova implementação ser validada manualmente.
- O preview recalculava até 524.288 pixels na thread da interface em cada frame, além
  de enviar o buffer ao canvas e compor a camada. O orçamento interativo foi reduzido
  para 262.144 pixels (512²); o raster definitivo continua usando resolução integral.
- O raster definitivo ainda criava um array RGBA temporário para cada pixel. Foi
  adicionado um caminho `write` que grava os quatro canais diretamente no buffer,
  eliminando milhões de objetos transitórios e pressão desnecessária no coletor de lixo.
- Worker e fallback copiavam novamente todo o buffer antes de criar `ImageData`,
  chegando a duplicar mais 33 MB em 4K. A cópia foi removida e o buffer tipado passou
  diretamente ao canvas.
- Quando o raster lido pertence exclusivamente ao worker/fallback e não precisa ser
  expandido, ele agora é editado no próprio buffer. A API pura continua copiando por
  padrão, mas o fluxo real evita outra alocação de aproximadamente 33 MB em 4K.
- O preview linear passou a incrementar posição e progresso por linha, evitando
  multiplicações e cálculo de offset redundantes para cada pixel. A LUT também passou
  a ser preenchida sem arrays temporários.
- O editor visual agora limita atualizações do arrasto a uma por frame, reutiliza os
  limites geométricos da trilha durante o gesto e evita uma normalização completa
  redundante em cada mudança.
- O processamento em lotes passou de 64 para 256 linhas no worker e de 32 para 128 no
  fallback. O worker ainda devolve o controle periodicamente para receber cancelamento,
  mas sem pagar dezenas de pausas artificiais adicionais em imagens grandes.
- O `pointerup` deixou de redesenhar sincronamente uma prévia que o frame pendente já
  havia produzido; só há redesenho quando a coordenada final realmente mudou.
- Benchmark 4K após as correções: 616,25 ms com 2 pontos, 728,80 ms com 8 e 734,08 ms
  com 32, contra 803,49/823,02/836,26 ms na medição anterior. O ganho foi de 23,3%,
  11,4% e 12,2%, respectivamente, mantendo o mesmo buffer de 33.177.600 bytes.
- No novo teto efetivo do preview (512×512), depois do aquecimento do JIT, o renderer
  puro levou aproximadamente 3,5 a 5,3 ms com 8 e 32 pontos. O primeiro caso medido
  inclui compilação/aquecimento e levou 12,03 ms.
- Validação final aprovada com 314 testes frontend, `vue-tsc --noEmit`, builds Vite de
  desenvolvimento e produção, `go test ./...`, `go vet ./...`, `git diff --check` e
  build Wails 3 de produção usando Go 1.26.5 e Node.js 24.14.1.
- Gerado novo instalador `bin/axia-amd64-installer.exe`, com 7.020.186 bytes e SHA-256
  `61A6F1B4EE81BDFC00112DD8476E16619FC26A2F41DF9DAAD13BF6A495F406F3`.
- A auditoria automatizada foi concluída; a fase permanece aguardando a validação
  prática de fluidez e equivalência visual no aplicativo instalado.

### 2026-08-27 — Simplificação do editor de transparência

- A validação manual revelou que os marcadores superiores e inferiores pareciam duas
  paletas de cores, tornando difícil descobrir a trilha independente de opacidade.
- As trilhas agora são identificadas como **Transparência — marcadores de cima** e
  **Cores — marcadores de baixo**. Ao selecionar um ponto, o painel informa claramente
  se está editando uma cor ou a transparência.
- O controle técnico “Opacidade” passou a ser apresentado como “Visibilidade”, com a
  explicação direta “0% transparente · 100% visível”.
- Foram adicionadas as ações rápidas “Cor → transparente” e “Transparente → cor”. Elas
  reduzem o degradê para uma única cor, configuram automaticamente as duas extremidades
  de transparência e mantêm o tipo linear/radial e o sentido visual mesmo quando a
  opção Inverter está ativa.
- Foram adicionados testes para os dois sentidos do atalho e para configuração
  invertida. Os 30 testes direcionados e a build TypeScript/Vite passaram.
- Gerado novo instalador com a interface simplificada em
  `bin/axia-amd64-installer.exe`, com 7.020.776 bytes e SHA-256
  `24C234F4820BD5F1431F54718FAF0EE9B312780A3C6921E977CDB42B776915E6`.

### 2026-08-27 — Editor unificado iniciado

- A avaliação da interface mostrou que rótulos adicionais e ações rápidas ainda
  mantinham opções demais. A fase 6 voltou para `EM ANDAMENTO` para substituir as duas
  trilhas visuais por uma única fileira de pontos de cor e transparência.
- O escopo aprovado inclui adicionar múltiplas cores clicando na faixa, configurar
  transparência no próprio ponto e duplicar um ponto com `Alt+arrastar`.
- O contrato interno separado de cor/opacidade será preservado como detalhe do motor;
  a simplificação ocorrerá na camada de interação para evitar regressões no worker,
  preview, seleções e compatibilidade de pixels.

### 2026-08-27 — Editor unificado implementado

- Removidas a fileira superior de opacidade e as duas ações rápidas. O editor apresenta
  somente uma faixa e uma fileira de pontos, reduzindo as escolhas simultâneas.
- Cada ponto selecionado reúne cor, visibilidade, posição, transparência total e
  remoção. “Sem cor (transparente)” alterna o alfa entre 0% e 100%, enquanto o controle
  de visibilidade ainda permite valores intermediários quando necessário.
- Clicar diretamente na faixa xadrez ou na trilha inferior cria uma nova cor com RGB e
  transparência interpolados naquela posição. Portanto o editor continua aceitando até
  32 cores, e não apenas as duas extremidades iniciais.
- `Alt+arrastar` duplica cor e transparência em IDs vinculados e move somente a cópia.
  Arraste normal move o par existente; remover elimina o par sem ultrapassar o mínimo
  seguro de duas cores.
- Configurações produzidas pela interface anterior permanecem aceitas. A associação usa
  IDs vinculados nos pontos novos e posição como fallback nos pontos legados, mantendo
  o contrato do raster e do worker inalterado.
- A leitura de transparência dos marcadores é compilada uma vez por atualização Vue,
  evitando reconstruir o interpolador várias vezes por ponto durante a renderização.
- Testes novos cobrem inserção interpolada, duplicação com `Alt`, movimento conjunto,
  transparência, remoção, inversão, imutabilidade e limites de 32 pontos.
- Validação aprovada com 319 testes frontend, `vue-tsc --noEmit`, build Vite de produção,
  `go test ./...`, `go vet ./...` e `git diff --check`.
- Gerado instalador para validação manual em `bin/axia-amd64-installer.exe`, com
  7.020.804 bytes e SHA-256
  `40417A9AC4D39F9B329B032115D766FDE75A638BE1D32AA388B5EB668C26D5C5`.

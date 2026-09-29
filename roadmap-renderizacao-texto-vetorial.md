# Roadmap — Renderização vetorial e efeitos de texto

## Metadados

- Criado em: 2026-09-28
- Estado geral: `NÃO INICIADO`
- Prioridade: alta para qualidade da ferramenta Texto
- Escopo: preview no canvas, estilos de camada em texto, miniaturas, mesclagem,
  rasterização explícita e exportação
- Roadmap relacionado: `roadmap-ferramenta-texto-profissional.md`

## Problema

Uma camada de texto é conteúdo editável e escalável, não uma imagem com resolução
definitiva. Ao exigir composição raster, o preview pode ficar desfocado, responder
lentamente à digitação ou transformação e gerar contornos de qualidade insuficiente.
Um indicador de carregamento comunica a espera, mas não pode ser a solução para
um pipeline lento ou bloqueante.

O objetivo é manter texto nítido no uso normal, aplicar efeitos de forma consistente
e atualizar efeitos complexos assincronamente, sem impedir a edição. Preview,
miniatura, mesclagem, rasterização explícita e exportação devem representar a mesma
aparência, respeitando a resolução apropriada de cada destino.

## Decisões de arquitetura

1. `TextLayerContent` continua sendo a única fonte de verdade. Canvas, bitmap, URL
   e cache são transitórios e nunca entram no `.axia` ou no histórico.
2. Texto sem efeito e efeitos simples com semântica equivalente usam DOM/SVG nativo
   do WebView. Isso mantém hinting, edição, seleção e resposta imediata.
3. Efeitos complexos usam Worker com `OffscreenCanvas` quando disponível. O worker
   consome o mesmo contrato de texto e estilo, e não cria um segundo modelo.
4. Espessuras são medidas em pixels do documento. Um traçado de 10 px continua com
   10 px quando o texto cresce; ele apenas parece proporcionalmente menor.
5. Em edição/gestos contínuos, latência vem antes da qualidade final. Quando a
   entrada estabiliza, o compositor produz a versão definitiva; a prévia anterior
   continua visível até a troca atômica.
6. Exportação usa qualidade final, sem reutilizar bitmap de viewport. A ordem e a
   semântica dos efeitos são compartilhadas com o preview.
7. Esta fase mantém a stack atual: Vue/TypeScript, Canvas 2D, DOM/SVG, Workers e
   Wails. Não introduzir Zig, WebGPU ou motor próprio de fontes sem benchmark que
   prove uma limitação real dessa base.

## Objetivos mensuráveis

- Digitar, mover caret, selecionar texto e alterar propriedade simples não espera
  um render raster e não apresenta spinner.
- Zoom e pan não acumulam uma fila de recomposições obsoletas.
- Apenas a geração mais recente pode publicar resultado no preview.
- Em 100% de zoom, texto e traçado têm bordas limpas, sem bitmap de baixa resolução
  ampliado artificialmente.
- Salvar, reabrir, exportar, mesclar e rasterizar preservam conteúdo, geometria,
  ordem dos efeitos e espessuras documentais.
- Caches obedecem orçamento de pixels/bytes e liberam recursos não utilizados.

Os números exatos de tempo, memória e taxa de quadros serão definidos depois do
benchmark de baseline em Windows e Linux; não devem ser inventados antes de medir
documentos e fontes reais.

## Níveis de renderização

### Nível A — Apresentação nativa imediata

Para texto sem estilo raster e subconjunto simples aprovado, inicialmente
preenchimento e traçado sólido externo. A camada DOM continua montada durante
digitação e transformação.

- [ ] Confirmar que o traçado segue os glifos, não uma caixa retangular.
- [ ] Converter o traçado pelo inverso da escala de transformação.
- [ ] Não iniciar worker para propriedades inteiramente nativas.
- [ ] Definir transição sem flash quando um estilo deixa o subconjunto nativo.

### Nível B — Compositor raster assíncrono

Para combinações de efeitos, sombras, desfoques, gradientes e padrões. Produz um
buffer de aparência transitório, sem tornar a camada de texto rasterizada.

- [ ] Contrato de entrada serializável e versionado.
- [ ] Bounds expandidos por todos os efeitos.
- [ ] Densidade explícita, limites seguros e qualidade solicitada.
- [ ] Geração e chave verificadas antes de publicar.
- [ ] Buffer anterior preservado até o novo assumir o mesmo slot visual.
- [ ] Cancelamento e descarte no unmount, troca de camada ou documento.

### Nível C — Saída final

Miniatura, exportação, mesclagem e rasterização explícita usam o mesmo núcleo de
composição, com perfil de resolução próprio. Menor resolução só pode reduzir detalhe,
nunca mudar cor, ordem, posição ou espessura semântica do efeito.

## Fase 0 — Auditoria e baseline

Estado: `NÃO INICIADO`

- [x] Mapear os caminhos de texto: DOM, raster transitório, preview de estilo,
  miniatura, exportação, mesclagem e rasterização.
- [x] Registrar quais estilos usam caminho nativo e quais exigem compositor.
- [ ] Medir tempo, memória e quantidade de renders em digitação, mudança de fonte,
  Ctrl+T, zoom, pan e sliders de efeito.
- [ ] Criar documentos de referência: texto curto, parágrafo, texto longo, fontes
  diferentes, traçado, sombra, combinação de efeitos e documento multicamadas.
- [ ] Adicionar instrumentação local de desenvolvimento para geração, invalidação,
  tempo e dimensão dos buffers; ela deve permanecer desligada em release.

Critério de aceite:

- Relatório identifica se o atraso vem de layout, composição, transferência,
  decodificação ou pintura do DOM.
- Nenhuma mudança visual é introduzida nesta fase.

### Registro — 2026-09-29 — Auditoria estática e primeira contenção de trabalho obsoleto

- O projeto já possui compositor compartilhado em `layerStyleCompositor.worker.ts`,
  protocolo de cancelamento, cache LRU de blobs/bitmaps e proteção de geração por
  consumidor. Portanto, criar outro worker não resolveria o gargalo.
- O caminho complexo de texto ainda prepara, no main thread, um canvas em alta
  densidade e o codifica em PNG. O worker decodifica esse PNG novamente, lê seus
  pixels, compõe o efeito, codifica novo PNG e o canvas o decodifica para mostrar.
  Esta ida e volta é o principal candidato a custo percebido em zoom e edição.
- A invalidação anterior só alcançava o compositor depois de a preparação PNG do
  texto terminar. Agora ela ocorre assim que a dependência muda; uma preparação
  que se tornar obsoleta não é enviada ao worker.
- Digitação em texto que exige compositor é coalescida por 120 ms. Transformações
  continuam em 180 ms e camadas de imagem em 40 ms; efeitos nativos de texto não
  passam por esse agendamento.
- Validação desta contenção: 434 testes do frontend, typecheck, build Vite e
  `git diff --check` aprovados.
- Próxima investigação: substituir a preparação PNG intermediária por uma fonte
  transitória que possa ser composta sem recodificação e sem duplicar trabalho
  entre canvas e miniatura, preservando paridade com exportação.

## Fase 1 — Contrato único de aparência

Estado: `NÃO INICIADO`

- [ ] Formalizar `TextAppearanceRequest`: texto normalizado, layout, transformação,
  estilos, bounds do documento, escala, qualidade e versão.
- [ ] Formalizar `TextAppearanceResult`: bounds visuais, offset, densidade,
  geração, chave de cache, bitmap/bytes transferíveis e métricas.
- [ ] Separar escala do documento, escala de transformação e densidade do raster;
  proibir inferência baseada no bitmap anterior.
- [ ] Centralizar ordem dos efeitos, bounds e espessuras em helpers puros testados.
- [ ] Criar fallback cooperativo se Worker/OffscreenCanvas não estiver disponível.
- [ ] Criar chave de cache estável, sem objetos reativos, URLs ou ordem acidental
  de propriedades.

Critério de aceite:

- Preview, worker e exportação formam requisições equivalentes.
- Testes cobrem normalização, bounds, escala, cache e projetos antigos.

### Registro — 2026-09-29 — Fonte tipográfica transitória no worker

- O protocolo do compositor agora diferencia fonte raster (`Blob`) de fonte de
  texto (`TextLayerContent` clonável mais escala de desenho). A alteração é
  estritamente transitória e não muda o formato `.axia`.
- Preview, exportação e mesclagem enviam texto estilizado diretamente ao worker.
  O `OffscreenCanvas` desenha os glifos antes de extrair a máscara alfa e compor
  o estilo; foi removida a preparação main-thread de canvas e PNG para esse caso.
- Imagens continuam no caminho de `Blob`, reduzindo o alcance da mudança e
  preservando o comportamento já validado para camadas raster.
- O núcleo de layout agora aceita contexto 2D de janela e de `OffscreenCanvas`,
  garantindo que quebra de parágrafo, espaçamento e alinhamento sejam calculados
  pelo mesmo algoritmo.
- Foi adicionado teste para o payload de texto do worker, confirmando cópia sem
  referência reativa. Validação: 435 testes, typecheck, build Vite e
  `git diff --check` aprovados.
- Pendente: validação visual em WebView real para fontes instaladas, Unicode,
  nitidez e paridade de traçado antes de considerar a nova fonte aprovada.

### Registro — 2026-09-29 — Correção de escala do texto nativo

- A validação visual revelou que uma camada sem `fx` também ficava borrada. A
  causa não era o worker: texto DOM de tamanho base era ampliado por
  `transform: scale(...)`, permitindo ao WebView ampliar uma textura pequena.
- A apresentação nativa agora materializa fonte, espaçamento, linhas e caixa na
  escala vertical final da camada. Em escala uniforme não sobra transform no
  elemento de texto; em escala não uniforme fica somente a correção horizontal.
- Um teste protege as escalas uniforme e não uniforme. Validação automatizada:
  436 testes, typecheck, build Vite e build Wails Windows aprovados.
- Pendente: validação manual desta build em zoom de ajuste, 100% e zoom alto antes
  de avançar para o próximo gargalo do compositor.

### Registro — 2026-09-29 — Densidade nativa orientada pelo zoom

- A apresentação DOM passou a considerar a escala do viewport, além da escala da
  camada. Em zoom acima de 100%, o texto é materializado em densidade maior e
  compensado por escala inversa, preservando geometria, alinhamento e espessura
  documental do traçado.
- Densidades são quantizadas em poucos degraus para não reconfigurar fonte, layout
  e textura a cada frame do zoom por roda. A área e a dimensão máximas reutilizam
  o orçamento de segurança de 16 MP e 16.384 px.
- Texto simples e traçado nativo usam esse caminho. Efeitos complexos continuam
  no worker, cuja fonte transitória já é criada na densidade do viewport.
- Testes adicionados para escolha de densidade, limite de área e preservação de
  escala uniforme/não uniforme. Validação: 437 testes, typecheck, build Vite e
  build Wails Windows aprovados.
- Gate pendente: validar em WebView real, inclusive no zoom máximo. Caso ainda
  exista pixelização acima do orçamento, a próxima fase será um overlay vetorial
  em coordenadas de tela, fora do `scale()` da superfície do documento.

### Registro — 2026-09-29 — Cobertura do zoom máximo e descarte defensivo

- A escala de densidade ganhou os degraus 24× e 32×, cobrindo o zoom máximo do
  editor quando os limites de dimensão e área permitem. Em textos muito grandes,
  o orçamento de 16 MP e 16.384 px continua reduzindo a densidade de forma
  determinística, em vez de arriscar travamento ou consumo excessivo de memória.
- O worker agora limpa explicitamente os `OffscreenCanvas` temporários usados
  para padrões, fonte e resultado, tanto em sucesso quanto em cancelamento ou
  erro. `ImageBitmap` também permanece fechado no mesmo caminho de finalização.
- Foi acrescentada cobertura para a escolha de 32× em uma camada pequena. A
  validação automatizada permanece em 437 testes do frontend, typecheck, build
  Vite e build Wails Windows aprovados.
- O próximo gate é somente a matriz manual de texto e efeitos no WebView real;
  não há mudança de serialização, de formato de documento ou de cache persistido.

## Fase 2 — Worker, agenda e cache

Estado: `NÃO INICIADO`

- [ ] Implementar um worker dedicado com mensagens `render`, `cancel` e `dispose`;
  nunca criar worker por camada ou por tecla.
- [ ] Usar geração monotônica por camada/sessão; respostas antigas são descartadas.
- [ ] Aplicar debounce curto e adaptativo durante entrada contínua; ao confirmar
  edição ou soltar Ctrl+T/slider, solicitar imediatamente qualidade final.
- [ ] Coalescer mudanças pendentes da mesma camada: digitação rápida vira uma só
  requisição, não uma fila por caractere.
- [ ] Implementar cache LRU limitado por bytes/pixels, indexado por conteúdo,
  layout, estilo, bounds e escala. Cache não é persistido.
- [ ] Reutilizar resultado apenas quando sua densidade for suficiente; nunca ampliar
  um preview de baixa resolução para aparentar nitidez.
- [ ] Limitar trabalho interativo aos bounds visíveis quando seguro, preservando o
  render completo necessário para exportar ou rasterizar.
- [ ] Tratar erro e excesso de orçamento sem perder editabilidade da camada.

Critério de aceite:

- Digitação e zoom contínuos não acumulam trabalho obsoleto.
- Trocar camada/documento impede publicação tardia e libera recursos pendentes.
- Repetir o mesmo estado usa cache sem regressão visual.

## Fase 3 — Handoff visual e feedback

Estado: `NÃO INICIADO`

- [ ] Manter a apresentação DOM/SVG ou o buffer raster anterior até o novo resultado
  estar pronto e decodificado.
- [ ] Trocar buffers no mesmo frame, sem desmontar `CanvasLayer`, deslocar canvas,
  alterar z-index ou capturar ponteiro fora dos pixels reais.
- [ ] Definir estados explícitos: `native`, `rendering`, `raster-ready`, `failed`.
- [ ] Mostrar `Atualizando efeito…` de forma discreta na camada ou barra contextual
  apenas após espera perceptível (referência inicial: 150 ms).
- [ ] Nunca usar modal, barra grande ou bloqueio do canvas durante digitação.
- [ ] Ocultar o indicador ao publicar, cancelar ou descartar uma geração, sem
  piscadas em renders rápidos.
- [ ] Em erro, apresentar mensagem acionável e conservar a camada como texto.

Critério de aceite:

- O indicador explica a espera, mas não mascara gargalo nem altera o layout.
- Usuário pode continuar digitando, mudar de camada, desfazer ou cancelar enquanto
  uma composição antiga é invalidada.

## Fase 4 — Paridade de destinos

Estado: `NÃO INICIADO`

- [ ] Fazer miniatura, exportação, mesclagem e rasterização chamar o núcleo de
  aparência com perfis de qualidade explícitos.
- [ ] Garantir que rasterizar texto seja somente uma decisão explícita do usuário;
  estilos não removem conteúdo ou propriedades editáveis.
- [ ] Cobrir texto em camada inteligente sem serializar caches na camada pai/filha.
- [ ] Definir fallback de fonte ausente para evitar divergência silenciosa entre
  preview e exportação.
- [ ] Verificar DPR, zoom e escala de exportação para impedir traçado incorreto.

Critério de aceite:

- PNG final coincide visualmente com o preview final nos documentos de referência.
- Mesclagem e rasterização incluem bounds completos, sem cortar sombra ou traçado.
- Salvar/reabrir recompõe a mesma aparência, sem persistir cache.

## Fase 5 — Testes, desempenho e liberação

Estado: `NÃO INICIADO`

- [ ] Criar testes de pixels tolerantes para glifos, traçado circular, sombras,
  transparência, escala, rotação e combinações de efeitos.
- [ ] Testar protocolo de worker: cancelamento, ordem de geração, LRU e descarte
  de respostas antigas.
- [ ] Exercitar Unicode, emojis, fontes ausentes, texto longo, parágrafos, zoom
  baixo/alto e documentos com muitas camadas.
- [ ] Perfilar desempenho e memória em Windows e Linux.
- [ ] Executar matriz manual antes de marcar o roadmap como concluído.

## Matriz manual obrigatória

1. Digitar rapidamente em texto simples por vários segundos.
2. Alterar tamanho, família, peso, cor e alinhamento durante a edição.
3. Aplicar traçado externo de 10 px, aumentar e reduzir a camada: ele deve manter
   10 px documentais e parecer proporcionalmente menor ao texto crescer.
4. Alternar entre estilo simples e combinação com sombra/blur sem sumir, piscar ou
   mover o canvas.
5. Fazer zoom in/out contínuo com efeito ativo, sem gargalo perceptível ou linha
   excessivamente grossa.
6. Testar Ctrl+T com escala uniforme, não uniforme e rotação.
7. Validar Undo/Redo, duplicação, camada inteligente, salvar/reabrir, mesclagem,
   rasterização explícita e exportação PNG.
8. Repetir em Windows e Linux.

## Falhas a evitar

- Usar loading como justificativa para bloquear edição.
- Compor por tecla ou por evento individual da roda do mouse.
- Criar traçado por caixa retangular ou ampliar raster de baixa resolução.
- Desmontar a camada enquanto o worker calcula.
- Permitir resposta antiga sobrescrever texto/estilo novo.
- Salvar `ImageBitmap`, `OffscreenCanvas`, URLs ou cache no projeto/histórico.
- Usar algoritmo visual diferente em preview e exportação.
- Introduzir WebGPU/Zig antes de provar por benchmark que a stack atual não atende.

## Critério de conclusão

O roadmap estará concluído quando texto permanecer editável sob todos os efeitos
suportados, a nitidez não depender de bitmap ampliado, o preview for interativo nos
cenários de referência e preview/exportação/mesclagem/rasterização tiverem paridade
visual comprovada por testes e validação manual.

## Ordem de execução

1. Baseline e diagnóstico.
2. Contrato e testes puros de escala, bounds e chaves.
3. Worker, cancelamento, agenda e cache.
4. Handoff visual e feedback discreto.
5. Paridade de exportação e operações de camada.
6. Benchmark, matriz manual e release.

Não adicionar efeitos tipográficos novos antes das fases 0 a 2 demonstrarem nitidez
e responsividade sustentáveis. A prioridade é estabilizar a base, não acumular mais
efeitos sobre um pipeline ainda frágil.

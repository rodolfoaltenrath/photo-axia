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

- [ ] Mapear os caminhos de texto: DOM, raster transitório, preview de estilo,
  miniatura, exportação, mesclagem e rasterização.
- [ ] Registrar quais estilos usam caminho nativo e quais exigem compositor.
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

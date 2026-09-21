# Roadmap de arquitetura do frontend

## Objetivo

Reduzir o papel de orquestrador central do `App.vue` sem alterar a stack
(Vue 3, TypeScript, composables e Wails) e sem introduzir estado global apenas
para dividir arquivos. O `App.vue` continuará dono da composição da tela e do
estado compartilhado enquanto cada fluxo passa a ter um composable com uma
interface explícita.

## Regras de execução

- Extrair um fluxo vertical por vez e preservar os testes existentes antes de
  iniciar o próximo.
- Passar refs e callbacks explicitamente; não introduzir Pinia nesta etapa.
- Manter os módulos puros em `src/editor/` e os efeitos/IO em `src/services/`.
- Medir antes de substituir DOM/WebView por renderização nativa ou tiled.
- Não mudar formatos `.axia`, atalhos ou contratos de backend durante uma
  extração estrutural.

## Fases

### Fase 1 — estabilização e fronteiras de baixo risco

- [x] Tornar os tokens de exportação independentes entre operações simultâneas.
- [x] Evitar hash de todas as camadas quando a prévia de Blend If está inativa.
- [x] Permitir duas gerações de miniatura em paralelo, respeitando o limite de
  CPU e sem liberar paralelismo de memória sem controle.
- [x] Extrair `useDocumentExport()` para concentrar estado, prévia e execução
  da exportação de documento/camada.

### Fase 2 — ciclo de projeto

- [x] Extrair `useProjectLifecycle()` para recentes, descarte e navegação da
  tela inicial.
- [x] Extrair `useProjectPersistence()` para o salvamento `.axia`, manifesto,
  assets e atualização de recentes.
- [ ] Mover o coordenador de abertura depois que seus testes de fluxo cobrirem
  cancelamento, assets, previews e histórico.
- [ ] Manter criação/restauração de manifestos em `services/project`.
- [ ] Cobrir abertura, cancelamento e recuperação de falha com testes de fluxo.

### Fase 3 — operações de camada

- [x] Extrair `useLayerActions()` para criação, texto, duplicar, ordem,
  visibilidade, opacidade, mesclagem e exclusão.
- [ ] Mover rasterização e mesclagem de camadas depois de isolar seus fluxos
  de renderização e ciclo de assets.
- [x] Extrair `useLayerStylePresets()` para biblioteca, aplicação e persistência
  de estilos; a edição temporária e a janela nativa permanecem no fluxo próprio.
- [ ] Extrair `useSmartLayerActions()` separadamente; sessões de edição
  inteligente não devem se misturar ao fluxo de camadas rasterizadas.
- [ ] Extrair `useLayerStyleActions()` e manter a janela Wails como adaptador
  de IO, não como estado de domínio.

### Fase 4 — seleção e ferramentas

- [ ] Extrair `useSelectionActions()` e preservar a barreira de mutações.
- [ ] Agrupar pincel, balde, gradiente e formas por contratos de rasterização,
  sem misturar regras de UI com workers.

### Fase 5 — medição antes de nova infraestrutura

- [ ] Cenários reproduzíveis: 10, 50, 100 e 300 camadas.
- [ ] Documentos: 4K, 8K, 32 MP e 64 MP.
- [ ] Registrar FPS, latência de arraste, Ctrl+Z, exportação e pico de RAM.
- [ ] Avaliar renderização tiled somente se os limites forem comprovados pelos
  benchmarks; avaliar código nativo apenas para hot paths perfilados.

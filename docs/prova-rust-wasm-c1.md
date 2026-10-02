# Prova de conceito Rust/WASM — C1 parcial

Estado: **empacotada para diagnóstico explícito, sem ligação com o
preview/exportação**. Esta primeira fatia verifica toolchain, ABI mínima,
arredondamento, alfa
transparente e comparação determinística com o código TS; não é o compositor
de documento nem a ABI V1 definitiva.

O crate `rust/axia-pixel-core` não possui dependências externas. Usa Rust
1.98.1 e `wasm32-unknown-unknown` fixados em `rust-toolchain.toml`, com
`Cargo.lock` versionado. No Windows usado nesta prova, o host instalado foi
`x86_64-pc-windows-gnu` para evitar instalar MSVC antes de haver necessidade
demonstrada. Uma build nativa Windows futura deverá reavaliar o host e testar
suas dependências, não assumir que este POC resolve isso.

Para reproduzir na raiz do repositório, com Rust e Node no `PATH`:

```powershell
cargo test --offline --locked --manifest-path rust/axia-pixel-core/Cargo.toml
cargo clippy --offline --locked --all-targets --manifest-path rust/axia-pixel-core/Cargo.toml -- -D warnings
cd frontend
npm run test:rust-poc
npm run build
npm run test:rust-bundle
npm run benchmark:rust-poc -- 512 10
npm run benchmark:rust-tiles -- 1024 256 10
npm run benchmark:rust-blend-if -- 1024 20
```

Para o smoke de navegador, execute `npm run preview` em outro terminal e
`npm run smoke:rust-poc` em `frontend/`. O script abre um Edge headless local,
consulta o diagnóstico por tempo real e encerra o processo. No Windows,
`npm run smoke:rust-wails` recompila o frontend, confere o bundle, constrói um
executável de produção em uma pasta temporária e testa o mesmo diagnóstico no
WebView2 do Wails. A janela fica oculta; a conexão DevTools usa uma porta local
e um perfil WebView2 temporário. O script encerra o executável e tenta remover
somente essa pasta temporária. Nenhum dos dois comandos altera o editor normal
ou substitui um instalador/portável existente.

O teste WASM usa o golden `fill-opacity-rounding` e compara todas as 25.856
combinações de alfa (0–255) e opacidade inteira (0–100) com
`composeLayerStyleRaster`. Também verifica rejeição de argumentos inválidos.
O contrato experimental agora aceita uma região em coordenadas absolutas de um
raster maior e devolve RGBA compacto. O teste remonta tiles com bordas parciais
e compara byte a byte com o raster TS inteiro para cinco opacidades, incluindo
alfa zero. Há validação de limites e sobreposição de buffers antes de escrever.
O Worker e o diagnóstico explícito também exercitam a nova mensagem
`render-region`. Esse pedido avulso ainda transfere o raster fonte completo.
O protocolo experimental `stage-source` transfere e copia a fonte uma vez para
a memória WASM, devolve um identificador temporário e permite vários pedidos
`render-staged-region` sem copiar novamente a fonte. `release-source`, troca da
fonte e `dispose` liberam a alocação; identificadores antigos são rejeitados.
Cada edição, undo/redo e troca de documento devem avançar uma `generation`
inteira monotônica na sessão do Worker (não reiniciada por documento). O comando
`invalidate-source` descarta a fonte anterior antes de os novos pixels ficarem
prontos; `stage-source` também avança a geração antes de validar/alocar, de
modo que uma falha não preserve pixels obsoletos. Uploads atrasados com geração
igual ou menor são rejeitados. A resposta de `render-staged-region` inclui
`sourceId` e `generation`; o futuro chamador deve compará-los com o estado
atual antes de publicar o tile, pois um render síncrono já concluído não pode
ser retirado da fila de respostas.
Cancelamento do Worker só se aplica a pedidos de renderização; comandos de
invalidação, preparação e liberação são barreiras de correção e não podem ser
cancelados. Um `init`/`dispose` ainda encerra a sessão inteira.
O consumidor experimental `RustPixelPocTileGate` fecha a publicação no lado TS:
ele invalida tokens imediatamente ao mudar fonte ou parâmetros visuais,
confere ID do pedido, `sourceId` e `generation` da resposta e aceita somente
o pedido mais recente por chave de tile. O diagnóstico empacotado percorre
esse gate; testes puros simulam respostas atrasadas e tiles independentes.
Ao integrá-lo, a chave do tile deve distinguir região e resolução de saída;
ela não é uma chave de cache persistente do documento.
O chamador futuro deverá chamar `beginSourceChange()` no momento da edição
(antes de esperar o Worker) e `beginViewChange()` quando zoom/estilo mudar.
Isto ainda não está conectado ao preview normal.

O adaptador experimental `rasterPreviewSnapshot`/`RustPixelPocPreviewObserver`
classifica os sinais que o editor já possui:

| Mudança observada | Ação conservadora |
| --- | --- |
| Documento/camada, `previewUrl`/`sourceUrl`, `editToken` ou dimensões do raster | Avançar geração da fonte; descartar tiles anteriores. Undo/redo que restaure outra fonte também entra aqui. |
| Estilo/luz global, opacidade, modo/visibilidade, transform, fundo ou `stackKey` | Preservar bytes da fonte; invalidar os tokens de vista. |
| Escala **visual animada**, DPR, scroll/pan ou tamanho do viewport | Preservar fonte; invalidar os tokens da grade/área visível. |

O mapeamento corresponde aos sinais de `useLayerStyleRaster` (fonte/estilo),
`useCanvasNavigation` (zoom/pan), `refreshLayerPreview` e
`applyHistorySteps`/`resetEditorScopeRuntime` (preview/histórico/troca de
escopo). O `stackKey` deve ser fornecido pelo futuro chamador e mudar quando
outra camada afetar a composição; o adaptador **não** calcula a pilha.
Ao conectá-lo a pan/zoom, passar um hash de estilos memoizado e
atualizar só a identidade do viewport por frame; não recalcular o hash de
estilos em cada evento de scroll.
Alterar pixels mantendo URL e dimensões exige mudar `editToken`, ou a troca
ficaria invisível. Texto/forma ainda não são fontes suportadas por esta POC.
O diagnóstico usa snapshots sintéticos para exercitar o adaptador no Wails;
nenhum `watch` adicional foi instalado no `App.vue` ou no caminho quente.
Há apenas uma fonte preparada por runtime, sem ownership do documento Rust.
Isto ainda não prova desempenho do compositor real ou estilos combinados.
O pré-build gera o `.wasm` em `target/`, copia-o para `frontend/src/generated/`
(ambos ignorados pelo Git) e deixa o Vite emitir um asset local com hash.
`main.ts` só importa o diagnóstico quando a URL contém `?axiaRustPoc=1`;
na abertura normal o Worker não inicia. `npm run test:rust-bundle` verifica
que os bytes gerados pelo Cargo são idênticos aos empacotados e que os chunks
do Worker/diagnóstico estão referenciados. `rustPixelPoc.worker.ts` usa um
protocolo isolado para inicializar, renderizar, cancelar uma pendência e
descartar o runtime. O harness Node executa
o **mesmo módulo de Worker** por uma ponte mínima de mensagens; valida
transferência dos buffers (a fonte é destacada da thread de origem), erros e
descarte. O teste de Worker passou 20 execuções consecutivas nesta máquina.
Em 2026-10-01, o diagnóstico ampliado com `render-region` e fonte reutilizável passou no
executável Wails/WebView2 temporário, com o Go fixado pelo `go.mod`; o build
Vite e a integridade do bundle passaram na mesma rodada. Isto continua sendo
smoke de protocolo, não validação visual/manual do compositor.
Em 2026-09-30, o build Vite e o diagnóstico em Edge headless servido por
`vite preview` passaram (`data-axia-rust-poc="passed"`). Um teste anterior
com `--dump-dom --virtual-time-budget` produziu um timeout artificial do
diagnóstico; a repetição pelo protocolo DevTools, aguardando tempo real,
passou. O smoke em um **executável de produção Wails/WebView2 temporário**
também passou em três execuções consecutivas. Isso comprova o carregamento
nesse runtime, mas **não** valida um instalador efetivamente instalado, nem
paridade de renderização no editor. Esse smoke usou Go 1.27.0 e Node 24.19.0
do `PATH`, ainda não as versões fixadas para o gate de reprodutibilidade.
Cancelamento não interrompe uma
chamada WASM síncrona; o chamador também precisa ignorar IDs obsoletos.

A ABI `axia_poc_*` é interna e experimental: o adaptador JS deve passar
somente ponteiros alocados por `axia_poc_alloc` e liberar cada par
ponteiro/comprimento uma única vez; o runtime TS e o harness respeitam esse
contrato, mas ainda não há validação nativa de handles. Não a expor
como API pública ou a dados não confiáveis. Antes de ligar ao compositor do
app, testar o pacote instalável, cópias de memória e desempenho end-to-end.

O workflow `.github/workflows/rust-wasm-proof.yml` roda a prova portátil em
Windows e Linux a cada push/PR. Ele testa o núcleo Rust, o contrato Worker,
o frontend e a integridade do bundle; no Windows também roda os testes Go.
O smoke Wails/WebView2 no runner hospedado é acionado apenas por
`workflow_dispatch`, pois ainda precisa ser observado nessa imagem. Nenhum
resultado de CI deve ser presumido antes da primeira execução.

## Primeira medição do POC, sem meta de desempenho

No Windows x64, Intel i7-3770, Node **24.19.0 do PATH** (ainda não o Node
24.14.1 fixado), 3 aquecimentos e 10 amostras, o benchmark de Worker isolado
observou:

| Raster | Mediana total por pedido | p95 amostral | Mediana cópia entrada + saída WASM | Mediana kernel |
| --- | ---: | ---: | ---: | ---: |
| 512 × 512 (1 MiB RGBA) | 2,082 ms | 2,989 ms | 0,311 ms | 1,213 ms |
| 1024 × 1024 (4 MiB RGBA) | 9,512 ms | 11,584 ms | 1,882 ms | 5,227 ms |

O total inclui a cópia da fonte preservada pelo chamador, mensagens, alocação,
cópias e kernel. Inicializar o Worker/WASM levou cerca de 97–102 ms nessas
duas execuções Node; ele deve ser reutilizado. O p95 de apenas 10 amostras
é instável. Isto **não** compara rotas equivalentes TS/Rust, não mede WebView,
Canvas, decode, UI/FPS ou consumo de memória e não autoriza trocar o preview.
Repetir com Node fixado, hardware alvo e documentos reais antes do gate C1.

Uma sonda separada (`npm run benchmark:rust-tiles -- 1024 256 10`) compara
pedidos de tile que reenviam a fonte com pedidos que a reutilizam. Em
2026-10-01, Windows x64/i7-3770/Node fixado 24.14.1, fonte RGBA 1024²,
tile 256² e 10 amostras após três aquecimentos, a mediana total foi
2,532 ms com reenvio e 0,717 ms com fonte reutilizada; preparar a fonte
custou 5,012 ms uma vez. A sonda inclui mensagens do Worker e cópia do
chamador; não mede Canvas, UI/FPS, invalidação de cache ou documentos reais.
As amostras são poucas e os modos são executados em sequência fixa; repetir
em máquinas alvo antes de usar esses números como critério de produto.

Esta comparação prova apenas o passe sem efeitos de opacidade de preenchimento
em um fundo transparente. Não prova paridade para estilos combinados, Canvas,
transformações, texto, exportação, preview ou gargalos de interação. O restante
do C0 permanece aberto, conforme o roadmap.

## Segunda fatia: Mesclar se da camada abaixo — C2 parcial

Em 2026-10-02, `rust/axia-pixel-core/src/blend_if.rs` passou a executar o
mesmo passe puro de `applyLayerStyleBlendIfUnderlying`, separado da modelagem
do documento. A ABI experimental `axia_poc_blend_if_underlying_region` recebe
raster fonte, dimensões/posição absoluta da região, backdrop compacto alinhado
com a região, saída distinta, canal (0=cinza, 1=R, 2=G, 3=B) e quatro
marcadores inteiros normalizados. Pares devem estar ordenados e entre 0 e 255;
o chamador TS normaliza o documento antes do envio. Rust rejeita canal/faixas,
dimensões, comprimento ou overlap inválidos antes de escrever a saída.

O passe altera somente alfa e preserva RGB oculto, inclusive quando o novo
alfa fica zero. Isso é diferente do passe de fill opacity sobre transparência,
que zera RGB quando o pixel deixa de contribuir. O canal cinza segue a ordem
`R * 0.2126 + G * 0.7152 + B * 0.0722` em f64; transições rígidas usam
comparações estritas e transições divididas usam os mesmos fatores/arredondamento
do TS. O algoritmo atual consulta RGB do backdrop **independentemente de seu
alfa**. Essa semântica foi preservada e testada, não reinterpretada no porte.

O comando Worker `blend-if-staged-region` reutiliza a fonte preparada e
transfere somente o backdrop da região. A resposta `rendered-staged-region`
identifica `sourceId`/`generation` e é verificada pelo mesmo gate de tiles.
Editar camada inferior deve mudar a revisão de pilha/vista imediatamente;
manter a geração da fonte não torna válido um tile calculado com outro backdrop.
O teste de integração exercita essa invalidação e confirma que não precisa
reenviar a fonte. O comando é cancelável quando pendente, sob a mesma limitação
das outras chamadas WASM síncronas; não interrompe um kernel já em execução.

O backdrop deve ser o raster **já composto** das camadas inferiores no estágio
e nas coordenadas corretas. O Rust deste POC não o calcula e não aplica
automaticamente fill opacity/estilos antes desse passe. As entradas são RGBA8
reto na mesma densidade; não há transformação/reamostragem, perfil ICC/P3 ou
halo neste passe pontual. Fonte, backdrop e saída têm limite individual de
64 MiB; o orçamento agregado/temporários do compositor ainda precisa de gate.
Liberar alocações não reduz automaticamente o tamanho da memória linear WASM.

Validação desta fatia:

- **8 testes nativos Rust** e Clippy sem avisos, incluindo os cinco testes
  anteriores de fill opacity.
- **479 testes frontend** e typecheck; as duas suítes novas da prova WASM
  também são verificadas por `test:types`, mas executadas por `test:rust-poc`
  após seu prebuild, evitando depender de WASM gerado em `npm test`.
- **16 testes na prova WASM/Worker**: os seis anteriores mais dez novos.
  Os quatro testes de canais usam 256 alfas × 256 valores de backdrop × oito
  configurações = **2.097.152 pixels comparados**, com luma fracionária no cinza.
  Incluem extremos, marcadores coincidentes, RGB oculto e backdrop transparente.
- Tiles de borda de um raster 7×5 recompostos contra o passe TS inteiro nos
  quatro canais; fonte e backdrop somente leitura. Uma sequência fill opacity
  → Blend If confirma que os dois arredondamentos são mantidos.
- Erros de ABI/adapter, fonte invalidada e recuperação depois de pedido inválido;
  Worker real com transferência do backdrop e gate de publicação por vista.
- Build local/bundle íntegro (WASM **25.461 bytes**) e diagnóstico explícito
  em executável temporário Wails/WebView2 passaram, agora também com Blend If.

O benchmark `npm run benchmark:rust-blend-if -- 1024 20` alterna a ordem dos
dois modos depois de três aquecimentos, compara cada saída fora da janela
medida e registra preparação da fonte uma vez. Em Windows 10.0.26200,
i7-3770/Node fixado 24.14.1, com canal cinza e RGBA sintético 1024²:

| Etapa | Mediana | p95 amostral (20 amostras) |
| --- | ---: | ---: |
| TS atual, cópia da fonte + passe puro | 137,647 ms | 153,573 ms |
| Adapter Rust/WASM, backdrop + saída + kernel | 21,796 ms | 24,903 ms |
| Kernel Rust dentro do adapter | 19,156 ms | 20,369 ms |
| Cópia do backdrop para WASM | 0,604 ms | 1,198 ms |
| Cópia da saída de WASM | 1,319 ms | 2,956 ms |

Preparar a fonte custou **1,931 ms** uma vez. As medianas dos componentes
não devem ser somadas para reconstruir a mediana total. O TS preserva a fonte
com uma cópia por pedido; Rust a mantém preparada e aloca a saída/backdrop.
Além disso, o TS atual normaliza a configuração dentro da função de opacidade
para cada pixel; Rust valida marcadores uma vez por pedido. Logo, o resultado
compara **as implementações atuais**, não isola linguagem, compilador ou SIMD.
Não houve medição de ganho visual: Worker/mensagens, decode/encode, Canvas,
GPU, cache da pilha e documentos reais estão fora desta sonda.

A feature normal de Mesclar se continua utilizando TS/Canvas. C0/C1/C2 seguem
abertos até os gates de paridade, memória, plataformas e pacote distribuível;
este segundo passe só roda na prova/diagnóstico explícitos.

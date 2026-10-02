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

## Terceira fatia: Sobreposição de cor e mesclagem de efeitos — C2 parcial

Em 2026-10-02, `color_overlay.rs` passou a reproduzir o passe puro de
Sobreposição de cor. `composite.rs` fornece mesclagem de efeito com RGBA8 reto
nos seis modos já suportados: normal, multiply, screen, overlay, darken e
lighten. A ordem de operações f64 e os arredondamentos positivos equivalentes
a `Math.round` foram mantidos. Isso **não** é ainda a composição das camadas
do documento, nem prova equivalência com `globalCompositeOperation` do Canvas.

Contrato da ABI interna `axia_poc_color_overlay_region`:

- Fonte RGBA original preparada, dimensões e região absoluta de origem.
  Seu alfa é a máscara do efeito; não usar o alfa pós-preenchimento/estilos.
- Target RGBA compacto com a aparência já composta no estágio de sobreposições;
  mesmo tamanho/densidade da região. Ele pode incluir fill opacity e efeitos
  internos anteriores. O passe não repete esses estágios.
- Cor RGBA com quatro bytes, opacidade finita **fracionária** de 0 a 100 e
  modo inteiro 0=normal, 1=multiply, 2=screen, 3=overlay, 4=darken, 5=lighten.
  Parsing/normalização de cor e documento continuam no chamador TS; a prova
  de fill opacity anterior ainda aceita apenas preenchimentos inteiros.
- Saída distinta com os mesmos bytes do target quando o efeito não contribui,
  preservando inclusive RGB oculto. Fonte e target não são modificados.
- Status 0=sucesso, 1=dimensões/comprimentos inválidos, 2=efeito inválido,
  3=ponteiro nulo, 5=saída sobreposta a uma entrada. Validar antes de escrever.

O Worker aceita `color-overlay-staged-region` e transfere somente o target do
tile, reutilizando a fonte original preparada. Retorna `rendered-staged-region`
com ID/geração e timings do adapter. Alterar parâmetros do efeito exige avançar
a versão visual do gate, mesmo sem trocar a fonte; uma resposta anterior não
pode substituir o efeito mais recente. Cancelamento segue limitado a pedidos
pendentes, nunca interrompe um kernel WASM síncrono.

São passes pontuais alinhados na grade de entrada: sem reamostragem, halo ou
transformação. Cada buffer tem limite individual de 64 MiB, **não** orçamento
agregado fechado. A ABI continua confiando em pares ponteiro/comprimento
alocados pelo adapter, sem validação nativa de handles. O runtime guarda uma
fonte: encadear Mesclar se subjacente exige preparar os pixels **já estilizados**,
enquanto múltiplas sobreposições precisam manter a máscara **original**. Os testes
exercitam essa distinção; não existe ainda executor de pilha/batch para ocultá-la.

Validação desta fatia:

- **13 testes nativos Rust**, Clippy sem avisos e formatação verificada.
- **480 testes frontend** e typecheck das novas suítes/benchmark.
- **29 testes WASM/Worker**: 16 anteriores e 13 novos. Seis matrizes cobrem
  256 alfas × 256 valores RGB × seis configurações de preenchimento/cor/opacidade
  × seis modos = **2.359.296 pixels comparados byte a byte**. Não é uma
  enumeração de todas as possíveis cores RGBA; inclui limiares RGB 127/128,
  fill 0/1/37,5/60/100, opacidade fracionária e alfa da cor 1/128/255.
- Novo golden fixo `color-overlay-partial-fill` no corpus compartilhado,
  preservando os demais esperados; tiles de borda em raster 7×5 após efeito
  interno, duas sobreposições usando a máscara original e sequência
  fill → sobreposição → Mesclar se. Nenhuma tolerância nesses testes puros.
- Transparência, RGB oculto, entradas somente leitura, fonte reaproveitada,
  limites/overlap/NaN/cor incompleta ou esparsa, erro seguido de recuperação e
  geração invalidada. O teste Worker existente também cobre o novo comando,
  transferência do target e mudança visual sem reenviar a fonte.
- Build/bundle íntegros, WASM **28.642 bytes**, e diagnóstico explícito no
  executável temporário de produção Wails/WebView2 passaram, incluindo a cor.
  Não foi produzido/validado instalador nesta fatia.

O benchmark `npm run benchmark:rust-color-overlay -- 1024 20` compara o
compositor TS atual com fill + um efeito e duas chamadas do adapter Rust para
a mesma saída. **Inclui** alocações, cópia do preenchimento WASM → JS, reenvio
do target JS → WASM e cópia final; preparar a fonte ocorre uma vez, à parte.
Alterna ordem, faz três aquecimentos e confere bytes fora da janela medida.
Windows 10.0.26200/i7-3770/Node fixado 24.14.1, RGBA sintético 1024²,
fill 60%, cor `#cb47958f`, opacidade 73,5%, modo overlay:

| Etapa | Mediana | p95 amostral (20 amostras) |
| --- | ---: | ---: |
| Compositor TS atual, preenchimento + sobreposição | 158,081 ms | 174,552 ms |
| Adapter Rust/WASM, ambas as chamadas e cópias | 87,099 ms | 103,977 ms |
| Soma dos dois kernels Rust por amostra | 83,955 ms | 100,891 ms |
| Cópia do target para WASM | 0,574 ms | 1,056 ms |
| Cópias de saída, intermediária + final | 2,124 ms | 3,548 ms |

Preparar a fonte custou **1,512 ms** uma vez. Medianas de componentes não se
somam para reconstruir a mediana total. O TS passa pelo seu pipeline atual
(máscara/insets/normalização/alocação); Rust usa configurações já convertidas
e fonte preparada. A sonda compara implementações, não ganho isolado de
linguagem/SIMD. São tempos de CPU/adapter em Node: não incluem Worker/mensagens,
Canvas, encode/decode, UI, GPU, memória de pico ou documentos reais. Um passe
de ~87 ms em 1024² não autoriza declarar interação fluida; região/agendamento,
batch sem cópias intermediárias e profiling dos kernels ainda são trabalho futuro.

O preview normal continua em TS/Canvas/DOM. C0/C1/C2 não foram encerrados e
o novo passe permanece restrito aos testes e diagnóstico explícito.

## Quarta fatia: Sobreposição de padrão — C2 parcial

Em 2026-10-02, `pattern_overlay.rs` passou a executar o passe puro de
Sobreposição de padrão, reutilizando `composite.rs` para os seis modos de
mesclagem. Mantém o alfa original da camada como máscara, aceita target já
composto e preserva todos os bytes quando o efeito não contribui. Usa a mesma
amostragem nearest-neighbor/repetição e a mesma ordem de aritmética e
arredondamento do TS. Não adiciona filtragem nova ou muda a aparência do efeito.

Contrato da ABI interna `axia_poc_pattern_overlay_region`:

- Fonte/máscara RGBA original preparada, dimensões, região absoluta e target
  compacto na mesma grade; saída distinta. `x/y` da região são usados para
  amostrar o padrão, nunca substituídos por coordenadas locais ao tile.
- Padrão **já decodificado** em RGBA8 reto, ponteiro/comprimento e dimensões
  positivas inteiras. Cada eixo tem limite de 8.192 e o raster até 64 MiB,
  conforme os limites atuais de estilo. Rust não lê URLs nem arquivos.
- Cosseno/seno f64, fator de escala e opacidade finita de 0 a 100, inclusive
  fracionária; modos 0=normal, 1=multiply, 2=screen, 3=overlay, 4=darken, 5=lighten.
  Coeficientes são finitos, no intervalo [-1,1] e formam rotação unitária
  (erro de norma até 1e-12); fator de escala no intervalo [0,01,10].
- O adapter TS recebe ângulo **normalizado [-180,180)** e escala **[1,1000]%**.
  Calcula `radians = -angle * Math.PI / 180`, `Math.cos`, `Math.sin` e
  `Math.max(0.01, scale / 100)` uma vez por pedido. Rust faz o laço de pixels;
  não troca a função trigonométrica da referência por outra implementação.
- A repetição segue `floor(((coordenada % tamanho) + tamanho) % tamanho)`,
  preservando o duplo resto e suas decisões próximas de zero/período.
  Simplificar para outro wrap pode mudar pixels em rotações de 90°/180°.
- Status 0=sucesso, 1=dimensões/comprimentos inválidos, 2=efeito inválido,
  3=ponteiro nulo, 5=saída sobreposta à fonte, target ou textura. Validação
  ocorre antes da escrita; entradas permanecem somente leitura.

Para manter paridade com o compositor existente, a âncora é a origem **da grade
preparada**, que pode incluir o padding de estilos externos. Não é ainda uma
âncora global de documento: se houver halo, o chamador precisa preparar a
máscara original com o mesmo padding da aparência e manter offsets/grade nos
pedidos. O teste com sombra valida essa montagem usando TS para produzir o
efeito externo. Não porta blur/sombra, geração de halo nem transforma camadas.
O `linkWithLayer` atual não altera a amostragem no passe TS puro; o porte
preserva isso, sem implementar posicionamento independente do documento.

O comando `pattern-overlay-staged-region` transfere o target e a textura,
reutilizando a fonte original. A textura ainda é copiada para WASM **por pedido**,
sem cache/handle persistente de asset. Ao mudar padrão/ângulo/escala/opacidade,
o chamador deve avançar a versão visual do gate mesmo se a máscara não mudou.
IDs ultrapassados e gerações antigas não podem publicar. Cancelamento é de
pedidos pendentes, não interrupção do kernel síncrono.

O POC exige padrão decodificado e rejeita raster ausente/incompleto. No pipeline
de produto, efeito sem asset selecionado continua sendo um no-op no TS; asset
selecionado mas não decodificado continua retornando `LayerStylePatternMissingError`.
Essa distinção ainda precisará ser preservada pelo futuro chamador Rust, não
convertida em fallback silencioso. A nova ABI é interna, não API pública.

Validação desta fatia:

- **16 testes Rust**, Clippy sem avisos e formatação verificada.
- **480 testes frontend** e typecheck, incluindo benchmark e harness Worker TS.
- **43 testes WASM/Worker**: 29 anteriores e 14 novos. As seis matrizes usam
  256 alfas de máscara × 256 posições de textura × seis configurações × seis
  modos = **2.359.296 pixels comparados byte a byte**. A configuração de ângulo
  0/escala 100 percorre todos os pares de alfa máscara/textura em cada modo;
  outras configurações cobrem preenchimento/opacidade fracionários, rotações
  negativas, 90°/próximas de 180°, escalas 1/37,5/99,9999/101,25/1000%.
- O golden fixo `pattern-overlay-tiling` foi reaproveitado sem modificar
  esperados. Tiles de um raster 17×11 com padrão 3×2 cobrem oito ângulos × seis
  escalas, incluindo 0,1°, repetição negativa e bordas ímpares. O raster inteiro
  TS e os tiles remontados têm os mesmos bytes, sem tolerância.
- Combinação sombra externa + cor + padrão nos seis modos, preservando origem
  de amostragem e offsets; cor → dois padrões com fill 0%, máscara original e
  arredondamento entre estágios; textura transparente e RGB oculto.
- ABI/adapter rejeitam dimensões, limites, NaN/Infinity, rotação inválida,
  região fora da fonte e overlap parcial da saída com as três entradas.
  Pedido inválido seguido de recuperação e fonte liberada foram verificados.
- Worker real transfere target/textura, mantém ID/geração da máscara e rejeita
  publicação após troca de aparência, pedido mais recente ou invalidação.
  O harness TS agora é compartilhado com a suíte Blend If/cor e libera timers
  e pendências também se a thread encerrar ou `postMessage` falhar.
- Build/bundle íntegros com WASM **34.233 bytes** e diagnóstico explícito em
  executável temporário de produção Wails/WebView2 passaram, incluindo padrão.
  Nenhum instalador novo foi produzido ou validado nesta fatia.
- Corrigida a métrica `wasmBytes` do diagnóstico: capturar o tamanho antes de
  transferir o buffer ao Worker, pois após transferência o buffer é detached e
  reportava zero. O smoke Wails agora exige tamanho igual ao artefato gerado;
  o smoke Edge também verifica tamanho positivo. Não altera o kernel/preview.

O comando `npm run benchmark:rust-pattern-overlay -- 1024 20` alterna TS/Rust
depois de três aquecimentos e confere cada saída fora da janela medida. A sonda
compara fill + padrão no compositor TS atual com duas chamadas do adapter Rust,
**incluindo** cópias intermediárias, alocações, upload da textura por pedido e
cópia final. Fonte/padrão já estão decodificados; preparar a fonte é custo separado.
Windows 10.0.26200/i7-3770/Node fixado 24.14.1, fonte RGBA sintética 1024²,
padrão 31×17 (2.108 bytes), fill 60%, ângulo normalizado -33,333°, escala 175,5%,
opacidade 73,5% e modo overlay:

| Etapa | Mediana | p95 amostral (20 amostras) |
| --- | ---: | ---: |
| Compositor TS atual, preenchimento + padrão | 295,777 ms | 325,142 ms |
| Adapter Rust/WASM, ambas as chamadas e cópias | 163,597 ms | 201,000 ms |
| Soma dos dois kernels Rust por amostra | 159,624 ms | 197,681 ms |
| Cópia do target + padrão para WASM | 0,600 ms | 1,190 ms |
| Cópias de saída, intermediária + final | 2,318 ms | 3,675 ms |

Preparar a fonte custou **1,621 ms** uma vez. Não somar medianas dos componentes.
A comparação mede implementações atuais: TS usa seu pipeline e calcula
trigonometria no amostrador por pixel; o adapter Rust calcula coeficientes uma
vez e reutiliza a fonte. Não isola linguagem/SIMD e não garante o mesmo resultado
de desempenho com texturas grandes. Worker/mensagens, UI, GPU, Canvas,
decode/encode e pico de memória não estão incluídos.

~164 ms para um raster inteiro 1024² continua acima de um orçamento interativo.
Profiling do kernel, regiões sujas, cache de textura, batch sem cópias
intermediárias e orçamento agregado precisam ser avaliados antes de ligar esse
passo ao preview. Os quatro buffers têm limite **individual**, não teto agregado
do compositor; liberar alocações não encolhe a memória linear do WASM.
O contrato de ponteiros continua confiando nas alocações do adapter, sem
validação nativa de handles. C0/C1/C2 seguem abertos e o preview normal não mudou.

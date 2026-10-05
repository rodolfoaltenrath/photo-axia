# Prova de conceito Rust/WASM — C1 parcial

Estado: **empacotada para diagnóstico explícito, sem ligação com o
preview/exportação**. Esta primeira fatia verifica toolchain, ABI mínima,
arredondamento, alfa
transparente e comparação determinística com o código TS; não é o compositor
de documento nem a ABI V1 definitiva.

Os [cuidados de implementação](cuidados-implementacao.md) concentram as
explicações de segurança, renderização e desempenho; no código ficam avisos curtos.

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
modo que uma falha não preserve pixels obsoletos. A invalidação reserva sua
geração para um único upload substituto; outras gerações já usadas ou menores
são rejeitadas. A resposta de `render-staged-region` inclui
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

## Quinta fatia: Mesclar se — Esta camada — C2 parcial

Em 2026-10-02, `blend_if.rs` passou a executar também o filtro da própria camada,
que no TS é o último passe de `composeLayerStyleRaster`. Reutiliza a mesma
matemática de canal/faixas da fatia subjacente, sem consultar backdrop. O tipo
Rust comum agora é `BlendIfConfig`; `UnderlyingBlendIf` permanece como alias
de compatibilidade. No adapter TS, `RustPixelPocBlendIf` compartilha configuração
e validação; `RustPixelPocUnderlyingBlendIf` também permanece como alias.
O passe anterior e seus testes não mudaram de semântica.

Contrato de `axia_poc_blend_if_this_layer_region`:

- Raster RGBA8 reto **já composto/estilizado**, dimensões e região absoluta na
  grade preparada, saída distinta. Sem buffer de máscara/backdrop adicional.
- Canal 0=cinza, 1=R, 2=G, 3=B; pares normalizados de sombras/highlights com
  quatro marcadores inteiros de 0 a 255 e ordenação global. A mesma validação
  Rust dos dois passes rejeita canal/faixas inválidos antes de escrever.
- Filtra alfa conforme o RGB **desse próprio raster**. O canal cinza mantém
  `R * 0.2126 + G * 0.7152 + B * 0.0722`, sem arredondar luma intermediária.
  Marcadores rígidos mantêm comparações estritas; divididos mantêm a rampa TS.
- Copia/preserva RGB, inclusive oculto; pixels com alfa zero continuam zero.
  Reduzir alfa a zero não limpa RGB, ao contrário do fill sobre transparência.
- Status 0=sucesso, 1=dimensões/comprimentos/região inválidos, 2=canal/faixas,
  3=ponteiro nulo, 5=saída sobreposta à fonte, inclusive overlap parcial.

O Worker aceita `blend-if-this-layer-staged-region`, reutiliza a fonte e retorna
`rendered-staged-region` com ID/geração/timings. Alterações **só** de faixas/canal
podem reutilizar o raster preparado, mas exigem avançar a versão visual do gate.
Mudanças no conteúdo, preenchimento, efeito, resolução ou padding que alterem
o raster estilizado exigem **outra fonte/geração**, não só nova vista.

Consequência para o futuro cache/observador: o `sourceKey` desse estágio deve
identificar o raster derivado com seus estilos/fill/halo/densidade. A chave da
imagem/máscara original usada pelas sobreposições não basta. O observador
experimental agora possui um construtor específico para o raster estilizado,
descrito na sexta fatia abaixo. Ainda não foi ligado ao editor; não reaproveitar
a classificação de alterações da máscara como contrato de fonte estilizada.
O futuro executor de estágios deve guardar essa distinção.

Ordem preservada: fill/efeitos → Esta camada → transformação para documento
→ Camada abaixo. Os testes de encadeamento usam entradas alinhadas na mesma
grade, **sem transformar/reamostrar**; não provam a fronteira de transformação.
No POC há uma única fonte preparada: para encadear operações, testes/chamador
preparam o raster estilizado e depois a saída filtrada. Não existe ainda um
executor nativo de pilha/batch/cache que gerencie esses estágios.

Os filtros de Esta camada e Camada abaixo precisam conservar arredondamentos
separados. Exemplo: alfa 1 e duas opacidades 0,5 produzem
`round(round(1 * 0.5) * 0.5) = 1`; fundir em `round(1 * 0.25)` produziria 0.
O teste nativo, a sequência WASM e o pipeline TS fixam esse contrato.

Validação desta fatia:

- **19 testes Rust**, Clippy sem avisos e formatação verificada.
- **481 testes frontend** e typecheck das novas suítes/benchmark.
- **56 testes WASM/Worker**: 43 anteriores e 13 novos. As quatro matrizes
  comparam 256 alfas × 256 valores/canal × oito faixas = **2.097.152 pixels**,
  incluindo luma fracionária, extremos e marcadores coincidentes/divididos.
- Novo golden congelado `blend-if-this-layer-red-channel`; comparador
  independente confirma os **13 casos** do corpus, sem regenerar os anteriores.
  A matriz usa o helper TS real de opacidade e o mesmo laço de alfa do passe
  privado; golden e combinações também confrontam o compositor TS público.
- Tiles 7×5, fonte somente leitura, RGB oculto e todos os 256 alfas na
  sequência dos dois filtros. Cor → padrão → Esta camada → Camada abaixo
  foi confrontada com o pipeline TS completo nos quatro canais.
- Sombra externa preparada por TS demonstra que o filtro usa a aparência
  estilizada expandida, inclusive halo; não a máscara/RGB original. Isso não
  porta sombra/halo para Rust nem autoriza apagar o compositor TS.
- ABI/adapter rejeitam overlap parcial, comprimentos, região, canal, pares
  incompletos/esparsos, NaN/Infinity, valores fracionários e faixas fora da ordem.
  Erro seguido de recuperação, invalidação/dispose e preservação da fonte passaram.
- Worker real cobre alteração de faixas sem reupload, pedidos ultrapassados,
  fonte substituída/liberada e encadeamento do alfa filtrado no passe subjacente.
  O novo passe tem `copyInMs = 0` depois de preparar a fonte.
- Build/bundle íntegros com WASM **35.950 bytes** e diagnóstico explícito no
  executável temporário Wails/WebView2 passaram, incluindo Esta camada.
  Nenhum instalador novo foi produzido/validado nesta fatia.

A sonda `npm run benchmark:rust-this-layer-blend-if -- 1024 20` compara o laço
TS de referência que chama `layerStyleBlendIfOpacity` com o adapter Rust sobre
fonte preparada. Usa três aquecimentos, alterna a ordem e confere bytes fora
da janela medida. Não executa o compositor TS inteiro: fill/efeitos/Canvas
estão fora dos dois modos. Inclui cópia da fonte no TS e alocação/cópia de
saída/liberação no adapter Rust; preparação da fonte é custo separado.
Windows 10.0.26200/i7-3770/Node fixado 24.14.1, raster sintético 1024², canal
cinza, sombras [50,100] e highlights [180,240]:

| Etapa | Mediana | p95 amostral (20 amostras) |
| --- | ---: | ---: |
| Laço TS de referência + helper atual + cópia da fonte | 132,412 ms | 139,968 ms |
| Adapter Rust/WASM, fonte preparada + saída | 19,543 ms | 31,390 ms |
| Kernel Rust dentro do adapter | 18,255 ms | 29,002 ms |
| Cópia de saída de WASM | 1,037 ms | 1,271 ms |

Preparar a fonte custou **1,589 ms** uma vez. Não somar medianas dos componentes.
O helper TS normaliza a configuração por pixel; Rust valida marcadores uma vez
por pedido. A comparação não isola linguagem/SIMD e não é uma medição de FPS:
não inclui Worker/mensagens, cache do documento, fontes/efeitos anteriores,
transformação, Canvas/GPU, encode/decode ou pico de memória.

Fonte e saída têm limite individual de 64 MiB; orçamento agregado e handles
nativos seguros seguem abertos. Cancelamento só interrompe pedidos pendentes,
nunca o kernel WASM síncrono. Esta camada, Camada abaixo, preenchimento,
sobreposição de cor e padrão estão disponíveis na prova isolada, **não** no
renderizador normal. C0/C1/C2 não foram concluídos.

## Sexta fatia: identidade do raster estilizado e substituição da fonte

Implementada em 2026-10-05, ainda no caminho experimental. Não porta outro
efeito para Rust nem altera seus kernels; prepara a invalidação correta do
adaptador para os passes já portados.

`styledRasterPreviewSnapshot` recebe a identidade do raster local **antes dos
dois filtros Mesclar se**. A fonte é distinta da máscara original e inclui:

- Documento, camada/tipo, identidade da imagem, espaço de cor e DPI.
- `contentKey`: revisão do conteúdo original, inclusive texto/forma sem imagem.
- `assetKey`: revisão agregada dos padrões/texturas já decodificados.
- Dimensões, offsets do halo, `resolutionScale` exato e qualidade.
- Fill, efeitos ativos em ordem e luz global quando utilizada por um efeito.

A identidade usa o conteúdo JSON normalizado, não um hash de 32 bits ou escala
quantizada. Os filtros Mesclar se são excluídos dessa chave porque ainda não
foram aplicados. Seus parâmetros continuam na identidade de aparência.

| Alteração | Invalidação |
| --- | --- |
| Conteúdo, fill, efeito ativo, halo, densidade, qualidade ou asset | Fonte/geração |
| Faixas/canal Mesclar se, pan/zoom ou backdrop | Vista/tokens, mantendo a fonte |
| Opacidade da camada, visibilidade, modo de mesclagem ou transformação local | Vista, se a identidade do raster não mudar |
| Raster indisponível | Fonte/geração; bloquear publicação anterior |

O chamador deve atualizar as revisões de conteúdo/assets e a geometria real.
Zoom/DPR ou redimensionamento que provoquem novo raster devem fornecer nova
densidade/dimensão/revisão; manter os metadados antigos não detecta alteração
de bytes por si só. Esta função não calcula halo, rasteriza texto/forma, lê
buffers, agenda jobs ou implementa LRU. Não serve para raster já filtrado ou
reamostrado no espaço documental. A normalização deve ser memoizada na futura
integração reativa; não foi medido um custo por frame do editor.

Foi reproduzida e corrigida uma falha do ciclo de vida: `invalidate-source(N)`
rejeitava `stage-source(N)`, embora o upload fosse a substituição esperada da
mesma edição. Agora:

1. Invalidar com uma geração nova libera a fonte e reserva essa geração.
2. Um upload da geração reservada a consome, inclusive se validar/alocar falhar.
3. Duplicatas e uploads atrasados são rejeitados sem consumir uma reserva nova.
4. Uma edição mais recente substitui a reserva; um upload direto de geração
   nova continua permitido. `release-source` não reabre geração já utilizada.

Uma falha de upload exige nova geração para tentar novamente. O chamador pode
usar `beginSourceChange()` nessa tentativa; não precisa inventar números fora
do gate. Gerações continuam monotônicas na sessão, sem reiniciar por documento.
Nenhuma exceção permite reusar uma geração que já recebeu upload.

Validação:

- Nove testes novos do snapshot: efeitos/fill, ordem, luz, geometria/halo,
  densidade fracionária, assets, filtros, texto/forma, undo, ausência e dados inválidos.
- Dois testes do runtime reproduziram a falha antes da correção e passaram
  depois, cobrindo reserva, duplicatas, erros, atrasos e recuperação.
- Um teste com o Worker real prepara a sobreposição no TS, envia o raster ao
  WASM, compara os bytes do filtro e verifica edição durante resposta pendente,
  invalidação/upload da mesma geração e duas edições rápidas antes do upload.
- Suítes completas: **490 testes frontend** e **59 WASM/Worker**, com typecheck.
- O diagnóstico empacotado também exercita a nova identidade, o upload após
  invalidar e a reutilização da fonte ao mudar somente as faixas. Build de
  produção, integridade do bundle e smoke Wails/WebView2 passaram.
- Os **19 testes Rust**, Clippy e formatação continuam passando.

O WASM permanece com 35.950 bytes. Preview normal, exportação e formato `.axia`
não mudaram. Faltam executor/batch, demais efeitos, cache/orçamento agregado,
transformações e benchmark end-to-end; os gates C0/C1/C2 permanecem abertos.

## Sétima fatia: sobreposição de gradiente linear, refletido e diamante

Esta seção registra a primeira versão do passe. A extensão atual para radial
e angular e a assinatura revisada estão na oitava fatia, abaixo.

Implementada em 2026-10-05, somente no caminho experimental. O novo kernel
`axia_poc_gradient_overlay_region` e o comando Worker
`gradient-overlay-staged-region` operam sobre fonte preparada e destino
compacto. Não são um compositor de documento nem substituem o gradiente da
ferramenta de preenchimento.

### Escopo e contrato privado

- Três tipos: linear=0, refletido=1 e diamante=2. Radial/angular permanecem no
  TS e são rejeitados nesta ABI; não são substituídos por uma aproximação.
- A fonte conserva a máscara original, inclusive quando fill=0. O destino
  contém a região já composta pelos passes anteriores. RGB oculto no destino
  é preservado quando a máscara não cobre o pixel ou o efeito tem opacidade zero.
- Coordenadas absolutas na **grade local completa da fonte**, centro do pixel
  em `(x+0,5,y+0,5)`. Dimensões do tile não mudam a âncora. Padding fornecido
  pelo chamador segue a mesma grade do compositor TS. Ainda não existe
  transformação/reamostragem para espaço documental neste passe.
- Paradas de cor RGBA8 e de opacidade independentes: 2 a 32 de cada, densas,
  ordenadas em posições finitas de 0 a 1. Posições iguais são aceitas; paradas
  nas extremidades não são obrigatórias. Opacidade de parada/efeito: 0 a 100;
  escala: 1 a 1000; reversão booleana; ângulo normalizado de -180 inclusive a
  180 exclusivo. Seis modos: normal, multiply, screen, overlay, darken e lighten.
- Ângulo convertido em seno/cosseno no TS **uma vez por pedido**, mantendo a
  referência trigonométrica do pipeline atual. Rust valida os coeficientes,
  amostra/interpola as paradas, calcula alfa e compõe os pixels em `f64`.
- Compatibilidade deliberada: após a última parada, o TS atual usa o par
  **primeira/última** e extrapola, em vez de prender a cor à última. O porte
  conserva essa regra e o arredondamento, inclusive RGB/alfa intermediários
  fora da faixa e intervalos subnormais. Corrigir essa semântica é mudança
  separada, não uma otimização silenciosa. Opacidade zero preserva o destino
  antes de calcular essas interpolações, como um efeito inativo no TS.

A ABI usa registros little-endian de 16 bytes: cor = posição `f64` + quatro
bytes RGBA + quatro bytes reservados zero; opacidade = posição `f64` + valor
`f64`. Cada buffer de paradas mede 32 a 512 bytes. Rust decodifica as duas
listas por pedido, **sem alocar por pixel**. O adaptador envia destino/paradas
a cada chamada e reutiliza a máscara preparada. O resultado conserva ID e
geração da fonte; o gate bloqueia respostas de fonte/vista ultrapassadas.

Status: 0=sucesso; 1=comprimentos/dimensões/região; 2=tipo/configuração/paradas;
3=ponteiro nulo; 5=saída sobreposta a qualquer entrada, inclusive paradas.
Metadados inválidos são rejeitados antes de modificar a saída. Buffers RGBA
têm limite individual de 64 MiB. A ABI continua privada, exigindo pares de
alocações vivas de `axia_poc_alloc`; os testes de overlap não tornam ponteiros
arbitrários seguros. Handles e orçamento agregado ainda estão pendentes.

### Validação

- **22 testes Rust**, Clippy sem avisos e formatação verificada.
- **492 testes frontend**, incluindo os dois novos goldens; typechecks passaram.
- **87 testes WASM/Worker**: 59 anteriores e 28 novos. As matrizes de três
  tipos × seis modos × quatro configurações × 256 alfas × 256 valores de cor
  comparam **4.718.592 pixels byte a byte** contra o compositor TS real.
- Corpus puro com **15 casos**: novos `gradient-reflected-centered` e
  `gradient-diamond-corners`, além do linear já existente. Entradas anteriores
  não foram regeneradas; comparador independente confirmou todas as saídas.
- Tiles 7×5 e 45 configurações de tipo/ângulo/escala, reversão, paradas
  coincidentes, extremidades ausentes, posições subnormais e opacidade zero.
  Render inteiro e tiles reconstituídos são idênticos.
- Sombra externa/interna e padding **preparados pelo TS** validam a grade e a
  máscara expandida; não demonstram cálculo nativo de halo. O encadeamento
  fill → cor → gradiente → padrão → Esta camada → Camada abaixo coincide com
  TS na mesma grade, sem provar transformação ou compositor de pilha.
- Adapter/ABI rejeitam listas incompletas/esparsas, tipo não suportado,
  configurações inválidas, bytes reservados não zero e overlap parcial.
  Recuperação após erro, liberação, fonte somente leitura e limite de 32
  paradas passaram. Worker real cobre transferências, reutilização da fonte,
  vista/pedido ultrapassado e invalidação da fonte.
- WASM final de **41.346 bytes**, build de produção, checagem do bundle e
  smoke do executável temporário Wails/WebView2 passaram. Diagnóstico explícito
  confere bytes do gradiente no Worker/WASM incorporados, sem CDN. Nenhum
  instalador/portável novo foi produzido nesta fatia.

### Medição isolada

`npm run benchmark:rust-gradient-overlay -- 1024 20 linear` executa fill=60 +
sobreposição de gradiente linear em um raster sintético 1024², com três
aquecimentos, vinte amostras em ordem alternada e comparação de bytes fora da
janela medida. Windows 10.0.26200, Intel i7-3770, Node fixado 24.14.1:

| Etapa | Mediana | p95 amostral |
| --- | ---: | ---: |
| Compositor TS puro, fill + gradiente | 1.217,179 ms | 1.268,396 ms |
| Adapter Rust/WASM, duas chamadas + cópias | 122,096 ms | 127,240 ms |
| Kernels Rust somados dentro do adapter | 118,754 ms | 123,633 ms |
| Cópias de entrada por amostra | 0,615 ms | 0,978 ms |
| Cópias de saída por amostra | 2,128 ms | 2,526 ms |

Preparação da máscara custou **1,889 ms** uma vez, fora da janela. A amostra
Rust inclui saída do fill copiada para JS, reupload como destino do gradiente,
serialização/alocação de paradas e liberação das alocações temporárias. Não
somar medianas/p95 dos componentes. Configuração: ângulo normalizado
33,33299999999997°, escala 175,5, opacidade do efeito 73,5, reversão desligada,
modo overlay; cores em 0/0,5/1 = [203,71,149,255]/[71,149,203,128]/
[149,203,71,255], opacidades em 0/0,4/1 = 25/100/50.

A referência TS normaliza/interpola paradas por pixel; o adapter as prepara
uma vez por pedido. O ganho não isola linguagem nem comprova SIMD. Não há
Worker/mensagens, texto, Canvas, transformação, GPU, encode/decode, composição
do documento ou medição de FPS/pico de memória nessa sonda. Cerca de 122 ms
para uma região de um megapixel ainda não autoriza ativação interativa: tiles,
executor/batch, cache e medição end-to-end seguem necessários.

Próximos limites: radial/angular com paridade própria, demais efeitos/halos,
executor de estágios que evite cópias intermediárias, cache/orçamento agregado,
transformações e integração reativa. Cancelamento não interrompe o kernel
WASM síncrono. Preview normal, exportação e `.axia` não mudaram; C0/C1/C2
continuam abertos.

## Oitava fatia: gradientes radial e angular

Implementada em 2026-10-05, no mesmo passe experimental. Agora os cinco tipos
atuais de **Sobreposição de gradiente** estão disponíveis em Rust/WASM:
linear=0, refletido=1, diamante=2, radial=3 e angular=4 (`angle` no protocolo).
Tipos desconhecidos continuam rejeitados. Isso não porta a ferramenta de
degradê nem ativa o novo caminho no editor.

### Geometria e compatibilidade

- Radial usa as distâncias normalizadas pelos dois raios da fonte completa,
  preservando a elipse, o centro e a escala do TS. O ângulo não altera o radial,
  como na referência atual. Não ancorar o gradiente no centro de cada tile.
- Angular calcula `atan2(dy,dx)` em Rust e recebe o ângulo em radianos do TS.
  Mantém a mesma ordem de subtração/divisão, soma de uma volta e resto `% 1`.
  Centro, quadrantes e emenda preservam a convenção atual, inclusive o centro
  de uma fonte de dimensões ímpares. Escala/reversão são aplicadas depois,
  mantendo a fórmula compartilhada dos cinco tipos.
- Máscara original, destino estilizado compacto, alfa reto, paradas
  independentes e extrapolação após a última parada seguem a sétima fatia.
  Novos tipos não introduzem alocações ou chamadas JS/WASM por pixel.

Uma regressão foi reproduzida antes de fechar o porte: em fonte 7×11, pixel
(1,1), `f64::hypot` e `Math.hypot` diferiam por arredondamento. Com duas paradas
coincidentes nessa posição, Rust retornava branco e TS preto. O radial agora
usa normalização pelo maior módulo, soma dos quadrados e raiz na mesma ordem
da referência de dois argumentos. A implementação usada pelo Node fixado pode
ser conferida no [V8 de Node 24.14.1](https://github.com/nodejs/node/blob/v24.14.1/deps/v8/src/builtins/math.tq).
O teste falhou com a implementação inicial e passou após o ajuste; sua
expectativa não foi relaxada. Não presumir igualdade universal com qualquer
motor JS, versão de libm ou plataforma: a suíte precisa acompanhar mudanças
de toolchain/runtime, sobretudo para paradas rígidas.

### ABI e segurança

A função privada `axia_poc_gradient_overlay_region` passa de 23 a **24
argumentos**, acrescentando `angle_radians: f64` ao fim. Aceita valores finitos
de -π inclusive a π exclusivo. Adapter/Worker calculam esse valor a partir do
ângulo normalizado já existente; não há mudança no formato `.axia`.
O adapter exige a aridade atual ao inicializar e rejeita binário antigo com
`wasm-unavailable`, antes de preparar fontes. A checagem do bundle também
instancia o WASM local e confere essa assinatura.

Os demais formatos, validações, códigos de erro, fonte preparada e contratos
de alocação/overlap permanecem iguais. Handles seguros, orçamento agregado e
interrupção do kernel síncrono continuam pendentes. Nenhuma crate/dependência
ou versão da stack foi alterada.

### Validação

- **25 testes Rust**, Clippy sem avisos e formatação verificada.
- **494 testes frontend** e typechecks passaram.
- **107 testes WASM/Worker**: 87 anteriores e 20 adicionais, incluindo dois
  goldens, doze matrizes de tipo/modo, três casos de precisão, dois Worker e
  rejeição da assinatura antiga. A matriz total dos cinco tipos compara
  **7.864.320 pixels byte a byte**, sem relaxar os testes anteriores.
- Corpus puro com **17 casos**: adicionados `gradient-radial-center` e
  `gradient-angle-quadrants`, cobrindo centro/eixos e os quadrantes/emenda.
  Os 15 anteriores não foram regenerados.
- Tiles 7×5 em **75 configurações** de tipo/ângulo/escala, inclusive bordas,
  reversão e paradas coincidentes. Os testes de máscara original e halos
  preparados no TS agora percorrem os cinco tipos, sem portar sombras/halos.
- Paradas rígidas e intervalos de 1e-16/1e-14 em geometrias assimétricas;
  angular em **300 geometrias/rotações determinísticas**, comparando com TS.
  Native/ABI cobrem ângulo inválido antes de modificar a saída.
- Worker real recompõe tiles dos dois novos tipos, muda ângulo/escala/reversão
  sem reupload da máscara e preserva ID/geração. Os testes anteriores continuam
  cobrindo transferência, recuperação, invalidação e descarte de respostas.
- Diagnóstico Wails/WebView2 testa bytes fixos dos cinco tipos e paradas
  rígidas calculadas pelo JS do próprio WebView, na mesma sessão que os passes
  anteriores. WASM de **42.825 bytes**, build, integridade e smoke passaram.
  Não foi gerado novo instalador/portável nem feita validação Linux nesta fatia.

### Medições isoladas

Executar `npm run benchmark:rust-gradient-overlay -- 1024 20 radial` e o mesmo
com `angle`. Sondas realizadas separadamente, sem builds/testes concorrentes,
com três aquecimentos, vinte amostras e comparação byte a byte fora da janela.
Mesma máquina/configuração da sétima fatia, mudando apenas o tipo:

| Tipo | TS mediana / p95 | Adapter Rust mediana / p95 |
| --- | ---: | ---: |
| Radial | 1.162,609 / 1.230,146 ms | 138,908 / 155,944 ms |
| Angular | 1.173,846 / 1.279,192 ms | 162,274 / 173,021 ms |

Kernels somados: radial 135,388 / 152,589 ms; angular 157,935 / 167,674 ms.
Preparar a fonte uma vez: 1,550 ms e 1,497 ms, respectivamente, fora da janela.
Não somar medianas/p95. O total do adapter inclui duas chamadas, cópia do fill
para JS e reupload no gradiente, serialização de paradas e alocações/liberações.
O benchmark não isola linguagem/SIMD nem mede FPS, Worker, Canvas, documento,
texto, transformação, GPU ou pico de memória. O custo de uma região inteira
de um megapixel ainda exige tiles/cache e executor/batch antes de integração
interativa. Não extrapolar esses números para o preview normal.

Próximos passos: executor de estágios/batch para reduzir cópias intermediárias,
demais efeitos e halo, cache/orçamento agregado, transformação/reamostragem,
medição end-to-end e validação multiplataforma. Os gates C0/C1/C2 continuam
abertos; preview normal, exportação e `.axia` permanecem inalterados.

## Nona fatia: lote local de estilos

Implementada em 2026-10-05. O executor experimental recebe um plano e executa
fill → sobreposições ordenadas → Mesclar se da própria camada em uma chamada
WASM, devolvendo somente o tile final. Aceita fill fracionário, até 64
sobreposições de cor, gradiente ou padrão, os cinco tipos de gradiente e um
filtro terminal opcional. Não inclui Camada abaixo, transformação,
reamostragem, sombras/halos nem composição da pilha do documento.

### Contrato e execução

O [contrato do lote local V1](contrato-lote-local-v1.md) especifica o pacote
binário little-endian, alinhamento, campos reservados, orçamento e erros.
A ABI privada `axia_poc_local_batch_region` tem 12 argumentos; adapter e
checagem do bundle rejeitam export ausente ou assinatura incompatível.
O Worker recebe o plano como comando regional de fonte preparada, mantendo
ID/geração, barreiras de ciclo de vida e descarte por view gate.

- Reutiliza os kernels existentes. Cada passe materializa RGBA8 e mantém a
  ordem e os arredondamentos da referência TS; não funde multiplicações de
  alfa. Sobreposições leem a máscara original, não a saída do passe anterior.
  O filtro terminal lê o raster já estilizado.
- Valida todo o pacote antes de executar. Dois buffers nativos alternam entre
  passes; a saída externa só recebe o resultado após sucesso completo.
  Erros não deixam saída parcial. Buffers temporários têm liberação RAII;
  packet/saída do adapter são liberados também em falhas.
- Impõe **96 MiB por job**, somando fonte, pacote, saída, um ou dois buffers
  temporários e reserva conservadora de metadados. Retorna status 6 e
  `memory-limit` para orçamento/reserva do lote. Não limita RSS, páginas WASM,
  buffers JS, fontes de outros jobs ou outros Workers; não é orçamento global
  do editor. Os passes individuais mantêm seus contratos anteriores.
- O serializador compartilha a codificação/validação de gradiente com o passe
  individual. Fill ganha um caminho interno fracionário sem alterar a ABI
  inteira antiga. Nenhuma dependência ou versão da stack foi alterada.

O pacote mantém entradas imutáveis e payloads alinhados. Padrões são copiados
para cada job; não existe cache/LRU de assets nem deduplicação do serializador.
A ABI continua privada/unsafe, sem registro nativo de alocações ou handles
seguros. Um kernel síncrono em andamento ainda não pode ser interrompido.

### Validação

- **29 testes Rust**, Clippy sem avisos e formatação verificada.
- **498 testes frontend** e typechecks passaram.
- **115 testes WASM/Worker**, incluindo matrizes byte a byte sobre
  **983.040 pixels**: cinco tipos de gradiente × três valores de fill,
  sobreposições ordenadas e filtro terminal.
- Nove fixtures compatíveis do corpus fixo de 17 casos passam pelo lote, sem
  regenerar expectativas. Os demais exigem passes ainda não portados.
- Tiles 7×5 em 16 configurações de ordem/canal, fill fracionário, zero/um/
  dois/64 efeitos, máscara original imutável e arredondamento separado de alfa.
- Rejeição de planos esparsos, tipos/configurações desconhecidos, campos
  reservados, offsets/overflow, payloads malformados, NaN e sobreposição de
  saída. Testes ABI mantêm a saída sentinela intacta ao rejeitar o pacote.
- Falhas simuladas de alocação de pacote/saída e orçamento nativo verificam
  limpeza, fonte preservada, recuperação e descarte. Worker real cobre
  transferência, view gate, invalidação e recuperação após plano inválido.
- Diagnóstico Wails/WebView2 compara bytes fixos do lote, preserva a geração
  e verifica os passes individuais na mesma fonte após o lote. Build,
  integridade e smoke passaram; WASM de **50.587 bytes**. Não foi gerado novo
  instalador/portável nem feita validação Linux nesta fatia.

### Medição isolada

Executar `npm run benchmark:rust-local-batch -- 1024 20`. Sonda no Windows,
i7-3770 e Node 24.14.1 fixado, sem builds/testes concorrentes, com três
aquecimentos e vinte amostras alternadas. Compara quatro chamadas individuais
(fill 60%, cor, gradiente, padrão) com uma chamada de lote; usa duas fontes
preparadas uma vez e compara cada saída com TS fora da janela cronometrada.
Não inclui o filtro terminal: o caminho individual exigiria preparar outra
fonte estilizada, tornando diferente o cenário de uma máscara preparada.

| Medida | Individuais: mediana / p95 | Lote: mediana / p95 |
| --- | ---: | ---: |
| Total do adapter | 365,312 / 408,130 ms | 358,808 / 389,442 ms |
| Tempo nativo | 356,810 / 400,396 ms | 357,029 / 387,986 ms |
| Cópias de entrada | 1,897 / 2,415 ms | 0,002 / 0,004 ms |
| Cópias de saída | 4,765 / 7,125 ms | 1,015 / 1,152 ms |

Bytes devolvidos WASM→JS caem de **16 MiB para 4 MiB** por job. Preparar a
fonte levou 1,720 ms no caminho individual e 1,231 ms no lote, fora da janela.
O total inclui serialização/alocação/liberação; o tempo nativo do lote inclui
parsing, reservas, scratch e cópia final. Não somar medianas/p95. A redução
do total foi pequena, cerca de 1,8%; kernels dominam e não ficaram mais
rápidos nesta medição. Não atribuir ganho a SIMD nem extrapolar para FPS.
Worker, Canvas, texto, GPU, documento e pico de memória não foram medidos.
O lote troca tráfego intermediário para JS por buffers nativos; menos bytes
de saída não demonstra menor consumo total de memória.

Próximos passos: demais estágios e halo, cache/assets e orçamento agregado,
transformação/reamostragem, medição end-to-end e validação multiplataforma.
Os gates C0/C1/C2 continuam abertos. Preview normal, exportação, texto, modelo
do documento e `.axia` permanecem inalterados.

## Décima fatia: spread/blur da máscara alfa com contexto

Implementada em 2026-10-05. Rust calcula a expansão quadrada e o blur da
máscara alfa, primitivos usados por sombras/brilhos. Não é porte completo de
um efeito: deslocamento, cor, contorno, knockout, ruído/seed, paint e mistura
final ainda ficam no TS. Não inclui expansão circular do traçado nem amplia
o lote local anterior. Nenhum consumidor visual normal mudou.

### Semântica e fronteira espacial

O [contrato da máscara alfa V1](contrato-mascara-alfa-v1.md) registra a ABI de
13 argumentos, raios inteiros 0..4096 e saída RGBA8 preta com alfa filtrado.
RGB/fill não participam da máscara. O chamador resolve tamanho/escala na grade
preparada; não aplicar raios documentais diretamente a uma fonte de preview.

- Spread: máximos horizontal/vertical em O(n), usando fila monotônica u32.
  Preserva a expansão quadrada atual, não muda o algoritmo do traçado.
- Blur: médias móveis com divisor fixo e zero fora da fonte. Arredonda cada
  eixo antes do seguinte; preciso usa um raio e suave divide o raio em três
  pares, como `blurAlpha` atual. Não aproxima com uma gaussiana diferente.
- Contexto: halo igual à soma spread + blur. Expande o tile, intersecta com
  a fonte preparada, executa os passes e recorta somente ao fim. Não lê somente
  o tile de saída nem reinicia o filtro na emenda entre tiles.
- A expansão externa da camada, sua origem/insets e o deslocamento de sombra
  não são resolvidos aqui. O chamador ainda prepara padding transparente na
  grade correta; resultados fora dessa fonte não são solicitáveis por esta ABI.

TS/Rust verificam 96 MiB por job somando fonte/saída, duas máscaras u8 do
contexto e fila u32. Overflow e `try_reserve_exact` falham sem publicar saída;
status 6 vira `memory-limit`. Não é limite global, LRU, RSS ou medição de pico.
As máscaras são reutilizadas entre eixos; não há alocação/chamada WASM por pixel.
Fonte preparada fica intacta. Ponteiros privados continuam unsafe; cancelamento
não interrompe o kernel síncrono. Nenhuma dependência/toolchain foi alterada.

### Validação

- **33 testes Rust**, Clippy sem avisos e formatação verificada.
- **501 testes frontend**, typechecks e **125 testes WASM/Worker** passaram.
- Matriz de **3.670.016 pixels**, todos os valores de alfa, quatro spreads,
  sete raios de blur e as duas técnicas, comparando byte a byte com as funções
  `spreadAlpha`/`blurAlpha` reais do TS, agora exportadas sem alteração de lógica.
- Tiles 7×5 em 192 configurações/geometrias, incluindo dimensões 1×N, N×1 e
  1×1, raios 4096 e fontes menores que o filtro. Cada tile equivale ao recorte
  do cálculo TS integral, incluindo as bordas.
- Mais 90 combinações de máscaras transparentes/opacas, cantos, xadrez e
  ruído determinístico, com regiões centrais/de borda e ambos os blurs.
- Quinze combinações size/spread conferem a máscara contra a **sombra TS
  completa** com distância zero, cor preta, fill zero, sem knockout/ruído e
  contorno padrão. Padding e origem são preparados pelo teste, não pelo Rust.
  Isso não valida os parâmetros ainda não portados da sombra.
- Referências fixas de blur/alfa, uso de vizinhos fora do tile, source/generation
  preservados, rejeição de configuração e assinatura antiga, orçamento
  virtual, falhas de allocator/kernel com limpeza/recuperação e ABI com saída
  sentinela/overlap. Falha de reserva interna é simulada no adapter; não foi
  provocada exaustão real da memória do sistema.
- Worker real transfere fonte/saída e testa fonte reutilizada, alteração de
  técnica, view gate, rejeição de plano inválido, invalidação e dispose.
- Os 17 goldens existentes permanecem idênticos; nenhum foi regenerado.
  Diagnóstico de bytes fixos passou no executável temporário Wails/WebView2,
  junto dos passes anteriores, build e integridade do bundle. WASM de
  **55.063 bytes**. Não foi gerado novo instalador/portável nem validado Linux.

### Medição isolada

Executar `npm run benchmark:rust-alpha-mask -- 1024 20`. Sonda isolada no
Windows/i7-3770/Node 24.14.1, três aquecimentos, vinte amostras, spread 4 e
blur suave 12. Ordem TS/Rust integral alternada; tile Rust medido separadamente
após o par. Comparações byte a byte ficam fora das janelas cronometradas.

| Caminho | Mediana / p95 |
| --- | ---: |
| TS integral 1024² | 106,100 / 128,512 ms |
| Adapter Rust integral 1024² | 82,418 / 90,075 ms |
| Kernel Rust integral | 80,872 / 88,754 ms |
| Adapter Rust tile 512² + contexto 544² | 20,274 / 21,917 ms |
| Kernel Rust desse tile | 19,908 / 21,537 ms |

Fonte preparada uma vez em 1,553 ms, fora da janela. O total TS inclui extração
do alfa, filtros e embalagem RGBA; o Rust inclui validação, temporários,
processamento e cópia final, sem reupload da fonte. Não soma medianas/p95 nem
isola efeito de linguagem/SIMD. O tile produz um quarto da área de saída,
não o documento inteiro mais rápido. Fórmula de buffers: integral 10.489.856
bytes; tile 5.836.928 bytes, ambos incluindo a fonte inteira preparada. Isso é
contabilidade de buffers, não memória medida. Não mede sombra completa,
Worker, Canvas, zoom/FPS, GPU, RSS ou performance do editor.

Próximos passos: construir efeitos externos/halo completos sobre esses
primitivos, incorporar estágios ao executor, cache/orçamento agregado e
transformação/reamostragem, antes da integração visual. C0/C1/C2 continuam
abertos; preview normal, exportação, texto e `.axia` ficam no caminho existente.

## Décima primeira fatia: sombra externa regional

Implementada em 2026-10-05. O kernel Rust agora executa deslocamento, spread,
blur suave, knockout, seis contornos, cor/opacidade/ruído e seis modos de
mesclagem de uma sombra externa sobre target compacto. O chamador ainda prepara
a fonte ampliada/insets; o efeito não entra no lote local nem no editor normal.
O [contrato da sombra V1](contrato-sombra-externa-v1.md) especifica essa fronteira.

### Compatibilidade e execução

- Adapter TS resolve luz local/global, escala e `Math.round` dos offsets/raios;
  a seed usa unidades UTF-16 do ID, não bytes UTF-8. Rust recebe parâmetros
  resolvidos no pacote `SHD1` com header de 64 bytes e até 32 pontos f64.
- Fonte/máscara original permanece separada do target estilizado. A leitura
  deslocada consulta pixels além do tile e respeita o limite da fonte inteira
  antes de filtrar. Reutiliza os filtros da décima fatia, sem criar RGBA ou
  máscara deslocada inteira intermediária. Suporte = spread + blur.
- Knockout subtrai o alfa original na posição de saída. Ruído consulta o índice
  global da grade preparada. O XOR final é **assinado**, como no TS atual;
  negativos podem elevar o alfa acima de 255 antes da mesclagem. Não limitar
  prematuramente nem trocar o PRNG durante o porte.
- Contornos customizados preservam pontos coincidentes, interpolação e o
  retorno ao primeiro Y após o último X. Não corrigir essa cauda implicitamente.
  Ring usa `sin` em Rust; testes na stack fixada não garantem igualdade universal
  de libm/runtime e precisam acompanhar trocas de plataforma/toolchain.
- ABI privada `axia_poc_drop_shadow_region`, **14 argumentos**, exige pares
  vivos do allocator e saída sem overlap com fonte/target/pacote. Adapter/bundle
  rejeitam assinatura incompatível. Não é um registro de alocações seguro.
- Limite de 96 MiB por job inclui fonte, target, pacote, saída, duas máscaras
  u8 do contexto, fila u32 e 512 bytes para pontos do contorno. TS valida antes
  das alocações WASM; Rust antes das máscaras. Validação/reservas precedem
  escrita da saída. RAII/finally liberam temporários em falha, mantendo a fonte.
  Não é LRU/orçamento global, RSS, overhead do allocator ou pico medido.

Nenhuma crate/dependência/toolchain mudou. No caminho TS de produção, somente
foi exportada a função real `renderDropShadow` para o oráculo; a lógica atual
de sombra não foi alterada. O Worker experimental mantém transferência,
geração, barreiras, view gate e descarte; WASM síncrono não é interrompível.

### Validação

- **37 testes Rust**, Clippy sem avisos e formatação verificada.
- **505 testes frontend**, typechecks e **142 testes WASM/Worker** passaram.
- Golden `directional-shadow-with-halo` reproduzido sem regenerar expectativas,
  com dimensões/offsets e knockout. Os 17 casos do corpus continuam idênticos.
- Matriz de **7.077.888 pixels**, seis modos × seis contornos × três níveis de
  ruído, atravessando todos os alfas da máscara/target e cores distintas.
- Tiles 7×5 em 288 configurações/geometrias, incluindo fontes estreitas/1×1,
  deslocamentos em direções diferentes, spread/blur, knockout e índice global.
- Cor RGBA zero/plena, opacidade 100 e ruído 100 com alfa potencialmente maior
  que 255; contornos ring/custom com knockout, até 32 pontos e intervalos 1e-14.
- Luz global/local, escala 0,125/1,375/8, quatro ângulos e efeito nos limites
  size 250/distância 1000. Não significa que uma fonte expandida enorme caiba.
- Duas sombras encadeadas na mesma máscara → overlay com fill zero → Esta
  camada → Camada abaixo, comparadas com o compositor TS completo; o filtro
  lê a fonte estilizada preparada depois dos efeitos, não a máscara original.
- Pacote, overflow/count, raios, offsets, NaN, pontos e geometrias inválidas,
  ponteiro null/overlap e saída sentinela; três falhas de alocação externas e
  falha de orçamento nativo simulada verificam recuperação/liberação.
- Worker real transfere target e fonte, altera luz/ruído/seed sem reupload,
  rejeita pedidos ultrapassados/inválidos, invalida e descarta. Diagnóstico de
  bytes fixos passou no executável temporário Wails/WebView2 junto dos passes
  anteriores; build/integridade passaram. WASM de **66.006 bytes**. Não foi
  gerado instalador/portável nem validado Linux nesta fatia.

### Medição isolada

`npm run benchmark:rust-drop-shadow -- 1024 20`: Windows/i7-3770/Node 24.14.1,
três aquecimentos, vinte amostras, sem builds/testes concorrentes. Efeito:
size 16, spread 25%, distância 11,25, ângulo -77,75, cor `#33669980`, multiply,
opacidade 73,5%, ruído 37,5%, contorno linear, sem knockout. Target preparado
contém RGBA variado. Alterna TS/Rust integral; mede tile central em separado.
Cada resultado é comparado byte a byte fora da janela cronometrada.

| Caminho | Mediana / p95 |
| --- | ---: |
| TS integral 1024² | 243,038 / 295,560 ms |
| Adapter Rust integral | 158,956 / 172,691 ms |
| Kernel Rust integral | 156,977 / 169,603 ms |
| Adapter Rust tile 512² + contexto 544² | 39,242 / 43,419 ms |
| Kernel Rust desse tile | 38,710 / 42,042 ms |

Cópia de entrada Rust integral: 0,598 / 0,746 ms; saída: 1,053 / 1,810 ms.
Preparar a fonte uma vez: 1,552 ms, fora da janela. TS inclui extração da
máscara/target e execução do efeito; Rust inclui serialização, upload de
target/pacote, temporários, kernel, readback e liberações. Não soma medianas/
p95 nem atribui a diferença somente à linguagem/SIMD. Contabilidade de buffers:
14.684.736 bytes integral e 6.886.080 bytes no tile; não é memória medida.
Tile retorna um quarto da área de saída, não o documento inteiro mais rápido.
Não mede preparação/padding do documento, Worker, Canvas, FPS/zoom, GPU ou RSS.

Próximos passos: demais efeitos externos/internos, executor com estágios e
halo integrado ao lote, cache/assets e orçamento agregado, transformação e
medição end-to-end antes do rollout. C0/C1/C2 continuam abertos; preview
normal, exportação, texto e `.axia` permanecem no caminho existente.

## Décima segunda fatia: sombra interna regional

Em 2026-10-05, o passe CPU Rust passou a calcular sombra interna a partir da
mesma máscara original e de um target regional independente. O comando
`inner-shadow-staged-region` é experimental; não habilita o renderizador Rust
na interface normal. Ver [contrato SHI1](contrato-sombra-interna-v1.md).

### Implementação e limites

- TS resolve luz local/global, escala, direção e arredondamento antes do job.
  Não negar o offset inteiro da externa: meio pixel exige arredondar depois
  de escolher a direção. Preserva seed FNV-1a sobre unidades UTF-16.
- Rust desloca alfa e aplica blur com halo usando as primitivas existentes.
  Calcula raw/contração, recorta o contorno pelo alfa original e aplica cor,
  opacidade, ruído assinado e os seis modos de mesclagem existentes.
- Compartilha filtros, parsing de campos comuns, contornos, ruído e composição
  com a externa. Mantém SHD1 inalterado; SHI1 tem cabeçalho de 72 bytes com
  contração f64 e pontos customizados a partir do byte 72. Entry points não
  aceitam o pacote do outro tipo; campos spread/knockout são zero no interno.
- Adapter compartilha o ciclo de alocação/liberação das sombras, mas valida
  ambos os contratos separadamente. Exige nova export/aridade no runtime e
  no bundle. Falhas liberam target/pacote/saída e preservam a fonte preparada.
- O orçamento continua 96 MiB/job, contando fonte, target, pacote, saída,
  duas máscaras contextuais e reserva de contorno. Não há fila de spread
  para sombra interna. Não equivale a RSS nem a orçamento agregado do editor.
- `renderInnerShadow` foi exportada apenas para servir de referência nos
  testes; a aritmética e o despacho do compositor TS não foram alterados.
- A cadeia respeita externo → conteúdo/Fill → interno → overlay. Esta fatia
  não implementa composição de conteúdo nem amplia o executor do lote local.

### Verificação

- `cargo test --offline --locked`: 41 testes nativos; `cargo fmt --check` e
  `cargo clippy --offline --locked --all-targets -- -D warnings` passaram.
- `npm test`: 509 testes frontend e checagem dos tipos de testes passaram.
- `npm run test:rust-poc`: 157 testes (5 standalone, 1 Worker básico e 151
  dos scripts), mantendo as suítes das fatias anteriores verdes.
- Build de produção, integridade do bundle e `npm run smoke:rust-wails`
  passaram: o diagnóstico incorporado ao executável verificou SHI1/Worker
  no WebView2, incluindo target transferido, gate e saída RGBA fixa. O único
  aviso de build foi o chunk acima de 500 kB já existente. O smoke usa e
  remove executável temporário; não foi gerado instalador/portável nesta fatia.
- Golden já versionado `inner-shadow-edge` passou sem regenerar expectativa.
  O corpus original de 17 goldens continua passando na suíte frontend.
- Matriz 256² × seis mesclagens × seis contornos × três níveis de ruído ×
  três contrações: 21.233.664 pixels comparados byte a byte contra a função TS.
- Tiles 7×5 em quatro geometrias, incluindo 1×N/N×1/1×1: 144 configurações
  (três tamanhos, três contrações, quatro ângulos), comparando também raster
  inteiro. Verifica bordas, halos e ruído pelo índice global da grade.
- Luz local/global, meio pixel, escalas 0,125/1,375/8 e limites de tamanho/
  distância; contornos com pontos duplicados e 32 paradas estreitas; cores
  com alfa zero/pleno; máscaras vazias/opacas e RGB oculto preservado.
- Cadeia externa/interna/overlay com Fill zero contra o compositor TS e
  recuperação da fonte original. Nenhum passe troca a máscara pelo target.
- ABI inválida: versão/tipo, choke/NaN, campos reservados, contagem enorme,
  pontos, regiões/comprimentos/null/overlap, saída sentinela e recuperação.
  Três falhas de alocação externas e status 6 do kernel são injetados com
  contagem de pares vivos; dispose termina com zero pares.
- Worker real transfere source/target, preserva geração, testa parâmetros
  alterados, pedidos ultrapassados, view change, erro recuperável,
  invalidate-source e dispose. Cancelamento não interrompe kernel síncrono.

### Sonda isolada Node

`npm run benchmark:rust-inner-shadow -- 1024 20`, Windows, Node 24.14.1,
Intel i7-3770, WASM release 66.848 bytes; três warmups, 20 amostras e ordem
TS/Rust alternada. Paridade de cada saída verificada fora da janela medida.

Fonte/target preparados 1024², sombra multiply `#33669980`, size 16, choke
37,5%, distância 11,25, ângulo local -77,75°, opacidade 73,5%, ruído 37,5%,
contorno linear. Upload da fonte uma vez: 3,31 ms, fora dos passes.

| Caminho | Mediana (ms) | p95 (ms) |
| --- | ---: | ---: |
| TS integral | 241,19 | 263,60 |
| Adapter Rust integral | 168,88 | 185,75 |
| Kernel Rust integral | 166,90 | 183,07 |
| Cópia de entradas do adapter | 0,57 | 1,11 |
| Cópia da saída integral | 1,14 | 2,54 |
| Adapter Rust tile 512², contexto 544² | 41,16 | 46,03 |
| Kernel Rust tile | 40,43 | 44,15 |

Contabilidade: 14.680.648 bytes integral, 6.883.912 bytes no tile; não é
memória medida. Tile retorna um quarto da saída. A sonda não mede preparação
do documento, Worker, Canvas, zoom/FPS, GPU nem RSS. P95 não é pior caso;
a diferença também não isola linguagem/SIMD.

Demais efeitos, preparação/insets e conteúdo/estágios integrados, cache/
orçamento agregado, transformação e medição end-to-end seguem pendentes.
Preview normal, exportação e `.axia` inalterados; C0/C1/C2 permanecem abertos.

## Décima terceira fatia: brilhos externos/internos regionais

Em 2026-10-05, o comando experimental `glow-staged-region` passou a calcular
brilho externo, interno borda e interno centro. Não há ligação ao renderizador
normal. O [contrato GLW1](contrato-brilhos-v1.md) define parâmetros, paint,
halos, ordem dos estágios e limites.

### Implementação

- TS prepara raio/spread, cores, paradas e seed UTF-16; Rust calcula spread,
  blur precise/softer, subtração externa ou recorte interno, contração,
  range, contorno, jitter, noise e mesclagem. Fonte e target são independentes.
- Brilho interno com raio arredondado zero é no-op. Raw zero é ignorado antes
  do contorno. Interno multiplica alfa final pela máscara, sem reutilizar o
  recorte `min(mask, contour)` da sombra interna. Preserva PRNG assinado,
  índice global e extrapolações legadas, sem mudança visual durante o porte.
- Gradiente segue intensidade, não XY/ângulo/tipo geométrico. Inversão,
  alfa de cor e paradas de opacidade independentes seguem o TS, com valores
  f64 e RGB arredondado por canal. Não há LUT aproximada.
- `effect_math.rs` extrai os mesmos contornos/PRNG usados pelas sombras;
  `sample_gradient` compartilha interpolação com overlays. Nenhuma aritmética
  existente foi modificada. Referências TS `renderInnerGlow`/`renderOuterGlow`
  foram apenas exportadas para testes, sem alterar o despacho normal.
- GLW1 possui cabeçalho 96 bytes e até 32 registros de cada payload: pontos,
  cores, opacidades. Máximo 1632 bytes, counts limitados antes da aritmética.
  Campos inválidos/reservados, pontos/paradas e buffers são rejeitados.
- Adapter reutiliza o ciclo de alocação/liberação de efeitos por máscara,
  com contrato e export próprios. Orçamento 96 MiB/job conta fonte, target,
  pacote, saída, duas máscaras, fila quando há spread e reserva 2048 de dados.
  Não é orçamento global nem memória medida.

### Testes

- `npm test`: 514 testes frontend e checagem de tipos passaram.
- `npm run test:rust-poc`: 173 testes (5 standalone, 1 Worker básico e 167
  dos scripts); mantém todas as fatias anteriores verdes.
- `cargo test --offline --locked`: 45 testes nativos. Fmt/check e
  clippy/all-targets com `-D warnings` passaram.
- Build de produção, integridade do bundle e `npm run smoke:rust-wails`
  passaram. O diagnóstico no WebView2 verificou os três kinds contra RGBA
  fixo, target transferido e gate válido. Executável temporário removido pelo
  smoke; não foi gerado instalador/portável. Único aviso de build: chunk
  acima de 500 kB já existente.
- Os goldens versionados `outer-glow-halo` e `inner-glow-edge` passaram sem
  regenerar expectativa. Corpus original de 17 goldens permanece inalterado.
- Matriz 64² × seis modos × três kinds × duas técnicas × seis contornos ×
  dois paints × três níveis combinados de noise/jitter: 5.308.416 pixels,
  equivalência byte a byte contra as funções TS reais.
- Nove combinações 256² (três kinds, três cores com alfa zero/pleno), contendo
  todos os pares de alfa máscara/target, com opacidade/ruído máximos.
- Tiles 7×5 em quatro geometrias, incluindo 1×N/N×1/1×1: 216 configurações
  com três kinds, duas técnicas, três tamanhos e três spread/choke. Compara
  raster inteiro e cada tile, mantendo índice global de ruído/jitter.
- Escalas 0,125/1,375/8; raio arredondado zero; tamanho máximo 250; máscaras
  vazias; contorno positivo em zero; RGB oculto; range 1/17,5/100; reverse;
  32 pontos e 32 paradas de cada payload estreitas/duplicadas (pacote máximo).
- Cadeia externo → internos → overlay, com Fill zero e lista de efeitos em
  outra ordem, comparada ao compositor TS. IDs distintos preservam os seeds;
  round trip Fill respeita a limpeza de RGB oculto já existente e verifica
  separadamente que o alfa original permanece no cache.
- ABI: magic/versão/kind, counts enormes, NaN/limites, campos reservados,
  padding de cor, geometria/null/overlap e saída sentinela; recuperação após
  erro. Injeção de três falhas de alocação e status 6 conta os pares vivos,
  terminando com zero após dispose; parâmetros inválidos não alocam no WASM.
- Worker real transfere buffers, exercita os três kinds, mudança de paint/
  técnica/range/jitter/noise/seed, geração, vista, pedidos ultrapassados,
  erro recuperável, invalidate-source e dispose. Não interrompe kernel síncrono.

### Sondas isoladas

`node --experimental-strip-types benchmarks/rustGlow.ts 1024 20 KIND PAINT`
após build release, Windows, Node 24.14.1, Intel i7-3770, WASM 71.806 bytes.
Três warmups e 20 amostras por caso; ordem TS/Rust alternada e paridade byte
a byte de cada saída verificada fora da janela medida. Sem outros builds/
testes em paralelo. Side 16..2048, samples 5..100 são limites do script.

Casos: screen, size 16, softer, range 73,5%, opacity/noise/jitter 73,5/37,5/
37,5%, contorno linear, cor `#33669980` ou gradiente invertido com três paradas
de cor e três de opacidade (duplicatas e cobertura parcial). Externo spread
25%, interno choke 37,5%. Upload da fonte 1,71..1,95 ms, fora dos passes.

| Caso | TS mediana/p95 (ms) | Adapter Rust mediana/p95 (ms) | Kernel Rust mediana/p95 (ms) | Tile Rust mediana/p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| Externo sólido | 261,47 / 350,57 | 178,86 / 187,56 | 176,59 / 184,57 | 44,42 / 61,20 |
| Interno borda sólido | 242,67 / 279,77 | 169,40 / 184,54 | 167,21 / 182,52 | 41,96 / 47,21 |
| Interno centro sólido | 225,59 / 312,93 | 168,21 / 222,09 | 166,02 / 220,06 | 41,10 / 56,24 |
| Externo degradê | 972,29 / 1077,96 | 197,28 / 228,43 | 195,07 / 226,48 | 49,05 / 69,32 |

Saída integral 1024²; tile 512², contexto 544², halo 16. Contabilidade de
buffers integral/tile: externo sólido 14.686.304/6.887.648 bytes; interno
sólido 14.682.208/6.885.472; externo gradiente 14.686.400/6.887.744.
Tile não retorna o raster completo; números não são RSS/pico real nem FPS.
P95 não é pior caso. Sonda não mede preparação/insets, Worker, Canvas,
interatividade, GPU ou composição do documento. Não atribuir o ganho somente
à linguagem/SIMD: o caminho TS do gradiente também materializa objetos por pixel.

Faltam traçado, acetinado, bisel, conteúdo/estágios no lote, preparação/insets
integrada, cache/orçamento agregado, transformação e medições end-to-end/
multiplataforma. Preview normal, exportação e `.axia` permanecem inalterados;
C0/C1/C2 continuam abertos. Validação manual da migração vem após integração
experimental, não é exigida para estes passes isolados.

## Décima quarta fatia: acetinado regional

Em 2026-10-05, o comando experimental `satin-staged-region` passou a calcular
acetinado CPU Rust/WASM sobre fonte/target preparados. O
[contrato SAT1](contrato-acetinado-v1.md) define parâmetros, máscara, halo,
ordem, ABI e orçamento. Preview normal, exportação, texto e `.axia` não mudam.

### Implementação

- TS resolve raio, trigonometria e arredondamento de dx/dy; Rust espelha
  **depois** do arredondamento, filtra as duas máscaras, calcula a diferença
  assinada e aplica invert, contorno, min com alfa original, cor e mesclagem.
- Sem abs, descarte antecipado de raw zero ou no-op por distância/raio zero:
  contorno positivo em zero continua contribuindo. Máscara participa no min
  e no alfa final. Máscaras seguem os limites completos da fonte, antes do
  blur, mesmo quando a amostra deslocada está fora do contexto do tile.
- Compartilha filtros, contorno e compositor de pixels existentes. Apenas
  expõe context_region/budget internamente; não muda suas operações nem os
  contratos anteriores. `renderSatin` TS foi exportado sem alterar o corpo.
- Pacote SAT1 de 64..576 bytes, pontos f64 e reservados zero; bounds/counts
  limitados antes da aritmética/reserva. Export e aridade próprios, sem
  interpretar pacotes de outros efeitos como acetinado.
- Orçamento 96 MiB/job inclui fonte, target, pacote, saída, **três máscaras**
  de contexto e 512 bytes para pontos. Primeira máscara permanece retida
  durante a reserva atual/scratch da segunda. TS/Rust recusam um caso que
  caberia se contassem duas; buffers externos até 64 MiB cada. Não é RSS,
  cache agregado nem orçamento global. Reservas precedem escrita da saída.
- Integra o mesmo lifecycle finally/RAII de efeitos por máscara, sem alterar
  fonte original. Publicação continua dependente de generation/sourceId,
  vista/efeito e pedido atual; kernel síncrono não é interrompido por cancel.

### Testes e pacote

- `npm test`: 514 testes frontend e checagem de tipos passaram.
- `npm run test:rust-poc`: 190 testes (5 standalone, 1 Worker básico e 184
  dos scripts), incluindo 17 novos do acetinado. Fatias anteriores verdes.
- `cargo test --offline --locked`: 49 testes nativos; fmt/check e
  clippy/all-targets com `-D warnings` passaram.
- Build de produção, integridade do WASM e `npm run smoke:rust-wails`
  passaram. Diagnóstico do executável Wails/WebView2 usa buffers transferidos,
  gate e RGBA fixo para invert false/true, além dos passes anteriores.
  Smoke removeu seu executável temporário; nenhum instalador/portável foi
  gerado. Único aviso de build: chunk acima de 500 kB já existente.
- Golden versionado `satin-inverted` passou sem regeneração. Preparação do
  target respeita Fill/limpeza de RGB oculto; isso é distinto do passe de
  efeito, que preserva target sem contribuição. Corpus original de 17 goldens
  passou também pelo comparador independente e permanece inalterado.
- Matriz 256² × seis modos × seis contornos × duas inversões × três
  distâncias: **14.155.776 pixels**, todos os pares de alfa original/target,
  equivalência byte a byte com a função TS real. Alfa original x XOR y
  exercita diferença deslocada no interior, não somente nas bordas.
- Tiles 7×5 em 37×29, 1×17, 19×1 e 1×1: três raios, duas inversões e quatro
  ângulos, 96 configurações; integral e cada tile equivalem ao TS.
- Escalas 0,125/1,375/8; ângulos/meio pixel e espelho após arredondar;
  size/distance máximos; contornos de 32 pontos estreitos/duplicados,
  sem cobertura dos endpoints; cor com alfa zero/pleno; RGB oculto e
  contorno positivo com diferença zero. Caso fixo alfa 101 gera alfa 40,
  cobrindo os dois fatores da máscara.
- Cadeia acetinado → overlay com Fill zero e efeitos em outra ordem compara
  com compositor TS, verificando fonte original reutilizável após os passes.
- ABI: magic/versão, raio/invert/blend, reservados, counts enormes, pontos
  NaN, comprimento, geometria, null, overlap e saída sentinela; nenhum pixel
  parcialmente escrito. Adapter rejeita assinatura antiga, parâmetros não
  normalizados e orçamento excessivo; efeito de entrada não é mutado.
- Três falhas de alocação e status 6 injetados: fonte continua reutilizável,
  temporários liberados, zero pares vivos após dispose. Parâmetros inválidos
  não alocam no WASM. Teste nativo cobre também overflow da contabilidade.
- Worker real transfere buffers; muda invert/ângulo/distância/size/contorno,
  rejeita resultados ultrapassados, invalida vista/fonte, recupera de erro e
  faz dispose. Não depende de seed/id para produzir pixels de acetinado.

### Sonda isolada

`npm run benchmark:rust-satin -- 1024 20`, release, Windows, Node 24.14.1,
Intel i7-3770, WASM **75.197 bytes**. Três warmups, 20 amostras, ordem TS/Rust
alternada; cada saída integral/tile comparada byte a byte fora da medição.
Nenhum build/teste concorrente durante a sonda. Limites do script: lado
16..2048, amostras 5..100.

Fonte/target preparados 1024², multiply `#33669980`, size 16, distância 11,25,
ângulo -77,75°, invert true, opacidade 73,5%, contorno linear. Upload da fonte
uma vez: 1,61 ms, fora dos passes.

| Caminho | Mediana (ms) | p95 (ms) |
| --- | ---: | ---: |
| TS integral | 180,26 | 186,89 |
| Adapter Rust integral | 155,29 | 175,34 |
| Kernel Rust integral | 153,12 | 173,35 |
| Cópia de entradas do adapter | 0,57 | 1,03 |
| Cópia de saída integral | 1,03 | 1,75 |
| Adapter Rust tile 512², contexto 544² | 37,51 | 38,81 |
| Kernel Rust tile | 36,92 | 37,55 |

Contabilidade integral/tile: 15.729.216/7.179.840 bytes, halo 16. Não é memória
medida. Tile retorna um quarto da saída. Ganho integral observado é modesto;
não atribuir a Rust/SIMD isoladamente, nem extrapolar para todos os efeitos.
Sonda não mede preparação/insets, Worker, Canvas, interatividade, zoom/FPS,
GPU, composição documental ou RSS; p95 não é pior caso.

Ainda faltam traçado, bisel, conteúdo/executor de estágios integrado ao lote,
preparação/insets, cache/orçamento agregado, transformação e medições
end-to-end/multiplataforma. C0/C1/C2 continuam abertos. Validação manual da
migração fica para depois da integração experimental ao editor.

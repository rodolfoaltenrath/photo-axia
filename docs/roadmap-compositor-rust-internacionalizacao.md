# Roadmap: compositor único em Rust e Axia multilíngue

Estado: **C0/I0 iniciados; C1/C2 com passes Rust e preview opt-in; compositor Rust não ativado por padrão**.
Atualizado em 2026-10-06.

Este plano tem duas trilhas independentes, com contratos compartilhados: (A) unificar
preview e exportação em um compositor de documento, introduzindo Rust/WASM onde
medido e seguro; (B) internacionalizar o aplicativo e permitir pacotes de idioma.
Um marco de uma trilha não deve esperar o da outra, exceto pela troca de mensagens
entre Go, Rust e TypeScript, que já nascerá com códigos estáveis, não frases.

## 1. Decisões e limites

- Preservar Go/Wails como shell, arquivos e diálogos; Vue/TypeScript como interface,
  interação, texto e orquestração; Rust como núcleo de pixels inicialmente **CPU**,
  compilado para `wasm32-unknown-unknown` e chamado de um Worker.
- A meta arquitetural é **um algoritmo de composição de documento** para preview,
  exportação, amostragem, miniaturas, mesclagem e rasterização. Esses consumidores
  podem pedir regiões/resoluções distintas; não podem implementar semânticas
  distintas de pilha, estilos ou mesclagem.
- Não migrar, nesta iniciativa, a modelagem/histórico do documento para Rust, a
  interface Vue, a tipografia para `cosmic-text`, nem o shell Wails para nativo.
  `wgpu`/WGSL só entram se benchmarks posteriores justificarem o custo e após
  teste real de WebGPU/WebGL2 no WebView distribuído.
- O novo caminho deve poder ser desligado por uma flag de desenvolvimento e, até
  a virada final, o caminho antigo deve permanecer utilizável. Não alterar o
  formato `.axia` como consequência da renderização ou do idioma.
- A preferência de idioma pertence às configurações do aplicativo; **não** ao
  documento. Texto digitado pelo usuário, nomes de camadas/projetos e rótulos
  personalizados não são traduzidos automaticamente.
- Dados de arquivo, IDs, enums, atalhos internos, códigos de erro, chaves de cache
  e protocolos jamais dependem da tradução exibida.

## 2. Situação observada no repositório

- `frontend/src/components/canvas/CanvasSurface.vue` e `CanvasLayer.vue` montam
  camadas DOM; `frontend/src/services/renderDocument.ts` compõe em Canvas 2D para
  exportação e outros consumidores. `useDocumentBlendIfPreview.ts` monta uma
  prévia composta adicional quando `Blend If` consulta camadas inferiores.
- `frontend/src/editor/layerStyleRaster.ts` é o núcleo puro de muitos efeitos,
  mas o Worker atual ainda usa `OffscreenCanvas` para obter RGBA de imagens/texto
  e converter a saída. `renderDocument.ts` também desenha texto/forma via Canvas.
- `layerStyleCacheKey` considera camada, identidade/dimensão da fonte, estilos,
  luz, escala e qualidade. Ainda não é uma chave de tile/composição de documento.
  O cache de estilos tem limites explícitos de 96 MiB e 64 MiB para decodificados.
- Há 61 arquivos de teste no frontend e 11 workers. Inventariar casos e cobertura
  antes de acrescentar fixtures; quantidade não equivale a paridade visual.
- Não há infraestrutura de i18n no `frontend/package.json`. Mensagens Go/TS e
  formatação de números/datas aparecem em português e com `pt-BR` fixo.
- `go.mod` pede Go **1.26.5** e Wails **v3.0.0-beta.12**. Os scripts baixam Go
  1.26.5 e Node **24.14.1**, mas nesta máquina `go version` mostrou 1.27.0,
  `node --version` mostrou 24.19.0 e `.toolchains/go1.23.12` continua presente.
  Rust/Cargo não estão instalados no `PATH`. Logo, compilar hoje sem auditar
  `PATH` não prova reprodutibilidade. O `Taskfile` usa `npm install`, apesar de
  existir `frontend/package-lock.json`.
- O worktree já contém mudanças em andamento, inclusive texto e empacotamento.
  Implementar por marcos sem sobrescrever alterações anteriores.

## 3. Fixação da stack e builds reproduzíveis — marco zero

Antes de portar um pixel, registrar uma build/teste de referência em Windows e
Linux. Versões abaixo são **alvos iniciais do plano**, não uma atualização já
executada. Qualquer mudança de versão terá PR/commit próprio e teste de pacote.

| Componente | Alvo e regra |
| --- | --- |
| Go | Manter `1.26.5` de `go.mod`; validar `go version` antes do build. Resolver o diretório local 1.23.12 obsoleto sem apagá-lo automaticamente. |
| Wails Go + runtime JS + CLI | Manter os três em `v3.0.0-beta.12`/`3.0.0-beta.12`; checagem automática de correspondência. |
| Node/npm | Fixar Node `24.14.1` inicialmente, o alvo já usado pelos scripts; verificar versão do npm da distribuição e registrar. Atualizar a linha 24 LTS em mudança separada de segurança. |
| Pacotes frontend | Preservar `package-lock.json`; builds/CI com `npm ci`. Travar versões diretas sem `^` após snapshot, verificando diferenças de lockfile. |
| Rust | Introduzir `rust-toolchain.toml` com `channel = "1.98.1"`, `profile = "minimal"`, `components = ["rustfmt", "clippy"]`, `targets = ["wasm32-unknown-unknown"]`. Confirmar disponibilidade na máquina/CI antes de integrar. |
| Crates/CLI WASM | Commitar `Cargo.lock`; fixar a mesma versão testada de `wasm-bindgen` e `wasm-bindgen-cli` (candidata `0.2.129`). Proibir `cargo install ...` sem versão no build. |
| `wgpu` e biblioteca de i18n | **Ainda não escolhidos.** Só fixar versão após protótipo de compatibilidade e decisão de adoção. |

Entregáveis de infraestrutura:

- [x] Criar um único manifesto de versões ou verificações equivalentes para
  Windows/Linux; comparar `go.mod`, scripts, Wails CLI/runtime, Node/npm e Rust.
- [ ] Rever `scripts/setup-go.sh`, `scripts/setup-node.sh`, `Taskfile.yml` e
  documentação; substituir `npm install` de build por `npm ci`, mantendo o fluxo
  de desenvolvimento apropriado. Registrar hashes dos downloads de toolchain.
- [ ] Build offline após download das dependências, bundle WASM local no Vite,
  sem CDN nem carregamento dinâmico de código externo. `cargo build --locked`,
  `npm ci`, `go mod download`/verificação de `go.sum`.
- [ ] CI Windows + Linux: format/lint, testes Go/TS/Rust, typecheck, build de
  desenvolvimento/produção e smoke test do WASM empacotado. Testar artefato
  instalado e portável, não só servidor Vite. Gerar SBOM/licenças se a ferramenta
  de release for adotada; registrar hashes de binário/instalador.
- [ ] Definir política de atualização deliberada (mensal para patches de
  segurança, sem troca automática em builds de release), com rollback reproduzível.

Gate: uma pessoa nova consegue reproduzir a build seguindo instruções curtas;
CI e ambiente local usam as versões declaradas; nenhuma mudança visual ocorreu.

## 4. Contrato do compositor — especificar antes da ABI

### 4.1 Coordenadas, superfícies e semântica

- Região solicitada em **coordenadas do documento** (origem, largura e altura),
  com convenção explícita para bordas semiabertas, pixels fracionários, rotação,
  recorte e arredondamento. Separar `documentScale`, zoom da câmera, DPR e
  densidade do raster fonte. Zoom/pan não modificam espessura documental de
  efeito nem pixels exportados.
- A saída contém dimensões físicas em pixels, origem documental, stride,
  formato/cor/alpha e um identificador da geração. Escolher e testar RGBA8,
  espaço de cor e alpha reto/premultiplicado nas fronteiras. Não mudar
  silenciosamente o `colorSpace` guardado no projeto.
- Definir ordem única: fundo, camadas visíveis, transformação, fill opacity,
  estilos por estágio, opacidade da camada, Blend If, modo de mesclagem e
  recorte. Documentar com fixtures antes de implementar. Máscaras/grupos
  futuros devem caber no protocolo sem serem simulados no DOM.
- Separar **região de saída** da **região de entrada necessária**. Sombra,
  brilho, bisel, traçado e blur pedem halo calculado dos efeitos; aplicar o
  efeito com contexto ampliado e cortar só ao fim. Padrões, gradientes, ruído
  e luz global usam coordenadas/seed absolutas para não criar emendas.
- `Blend If: camada abaixo` exige os pixels compostos do backdrop naquele
  estágio. Sua invalidação depende das camadas inferiores, não só da fonte
  da camada atual. Decidir a política para grupos/isolamento antes de incluí-los.
- Texto e formas continuam nascendo do renderizador do navegador; o contrato
  recebe raster na densidade apropriada e preserva transformações/efeitos em
  pixels documentais. Exportação não pode consumir automaticamente a miniatura
  de baixa resolução do preview. Fonte ausente deve ter fallback previsível.
- Preview pede apenas área visível/tiles sujos; exportação percorre o documento
  em resolução plena e monta a saída sem depender do viewport. Conta-gotas,
  miniaturas e mesclagem usam o mesmo kernel e parâmetros explícitos de qualidade.

### 4.2 ABI Rust ↔ TypeScript (proposta, validar com protótipo)

Fluxo: TS decodifica/rasteriza fontes externas quando necessário → transfere
buffers/lotes ao Worker → adaptador WASM valida dimensões/offsets → núcleo Rust
opera sobre fatias RGBA → Worker publica tile com token de geração. Evitar uma
chamada WASM por pixel; medir cópia, view de memória WASM, upload e readback.

Entrada lógica `ComposeRequestV1`: versão de protocolo; documento/revisão;
região de saída; escala/densidade; lista ordenada de descritores de camada;
transformação e raster de fonte; efeitos/ativos/padrões já decodificados;
dependências do backdrop; espaço de cor; qualidade/cancelamento; orçamento.
Saída `ComposeResultV1`: região coberta, RGBA/stride, geração, metadados e erro
estruturado `{ code, params }`. Uma ABI binária/estruturada concreta será escolhida
somente depois de medir JSON vs buffers; offsets e comprimentos serão validados.

O Rust **não** é dono do documento nem recebe objetos Vue. Cache opcional é um
handle opaco, de vida limitada ao Worker: criar/reusar/liberar, invalidar por
revisão, limpar em troca de projeto, tratar restart e limite de memória. Nunca
persistir handle em `.axia`. `cancel` deve impedir publicação tardia; não presumir
que interrompe imediatamente uma chamada WASM síncrona. Para tarefas longas,
usar tiles menores e checagens cooperativas entre lotes.

### 4.3 Cache, agendamento e orçamento

- Chaves separadas para raster da fonte, estilo de camada e composição da pilha.
  Incluir versão de protocolo/algoritmo, revisões de fontes/padrões, parâmetros
  normalizados, luz, transformação, região+halo, escala/qualidade e, quando
  necessário, revisões das camadas inferiores. Reusar `layerStyleCacheKey` apenas
  como referência, não como chave completa de documento.
- Modelo de dirty regions com propagação: editar estilo amplia área afetada;
  mover/ocultar camada invalida bounds antigo **e** novo; editar backdrop invalida
  resultados superiores que consultam seus pixels. Ao duvidar, invalidar mais,
  jamais exibir cache incorreto.
- LRU por orçamento de bytes, telemetria de hit/miss/evicção e contagem de
  RGBA temporários. Limites configuráveis por plataforma; evitar cópias e
  encodificar PNG durante cada frame interativo. Proteger de 8K/64 MP e de
  `OutOfMemory` com tiles, validação de dimensões e falha recuperável.
- Prioridade: interação visível > refinamento de qualidade > miniatura;
  coalescer alterações rápidas, aplicar backpressure, descartar gerações antigas,
  manter último quadro válido durante processamento. Zoom/pan podem transformar
  temporariamente o quadro anterior, com refinamento sem salto/piscada.
- Registrar tempo CPU por passe, tempo de cópia/decodificação, latência p95,
  tempo até quadro final, uso/pico de memória, tamanho de tile e cache. SIMD é
  uma hipótese a medir; não um requisito nem ganho prometido.

## 5. Estratégia de testes e aceitação de imagem

Criar corpus versionado de documentos pequenos e casos sintéticos, além de
amostras reais autorizadas. Guardar **RGBA de referência com metadados** para
operações puras; PNG serve de artefato visual, não de hash universal. Separar:

| Fronteira | Oráculo |
| --- | --- |
| Função pura TS ↔ Rust CPU | Byte a byte quando ambas recebem exatamente os mesmos buffers/parâmetros e a semântica numérica é reproduzível. Divergências são investigadas; não mascaradas por tolerância automática. |
| Canvas 2D/browser, fontes, escalonamento | Diferença de imagem com tolerância definida por caso, inspeção de heatmap e limiar de pixels; preservar geometria e ausência de artefatos. |
| GPU futura/dispositivos | Tolerância explícita, testes por backend/driver e comparação CPU de referência. |

Cobrir alpha zero/255, arredondamentos, espaços de cor, todos os modos de
mesclagem e efeitos, ordem combinada, padrões ausentes, Blend If, luz global,
texto com/sem estilo, forma, imagem inteligente/PDF, rotação, 1 px, bordas,
tiles adjacentes, halo, DPI, zoom mínimo/máximo, fundo transparente, undo/redo,
salvar/reabrir `.axia`, cancelamento/restart do Worker e falha de WASM.

Benchmark antes/depois em Windows e Linux com documento 1080p, 4K, 8K e
64 MP quando a máquina suportar; 10/50/100/300 camadas; interação rápida e
exportação. Registrar CPU/GPU, WebView, RAM, DPR e versões. Os 211/292 ms de
efeitos isolados no roadmap de estilos são referência histórica, não previsão
para Rust. Gate de performance: estabelecer baseline repetível; não aceitar
regressão p95/uso de RAM sem justificativa e teste manual de fluidez. Definir
limiares numéricos por cenário **após** a medição da fase zero.

## 6. Fases da migração do compositor

Cada fase termina com testes, screenshot/benchmark comparativo, flag de retorno
e decisão registrada. Nenhum passo exige migração do modelo/histórico.

### C0 — Baseline e oráculo

- [ ] Congelar toolchains; rodar testes existentes; inventariar caminhos de
  renderização/consumidores e matriz de recursos efetivamente suportados.
- [ ] Adicionar fixtures das funções puras e de documentos, métricas e script
  reprodutível de comparação. Medir custo de decode, Canvas, Worker e handoff.
- [ ] Definir convenções 4.1/4.2, orçamento de memória e gates.

Primeira coleta de testes/versões e inventário de caminhos:
[baseline-compositor-internacionalizacao.md](baseline-compositor-internacionalizacao.md).
Primeiro contrato espacial/semântico e corpus RGBA portátil:
[contrato-compositor-v1.md](contrato-compositor-v1.md) e
`frontend/tests/fixtures/layerStyleGoldens.v1.json`.
O corpus agora cobre os dez tipos atuais de efeito e possui comparador
independente do compositor TS. Há também um benchmark reproduzível do núcleo
CPU e a primeira fixture de documento/Canvas validada no Edge/Windows. Ela
agora cobre três pilhas pequenas, inclusive estilos combinados, e uma rejeição
explícita de efeito incompatível com forma.
Uma primeira sonda end-to-end de exportação PNG mede agora documentos
sintéticos de 512² e 1024² no Edge/Windows, com e sem estilos, incluindo
sondas separadas de decode e leitura em Canvas. Uma segunda sonda distingue
estilo em cache de recomposição e mede o Worker real diretamente, sem cache,
ao lado do núcleo raster puro. Uma instrumentação opcional já separa decode,
composição e codificação dentro do Worker de estilos, sem coletar esses dados
nas solicitações normais. Uma sonda isolada do `useLayerImageBuffer` também
mede a troca entre os dois `<img>` e confirma que o buffer antigo permanece
ativo até o novo aparecer no DOM. O marco C0 segue aberto: faltam medir o
preview completo e sua pintura/FPS em Wails com documentos reais, ampliar
combinações/erros e repetir nas plataformas alvo. Um smoke adicional já percorre
o editor Wails real com imagem sintética e preset de sombra, sem perder o buffer
ativo. Capturas da região do canvas via DevTools também confirmaram mudança
de pixels na superfície apresentada. Ainda não substitui medição de FPS nem
QA com documentos do usuário.

O runner `benchmark:preview-wails` agora acrescenta uma janela de referência
ociosa, trocas repetidas entre três presets, zoom animado por wheel e pan por
scroll no próprio editor Wails. Registra cadência de callbacks `rAF`, tarefas
longas da thread da interface e latência da troca visual; verifica movimento
real/restauração do viewport e continuidade do buffer. As primeiras medições
512²/1024² foram registradas no baseline. Cadência `rAF` **não é FPS apresentado
pela GPU**. A medição usa imagem sintética, uma camada e eventos automatizados;
documentos reais, muitas camadas, pintura/GPU e memória continuam pendentes.
O workflow manual coleta a mesma sonda sem aplicar um limiar de performance
dependente do hardware do runner. Isso ainda não fecha o marco C0.

### C1 — POC Rust/WASM isolada, sem mudança visual

- [ ] Criar crate puro e adaptador WASM separados; CI compila, testa, empacota
  e carrega em Worker no app instalado. Nenhum acesso a DOM dentro do núcleo.
- [ ] Portar **uma** operação representativa já testada (incluindo caso de
  arredondamento e pixels transparentes). Comparar RGBA, cópias e tempo total;
  não portar módulos inteiros apenas para justificar a toolchain.
- [ ] Mapear `Math.round`, `Uint8ClampedArray`, `Math.sin/cos`, ordem de operações
  e casos NaN/overflow. Desabilitar otimizações que quebrem paridade quando
  necessário; avaliar SIMD separadamente.
- [ ] Gate: resultado correto, build offline/reprodutível, sem piora relevante
  de UI. Se falhar, manter compositor único como objetivo, mas reavaliar Rust.

Primeira fatia: [prova Rust/WASM](prova-rust-wasm-c1.md) com um passe puro de
opacidade de preenchimento, `Cargo.lock` sem dependências e testes nativo/WASM
contra o golden e a matriz completa de alfa/opacidade. Um Worker experimental
já exercita transferência, cancelamento pendente e descarte fora da UI. O
pré-build agora gera o WASM local, e o Vite inclui Worker e asset com hash;
uma checagem de bundle, um smoke em Edge headless via `vite preview` e outro
em executável de produção temporário Wails/WebView2 passaram. O último foi
repetido três vezes sem falha, mas não é um instalador instalado.
Há primeira medição Node de cópias/tempo, ainda sem comparação representativa.
Faltam teste do instalador/portável distribuível, CI Windows/Linux, baseline
end-to-end e fechamento de C0; portanto **nenhuma caixa C1 foi marcada como
concluída**.

Há agora um workflow de CI Windows/Linux para testes Rust, contrato Worker,
frontend e bundle; Go é testado no Windows. O smoke Wails/WebView2 no runner
hospedado fica disponível por acionamento manual até termos a primeira execução
observada. Criar o workflow não equivale a aprovar o gate: faltam resultados
reais da CI e o teste do instalador distribuível.

### C2 — Estilos CPU e raster por região

- [x] Portar passes de estilo gradualmente, com testes de combinação e paridade
  por efeito. Adicionar entradas/halos e seed/âncora absolutos; verificar
  equivalência tile vs raster inteiro. Separar rasterização de texto/forma.
- [x] Fechar dispatch exaustivo de efeitos no TS atual independentemente do
  porte; casos não suportados retornam erro estruturado, nunca somem em silêncio.
- [ ] Cache/cancelamento/orçamentos com benchmark end-to-end, não apenas kernel.

A POC Rust de opacidade de preenchimento já recebe uma região absoluta e
devolve um tile compacto. Testes nativos e WASM remontam tiles de borda e
verificam paridade byte a byte com o raster inteiro; o Worker e o diagnóstico
explícito também percorrem o protocolo regional. Uma fonte pode agora ser
preparada uma vez no Worker/WASM e reutilizada por vários tiles, com liberação
e invalidação explícitas. Uma geração monotônica rejeita uploads atrasados e
identifica tiles obsoletos; o pedido avulso ainda copia a fonte a cada vez.
Um gate experimental no consumidor TS confere também o ID do pedido e a
versão visual por tile antes de aceitar a resposta, sem uso no preview normal.
Um adaptador puro já classifica mudanças de fonte versus aparência/viewport
usando as identidades existentes do editor; falta ligá-lo aos eventos reais,
fornecer revisão da pilha e medir o custo dessa ligação antes de C4.
Uma sonda isolada mediu a diferença entre esses dois modos, mas ainda faltam
cache do documento, halo, outros efeitos e benchmark end-to-end do editor.
Portanto, isto não conclui os passes nem o gate de desempenho de C2.

Em 2026-10-02 foi portado um segundo passe puro para Rust: **Mesclar se —
camada abaixo**, com canal cinza/R/G/B e marcadores rígidos ou divididos.
O Worker aceita fonte preparada + região + backdrop compacto já composto,
retorna o tile com a mesma geração e preserva os bytes da fonte. Goldens,
2.097.152 combinações de alfa/canal/faixa, tiles adjacentes e sequência
fill opacity → Blend If passaram byte a byte contra o TS. O teste do Worker
também cobre alteração do backdrop sem reupload da fonte e invalidação do
tile anterior; o diagnóstico incorporado passou no Wails/WebView2.
Uma comparação Node 1024² registrou 137,65 ms de mediana no TS atual contra
21,80 ms no adaptador Rust/WASM com fonte preparada. Parte da diferença vem
da normalização por pixel no TS atual; não é uma medida isolada do ganho de
linguagem, nem do preview. Detalhes e limites estão na
[prova Rust/WASM](prova-rust-wasm-c1.md). A pilha/backdrop continuam sob
responsabilidade do chamador: este passe não implementa sozinho composição
do documento, grupos, transformações, cache de backdrop ou estilos com halo.

Uma terceira fatia, **Sobreposição de cor**, agora utiliza a mesclagem CPU Rust
nos seis modos atuais de efeito (normal, multiply, screen, overlay, darken,
lighten). O contrato distingue a fonte/máscara original preparada do target
compacto já composto, mantendo o efeito com fill 0% e sem reaplicar preenchimento.
Um golden isolado, 2.359.296 pixels comparados byte a byte contra TS, tiles de
borda, efeito interno anterior e passes encadeados passaram. O Worker e o
diagnóstico Wails/WebView2 também percorrem essa operação, com descarte por
versão visual e reaproveitamento da fonte. A sonda Node 1024² para fill → cor,
incluindo cópias intermediárias entre duas chamadas WASM, registrou medianas
de 158,08 ms no TS e 87,10 ms no adapter Rust. Isso não comprova fluidez no
editor: o kernel ainda precisa de otimização/agendamento por região antes do
rollout. Os detalhes estão na [prova Rust/WASM](prova-rust-wasm-c1.md).
Esse módulo não porta os modos de composição do documento/Canvas nem liga
Rust ao preview normal. Cache agregado, halos, demais efeitos e gates C2
continuam abertos; a ABI permanece experimental e sem posse do documento.

Uma quarta fatia, **Sobreposição de padrão**, agora amostra a textura RGBA
decodificada e usa a mesma mesclagem Rust dos efeitos. Coordenadas são absolutas
na grade preparada: tiles não reiniciam a repetição. Os coeficientes de rotação
são calculados uma vez pelo adapter TS com a mesma trigonometria da referência,
evitando mudança de texel em fronteiras por diferenças de biblioteca matemática.
O golden existente, 2.359.296 pixels comparados, 48 combinações de rotação/escala
em tiles de borda, transparência e combinação com raster expandido por sombra
passaram byte a byte. O Worker transfere target/textura e reutiliza a máscara,
com proteção contra respostas ultrapassadas; o diagnóstico passou no WebView2.
Uma sonda Node 1024² registrou 295,78 ms no TS e 163,60 ms no adapter Rust para
fill → padrão, incluindo cópias intermediárias e upload do padrão por pedido.
Ainda faltam cache de assets/batch, profiling, orçamento agregado e benchmark
end-to-end. A expansão da sombra foi produzida pelo TS no teste, não portada;
halo e âncora seguem sob responsabilidade do chamador. O preview normal não
foi alterado e nenhum gate C0/C1/C2 foi encerrado. Detalhes na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma quinta fatia completa o passe puro **Mesclar se — Esta camada**, nos quatro
canais e por região. Reutiliza regras de luma/faixas em Rust, mas lê RGB/alfa
do raster **já estilizado**, inclusive efeitos externos, não da máscara original.
O golden fixo, 2.097.152 pixels comparados, tiles 7×5 e sequência cor → padrão
→ Esta camada → Camada abaixo passaram byte a byte, com arredondamento separado
em cada filtro. Worker/gate/diagnóstico WebView2 cobrem o novo comando sem
backdrop ou reupload da fonte entre alterações de faixas. A sonda Node 1024²
mediu 132,41 ms no laço TS de referência com o helper atual e 19,54 ms no adapter
Rust com fonte preparada. O helper TS normaliza por pixel; isso não isola
linguagem nem mede fluidez do editor. A chave do raster preparado precisa incluir
estilos/fill/halo/resolução; reusar a chave da máscara original produziria fonte
obsoleta. Faltam executor de estágios/batch, transformação/reamostragem,
cache/orçamento e os demais efeitos; preview normal e gates continuam intocados.
Detalhes e limites na [prova Rust/WASM](prova-rust-wasm-c1.md).

Em 2026-10-05 foi adicionada a identidade específica do raster estilizado
antes de Mesclar se: fill/efeitos ativos, revisão de assets/conteúdo, halo,
dimensões, densidade e qualidade invalidam a fonte; faixas dos filtros
invalidam somente a vista. Texto/forma sem imagem também recebem identidade
explícita. O adaptador agora permite um upload da geração reservada pela
invalidação, corrigindo a rejeição da substituição esperada sem abrir caminho
para duplicatas ou uploads atrasados. Snapshot, runtime, Worker real e
diagnóstico empacotado cobrem esse ciclo. Não é um cache LRU nem um executor;
nenhum kernel Rust adicional ou caminho visual normal foi alterado. Faltam
integração reativa, orçamento/batch e os demais gates. Detalhes na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma sétima fatia adiciona **Sobreposição de gradiente** linear, refletido e
diamante ao caminho Rust isolado, com paradas independentes de cor/opacidade,
seis modos de mesclagem e tiles na grade completa da máscara original. Nessa
primeira versão, radial e angular eram rejeitados explicitamente. Matrizes com
4.718.592 pixels, dois novos goldens, tiles/halos preparados no TS e Worker real
passaram byte a byte. A sonda isolada 1024² mediu fill + gradiente linear em
1.217,18 ms no TS e 122,10 ms no adapter Rust, incluindo cópias intermediárias;
não mede FPS nem justifica ativação no editor. O corpus puro tem 15 casos;
492 testes frontend, 87 WASM/Worker e 22 Rust, build e smoke WebView2 passaram.
Faltam dois tipos de gradiente, demais efeitos/halos, executor/batch,
transformações e orçamento agregado. Nenhum gate foi fechado e preview normal,
exportação e `.axia` permanecem inalterados. Contrato e medição completos na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma oitava fatia estende o mesmo passe aos gradientes **radial e angular**,
completando os cinco tipos atuais da sobreposição no POC. Um teste de paradas
rígidas revelou diferença de arredondamento no radial; o cálculo Rust agora
preserva a referência JS de dois argumentos. Centro, emenda angular, rotações,
reversão e tiles são testados; o adapter rejeita a assinatura WASM anterior.
O corpus tem 17 goldens e a matriz dos cinco tipos compara 7.864.320 pixels
contra TS. Isso não conclui o compositor de documento nem ativa o caminho no
preview normal. Faltam demais efeitos/halos, executor/batch, cache/orçamento,
transformações e validação multiplataforma. Detalhes e medições na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma nona fatia adiciona um **lote local** em Rust: fill fracionário, até 64
overlays de cor/gradiente/padrão e Mesclar se — Esta camada no fim, sem cópias
JS de rasters intermediários. Máscara e destino são separados; a saída só é
publicada após sucesso. TS/Rust verificam 96 MiB por job incluindo scratch;
`memory-limit` identifica orçamento/reserva interna. Não inclui Camada abaixo,
transformação, halo ou compositor de documento. A sonda 1024² reduziu saída
WASM→JS de 16 MiB para 4 MiB, mas o tempo total mudou pouco (365,31 → 358,81 ms):
predominam os kernels. Isso não mede FPS nem conclui C0/C1/C2. Contrato,
cobertura e limites na [ABI do lote local](contrato-lote-local-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima fatia porta os primitivos de **expansão quadrada e desfoque da
máscara alfa** para Rust. Calcula suporte spread + blur, processa o contexto
do tile e recorta ao fim, preservando arredondamento por eixo e zero nas bordas.
Worker/adapter reutilizam a fonte e verificam 96 MiB por job incluindo duas
máscaras e fila. Isso prepara sombras/brilhos, mas não porta cor, deslocamento,
contorno, ruído ou a composição desses efeitos; o lote local não foi ampliado.
Matrizes, tiles e casos comparados com a sombra TS passaram byte a byte.
A sonda isolada 1024² mediu 106,10 ms no TS e 82,42 ms no adapter Rust; um tile
512² com contexto 544² levou 20,27 ms. Não é medição de FPS. Preview normal,
exportação e gates C0/C1/C2 permanecem inalterados. Detalhes na
[ABI da máscara alfa](contrato-mascara-alfa-v1.md) e na [prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima primeira fatia porta a **sombra externa**: deslocamento resolvido
no TS, spread/blur em Rust, knockout, cor/alfa, seis contornos, ruído e seis
modos de mesclagem, sobre fonte original com padding e target compacto.
Preserva índice global, hash UTF-16, ruído assinado e cauda dos contornos
customizados da referência. Golden existente, matrizes, tiles e cadeia de
sombras/overlay/Mesclar se passaram byte a byte. O orçamento por job soma os
buffers da sombra aos filtros; não é LRU/global. A sonda Node 1024² mediu
243,04 ms no TS e 158,96 ms no adapter Rust; tile 512² com contexto 544² levou
39,24 ms. Ainda não mede fluidez do editor. Fonte ampliada/insets, executor
externo integrado ao lote, demais efeitos, cache/transformações e gates
C0/C1/C2 seguem pendentes. Preview normal, exportação e `.axia` não mudaram.
Detalhes na [ABI da sombra externa](contrato-sombra-externa-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima segunda fatia porta a **sombra interna**: direção resolvida antes
do arredondamento, blur com halo, contração, recorte pelo alfa original,
contornos, ruído, cor e seis modos de mesclagem. Compartilha filtros e núcleo
de sombras sem alterar SHD1; o pacote SHI1 e o comando Worker são separados.
Golden existente, 21.233.664 pixels da matriz, tiles e cadeia externa/interna/
overlay com Fill zero passaram byte a byte. Sonda Node 1024²: mediana 241,19 ms
no TS e 168,88 ms no adapter Rust; tile 512² com contexto 544²: 41,16 ms.
Não mede FPS nem encerra gate de desempenho. Demais efeitos, estágios/conteúdo
no lote, preparação integrada, cache/orçamento agregado e transformação seguem
pendentes. Preview normal, exportação e `.axia` não mudaram; C0/C1/C2 abertos.
Detalhes na [ABI interna](contrato-sombra-interna-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima terceira fatia porta os **brilhos externo e interno (borda/centro)**:
spread/blur com halo, técnica precise/softer, contração, range, contornos,
jitter/ruído e paint sólido/degradê pela intensidade. GLW1 transporta pontos
e paradas f64; filtros, contornos e interpolação são compartilhados em Rust,
sem alterar os contratos das sombras/overlays. Goldens existentes e matrizes
passaram byte a byte, incluindo 32 paradas estreitas e tiles nas bordas.
Sonda 1024²: externo sólido 261,47 → 178,86 ms; externo degradê 972,29 →
197,28 ms no adapter Rust. Tile 512² com contexto 544²: 44,42/49,05 ms.
Não é FPS nem medição do compositor documental. Ainda faltam traçado, acetinado,
bisel, conteúdo/estágios no lote, preparação integrada, cache/orçamento global,
transformação e gates C0/C1/C2. Preview normal/exportação/`.axia` inalterados.
Detalhes no [contrato dos brilhos](contrato-brilhos-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima quarta fatia porta o **acetinado**: dois desfoques com halo,
deslocamentos espelhados depois de arredondar, diferença assinada, inversão,
contorno, recorte pelo alfa original e seis modos de mesclagem. SAT1 e comando
Worker separados; não descarta raw zero antes do contorno. O orçamento conta
três máscaras no pico, preservando saída/fonte em falhas. Golden existente,
14.155.776 pixels da matriz, tiles, escala e composição antes do overlay com
Fill zero passaram byte a byte. Sonda isolada Node 1024²: mediana 180,26 ms no
TS, 155,29 ms no adapter Rust; tile 512²/contexto 544²: 37,51 ms. Não mede FPS.
Traçado, bisel, conteúdo/estágios no lote, preparação integrada, cache/orçamento
global, transformação e gates C0/C1/C2 seguem pendentes. Preview normal,
exportação e `.axia` inalterados. Detalhes no
[contrato do acetinado](contrato-acetinado-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima quinta fatia porta o **traçado interno/central/externo**, com cor,
cinco tipos de degradê espacial e padrão. Mantém expansão circular via distância
quadrada, erosão interna legada, espessura mínima e pintura na grade completa;
não usa o tile como origem de gradiente/textura. STK1 transporta parâmetros e
payloads validados; orçamento soma máscaras, EDT, linhas/fronteiras e fila.
Golden combinado e 10.616.832 pixels da matriz passaram byte a byte, além de
tiles esparsos, 32 paradas estreitas e cadeia overlay → traçado com Fill zero.
Sondas Node 1024²: sólido 208,42 → 132,92 ms, degradê 1095,89 → 190,97 ms,
padrão 323,36 → 203,13 ms; tiles 512²/contexto 528²: 31,85/47,36/49,17 ms.
Não mede FPS/documento. Bisel, conteúdo/estágios no lote, preparação integrada,
cache/orçamento global, transformação e gates C0/C1/C2 continuam pendentes.
Preview normal, exportação e `.axia` não mudaram. Detalhes no
[contrato do traçado](contrato-tracado-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima sexta fatia porta o **bisel/relevo**: três técnicas, quatro estilos,
direção, profundidade, softening, contornos de brilho/recorte, textura e luz,
com highlight/shadow independentes. BEV1 transporta vetor de luz resolvido no
TS, dois contornos e textura decodificada. Halo R+S+1 cobre filtros e derivada;
dois buffers são reutilizados sem alocação por pixel. Preserva peculiaridades
do TS: altitude do efeito mesmo com ângulo global, textura pelo RGB sem alfa
e dot zero sem contribuição. Golden existente, matrizes, tiles, raios máximos,
contornos estreitos, máscaras esparsas e cadeia acetinado → overlay → bisel →
traçado com Fill zero passaram byte a byte. Sonda isolada Node 1024²: mediana
295,94 ms no TS e 256,97 ms no adapter Rust; tile 512²/contexto 554²: 63,22 ms.
O ganho deste caso foi moderado; não mede FPS nem encerra gate de desempenho.
Os dez tipos atuais têm passes Rust isolados, **não** um compositor integrado.
Conteúdo/executor de estágios, preparação/insets, cache/orçamento global,
transformação, integração e validação end-to-end/multiplataforma continuam
pendentes. C0/C1/C2 permanecem abertos; preview normal/exportação/`.axia`
inalterados. Detalhes no [contrato do bisel](contrato-bisel-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima sétima fatia integra **externos → conteúdo/Fill → internos →
overlays → superiores → Esta camada** em uma chamada Rust por tile. STG1
reutiliza os dez tipos e preserva a máscara original; conteúdo compõe sobre
sombras, não substitui o acumulado. Dois buffers internos alternam sem cópia
JS entre efeitos; output externo só é escrito após a sequência completa.
Preflight valida estágios, payloads e orçamento com o pico dos filtros e três
rasters compactos. Goldens, combinações dos dez tipos/seis modos/Fill fracionário,
tiles, flags e falhas passaram. Sonda Node 512²: TS 1467,50 ms, adapter Rust
406,76 ms, tile 260² 103,49 ms; Rust reutiliza fonte/parâmetros preparados,
enquanto TS inclui normalização/padding. Não é FPS nem ganho isolado da linguagem.
O porte dos passes CPU está concluído nesta fronteira experimental; C2 ainda
exige preparo/cache/agendamento real e medição end-to-end. C0/C1/C2 continuam
abertos; não é compositor da pilha, C3/C4 nem rollout no preview normal.
Detalhes no [contrato dos estágios](contrato-estagios-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma décima oitava fatia adiciona **preparação e sessão de fonte original**:
normalização/insets reais, padding próprio, preflight antes do decode/upload
e offsets locais para integral/tile. Fonte staged reusada por chave exata de
conteúdo/geometria/escala/qualidade, sem hash curto; Fill/cor/textura podem
recompor sem novo upload. Decode compatível pendente é compartilhado, e gates
rejeitam preparação/render tardios, inclusive durante dispose. Goldens e
Worker real cobrem reuso, falhas e reinício; diagnóstico Wails percorre essa
fronteira com RGBA fixo. Não liga Rust a `renderLayerStyle`/preview/exportação.
Padding ainda roda no ambiente do chamador: hospedá-lo em Worker, adaptar
decode/assets, agendamento, orçamento agregado e benchmark end-to-end são os
próximos passos de C2. Não é compositor da pilha nem encerramento de C2/C3/C4.
Detalhes no [contrato da preparação](contrato-preparacao-estilos-v1.md).

Uma décima nona fatia hospeda **padding e layout de staging no Worker**.
`stage-style-source` recebe cópia RGBA original e metadados editoriais, sem
pixels de texturas; valida orçamento, prepara margens e confirma chave/geometria
antes da adoção. Factory de staging libera fonte anterior antes de preparar,
inclusive em falha, sem executar para gerações atrasadas. Mantém goldens/reuso,
gates e protocolo baixo nível. Consumidor ainda faz preflight leve, loader e
cópia original; decode/encode reais, fila, orçamento agregado e benchmark
end-to-end seguem pendentes. Nada muda no preview normal/exportação/`.axia`,
nem fecha C2/C3/C4. Contrato e provas registram alcance e limites desta fatia.

Uma vigésima fatia adiciona **decode de imagens, texto e assets no Worker**.
`composeMedia` envia Blob/texto editorial, sem decode/cópia RGBA na UI; Worker
usa APIs browser e o desenhador de texto existente, prepara padding e executa
STG1 em Rust. Padrões/texturas ativos são deduplicados e decodificados em sequência,
com dimensões e orçamentos validados. Bitmaps/Canvas temporários são liberados em
sucesso, erro e obsolescência. Fonte reutilizada entre estilos/tiles; assets atuais
sempre recompõem, sem cache de resultado.
Factory assíncrona protege geração e impede upload após invalidação/substituição/
dispose. Fila de mídia limitada a oito trabalhos não bloqueia barreiras de lifecycle.
Testes Node distinguem doubles de decoder do Worker/WASM real; smoke WebView2 usa
PNG real, mudança de padrão e texto. C0/C1/C2 permanecem abertos: encode, limites
intrínsecos de imagens, coalescência, cache/orçamento global, serviço real e medições
end-to-end ainda faltam. Preview normal/exportação/`.axia` continuam inalterados.
Detalhes no [contrato da preparação](contrato-preparacao-estilos-v1.md) e na
[prova Rust/WASM](prova-rust-wasm-c1.md).

Uma vigésima primeira fatia completa **decode → efeitos Rust → PNG no Worker**.
`composeMediaPng` usa o mesmo pipeline/região e fonte reutilizável de RGBA;
Canvas codifica a saída sem trazer pixels para a UI. Gate exige formato pedido,
geometria e gerações atuais; cancelamento/troca/dispose durante encode nunca
publicam PNG antigo. Fila serial existente limita encoders simultâneos e Canvas
temporário é limpo em `finally`. Preflight cobra fonte/assets/pacote retidos,
saída/Canvas/margem de encoder e Blob pronto; não é teto de RSS.
Timings de upload Canvas/encode são separados do kernel, sem benchmark end-to-end.
Smoke Wails redecodifica PNG real integral/tile/Fill/padrão/texto e confirma reuso.
Node distingue doubles de encoder do Worker/WASM real. Preview normal, exportação
e `.axia` permanecem inalterados; faltam consumidor/serviço real, orçamento global,
coalescência/prioridade, limites intrínsecos e medições/QA para encerrar C2.
Pilha documental e canvas único continuam C3/C4, sem remover renderizadores antigos.

Uma vigésima segunda fatia adiciona **serviço consumidor experimental**:
Worker exclusivo aberto sob demanda/reutilizado, RPC correlacionado/bounded,
um ativo + um pendente (último pedido vence), snapshots, cancelamento visual
sem cancelar staging, invalidate/dispose e retomada no próximo pedido após falha.
Watchdog/épocas impedem adoção de abertura tardia. Leases de PNG têm release
idempotente e orçamento lógico de entradas/fase ativa/resultados por serviço;
não é teto de RSS ou orçamento global. O diagnóstico Wails usa a factory browser
e PNG real para integral/tile/Fill/reuso, obsolescência e leases.
Preview/exportação/`.axia` continuam inalterados. Próximos passos: consumidor
real atrás de flag, handoff/fallback/métricas, pool/orçamento global/cache e
limites intrínsecos; não criar um Worker por camada sem política global.
C0/C1/C2 continuam abertos e C3/C4 ainda não foram substituídos.
Detalhes no [contrato do serviço](contrato-servico-estilos-rust-v1.md).

Uma vigésima terceira fatia liga **estilos de um canvas real ao serviço Rust**,
somente com `--axia-rust-styles-preview`/`?axiaRustStyles=1`. Um dono por janela;
outros canvases, miniaturas e exportação continuam no legado. PNG e lease ficam
juntos da URL até retirada pelo handoff/unmount. Preparação abortável, tokens,
fechamento antes da troca de dono e circuito de fallback protegem cancelamento,
falhas e reinstanciação sem criar Worker por camada. Chave compacta da fonte
compara a identidade original exata; cache legado não recebe resultados Rust.
Smokes Wails percorrem UI real, pixels visíveis, handoff, fallback com WASM
indisponível e remoção da camada com zero leases pendentes. Timings agrupados
não são benchmark de FPS ou porcentagem de ganho. Default permanece desligado;
faltam pool/orçamento global/cache, limites intrínsecos, matriz visual e medições
repetidas antes do rollout. C0/C1/C2 permanecem abertos e C3/C4 não mudam.
Detalhes no [contrato do preview](contrato-preview-estilos-rust-v1.md).

Uma vigésima quarta fatia adiciona **agendador compartilhado isolado**, ainda
sem ampliar o preview da 23ª fatia. Um serviço/Worker adotado por vez; FIFO entre
consumidores, substituição somente dentro da mesma camada, cancelamento sem
interferência nas demais e capacidade bounded. Snapshots/preflight do serviço
são compartilhados; identidade compacta não permite alias entre camadas.
Orçamento conjunto cobra ativo, fila e todas as leases, inclusive após dispose.
`whenIdle()` distingue rejeição visual de drenagem; reconexão espera confirmação
de término anterior. Worker/WASM reais em Node validam os cenários multicamadas,
com doubles explícitos de Canvas/mídia. Preview atual e exportação não mudaram.
Próximo passo é ligar a fila ao preview opt-in e validar lifecycle/preparação,
orçamento e handoff multicamadas em Wails. Prioridades/cache, limites intrínsecos,
medições e QA ainda faltam; C0/C1/C2 permanecem abertos. Detalhes no
[contrato do agendador](contrato-agendador-estilos-rust-v1.md).

Uma vigésima quinta fatia liga **preview multicamadas ao agendador compartilhado**,
ainda opt-in. Preparação entra na fila antes de fetch, com metadados limitados,
reserva de mídia codificada, leitura em stream bounded/abortável e conferência
dos bytes reais antes do Worker. Cancelamento é por consumidor; drenagem evita
sobrepor operações. Timeout de loader fecha a instância para impedir novas
preparações sobre uma antiga que não terminou. Falha local abre circuito da
camada; indisponibilidade WASM abre circuito comum e preserva fallback dos
consumidores válidos. Leases antigas descontam orçamento da próxima instância.
Smoke Wails exercita três camadas, um Worker, remoção parcial, edição isolada,
fallback sem multiplicar Workers e limpeza final. Default/miniaturas/exportação,
texto, ABI, algoritmos Rust e versões não mudaram. Faltam prioridades/visibilidade,
cache/assets, limites intrínsecos, orçamento entre janelas e medições/QA.
C0/C1/C2 continuam abertos; C3/C4 não substituíram pilha/DOM/exportação.

O despacho raster e o cálculo de insets no TS agora usam `switch` exaustivo
derivado do mapa efeito→estágio. Um efeito desconhecido chega a
`LayerStyleUnsupportedEffectError` com código e tipos; os goldens puros e os
três documentos Canvas mantiveram a aparência. O protocolo do Worker preserva
esse código/tipos e identifica também padrão não decodificado; o fallback sem
Worker usa as mesmas classes. O teste de protocolo cobre a serialização por
`structuredClone` e mensagem legada. A validação visual manual e os demais
gates C2 continuam pendentes.

### C3 — Um compositor offscreen do documento

- [ ] Usar pilha/estilos/Blend If em ordem explícita no mesmo kernel para
  exportação, miniatura, amostragem, mesclagem e rasterização. Preservar
  resolução plena e `.axia` antigo; validar PNG e casos de baixa memória.
- [ ] Não apagar `renderDocument.ts` enquanto houver consumidor sem paridade.
  Mapear cada chamada a um teste de integração antes da substituição.

### C4 — Preview ao vivo em uma superfície

- [ ] Integrar canvas de documento único, tiles visíveis, dirty regions e
  agendador. Manter overlays de seleção, guias, texto em edição, ferramentas e
  handles em camada de interação independente, com coordenadas coerentes.
- [ ] Comparar pan/zoom, efeitos, fontes, seleção, cursores, transparência,
  DPI e imagem carregando; impedir flash, quadro obsoleto e mudança de centro.
- [ ] Testar Blend If sem prévia especial. Após paridade e rollout, remover
  `<img>` por camada, handoff/double buffer e prévia composta antiga **somente**
  quando não houver usuário/caso dependente. Manter rollback durante beta.

### C5 — Consolidação e eventual GPU

- [ ] Remover caminhos duplicados e dívida de testes apenas após inspeção de
  referências/consumidores. Documentar ABI pública, diagnósticos e limites.
- [ ] Medir GPU no hardware alvo: WebGPU/WebGL2 do WebView2 realmente entregue,
  fallbacks, limites de textura, custo de upload/readback, drivers e baterias.
  Se um passe CPU for gargalo medido, testar WGSL/`wgpu` sob paridade tolerante.
  Não pressupor compute shaders no fallback WebGL2 nem portabilidade gratuita.
- [ ] Modelo/histórico em Rust e shell nativo são iniciativas **futuras separadas**,
  justificadas por benefício próprio, não requisitos deste roadmap.

## 7. Internacionalização — arquitetura de primeira classe

### 7.1 Resolução de idioma e preferências

- Idiomas oficiais iniciais: `pt-BR` (Português do Brasil), `en-US` (English)
  e `zh-Hans` (简体中文). `zh-CN`/`zh-SG` podem mapear para `zh-Hans`; `zh-TW`,
  `zh-HK` e `zh-MO` **não** devem receber simplificado implicitamente.
- Preferência `auto | tag BCP 47 explícita`. Em `auto`, consultar preferências
  do SO por adaptador Go por plataforma; validar e testar a leitura real em
  Windows/Linux/macOS suportados. `navigator.languages` é fallback, pois
  descreve o WebView/navegador e não garante equivalência ao SO. Reavaliar
  `auto` na próxima abertura após mudança do SO; troca manual aplica sem reinício
  quando possível.
- Ordem: escolha explícita válida → lista do SO/idioma disponível mais próximo
  → fallback `en-US`. Enquanto a extração não estiver completa, PT-BR continua
  base de desenvolvimento; não lançar o seletor como "traduzido" com UI mista.
- Guardar preferência por usuário, fora do `.axia`; restaurar na janela de
  estilos e em diálogos. Mudar idioma não altera texto do documento nem assets.
- `Intl`/CLDR para números, datas, unidades e pluralização; medida documental
  e parsing de números de propriedade devem ter regras explícitas por locale.
  Não confundir separador decimal exibido com valores serializados.

### 7.2 Catálogos e fronteira entre linguagens

- Usar chaves semânticas (`export.error.tooLarge`), parâmetros nomeados e
  plurais; proibir concatenação de frases traduzidas. Preferir biblioteca Vue
  compatível depois de POC, com versão fixada e bundles oficiais locais.
- Go/Rust/Worker retornam códigos estáveis `{ code, params }`, com detalhes
  técnicos separados da mensagem ao usuário. O frontend resolve a tradução;
  diálogos nativos recebem rótulos traduzidos ou consultam o mesmo catálogo
  por adaptador. Evitar enviar mensagem livre localizada como contrato.
- Extrair texto de `App.vue`, componentes, tooltips, status, erros, menus,
  onboarding, atalhos visíveis, diálogos Go, janela de estilos, instalador e
  fluxos de PDF/exportação. Texto de log técnico pode permanecer estável, mas
  erro exibido ao usuário não. Auditar `toLocaleString('pt-BR')`, ordenação e
  comparações dependentes de locale.
- Definir `dir`, `lang`, fallback de fontes e CSS sem larguras fixas. Garantir
  que mudança de tradução não mova o canvas nem oculte ferramentas; validar
  rótulos longos, escalas de SO e CJK. RTL fica explicitamente fora do primeiro
  lote, mas componentes não devem codificar esquerda/direita semanticamente.

### 7.3 Pacotes de tradução externos para modders

Pacote declarativo (por exemplo `manifest.json` + `messages.json` UTF-8) em
diretório de dados do usuário, com `schemaVersion`, tag BCP 47, nome nativo,
autor/licença opcional, versão do pacote e faixa de compatibilidade de chaves.
Oficiais vêm embutidos; externos não alteram arquivos instalados. O Go limita
leitura ao diretório configurado e entrega apenas dados validados à UI.

- [ ] Documentar localização por plataforma e modo portável, instalação,
  atualização, desativação e remoção sem tocar em projetos. Não varrer disco
  inteiro nem baixar pacotes automaticamente.
- [ ] Validar JSON e schema, tamanho de arquivo/quantidade de chaves,
  codificação, duplicatas, locale, placeholders e pluralização. Rejeitar
  caminhos externos/links indevidos; não executar JS, CSS, HTML nem scripts
  incluídos. Traduzir texto como texto, não `innerHTML`.
- [ ] Impedir sobrescrita de idiomas oficiais sem escolha explícita; informar
  pacote incompatível/malformado e continuar com idioma oficial. Fallback por
  chave para `en-US` (e `pt-BR` enquanto a migração estiver incompleta).
- [ ] Definir versionamento do schema, depreciação de chaves, inventário
  público, exemplo de pacote, licença recomendada, validador CLI e cobertura.
  Traduções externas são dados não confiáveis: limitar uso de memória e
  preservar UI utilizável se a pasta for apagada durante a sessão.
- [ ] Não misturar este mecanismo com API de plugins/mods executáveis; é
  exclusivamente extensão de idioma.

### 7.4 Fases de entrega de idiomas

#### I0 — Inventário e infraestrutura

- [ ] Classificar strings de UI, mensagens Go, rótulos nativos, formatação,
  strings persistidas e texto do usuário. Decidir comportamento de projetos
  antigos que contêm nomes padrão já gravados em português: preservá-los.
- [ ] Criar catálogos base `pt-BR`/`en-US`, resolvedor `auto`, persistência de
  preferência e testes de seleção/fallback. Versionar dependência de i18n.

O resolvedor puro, a preferência persistível e os primeiros testes estão em
`frontend/src/i18n/locale.ts` e `frontend/tests/locale.test.ts`. O método nativo
`GetSystemLanguages` e o adaptador `getSystemLanguages()` já fornecem a lista
ordenada do SO (Windows API; variáveis POSIX no Linux; AppleLanguages no macOS),
com `navigator.languages` apenas como fallback. A chamada real foi testada no
Windows; Linux/macOS ainda exigem validação nas plataformas alvo. A lista não
altera automaticamente o idioma da UI por enquanto.

O [inventário de strings](inventario-strings-i18n.md) classifica as fronteiras.
O primeiro catálogo tipado (`frontend/src/i18n/catalogs.ts`) cobre 20 chaves
da tela inicial em três idiomas; chinês ainda requer revisão fluente.
`ProjectHome.vue` e `RecentProjectCard.vue` consomem essa fatia com PT-BR como
padrão, sem seletor nem ativação automática. Faltam os demais fluxos, conexão
da lista do SO ao estado global e validação visual antes de declarar I0/I1
concluídos.

O menu superior foi extraído em seguida: 54 chaves adicionais em
`frontend/src/i18n/menuCatalogs.ts` (74 no total), incluindo plurais, tooltips
e acessibilidade. `TopMenu.vue` continua em PT-BR por padrão; rótulos gerados
por histórico/status e checagem visual de largura ainda são pendências.

O diálogo Novo documento foi extraído com 54 chaves adicionais (128 no total),
incluindo validações por código e números de estimativas formatados para
exibição. Predefinições internas usam IDs para obter rótulos traduzidos; nomes
salvos pelo usuário e dados serializados permanecem intactos. A prop `locale`
do diálogo ainda usa PT-BR por padrão e não foi ligada ao estado global.
Testes dos rótulos, dos erros e do contrato existente passaram; faltam QA
visual e os demais diálogos antes de ativar idiomas alternativos.

#### I1 — Migração completa de strings e formatação

- [ ] Migrar fluxo por fluxo, com linter que detecte chaves ausentes,
  parâmetros divergentes e novos textos literais em pontos de UI. Testar
  plurais, números, datas, DPI, unidades e atalhos.
- [ ] Entregar `zh-Hans` revisado por pessoa fluente; validar fontes, menus,
  caixas, quebra de linha e entrada de texto chinês sem confundir UI e conteúdo.
- [ ] Manual de QA nas três línguas, Windows/Linux/macOS suportados e WebViews
  alvo. Pseudolocalização para descobrir cortes e expansões de texto.

#### I2 — Pacotes externos

- [ ] Implementar leitor/validador isolado, exemplo, teste de segurança e
  interface de escolha de idioma externo. Simular pacote parcial, incompatível,
  corrompido, enorme, removido em execução e tentativa de HTML/script.
- [ ] Atualizar README, instalador/portável e guia de tradutores; publicar
  contrato estável somente após ciclo beta de feedback.

Gate de lançamento multilíngue: nenhuma chave obrigatória ausente em idiomas
oficiais; interface não quebra layout; locale auto/manual/fallback comprovados;
todos os erros exibidos têm tradução; pacote externo inválido nunca impede abrir.

## 8. Matriz de validação final e encerramento

- Testes automatizados em Windows/Linux e smoke manual no macOS se suportado
  pela distribuição; hardware integrado e discreto quando disponível.
- Perfil visual: 100%, zoom máximo, pan com botão central, DPR 1/1,25/2,
  documento transparente, texto grande com estilos, `Blend If`, PDFs, camadas
  inteligentes, recorte/seleção e exportação; comparar preview e arquivo.
- Perfil de robustez: 8K/64 MP, memória pressionada, Worker reiniciado, troca
  rápida de documento, cancelamento de exportação, undo/redo e fechamento com
  render pendente. Nenhum crash, vazamento progressivo ou resultado antigo.
- Perfil de idioma: instalação limpa com SO em PT/EN/zh-Hans, alternância
  manual/auto, SO não suportado, idioma externo parcial/malicioso e mesma
  sessão salva/reaberta em outro idioma. Layout e conteúdo editorial intactos.
- Critérios de encerramento: contrato e limites documentados; testes verdes;
  baseline e regressões publicados; validação manual do usuário; artefato
  instalável/portável testado; flag antiga só removida após período beta;
  nenhum consumidor usa composição paralela por acidente.

## 9. Dependências, riscos e ordem recomendada

1. **Agora:** fechar C0/contrato e I0 em paralelo. O sistema de códigos de erro
   estáveis entra no contrato V1 para não retrabalhar a ABI.
2. **Depois:** C1 POC Rust e I1 extração de strings podem avançar isoladamente.
   Não acoplar introdução de Rust à troca visual do preview no mesmo commit.
3. **Em seguida:** C2 → C3 → C4, liberando por feature flag e benchmark. I2 pode
   acontecer depois da cobertura dos três idiomas, sem esperar C4.
4. **Por último:** C5 e remoção de caminhos velhos, só após aceitação manual.

Riscos de maior impacto: incompatibilidade WebView/Worker/WASM em hardware real;
copiar RGBA demais; halos/invalidação incompletos; estilo ou Blend If divergente;
renderização de texto em escala inadequada; OOM em documentos grandes; mistura
de strings/locales entre Go e frontend; pacote de idioma não confiável. Cada
risco tem gate correspondente acima. Se C1 não entregar resultado e desempenho
aceitáveis, preservar o contrato de compositor único e considerar implementação
CPU em TS; Rust não é um objetivo independente da qualidade do Axia.

## Referências técnicas para as versões e convenções

- [Rust 1.98.1](https://blog.rust-lang.org/releases/latest/),
  [fixação via rust-toolchain.toml](https://rust-lang.github.io/rustup/overrides.html),
  [Cargo.lock](https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html).
- [Go 1.26.5](https://go.dev/dl/),
  [Node 24 LTS](https://nodejs.org/en/about/previous-releases),
  [wasm-bindgen 0.2.129](https://docs.rs/wasm-bindgen/latest/wasm_bindgen/).
- [Limites WebGL2/WebGPU no wgpu](https://docs.rs/wgpu/latest/wgpu/struct.Limits.html),
  [preferência do navegador vs. SO](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/language),
  [tags de locale CLDR](https://unicode-org.github.io/cldr/ldml/tr35.html).

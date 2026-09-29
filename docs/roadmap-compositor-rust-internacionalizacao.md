# Roadmap: compositor único em Rust e Axia multilíngue

Estado: **C0/I0 iniciados; nenhuma migração visual ou de compositor ativada**.
Atualizado em 2026-09-29.

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
O marco C0 segue aberto: faltam medições visuais/de desempenho, fixtures e
repetição em toolchains fixadas e plataformas alvo.

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

### C2 — Estilos CPU e raster por região

- [ ] Portar passes de estilo gradualmente, com testes de combinação e paridade
  por efeito. Adicionar entradas/halos e seed/âncora absolutos; verificar
  equivalência tile vs raster inteiro. Separar rasterização de texto/forma.
- [ ] Fechar dispatch exaustivo de efeitos no TS atual independentemente do
  porte; casos não suportados retornam erro estruturado, nunca somem em silêncio.
- [ ] Cache/cancelamento/orçamentos com benchmark end-to-end, não apenas kernel.

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
`frontend/src/i18n/locale.ts` e `frontend/tests/locale.test.ts`; falta conectar
a leitura real do SO, os catálogos e a interface de escolha.

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

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

Esta comparação prova apenas o passe sem efeitos de opacidade de preenchimento
em um fundo transparente. Não prova paridade para estilos combinados, Canvas,
transformações, texto, exportação, preview ou gargalos de interação. O restante
do C0 permanece aberto, conforme o roadmap.

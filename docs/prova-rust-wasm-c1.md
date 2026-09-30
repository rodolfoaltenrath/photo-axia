# Prova de conceito Rust/WASM — C1 parcial

Estado: **isolada, sem ligação com o preview/exportação**. O objetivo desta
primeira fatia é verificar toolchain, ABI mínima, arredondamento, alfa
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
cargo build --offline --release --locked --target wasm32-unknown-unknown --manifest-path rust/axia-pixel-core/Cargo.toml
node --experimental-strip-types frontend/scripts/testRustPixelPoc.mjs
```

O teste WASM usa o golden `fill-opacity-rounding` e compara todas as 25.856
combinações de alfa (0–255) e opacidade inteira (0–100) com
`composeLayerStyleRaster`. Também verifica rejeição de argumentos inválidos.
O build gera um `.wasm` local em `target/`, ignorado pelo Git; o app ainda não
o carrega. A ABI `axia_poc_*` é interna e experimental: o adaptador JS deve
passar somente ponteiros alocados por `axia_poc_alloc` e liberar cada par
ponteiro/comprimento uma única vez; atualmente apenas o harness de teste
respeita esse contrato, sem uma camada de validação de handles. Não a expor
como API pública ou a dados
não confiáveis. Antes de conectar um Worker, definir ownership/cancelamento e
testar carregamento no pacote instalável, cópias de memória e desempenho.

Esta comparação prova apenas o passe sem efeitos de opacidade de preenchimento
em um fundo transparente. Não prova paridade para estilos combinados, Canvas,
transformações, texto, exportação, preview ou gargalos de interação. O restante
do C0 permanece aberto, conforme o roadmap.

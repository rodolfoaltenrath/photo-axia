/**
 * Orçamentos do consumidor documental Rust, num só lugar para o planejador, a carga de
 * mídia no Worker e as fontes sintetizadas (forma e texto) não divergirem.
 *
 * O preparo no núcleo mantém duas cópias das fontes ao mesmo tempo (pacote SDP1 e
 * documento preparado) dentro do orçamento de trabalho de 96 MiB; 47 MiB deixa espaço
 * para o tile de 256×256, registros e metadados e admite uma foto de 12 MP
 * (4000×3000 = 45,8 MiB). Medido com `npm run benchmark:rust-document-budget`.
 */
export const RUST_DOCUMENT_SOURCE_BYTES = 47 * 1024 * 1024
/**
 * Pico transitório da decodificação no Worker documental: arquivo decodificado, bitmap,
 * canvas e leitura (até 4× uma fonte no limite). É memória JS/GPU do Worker, liberada antes
 * de montar o pacote (bitmap fechado, canvas encolhido), e não conta no WASM.
 */
export const RUST_DOCUMENT_DECODE_BYTES = 4 * RUST_DOCUMENT_SOURCE_BYTES
/** Bytes codificados (PNG/JPEG e texto já rasterizado) lidos pela thread principal. */
export const RUST_DOCUMENT_ENCODED_BYTES = 32 * 1024 * 1024

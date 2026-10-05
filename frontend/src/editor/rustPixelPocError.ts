export class RustPixelPocError extends Error {
  readonly code: 'wasm-unavailable' | 'invalid-input' | 'wasm-failure' | 'memory-limit'

  constructor(code: RustPixelPocError['code']) {
    super(code)
    this.code = code
  }
}

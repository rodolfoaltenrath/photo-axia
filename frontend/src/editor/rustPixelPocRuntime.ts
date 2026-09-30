const MAX_POC_BYTES = 64 * 1024 * 1024

interface RustPixelPocExports {
  memory: WebAssembly.Memory
  axia_poc_alloc(length: number): number
  axia_poc_free(pointer: number, length: number): void
  axia_poc_fill_opacity(pointer: number, length: number, opacity: number): number
}

export class RustPixelPocError extends Error {
  readonly code: 'wasm-unavailable' | 'invalid-input' | 'wasm-failure'

  constructor(code: 'wasm-unavailable' | 'invalid-input' | 'wasm-failure') {
    super(code)
    this.code = code
  }
}

function validateExports(exports: WebAssembly.Exports): RustPixelPocExports {
  const candidate = exports as unknown as Partial<RustPixelPocExports>
  if (!(candidate.memory instanceof WebAssembly.Memory) ||
      typeof candidate.axia_poc_alloc !== 'function' ||
      typeof candidate.axia_poc_free !== 'function' ||
      typeof candidate.axia_poc_fill_opacity !== 'function') {
    throw new RustPixelPocError('wasm-unavailable')
  }
  return candidate as RustPixelPocExports
}

export async function createRustPixelPocRuntime(wasm: ArrayBuffer) {
  if (!wasm.byteLength) throw new RustPixelPocError('wasm-unavailable')
  let result: WebAssembly.WebAssemblyInstantiatedSource
  try {
    result = await WebAssembly.instantiate(wasm, {})
  } catch {
    throw new RustPixelPocError('wasm-unavailable')
  }
  const exports = validateExports(result.instance.exports)

  return {
    render(source: Uint8Array, fillOpacity: number) {
      if (!source.byteLength || source.byteLength > MAX_POC_BYTES || source.byteLength % 4 !== 0 ||
          !Number.isInteger(fillOpacity) || fillOpacity < 0 || fillOpacity > 100) {
        throw new RustPixelPocError('invalid-input')
      }
      const length = source.byteLength
      const started = performance.now()
      const pointer = exports.axia_poc_alloc(length)
      if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer + length > exports.memory.buffer.byteLength) {
        throw new RustPixelPocError('wasm-failure')
      }
      const allocated = performance.now()
      let copiedIn = allocated
      let computed = allocated
      let copiedOut = allocated
      let rgba: Uint8Array
      try {
        new Uint8Array(exports.memory.buffer, pointer, length).set(source)
        copiedIn = performance.now()
        if (exports.axia_poc_fill_opacity(pointer, length, fillOpacity) !== 0) {
          throw new RustPixelPocError('wasm-failure')
        }
        computed = performance.now()
        rgba = new Uint8Array(exports.memory.buffer, pointer, length).slice()
        copiedOut = performance.now()
      } finally {
        exports.axia_poc_free(pointer, length)
      }
      const released = performance.now()
      return {
        rgba,
        timings: {
          allocationMs: allocated - started,
          copyInMs: copiedIn - allocated,
          kernelMs: computed - copiedIn,
          copyOutMs: copiedOut - computed,
          releaseMs: released - copiedOut
        }
      }
    }
  }
}

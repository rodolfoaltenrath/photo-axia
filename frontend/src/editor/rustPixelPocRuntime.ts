const MAX_POC_BYTES = 64 * 1024 * 1024
let nextSourceId = 0

interface RustPixelPocExports {
  memory: WebAssembly.Memory
  axia_poc_alloc(length: number): number
  axia_poc_free(pointer: number, length: number): void
  axia_poc_fill_opacity(pointer: number, length: number, opacity: number): number
  axia_poc_fill_opacity_region(sourcePointer: number, sourceLength: number,
    sourceWidth: number, sourceHeight: number, x: number, y: number,
    width: number, height: number, outputPointer: number, outputLength: number,
    opacity: number): number
}

export interface RustPixelPocRegion { x: number; y: number; width: number; height: number }

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
      typeof candidate.axia_poc_fill_opacity !== 'function' ||
      typeof candidate.axia_poc_fill_opacity_region !== 'function') {
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
  let staged: { id: number; generation: number; pointer: number; length: number;
    width: number; height: number } | null = null
  let latestGeneration = 0
  let disposed = false

  function validateNextGeneration(generation: number) {
    if (!Number.isSafeInteger(generation) || generation <= latestGeneration) {
      throw new RustPixelPocError('invalid-input')
    }
  }

  function discardStaged() {
    if (staged) exports.axia_poc_free(staged.pointer, staged.length)
    staged = null
  }

  function validateSource(source: Uint8Array, width: number, height: number) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0 || width > 0xffffffff || height > 0xffffffff ||
        source.byteLength !== width * height * 4 || source.byteLength > MAX_POC_BYTES) {
      throw new RustPixelPocError('invalid-input')
    }
  }

  function validateRegion(region: RustPixelPocRegion, width: number, height: number, fillOpacity: number) {
    const values = [region.x, region.y, region.width, region.height, fillOpacity]
    const outputLength = region.width * region.height * 4
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) ||
        region.width === 0 || region.height === 0 || fillOpacity > 100 ||
        outputLength > MAX_POC_BYTES || region.x + region.width > width ||
        region.y + region.height > height) {
      throw new RustPixelPocError('invalid-input')
    }
    return outputLength
  }

  function renderFromPointer(sourcePointer: number, sourceLength: number, sourceWidth: number,
    sourceHeight: number, region: RustPixelPocRegion, fillOpacity: number,
    sourceAllocationMs: number, sourceCopyInMs: number) {
    const outputLength = region.width * region.height * 4
    const allocationStarted = performance.now()
    const outputPointer = exports.axia_poc_alloc(outputLength)
    if (!Number.isSafeInteger(outputPointer) || outputPointer <= 0) {
      throw new RustPixelPocError('wasm-failure')
    }
    const allocated = performance.now()
    let computed = allocated
    let copiedOut = allocated
    let rgba: Uint8Array
    try {
      if (sourcePointer + sourceLength > exports.memory.buffer.byteLength ||
          outputPointer + outputLength > exports.memory.buffer.byteLength) {
        throw new RustPixelPocError('wasm-failure')
      }
      if (exports.axia_poc_fill_opacity_region(sourcePointer, sourceLength,
        sourceWidth, sourceHeight, region.x, region.y, region.width, region.height,
        outputPointer, outputLength, fillOpacity) !== 0) {
        throw new RustPixelPocError('wasm-failure')
      }
      computed = performance.now()
      rgba = new Uint8Array(exports.memory.buffer, outputPointer, outputLength).slice()
      copiedOut = performance.now()
    } finally {
      exports.axia_poc_free(outputPointer, outputLength)
    }
    const released = performance.now()
    return {
      rgba,
      timings: {
        allocationMs: sourceAllocationMs + allocated - allocationStarted,
        copyInMs: sourceCopyInMs,
        kernelMs: computed - allocated,
        copyOutMs: copiedOut - computed,
        releaseMs: released - copiedOut
      }
    }
  }

  return {
    render(source: Uint8Array, fillOpacity: number) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
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
    },
    renderRegion(source: Uint8Array, sourceWidth: number, sourceHeight: number,
      region: RustPixelPocRegion, fillOpacity: number) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      validateSource(source, sourceWidth, sourceHeight)
      validateRegion(region, sourceWidth, sourceHeight, fillOpacity)
      const started = performance.now()
      const sourcePointer = exports.axia_poc_alloc(source.byteLength)
      if (!Number.isSafeInteger(sourcePointer) || sourcePointer <= 0) {
        throw new RustPixelPocError('wasm-failure')
      }
      try {
        if (sourcePointer + source.byteLength > exports.memory.buffer.byteLength) {
          throw new RustPixelPocError('wasm-failure')
        }
        const allocated = performance.now()
        new Uint8Array(exports.memory.buffer, sourcePointer, source.byteLength).set(source)
        const copiedIn = performance.now()
        return renderFromPointer(sourcePointer, source.byteLength, sourceWidth, sourceHeight,
          region, fillOpacity, allocated - started, copiedIn - allocated)
      } finally {
        exports.axia_poc_free(sourcePointer, source.byteLength)
      }
    },
    invalidateSource(generation: number) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      validateNextGeneration(generation)
      latestGeneration = generation
      discardStaged()
    },
    stageSource(source: Uint8Array, width: number, height: number, generation: number) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      validateNextGeneration(generation)
      // A new edit invalidates old pixels even if validation/allocation fails.
      latestGeneration = generation
      discardStaged()
      validateSource(source, width, height)
      const started = performance.now()
      const pointer = exports.axia_poc_alloc(source.byteLength)
      if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new RustPixelPocError('wasm-failure')
      try {
        if (pointer + source.byteLength > exports.memory.buffer.byteLength) {
          throw new RustPixelPocError('wasm-failure')
        }
        new Uint8Array(exports.memory.buffer, pointer, source.byteLength).set(source)
      } catch (error) {
        exports.axia_poc_free(pointer, source.byteLength)
        throw error
      }
      const sourceId = ++nextSourceId
      staged = { id: sourceId, generation, pointer, length: source.byteLength, width, height }
      return { sourceId, generation, stagingMs: performance.now() - started }
    },
    renderStagedRegion(sourceId: number, region: RustPixelPocRegion, fillOpacity: number) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      validateRegion(region, staged.width, staged.height, fillOpacity)
      return { ...renderFromPointer(staged.pointer, staged.length, staged.width, staged.height,
        region, fillOpacity, 0, 0), generation: staged.generation }
    },
    releaseSource(sourceId: number) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      discardStaged()
    },
    dispose() {
      if (disposed) return
      disposed = true
      discardStaged()
    }
  }
}

import type { LayerBlendMode } from '../types/editor.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { encodeLocalBatch, encodeBatchGradient, type RustPixelPocBatchPlan } from './rustPixelPocBatch.ts'
export { RustPixelPocError } from './rustPixelPocError.ts'

const MAX_POC_BYTES = 64 * 1024 * 1024
let nextSourceId = 0

interface RustPixelPocExports {
  axia_poc_local_batch_region(sourcePointer: number, sourceLength: number, sourceWidth: number, sourceHeight: number,
    x: number, y: number, width: number, height: number, packetPointer: number, packetLength: number,
    outputPointer: number, outputLength: number): number
  memory: WebAssembly.Memory
  axia_poc_alloc(length: number): number
  axia_poc_free(pointer: number, length: number): void
  axia_poc_fill_opacity(pointer: number, length: number, opacity: number): number
  axia_poc_fill_opacity_region(sourcePointer: number, sourceLength: number,
    sourceWidth: number, sourceHeight: number, x: number, y: number,
    width: number, height: number, outputPointer: number, outputLength: number,
    opacity: number): number
  axia_poc_blend_if_underlying_region(sourcePointer: number, sourceLength: number,
    sourceWidth: number, sourceHeight: number, x: number, y: number,
    width: number, height: number, backdropPointer: number, backdropLength: number,
    outputPointer: number, outputLength: number, channel: number, shadowStart: number,
    shadowEnd: number, highlightStart: number, highlightEnd: number): number
  axia_poc_blend_if_this_layer_region(sourcePointer: number, sourceLength: number,
    sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number,
    outputPointer: number, outputLength: number, channel: number, shadowStart: number,
    shadowEnd: number, highlightStart: number, highlightEnd: number): number
  axia_poc_color_overlay_region(sourcePointer: number, sourceLength: number,
    sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number,
    targetPointer: number, targetLength: number, outputPointer: number, outputLength: number,
    red: number, green: number, blue: number, colorAlpha: number, opacity: number, blendMode: number): number
  axia_poc_pattern_overlay_region(sourcePointer: number, sourceLength: number,
    sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number,
    targetPointer: number, targetLength: number, outputPointer: number, outputLength: number,
    patternPointer: number, patternLength: number, patternWidth: number, patternHeight: number,
    cosine: number, sine: number, scaleFactor: number, opacity: number, blendMode: number): number
  axia_poc_gradient_overlay_region(sourcePointer: number, sourceLength: number,
    sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number,
    targetPointer: number, targetLength: number, outputPointer: number, outputLength: number,
    colorsPointer: number, colorsLength: number, opacitiesPointer: number, opacitiesLength: number,
    kind: number, cosine: number, sine: number, scale: number, reverse: number,
    opacity: number, blendMode: number, angleRadians: number): number
}

export interface RustPixelPocRegion { x: number; y: number; width: number; height: number }
/** Normalize thresholds before dispatch. */
export interface RustPixelPocBlendIf {
  channel: 'gray' | 'red' | 'green' | 'blue'
  shadows: [number, number]
  highlights: [number, number]
}
export type RustPixelPocUnderlyingBlendIf = RustPixelPocBlendIf

export interface RustPixelPocColorOverlay {
  color: [number, number, number, number]
  opacity: number
  blendMode: LayerBlendMode
}

/** Decoded RGBA8, not an asset URL. */
export interface RustPixelPocPatternRaster { rgba: Uint8Array; width: number; height: number }
/** Normalized style parameters only. */
export interface RustPixelPocPatternOverlay {
  angle: number
  scale: number
  opacity: number
  blendMode: LayerBlendMode
}

export interface RustPixelPocGradientOverlay {
  gradient: {
    type: 'linear' | 'reflected' | 'diamond' | 'radial' | 'angle'
    colorStops: { position: number; color: [number, number, number, number] }[]
    opacityStops: { position: number; opacity: number }[]
  }
  angle: number
  scale: number
  reverse: boolean
  opacity: number
  blendMode: LayerBlendMode
}

const GRADIENT_KINDS = { linear: 0, reflected: 1, diamond: 2, radial: 3, angle: 4 } as const

const BLEND_MODES: Readonly<Record<LayerBlendMode, number>> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5
}

type TilePass =
  | { type: 'local-batch'; pointer: number; length: number }
  | { type: 'blend-if'; pointer: number; length: number; config: RustPixelPocUnderlyingBlendIf }
  | { type: 'blend-if-this-layer'; config: RustPixelPocBlendIf }
  | { type: 'color-overlay'; pointer: number; length: number; effect: RustPixelPocColorOverlay }
  | { type: 'pattern-overlay'; pointer: number; length: number; patternPointer: number;
      patternLength: number; patternWidth: number; patternHeight: number;
      cosine: number; sine: number; scaleFactor: number; effect: RustPixelPocPatternOverlay }
  | { type: 'gradient-overlay'; pointer: number; length: number; colorsPointer: number;
      colorsLength: number; opacitiesPointer: number; opacitiesLength: number;
      cosine: number; sine: number; effect: RustPixelPocGradientOverlay }

const BLEND_IF_CHANNELS: Readonly<Record<RustPixelPocUnderlyingBlendIf['channel'], number>> = {
  gray: 0, red: 1, green: 2, blue: 3
}

function validateExports(exports: WebAssembly.Exports): RustPixelPocExports {
  const candidate = exports as unknown as Partial<RustPixelPocExports>
  if (!(candidate.memory instanceof WebAssembly.Memory) ||
      typeof candidate.axia_poc_alloc !== 'function' ||
      typeof candidate.axia_poc_free !== 'function' ||
      typeof candidate.axia_poc_fill_opacity !== 'function' ||
      typeof candidate.axia_poc_fill_opacity_region !== 'function' ||
      typeof candidate.axia_poc_blend_if_underlying_region !== 'function' ||
      typeof candidate.axia_poc_blend_if_this_layer_region !== 'function' ||
      typeof candidate.axia_poc_color_overlay_region !== 'function' ||
      typeof candidate.axia_poc_pattern_overlay_region !== 'function' ||
      typeof candidate.axia_poc_gradient_overlay_region !== 'function' ||
      candidate.axia_poc_gradient_overlay_region.length !== 24 ||
      typeof candidate.axia_poc_local_batch_region !== 'function' || candidate.axia_poc_local_batch_region.length !== 12) {
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
  let reservedGeneration: number | null = null
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
    sourceAllocationMs: number, sourceCopyInMs: number,
    pass?: TilePass) {
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
      let status: number
      if (!pass) {
        status = exports.axia_poc_fill_opacity_region(sourcePointer, sourceLength,
          sourceWidth, sourceHeight, region.x, region.y, region.width, region.height,
          outputPointer, outputLength, fillOpacity)
      } else {
        switch (pass.type) {
          case 'local-batch':
            status = exports.axia_poc_local_batch_region(sourcePointer, sourceLength,
              sourceWidth, sourceHeight, region.x, region.y, region.width, region.height,
              pass.pointer, pass.length, outputPointer, outputLength)
            break
          case 'blend-if-this-layer':
            status = exports.axia_poc_blend_if_this_layer_region(sourcePointer, sourceLength,
              sourceWidth, sourceHeight, region.x, region.y, region.width, region.height,
              outputPointer, outputLength, BLEND_IF_CHANNELS[pass.config.channel],
              ...pass.config.shadows, ...pass.config.highlights)
            break
          case 'blend-if':
            status = exports.axia_poc_blend_if_underlying_region(sourcePointer, sourceLength,
              sourceWidth, sourceHeight, region.x, region.y, region.width, region.height,
              pass.pointer, pass.length, outputPointer, outputLength,
              BLEND_IF_CHANNELS[pass.config.channel], ...pass.config.shadows, ...pass.config.highlights)
            break
          case 'color-overlay':
            status = exports.axia_poc_color_overlay_region(sourcePointer, sourceLength,
              sourceWidth, sourceHeight, region.x, region.y, region.width, region.height,
              pass.pointer, pass.length, outputPointer, outputLength, ...pass.effect.color,
              pass.effect.opacity, BLEND_MODES[pass.effect.blendMode])
            break
          case 'pattern-overlay':
            status = exports.axia_poc_pattern_overlay_region(sourcePointer, sourceLength,
              sourceWidth, sourceHeight, region.x, region.y, region.width, region.height,
              pass.pointer, pass.length, outputPointer, outputLength,
              pass.patternPointer, pass.patternLength, pass.patternWidth, pass.patternHeight,
              pass.cosine, pass.sine, pass.scaleFactor, pass.effect.opacity, BLEND_MODES[pass.effect.blendMode])
            break
          case 'gradient-overlay':
            status = exports.axia_poc_gradient_overlay_region(sourcePointer, sourceLength,
              sourceWidth, sourceHeight, region.x, region.y, region.width, region.height,
              pass.pointer, pass.length, outputPointer, outputLength,
              pass.colorsPointer, pass.colorsLength, pass.opacitiesPointer, pass.opacitiesLength,
              GRADIENT_KINDS[pass.effect.gradient.type], pass.cosine, pass.sine,
              pass.effect.scale, pass.effect.reverse ? 1 : 0, pass.effect.opacity, BLEND_MODES[pass.effect.blendMode],
              pass.effect.angle * Math.PI / 180)
            break
          default:
            pass satisfies never
            throw new RustPixelPocError('invalid-input')
        }
      }
      if (status !== 0) {
        if (pass?.type === 'local-batch' && status === 6) throw new RustPixelPocError('memory-limit')
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

  function validateBlendIfConfig(config: RustPixelPocBlendIf) {
    if (!config || !Object.hasOwn(BLEND_IF_CHANNELS, config.channel) ||
        !Array.isArray(config.shadows) || config.shadows.length !== 2 ||
        !Array.isArray(config.highlights) || config.highlights.length !== 2) {
      throw new RustPixelPocError('invalid-input')
    }
    const thresholds = [...config.shadows, ...config.highlights]
    if (thresholds.some((value, index) => !Number.isSafeInteger(value) || value < 0 || value > 255 ||
        (index > 0 && value < thresholds[index - 1]!))) {
      throw new RustPixelPocError('invalid-input')
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
      reservedGeneration = generation
    },
    stageSource(source: Uint8Array, width: number, height: number, generation: number) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (reservedGeneration === null || generation !== reservedGeneration) validateNextGeneration(generation)
      // Invalidate old pixels even if staging fails.
      latestGeneration = generation
      reservedGeneration = null
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
    /** Requires styled pixels, not the original mask. */
    blendIfThisLayerStagedRegion(sourceId: number, region: RustPixelPocRegion, config: RustPixelPocBlendIf) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      validateRegion(region, staged.width, staged.height, 100)
      validateBlendIfConfig(config)
      return { ...renderFromPointer(staged.pointer, staged.length, staged.width, staged.height,
        region, 100, 0, 0, { type: 'blend-if-this-layer', config }), generation: staged.generation }
    },
    blendIfStagedRegion(sourceId: number, region: RustPixelPocRegion, backdrop: Uint8Array,
      config: RustPixelPocUnderlyingBlendIf) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      const length = validateRegion(region, staged.width, staged.height, 100)
      validateBlendIfConfig(config)
      if (backdrop.byteLength !== length) {
        throw new RustPixelPocError('invalid-input')
      }
      const started = performance.now()
      const pointer = exports.axia_poc_alloc(length)
      if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new RustPixelPocError('wasm-failure')
      try {
        if (pointer + length > exports.memory.buffer.byteLength) throw new RustPixelPocError('wasm-failure')
        const allocated = performance.now()
        new Uint8Array(exports.memory.buffer, pointer, length).set(backdrop)
        const copiedIn = performance.now()
        return { ...renderFromPointer(staged.pointer, staged.length, staged.width, staged.height,
          region, 100, allocated - started, copiedIn - allocated, { type: 'blend-if', pointer, length, config }),
          generation: staged.generation }
      } finally {
        exports.axia_poc_free(pointer, length)
      }
    },
    colorOverlayStagedRegion(sourceId: number, region: RustPixelPocRegion, target: Uint8Array,
      effect: RustPixelPocColorOverlay) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      const length = validateRegion(region, staged.width, staged.height, 100)
      if (!effect || !Object.hasOwn(BLEND_MODES, effect.blendMode) ||
          !Number.isFinite(effect.opacity) || effect.opacity < 0 || effect.opacity > 100 ||
          !Array.isArray(effect.color) || effect.color.length !== 4 ||
          [...effect.color].some((value) => !Number.isSafeInteger(value) || value < 0 || value > 255) ||
          target.byteLength !== length) {
        throw new RustPixelPocError('invalid-input')
      }
      const started = performance.now()
      const pointer = exports.axia_poc_alloc(length)
      if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new RustPixelPocError('wasm-failure')
      try {
        if (pointer + length > exports.memory.buffer.byteLength) throw new RustPixelPocError('wasm-failure')
        const allocated = performance.now()
        new Uint8Array(exports.memory.buffer, pointer, length).set(target)
        const copiedIn = performance.now()
        return { ...renderFromPointer(staged.pointer, staged.length, staged.width, staged.height,
          region, 100, allocated - started, copiedIn - allocated, { type: 'color-overlay', pointer, length, effect }),
          generation: staged.generation }
      } finally {
        exports.axia_poc_free(pointer, length)
      }
    },
    patternOverlayStagedRegion(sourceId: number, region: RustPixelPocRegion, target: Uint8Array,
      pattern: RustPixelPocPatternRaster, effect: RustPixelPocPatternOverlay) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      const length = validateRegion(region, staged.width, staged.height, 100)
      if (!effect || !Object.hasOwn(BLEND_MODES, effect.blendMode) ||
          !Number.isFinite(effect.opacity) || effect.opacity < 0 || effect.opacity > 100 ||
          !Number.isFinite(effect.angle) || effect.angle < -180 || effect.angle >= 180 ||
          !Number.isFinite(effect.scale) || effect.scale < 1 || effect.scale > 1000 ||
          target.byteLength !== length || !pattern || !(pattern.rgba instanceof Uint8Array) ||
          pattern.width > 8192 || pattern.height > 8192) {
        throw new RustPixelPocError('invalid-input')
      }
      validateSource(pattern.rgba, pattern.width, pattern.height)
      // Keep TS trig to preserve texel-boundary parity.
      const radians = -effect.angle * Math.PI / 180
      const cosine = Math.cos(radians), sine = Math.sin(radians)
      const scaleFactor = Math.max(0.01, effect.scale / 100)
      const started = performance.now()
      const pointer = exports.axia_poc_alloc(length)
      if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new RustPixelPocError('wasm-failure')
      let patternPointer = 0
      try {
        patternPointer = exports.axia_poc_alloc(pattern.rgba.byteLength)
        if (!Number.isSafeInteger(patternPointer) || patternPointer <= 0 ||
            pointer + length > exports.memory.buffer.byteLength ||
            patternPointer + pattern.rgba.byteLength > exports.memory.buffer.byteLength) {
          throw new RustPixelPocError('wasm-failure')
        }
        const allocated = performance.now()
        new Uint8Array(exports.memory.buffer, pointer, length).set(target)
        new Uint8Array(exports.memory.buffer, patternPointer, pattern.rgba.byteLength).set(pattern.rgba)
        const copiedIn = performance.now()
        return { ...renderFromPointer(staged.pointer, staged.length, staged.width, staged.height,
          region, 100, allocated - started, copiedIn - allocated, { type: 'pattern-overlay', pointer, length,
            patternPointer, patternLength: pattern.rgba.byteLength, patternWidth: pattern.width,
            patternHeight: pattern.height, cosine, sine, scaleFactor, effect }), generation: staged.generation }
      } finally {
        if (Number.isSafeInteger(patternPointer) && patternPointer > 0) {
          exports.axia_poc_free(patternPointer, pattern.rgba.byteLength)
        }
        exports.axia_poc_free(pointer, length)
      }
    },
    gradientOverlayStagedRegion(sourceId: number, region: RustPixelPocRegion, target: Uint8Array,
      effect: RustPixelPocGradientOverlay) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      const length = validateRegion(region, staged.width, staged.height, 100)
      if (target.byteLength !== length) throw new RustPixelPocError('invalid-input')
      const { colors, opacities, cosine, sine } = encodeBatchGradient(effect)
      const started = performance.now()
      const allocations: { pointer: number; bytes: Uint8Array }[] = []
      try {
        for (const bytes of [target, colors, opacities]) {
          const pointer = exports.axia_poc_alloc(bytes.byteLength)
          if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new RustPixelPocError('wasm-failure')
          allocations.push({ pointer, bytes })
          if (pointer + bytes.byteLength > exports.memory.buffer.byteLength) throw new RustPixelPocError('wasm-failure')
        }
        const allocated = performance.now()
        for (const { pointer, bytes } of allocations) new Uint8Array(exports.memory.buffer, pointer, bytes.byteLength).set(bytes)
        const copiedIn = performance.now()
        return { ...renderFromPointer(staged.pointer, staged.length, staged.width, staged.height,
          region, 100, allocated - started, copiedIn - allocated, {
            type: 'gradient-overlay', pointer: allocations[0]!.pointer, length,
            colorsPointer: allocations[1]!.pointer, colorsLength: colors.byteLength,
            opacitiesPointer: allocations[2]!.pointer, opacitiesLength: opacities.byteLength,
            cosine, sine, effect
          }), generation: staged.generation }
      } finally {
        for (const { pointer, bytes } of allocations) exports.axia_poc_free(pointer, bytes.byteLength)
      }
    },
    localBatchStagedRegion(sourceId: number, region: RustPixelPocRegion, plan: RustPixelPocBatchPlan) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      const length = validateRegion(region, staged.width, staged.height, 100)
      const bytes = encodeLocalBatch(plan, staged.length, length)
      const started = performance.now()
      const pointer = exports.axia_poc_alloc(bytes.byteLength)
      if (!Number.isSafeInteger(pointer) || pointer <= 0) throw new RustPixelPocError('wasm-failure')
      try {
        if (pointer + bytes.byteLength > exports.memory.buffer.byteLength) throw new RustPixelPocError('wasm-failure')
        const allocated = performance.now()
        new Uint8Array(exports.memory.buffer, pointer, bytes.byteLength).set(bytes)
        const copiedIn = performance.now()
        return { ...renderFromPointer(staged.pointer, staged.length, staged.width, staged.height,
          region, 100, allocated - started, copiedIn - allocated, { type: 'local-batch', pointer, length: bytes.byteLength }),
          generation: staged.generation }
      } finally { exports.axia_poc_free(pointer, bytes.byteLength) }
    },
    releaseSource(sourceId: number) {
      if (disposed) throw new RustPixelPocError('wasm-unavailable')
      if (!staged || staged.id !== sourceId) throw new RustPixelPocError('invalid-input')
      discardStaged()
    },
    dispose() {
      if (disposed) return
      disposed = true
      reservedGeneration = null
      discardStaged()
    }
  }
}

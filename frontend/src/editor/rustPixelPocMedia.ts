import { RustPixelPocError } from './rustPixelPocError.ts'
import { buildLayerStylePipeline } from './layerStyleCompositor.ts'
import { drawTextLayerContent } from './textCanvas.ts'
import { MAX_TEXT_CONTENT_LENGTH, MAX_TEXT_FONT_FAMILY_LENGTH, MAX_TEXT_LINE_COUNT } from './text.ts'
import type { LayerStyleWorkerSource } from './layerStyleRenderProtocol.ts'
import type { RustPixelPocStyleSourceLayout } from './rustPixelPocStylePreparation.ts'
import type { LayerStylePatternAsset } from '../types/editor.ts'
import type { RustPixelPocPatternRaster } from './rustPixelPocRuntime.ts'

const MAX_ENCODED_BYTES = 64 * 1024 * 1024
const MAX_WORKING_BYTES = 96 * 1024 * 1024

function validateBlob(blob: Blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new RustPixelPocError('invalid-input')
  if (blob.size > MAX_ENCODED_BYTES) throw new RustPixelPocError('memory-limit')
}

function validatePlatform(raster: boolean) {
  if (typeof OffscreenCanvas !== 'function' || raster && typeof createImageBitmap !== 'function') {
    throw new RustPixelPocError('wasm-unavailable')
  }
}

async function bitmapFrom(blob: Blob, options?: ImageBitmapOptions) {
  try { return await createImageBitmap(blob, options) }
  catch { throw new RustPixelPocError('invalid-input') }
}

export async function decodeRustStyleSource(source: LayerStyleWorkerSource,
  layout: RustPixelPocStyleSourceLayout, ensureCurrent: () => void) {
  ensureCurrent()
  validateRustStyleMediaSource(source)
  validatePlatform(source.type === 'raster')
  let bitmap: ImageBitmap | undefined
  let canvas: OffscreenCanvas | undefined
  try {
    if (source.type === 'raster') {
      bitmap = await bitmapFrom(source.blob, { resizeWidth: layout.sourceWidth, resizeHeight: layout.sourceHeight,
        resizeQuality: layout.quality === 'interactive' ? 'medium' : 'high' })
      ensureCurrent()
    }
    canvas = new OffscreenCanvas(layout.sourceWidth, layout.sourceHeight)
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new RustPixelPocError('wasm-unavailable')
    if (source.type === 'text') drawTextLayerContent(context, source.text, { x: source.drawScaleX, y: source.drawScaleY })
    else context.drawImage(bitmap!, 0, 0, layout.sourceWidth, layout.sourceHeight)
    const pixels = context.getImageData(0, 0, layout.sourceWidth, layout.sourceHeight)
    ensureCurrent()
    return { width: pixels.width, height: pixels.height, data: pixels.data }
  } finally {
    bitmap?.close()
    if (canvas) { canvas.width = 1; canvas.height = 1 }
  }
}

export function validateRustStyleMediaSource(source: LayerStyleWorkerSource) {
  if (!source || source.type !== 'raster' && source.type !== 'text') throw new RustPixelPocError('invalid-input')
  if (source.type === 'raster') validateBlob(source.blob)
  else {
    const text = source.text
    if (!text || typeof text.content !== 'string' || typeof text.fontFamily !== 'string' ||
        text.content.length > MAX_TEXT_CONTENT_LENGTH || text.content.split('\n').length > MAX_TEXT_LINE_COUNT ||
        text.fontFamily.length > MAX_TEXT_FONT_FAMILY_LENGTH || typeof text.color !== 'string' ||
        ![source.drawScaleX, source.drawScaleY, text.fontSize, text.lineHeight, text.baseWidth, text.baseHeight]
          .every(value => Number.isFinite(value) && value > 0) ||
        !Number.isFinite(text.fontWeight) || !Number.isFinite(text.letterSpacing ?? 0)) {
      throw new RustPixelPocError('invalid-input')
    }
  }
}

export function prepareRustStyleAssets(layout: RustPixelPocStyleSourceLayout, blobs: Readonly<Record<string, Blob>>) {
  if (!blobs || typeof blobs !== 'object') throw new RustPixelPocError('invalid-input')
  const supplied = Object.values(blobs)
  if (supplied.length > 64) throw new RustPixelPocError('invalid-input')
  let encodedBytes = 0
  for (const blob of supplied) { validateBlob(blob); encodedBytes += blob.size }
  if (encodedBytes > MAX_ENCODED_BYTES) throw new RustPixelPocError('memory-limit')
  const pipeline = buildLayerStylePipeline(layout.styles)
  const assets = new Map<string, LayerStylePatternAsset>()
  function add(asset: LayerStylePatternAsset | undefined) {
    if (!asset) return
    const existing = assets.get(asset.id)
    if (existing && (existing.width !== asset.width || existing.height !== asset.height || existing.sourceUrl !== asset.sourceUrl)) {
      throw new RustPixelPocError('invalid-input')
    }
    assets.set(asset.id, asset)
  }
  for (const effect of pipeline.overlay) if (effect.type === 'pattern-overlay') add(effect.pattern)
  for (const effect of pipeline.upper) {
    if (effect.type === 'stroke' && effect.paint.type === 'pattern') add(effect.paint.pattern)
    if (effect.type === 'bevel-emboss' && effect.textureEnabled) add(effect.texture)
  }
  if (assets.size > 64) throw new RustPixelPocError('invalid-input')
  let decodedBytes = 0, largestBytes = 0
  const entries = [...assets.values()].map(asset => {
    const blob = Object.hasOwn(blobs, asset.id) ? blobs[asset.id]! : undefined
    if (!blob) throw new RustPixelPocError('invalid-input')
    validateBlob(blob)
    const bytes = asset.width * asset.height * 4
    if (![asset.width, asset.height, bytes].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new RustPixelPocError('invalid-input')
    }
    decodedBytes += bytes; largestBytes = Math.max(largestBytes, bytes)
    return { asset, blob }
  })
  // Retained assets + one bitmap/canvas/readback + the staged source.
  if (encodedBytes > MAX_ENCODED_BYTES || layout.width * layout.height * 4 + decodedBytes + 3 * largestBytes > MAX_WORKING_BYTES) {
    throw new RustPixelPocError('memory-limit')
  }
  return { entries, decodedBytes }
}

export async function decodeRustStyleAssets(prepared: ReturnType<typeof prepareRustStyleAssets>, ensureCurrent: () => void) {
  const patterns = new Map<string, RustPixelPocPatternRaster>()
  if (prepared.entries.length) validatePlatform(true)
  for (const { asset, blob } of prepared.entries) {
    ensureCurrent()
    const bitmap = await bitmapFrom(blob)
    let canvas: OffscreenCanvas | undefined
    try {
      ensureCurrent()
      if (bitmap.width !== asset.width || bitmap.height !== asset.height) throw new RustPixelPocError('invalid-input')
      canvas = new OffscreenCanvas(asset.width, asset.height)
      const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
      if (!context) throw new RustPixelPocError('wasm-unavailable')
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, asset.width, asset.height)
      patterns.set(asset.id, { width: asset.width, height: asset.height,
        rgba: new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength) })
    } finally {
      bitmap.close()
      if (canvas) { canvas.width = 1; canvas.height = 1 }
    }
  }
  ensureCurrent()
  return patterns
}

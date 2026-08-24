import { forEachPixelSpan, selectionContainsPoint, transformSelectionPoint, type Matrix2D, type SelectionRegion } from './selection.ts'
import { colorRegionSpanIterator, visitColorRegionSpans, type ColorRegionOptions, type ColorRegionResult } from './colorRegion.ts'

export interface PaintBucketRasterRequest {
  color: string
  height: number
  pixels: Uint8ClampedArray | Uint8Array
  region: ColorRegionResult
  selection: SelectionRegion | null
  sourceToDocument: Matrix2D
  width: number
}

export interface PaintBucketRasterResult {
  changedPixelCount: number
  pixels?: Uint8ClampedArray<ArrayBuffer>
}

export interface PaintBucketColorRegionRequest extends Omit<PaintBucketRasterRequest, 'region'> {
  regionOptions: ColorRegionOptions
}

export interface CooperativePaintBucketOptions {
  spansPerChunk?: number
  throwIfCancelled?: () => void
  yieldControl: () => Promise<void>
}

function paintBucketColor(value: string) {
  const match = /^#([\da-f]{6})$/i.exec(value)
  if (!match) throw new Error('A cor do Balde de Tinta é inválida.')
  const hex = match[1]!
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    255
  ] as const
}

export function applyPaintBucketRaster(request: PaintBucketRasterRequest): PaintBucketRasterResult {
  const expectedLength = request.width * request.height * 4
  if (request.width <= 0 || request.height <= 0 || request.pixels.length < expectedLength) {
    throw new Error('O raster de origem do Balde de Tinta é inválido.')
  }
  const color = paintBucketColor(request.color)
  let output: Uint8ClampedArray<ArrayBuffer> | undefined
  let changedPixelCount = 0
  forEachPixelSpan(request.region.spans, (span) => {
    if (span.y < 0 || span.y >= request.height) return
    const start = Math.max(0, Math.floor(span.x0))
    const end = Math.min(request.width, Math.ceil(span.x1))
    for (let x = start; x < end; x++) {
      if (request.selection) {
        const documentPoint = transformSelectionPoint(request.sourceToDocument, { x: x + 0.5, y: span.y + 0.5 })
        if (!selectionContainsPoint(request.selection, documentPoint)) continue
      }
      const offset = (span.y * request.width + x) * 4
      if (
        request.pixels[offset] === color[0] && request.pixels[offset + 1] === color[1] &&
        request.pixels[offset + 2] === color[2] && request.pixels[offset + 3] === color[3]
      ) continue
      if (!output) {
        output = new Uint8ClampedArray(expectedLength)
        output.set(request.pixels.subarray(0, expectedLength))
      }
      output.set(color, offset)
      changedPixelCount += 1
    }
  })
  return { pixels: output, changedPixelCount }
}

export function applyPaintBucketColorRegion(request: PaintBucketColorRegionRequest): PaintBucketRasterResult {
  const expectedLength = request.width * request.height * 4
  if (request.width <= 0 || request.height <= 0 || request.pixels.length < expectedLength) {
    throw new Error('O raster de origem do Balde de Tinta é inválido.')
  }
  const color = paintBucketColor(request.color)
  let output: Uint8ClampedArray<ArrayBuffer> | undefined
  let changedPixelCount = 0
  visitColorRegionSpans(request.pixels, request.width, request.height, request.regionOptions, (y, x0, x1) => {
    for (let x = x0; x < x1; x++) {
      if (request.selection) {
        const documentPoint = transformSelectionPoint(request.sourceToDocument, { x: x + 0.5, y: y + 0.5 })
        if (!selectionContainsPoint(request.selection, documentPoint)) continue
      }
      const offset = (y * request.width + x) * 4
      if (
        request.pixels[offset] === color[0] && request.pixels[offset + 1] === color[1] &&
        request.pixels[offset + 2] === color[2] && request.pixels[offset + 3] === color[3]
      ) continue
      if (!output) {
        output = new Uint8ClampedArray(expectedLength)
        output.set(request.pixels.subarray(0, expectedLength))
      }
      output.set(color, offset)
      changedPixelCount += 1
    }
  })
  return { pixels: output, changedPixelCount }
}

export async function applyPaintBucketColorRegionCooperatively(
  request: PaintBucketColorRegionRequest,
  options: CooperativePaintBucketOptions
): Promise<PaintBucketRasterResult> {
  const expectedLength = request.width * request.height * 4
  if (request.width <= 0 || request.height <= 0 || request.pixels.length < expectedLength) {
    throw new Error('O raster de origem do Balde de Tinta é inválido.')
  }
  const color = paintBucketColor(request.color)
  const spansPerChunk = Math.max(1, Math.floor(options.spansPerChunk ?? 128))
  let output: Uint8ClampedArray<ArrayBuffer> | undefined
  let changedPixelCount = 0
  let pendingSpans = 0
  for (const [y, x0, x1] of colorRegionSpanIterator(request.pixels, request.width, request.height, request.regionOptions)) {
    for (let x = x0; x < x1; x++) {
      if (request.selection) {
        const documentPoint = transformSelectionPoint(request.sourceToDocument, { x: x + 0.5, y: y + 0.5 })
        if (!selectionContainsPoint(request.selection, documentPoint)) continue
      }
      const offset = (y * request.width + x) * 4
      if (
        request.pixels[offset] === color[0] && request.pixels[offset + 1] === color[1] &&
        request.pixels[offset + 2] === color[2] && request.pixels[offset + 3] === color[3]
      ) continue
      if (!output) {
        output = new Uint8ClampedArray(expectedLength)
        output.set(request.pixels.subarray(0, expectedLength))
      }
      output.set(color, offset)
      changedPixelCount += 1
    }
    pendingSpans += 1
    if (pendingSpans >= spansPerChunk) {
      pendingSpans = 0
      options.throwIfCancelled?.()
      await options.yieldControl()
      options.throwIfCancelled?.()
    }
  }
  options.throwIfCancelled?.()
  return { pixels: output, changedPixelCount }
}

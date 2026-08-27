import {
  createGradientInterpolator,
  normalizeGradientStopsConfig,
  type GradientConfigInput,
  type GradientGeometry,
  type GradientInterpolator,
  type GradientType
} from './gradient.ts'
import {
  invertMatrix,
  forEachPixelSpan,
  layerSourceToDocumentMatrix,
  selectionDocumentBounds,
  pixelSpansContainPoint,
  transformSelectionBounds,
  transformSelectionPoint,
  type Matrix2D,
  type PixelSelection,
  type SelectionBounds,
  type SelectionPoint,
  type SelectionRegion
} from './selection.ts'
import type { LayerTransform } from '../types/editor.ts'

export interface GradientRasterGeometry {
  originX: number
  originY: number
  width: number
  height: number
}

export interface GradientRasterRequest {
  sourcePixels: Uint8ClampedArray | Uint8Array
  sourceWidth: number
  sourceHeight: number
  transform: LayerTransform
  geometry: GradientGeometry
  config: GradientConfigInput
  selection: SelectionRegion | null
  documentWidth: number
  documentHeight: number
  reuseSourceBuffer?: boolean
}

export interface GradientRasterState {
  pixels: Uint8ClampedArray<ArrayBuffer>
  geometry: GradientRasterGeometry
  outputToDocument: Matrix2D
  writeGradient: GradientInterpolator['write']
  contains: (x: number, y: number) => boolean
  gradient: GradientGeometry
  gradientType: GradientType
}

function normalizedDocumentBounds(width: number, height: number): SelectionBounds {
  return { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) }
}

function intersectBounds(first: SelectionBounds, second: SelectionBounds): SelectionBounds {
  const x = Math.max(first.x, second.x)
  const y = Math.max(first.y, second.y)
  const maximumX = Math.min(first.x + first.width, second.x + second.width)
  const maximumY = Math.min(first.y + first.height, second.y + second.height)
  return { x, y, width: Math.max(0, maximumX - x), height: Math.max(0, maximumY - y) }
}

export function gradientRasterGeometry(
  sourceWidth: number,
  sourceHeight: number,
  transform: LayerTransform,
  documentWidth: number,
  documentHeight: number,
  expand: boolean,
  expansionBounds?: SelectionBounds
): GradientRasterGeometry {
  if (!expand || sourceWidth <= 0 || sourceHeight <= 0 || documentWidth <= 0 || documentHeight <= 0) {
    return { originX: 0, originY: 0, width: sourceWidth, height: sourceHeight }
  }
  const documentToSource = invertMatrix(layerSourceToDocumentMatrix(transform, sourceWidth, sourceHeight))
  const documentInSource = transformSelectionBounds(
    documentToSource,
    expansionBounds ?? normalizedDocumentBounds(documentWidth, documentHeight)
  )
  const originX = Math.min(0, Math.floor(documentInSource.x))
  const originY = Math.min(0, Math.floor(documentInSource.y))
  const maximumX = Math.max(sourceWidth, Math.ceil(documentInSource.x + documentInSource.width))
  const maximumY = Math.max(sourceHeight, Math.ceil(documentInSource.y + documentInSource.height))
  return {
    originX,
    originY,
    width: Math.max(1, maximumX - originX),
    height: Math.max(1, maximumY - originY)
  }
}

export function gradientResultTransform(
  transform: LayerTransform,
  sourceWidth: number,
  sourceHeight: number,
  result: GradientRasterGeometry
): LayerTransform {
  if (
    result.originX === 0 &&
    result.originY === 0 &&
    result.width === sourceWidth &&
    result.height === sourceHeight
  ) return { ...transform }
  const sourceToDocument = layerSourceToDocumentMatrix(transform, sourceWidth, sourceHeight)
  const center = transformSelectionPoint(sourceToDocument, {
    x: result.originX + result.width / 2,
    y: result.originY + result.height / 2
  })
  const width = result.width * transform.width / sourceWidth
  const height = result.height * transform.height / sourceHeight
  return {
    ...transform,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height
  }
}

function pointInBounds(x: number, y: number, bounds: SelectionBounds) {
  return x >= bounds.x && y >= bounds.y &&
    x < bounds.x + bounds.width && y < bounds.y + bounds.height
}

function pixelSelectionContains(selection: PixelSelection) {
  const documentToSelection = invertMatrix(selection.sourceToDocument)
  if (!Array.isArray(selection.spans)) {
    return (x: number, y: number) => {
      const sourceX = documentToSelection[0] * x + documentToSelection[2] * y + documentToSelection[4]
      const sourceY = documentToSelection[1] * x + documentToSelection[3] * y + documentToSelection[5]
      return pixelSpansContainPoint(selection.spans, Math.floor(sourceY), sourceX)
    }
  }
  const rows = new Map<number, Array<{ x0: number; x1: number }>>()
  forEachPixelSpan(selection.spans, (span) => {
    const row = rows.get(span.y)
    if (row) row.push({ x0: span.x0, x1: span.x1 })
    else rows.set(span.y, [{ x0: span.x0, x1: span.x1 }])
  })
  return (x: number, y: number) => {
    const sourceX = documentToSelection[0] * x + documentToSelection[2] * y + documentToSelection[4]
    const sourceY = documentToSelection[1] * x + documentToSelection[3] * y + documentToSelection[5]
    const spans = rows.get(Math.floor(sourceY))
    return Boolean(spans?.some((span) => sourceX >= span.x0 && sourceX < span.x1))
  }
}

function selectionPredicate(selection: SelectionRegion | null, documentWidth: number, documentHeight: number) {
  const documentBounds = normalizedDocumentBounds(documentWidth, documentHeight)
  if (!selection) return (x: number, y: number) => pointInBounds(x, y, documentBounds)
  if (selection.kind === 'pixels') {
    const selectionBounds = selectionDocumentBounds(selection)
    const containsPixel = pixelSelectionContains(selection)
    return (x: number, y: number) =>
      pointInBounds(x, y, documentBounds) && pointInBounds(x, y, selectionBounds) && containsPixel(x, y)
  }
  const bounds = selection.bounds
  if (selection.kind === 'rectangle') {
    return (x: number, y: number) => pointInBounds(x, y, documentBounds) && pointInBounds(x, y, bounds)
  }
  if (selection.kind === 'ellipse') {
    const radiusX = bounds.width / 2
    const radiusY = bounds.height / 2
    return (x: number, y: number) => {
      if (!pointInBounds(x, y, documentBounds) || !pointInBounds(x, y, bounds) || radiusX <= 0 || radiusY <= 0) return false
      const normalizedX = (x - bounds.x - radiusX) / radiusX
      const normalizedY = (y - bounds.y - radiusY) / radiusY
      return normalizedX * normalizedX + normalizedY * normalizedY <= 1
    }
  }
  return (x: number, y: number) => {
    if (!pointInBounds(x, y, documentBounds) || !pointInBounds(x, y, bounds)) return false
    let inside = false
    for (let index = 0, previous = selection.points.length - 1; index < selection.points.length; previous = index++) {
      const currentPoint = selection.points[index]!
      const previousPoint = selection.points[previous]!
      const crosses = (currentPoint.y > y) !== (previousPoint.y > y) &&
        x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y) /
          (previousPoint.y - currentPoint.y) + currentPoint.x
      if (crosses) inside = !inside
    }
    return inside
  }
}

export function createGradientRasterState(request: GradientRasterRequest): GradientRasterState {
  const expectedLength = request.sourceWidth * request.sourceHeight * 4
  if (request.sourceWidth <= 0 || request.sourceHeight <= 0 || request.sourcePixels.length < expectedLength) {
    throw new Error('O raster de origem do degradê é inválido.')
  }
  const documentBounds = normalizedDocumentBounds(request.documentWidth, request.documentHeight)
  const expansionBounds = request.selection
    ? intersectBounds(selectionDocumentBounds(request.selection), documentBounds)
    : documentBounds
  const geometry = gradientRasterGeometry(
    request.sourceWidth,
    request.sourceHeight,
    request.transform,
    request.documentWidth,
    request.documentHeight,
    true,
    expansionBounds
  )
  const canReuseSource = request.reuseSourceBuffer === true &&
    request.sourcePixels instanceof Uint8ClampedArray &&
    request.sourcePixels.buffer instanceof ArrayBuffer &&
    request.sourcePixels.byteLength === expectedLength &&
    geometry.originX === 0 &&
    geometry.originY === 0 &&
    geometry.width === request.sourceWidth &&
    geometry.height === request.sourceHeight
  const pixels: Uint8ClampedArray<ArrayBuffer> = canReuseSource
    ? request.sourcePixels as Uint8ClampedArray<ArrayBuffer>
    : new Uint8ClampedArray(geometry.width * geometry.height * 4)
  if (!canReuseSource) {
    for (let row = 0; row < request.sourceHeight; row++) {
      const sourceStart = row * request.sourceWidth * 4
      const targetStart = ((row - geometry.originY) * geometry.width - geometry.originX) * 4
      pixels.set(request.sourcePixels.subarray(sourceStart, sourceStart + request.sourceWidth * 4), targetStart)
    }
  }
  const sourceToDocument = layerSourceToDocumentMatrix(
    request.transform,
    request.sourceWidth,
    request.sourceHeight
  )
  const outputToDocument: Matrix2D = [
    sourceToDocument[0],
    sourceToDocument[1],
    sourceToDocument[2],
    sourceToDocument[3],
    sourceToDocument[0] * geometry.originX + sourceToDocument[2] * geometry.originY + sourceToDocument[4],
    sourceToDocument[1] * geometry.originX + sourceToDocument[3] * geometry.originY + sourceToDocument[5]
  ]
  const config = normalizeGradientStopsConfig(request.config)
  return {
    pixels,
    geometry,
    outputToDocument,
    writeGradient: createGradientInterpolator(config).write,
    contains: selectionPredicate(request.selection, request.documentWidth, request.documentHeight),
    gradient: request.geometry,
    gradientType: config.type
  }
}

export function renderGradientRasterRows(state: GradientRasterState, startRow: number, endRow: number) {
  const firstRow = Math.max(0, Math.floor(startRow))
  const lastRow = Math.min(state.geometry.height, Math.ceil(endRow))
  const matrix = state.outputToDocument
  const deltaX = state.gradient.end.x - state.gradient.start.x
  const deltaY = state.gradient.end.y - state.gradient.start.y
  const divisor = state.gradientType === 'radial'
    ? Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    : deltaX * deltaX + deltaY * deltaY
  const validDivisor = Number.isFinite(divisor) && divisor > Number.EPSILON
  for (let y = firstRow; y < lastRow; y++) {
    let documentX = matrix[0] * 0.5 + matrix[2] * (y + 0.5) + matrix[4]
    let documentY = matrix[1] * 0.5 + matrix[3] * (y + 0.5) + matrix[5]
    for (let x = 0; x < state.geometry.width; x++) {
      if (state.contains(documentX, documentY)) {
        let progress = 0
        if (validDivisor) {
          const pointX = documentX - state.gradient.start.x
          const pointY = documentY - state.gradient.start.y
          const rawProgress = state.gradientType === 'radial'
            ? Math.sqrt(pointX * pointX + pointY * pointY) / divisor
            : (pointX * deltaX + pointY * deltaY) / divisor
          progress = Math.min(1, Math.max(0, rawProgress))
        }
        const offset = (y * state.geometry.width + x) * 4
        state.writeGradient(state.pixels, offset, progress)
      }
      documentX += matrix[0]
      documentY += matrix[1]
    }
  }
  return state
}

export function applyGradientRaster(request: GradientRasterRequest) {
  const state = createGradientRasterState(request)
  return renderGradientRasterRows(state, 0, state.geometry.height)
}

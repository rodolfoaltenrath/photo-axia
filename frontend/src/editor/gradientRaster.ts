import {
  gradientProgress,
  parseGradientColor,
  type GradientConfig,
  type GradientGeometry
} from './gradient.ts'
import {
  invertMatrix,
  layerSourceToDocumentMatrix,
  selectionDocumentBounds,
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
  config: GradientConfig
  selection: SelectionRegion | null
  documentWidth: number
  documentHeight: number
}

export interface GradientRasterState {
  pixels: Uint8ClampedArray
  geometry: GradientRasterGeometry
  outputToDocument: Matrix2D
  startColor: readonly [number, number, number]
  endColor: readonly [number, number, number]
  contains: (point: SelectionPoint) => boolean
  gradient: GradientGeometry
  gradientType: GradientConfig['type']
}

function normalizedDocumentBounds(width: number, height: number): SelectionBounds {
  return { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) }
}

export function gradientRasterGeometry(
  sourceWidth: number,
  sourceHeight: number,
  transform: LayerTransform,
  documentWidth: number,
  documentHeight: number,
  expand: boolean
): GradientRasterGeometry {
  if (!expand || sourceWidth <= 0 || sourceHeight <= 0 || documentWidth <= 0 || documentHeight <= 0) {
    return { originX: 0, originY: 0, width: sourceWidth, height: sourceHeight }
  }
  const documentToSource = invertMatrix(layerSourceToDocumentMatrix(transform, sourceWidth, sourceHeight))
  const documentInSource = transformSelectionBounds(
    documentToSource,
    normalizedDocumentBounds(documentWidth, documentHeight)
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

function pointInBounds(point: SelectionPoint, bounds: SelectionBounds) {
  return point.x >= bounds.x && point.y >= bounds.y &&
    point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height
}

function pixelSelectionContains(selection: PixelSelection) {
  const documentToSelection = invertMatrix(selection.sourceToDocument)
  const rows = new Map<number, Array<{ x0: number; x1: number }>>()
  for (const span of selection.spans) {
    const row = rows.get(span.y)
    if (row) row.push({ x0: span.x0, x1: span.x1 })
    else rows.set(span.y, [{ x0: span.x0, x1: span.x1 }])
  }
  return (point: SelectionPoint) => {
    const sourcePoint = transformSelectionPoint(documentToSelection, point)
    const spans = rows.get(Math.floor(sourcePoint.y))
    return Boolean(spans?.some((span) => sourcePoint.x >= span.x0 && sourcePoint.x < span.x1))
  }
}

function selectionPredicate(selection: SelectionRegion | null, documentWidth: number, documentHeight: number) {
  const documentBounds = normalizedDocumentBounds(documentWidth, documentHeight)
  if (!selection) return (point: SelectionPoint) => pointInBounds(point, documentBounds)
  if (selection.kind === 'pixels') {
    const selectionBounds = selectionDocumentBounds(selection)
    const containsPixel = pixelSelectionContains(selection)
    return (point: SelectionPoint) =>
      pointInBounds(point, documentBounds) && pointInBounds(point, selectionBounds) && containsPixel(point)
  }
  const bounds = selection.bounds
  if (selection.kind === 'rectangle') {
    return (point: SelectionPoint) => pointInBounds(point, documentBounds) && pointInBounds(point, bounds)
  }
  if (selection.kind === 'ellipse') {
    const radiusX = bounds.width / 2
    const radiusY = bounds.height / 2
    return (point: SelectionPoint) => {
      if (!pointInBounds(point, documentBounds) || !pointInBounds(point, bounds) || radiusX <= 0 || radiusY <= 0) return false
      const x = (point.x - bounds.x - radiusX) / radiusX
      const y = (point.y - bounds.y - radiusY) / radiusY
      return x * x + y * y <= 1
    }
  }
  return (point: SelectionPoint) => {
    if (!pointInBounds(point, documentBounds) || !pointInBounds(point, bounds)) return false
    let inside = false
    for (let index = 0, previous = selection.points.length - 1; index < selection.points.length; previous = index++) {
      const currentPoint = selection.points[index]!
      const previousPoint = selection.points[previous]!
      const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
        point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y) /
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
  const geometry = gradientRasterGeometry(
    request.sourceWidth,
    request.sourceHeight,
    request.transform,
    request.documentWidth,
    request.documentHeight,
    !request.selection
  )
  const pixels = new Uint8ClampedArray(geometry.width * geometry.height * 4)
  for (let row = 0; row < request.sourceHeight; row++) {
    const sourceStart = row * request.sourceWidth * 4
    const targetStart = ((row - geometry.originY) * geometry.width - geometry.originX) * 4
    pixels.set(request.sourcePixels.subarray(sourceStart, sourceStart + request.sourceWidth * 4), targetStart)
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
  const foreground = parseGradientColor(request.config.foregroundColor)
  const background = parseGradientColor(request.config.backgroundColor)
  return {
    pixels,
    geometry,
    outputToDocument,
    startColor: request.config.reversed ? background : foreground,
    endColor: request.config.reversed ? foreground : background,
    contains: selectionPredicate(request.selection, request.documentWidth, request.documentHeight),
    gradient: request.geometry,
    gradientType: request.config.type
  }
}

export function renderGradientRasterRows(state: GradientRasterState, startRow: number, endRow: number) {
  const firstRow = Math.max(0, Math.floor(startRow))
  const lastRow = Math.min(state.geometry.height, Math.ceil(endRow))
  for (let y = firstRow; y < lastRow; y++) {
    for (let x = 0; x < state.geometry.width; x++) {
      const point = transformSelectionPoint(state.outputToDocument, { x: x + 0.5, y: y + 0.5 })
      if (!state.contains(point)) continue
      const progress = gradientProgress(point, state.gradient, state.gradientType)
      const offset = (y * state.geometry.width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        state.pixels[offset + channel] = Math.round(
          state.startColor[channel]! + (state.endColor[channel]! - state.startColor[channel]!) * progress
        )
      }
      state.pixels[offset + 3] = 255
    }
  }
  return state
}

export function applyGradientRaster(request: GradientRasterRequest) {
  const state = createGradientRasterState(request)
  return renderGradientRasterRows(state, 0, state.geometry.height)
}

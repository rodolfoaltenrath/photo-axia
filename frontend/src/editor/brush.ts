import type { Matrix2D, SelectionPoint } from './selection'
import type { LayerTransform } from '../types/editor'

type BrushContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type BrushOperation = 'paint' | 'erase'

export interface BrushPreviewSize {
  width: number
  height: number
}

export type BrushPreviewHandoffAction = 'keep' | 'mark-committed' | 'clear'

export function brushPreviewHandoffAction(
  baseSource: string | undefined,
  observedSource: string | undefined,
  busy: boolean,
  sourceReady: boolean
): BrushPreviewHandoffAction {
  if (!observedSource) return busy ? 'keep' : 'clear'
  if (observedSource === baseSource) return busy ? 'keep' : 'clear'
  return sourceReady ? 'clear' : 'mark-committed'
}

const MAX_PREVIEW_PIXELS = 4_194_304

export function brushPointSpacing(size: number, viewportScale: number) {
  const safeScale = Math.max(0.01, viewportScale)
  return Math.max(0.05, Math.min(Math.max(1, size) * 0.025, 0.75 / safeScale))
}

export function brushOperationExpandsRaster(operation: BrushOperation, hasSelection: boolean) {
  return operation === 'paint' && !hasSelection
}

export function brushPreviewUsesLayerSpace(operation: BrushOperation, hasSelection: boolean) {
  return operation === 'erase' || hasSelection
}

export function appendBrushPoint(
  points: SelectionPoint[],
  point: SelectionPoint,
  minimumDistance: number,
  force = false
) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
  const previous = points.at(-1)
  if (!previous) {
    points.push(point)
    return true
  }

  const distanceSquared = (point.x - previous.x) ** 2 + (point.y - previous.y) ** 2
  if (distanceSquared <= Number.EPSILON) return false
  if (!force && distanceSquared < minimumDistance ** 2) return false
  points.push(point)
  return true
}

export function brushPreviewSize(
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
  viewportScale: number,
  pixelRatio: number,
  maximumPixels = MAX_PREVIEW_PIXELS
): BrushPreviewSize {
  const density = Math.max(0.01, viewportScale) * Math.max(1, Math.min(2, pixelRatio || 1))
  let width = Math.max(1, Math.min(sourceWidth, Math.ceil(Math.abs(displayWidth) * density)))
  let height = Math.max(1, Math.min(sourceHeight, Math.ceil(Math.abs(displayHeight) * density)))
  const pixelCount = width * height
  if (pixelCount > maximumPixels) {
    const reduction = Math.sqrt(maximumPixels / pixelCount)
    width = Math.max(1, Math.floor(width * reduction))
    height = Math.max(1, Math.floor(height * reduction))
  }
  return { width, height }
}

export function stableEraserPreviewSize(
  asset: {
    width: number
    height: number
    previewUrl?: string
    previewWidth?: number
    previewHeight?: number
  },
  displayWidth: number,
  displayHeight: number,
  viewportScale: number,
  pixelRatio: number
) {
  if (asset.previewUrl && asset.previewWidth && asset.previewHeight) {
    return { width: asset.previewWidth, height: asset.previewHeight }
  }
  return brushPreviewSize(
    asset.width,
    asset.height,
    displayWidth,
    displayHeight,
    viewportScale,
    pixelRatio
  )
}

function brushDocumentToSourceMatrix(transform: LayerTransform, sourceWidth: number, sourceHeight: number): Matrix2D {
  const angle = ((transform.rotation ?? 0) * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const scaleX = transform.width / sourceWidth
  const scaleY = transform.height / sourceHeight
  const a = cosine * scaleX
  const b = sine * scaleX
  const c = -sine * scaleY
  const d = cosine * scaleY
  const centerX = transform.x + transform.width / 2
  const centerY = transform.y + transform.height / 2
  const e = centerX - a * sourceWidth / 2 - c * sourceHeight / 2
  const f = centerY - b * sourceWidth / 2 - d * sourceHeight / 2
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 1e-12) return [1, 0, 0, 1, 0, 0]
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ]
}

function transformBrushBounds(matrix: Matrix2D, left: number, top: number, right: number, bottom: number) {
  const points = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ].map((point) => ({
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
  }))
  return {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y))
  }
}

export function brushStrokeGeometry(
  sourceWidth: number,
  sourceHeight: number,
  transform: LayerTransform,
  points: readonly SelectionPoint[],
  size: number,
  documentWidth: number,
  documentHeight: number,
  expand: boolean
) {
  if (!expand || !points.length) {
    return { originX: 0, originY: 0, width: sourceWidth, height: sourceHeight }
  }
  const radius = Math.max(0.5, size / 2) + 1
  let minimumX = points[0]!.x
  let minimumY = points[0]!.y
  let maximumX = minimumX
  let maximumY = minimumY
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!
    minimumX = Math.min(minimumX, point.x)
    minimumY = Math.min(minimumY, point.y)
    maximumX = Math.max(maximumX, point.x)
    maximumY = Math.max(maximumY, point.y)
  }
  const left = Math.max(0, minimumX - radius)
  const top = Math.max(0, minimumY - radius)
  const right = Math.min(documentWidth, maximumX + radius)
  const bottom = Math.min(documentHeight, maximumY + radius)
  if (right <= left || bottom <= top) {
    return { originX: 0, originY: 0, width: sourceWidth, height: sourceHeight }
  }
  const documentToSource = brushDocumentToSourceMatrix(transform, sourceWidth, sourceHeight)
  const strokeBounds = transformBrushBounds(documentToSource, left, top, right, bottom)
  const originX = Math.min(0, Math.floor(strokeBounds.x))
  const originY = Math.min(0, Math.floor(strokeBounds.y))
  const maxX = Math.max(sourceWidth, Math.ceil(strokeBounds.right))
  const maxY = Math.max(sourceHeight, Math.ceil(strokeBounds.bottom))
  return { originX, originY, width: maxX - originX, height: maxY - originY }
}

export function setContextTransform(context: BrushContext, matrix: Matrix2D) {
  context.setTransform(...matrix)
}

/**
 * Draws only the points that were not rendered yet. Returning the new point
 * count makes each animation frame O(new points), rather than O(full stroke).
 */
export function drawBrushPoints(
  context: BrushContext,
  points: readonly SelectionPoint[],
  renderedPointCount: number,
  size: number,
  color: string,
  operation: BrushOperation = 'paint'
) {
  if (!points.length || renderedPointCount >= points.length) return points.length

  context.globalCompositeOperation = operation === 'erase' ? 'destination-out' : 'source-over'
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = Math.max(0.1, size)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  if (points.length === 1 && renderedPointCount === 0) {
    const point = points[0]!
    context.beginPath()
    context.arc(point.x, point.y, Math.max(0.05, size / 2), 0, Math.PI * 2)
    context.fill()
    return 1
  }

  const firstSegment = Math.max(1, renderedPointCount)
  if (firstSegment >= points.length) return points.length
  context.beginPath()
  const previous = points[firstSegment - 1]!
  context.moveTo(previous.x, previous.y)
  for (let index = firstSegment; index < points.length; index++) {
    const point = points[index]!
    context.lineTo(point.x, point.y)
  }
  context.stroke()
  return points.length
}

export function drawPackedBrushPoints(
  context: BrushContext,
  points: Float32Array,
  size: number,
  color: string,
  operation: BrushOperation = 'paint'
) {
  const pointCount = Math.floor(points.length / 2)
  if (!pointCount) return
  context.globalCompositeOperation = operation === 'erase' ? 'destination-out' : 'source-over'
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = Math.max(0.1, size)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  if (pointCount === 1) {
    context.arc(points[0]!, points[1]!, Math.max(0.05, size / 2), 0, Math.PI * 2)
    context.fill()
    return
  }
  context.moveTo(points[0]!, points[1]!)
  for (let index = 1; index < pointCount; index++) {
    context.lineTo(points[index * 2]!, points[index * 2 + 1]!)
  }
  context.stroke()
}

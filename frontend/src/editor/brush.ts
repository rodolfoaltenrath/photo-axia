import type { Matrix2D, SelectionPoint } from './selection'

type BrushContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface BrushPreviewSize {
  width: number
  height: number
}

const MAX_PREVIEW_PIXELS = 4_194_304

export function brushPointSpacing(size: number, viewportScale: number) {
  const safeScale = Math.max(0.01, viewportScale)
  return Math.max(0.05, Math.min(Math.max(1, size) * 0.025, 0.75 / safeScale))
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
  color: string
) {
  if (!points.length || renderedPointCount >= points.length) return points.length

  context.globalCompositeOperation = 'source-over'
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
  color: string
) {
  const pointCount = Math.floor(points.length / 2)
  if (!pointCount) return
  context.globalCompositeOperation = 'source-over'
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

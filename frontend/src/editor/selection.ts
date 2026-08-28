import type { LayerTransform } from '../types/editor'
import { colorRegionSpans, type ColorRegionResult } from './colorRegion.ts'

export type SelectionMode =
  | 'rectangle'
  | 'ellipse'
  | 'single-row'
  | 'single-column'
  | 'lasso'

export interface SelectionPoint {
  x: number
  y: number
}

export interface SelectionBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface RectangleSelection {
  kind: 'rectangle'
  bounds: SelectionBounds
}

export interface EllipseSelection {
  kind: 'ellipse'
  bounds: SelectionBounds
}

export interface LassoSelection {
  kind: 'lasso'
  points: SelectionPoint[]
  bounds: SelectionBounds
}

export interface PixelSpan {
  y: number
  x0: number
  x1: number
}

export interface PackedPixelSpans {
  kind: 'packed-spans'
  data: Int32Array<ArrayBuffer>
  length: number
}

export type PixelSpans = PixelSpan[] | PackedPixelSpans

export type Matrix2D = [number, number, number, number, number, number]

export interface PixelSelection {
  kind: 'pixels'
  sourceLayerId?: string
  sourceWidth: number
  sourceHeight: number
  sourceToDocument: Matrix2D
  spans: PixelSpans
  bounds: SelectionBounds
  pixelCount: number
}

export type SelectionRegion = RectangleSelection | EllipseSelection | LassoSelection | PixelSelection

export type WandResult = ColorRegionResult

export function forEachPixelSpan(spans: PixelSpans, visit: (span: PixelSpan, index: number) => void) {
  if (Array.isArray(spans)) {
    spans.forEach(visit)
    return
  }
  for (let index = 0; index < spans.length; index++) {
    const offset = index * 3
    visit({ y: spans.data[offset]!, x0: spans.data[offset + 1]!, x1: spans.data[offset + 2]! }, index)
  }
}

export function pixelSpansSome(spans: PixelSpans, predicate: (span: PixelSpan) => boolean) {
  if (Array.isArray(spans)) return spans.some(predicate)
  for (let index = 0; index < spans.length; index++) {
    const offset = index * 3
    if (predicate({ y: spans.data[offset]!, x0: spans.data[offset + 1]!, x1: spans.data[offset + 2]! })) return true
  }
  return false
}

export function pixelSpansContainPoint(spans: PixelSpans, y: number, x: number) {
  if (Array.isArray(spans)) return spans.some((span) => span.y === y && x >= span.x0 && x < span.x1)
  let low = 0
  let high = spans.length - 1
  while (low <= high) {
    const index = (low + high) >>> 1
    const offset = index * 3
    const spanY = spans.data[offset]!
    const x0 = spans.data[offset + 1]!
    const x1 = spans.data[offset + 2]!
    if (spanY < y || (spanY === y && x1 <= x)) low = index + 1
    else if (spanY > y || x0 > x) high = index - 1
    else return true
  }
  return false
}

export function clonePixelSpans(spans: PixelSpans): PixelSpans {
  return Array.isArray(spans)
    ? spans.map((span) => ({ ...span }))
    : { kind: 'packed-spans', data: new Int32Array(spans.data), length: spans.length }
}

const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0]

export function clampSelectionPoint(
  point: SelectionPoint,
  width: number,
  height: number,
  minX = 0,
  minY = 0
): SelectionPoint {
  return {
    x: Math.max(minX, Math.min(width, point.x)),
    y: Math.max(minY, Math.min(height, point.y))
  }
}

export function dragSelectionBounds(
  start: SelectionPoint,
  end: SelectionPoint,
  constrainProportions = false
): SelectionBounds {
  let deltaX = end.x - start.x
  let deltaY = end.y - start.y
  if (constrainProportions) {
    const size = Math.max(Math.abs(deltaX), Math.abs(deltaY))
    deltaX = Math.sign(deltaX || 1) * size
    deltaY = Math.sign(deltaY || 1) * size
  }

  return {
    x: Math.min(start.x, start.x + deltaX),
    y: Math.min(start.y, start.y + deltaY),
    width: Math.abs(deltaX),
    height: Math.abs(deltaY)
  }
}

export function constrainedSelectionEndpoint(
  start: SelectionPoint,
  end: SelectionPoint,
  width: number,
  height: number,
  minX = 0,
  minY = 0
) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const availableX = deltaX < 0 ? start.x - minX : width - start.x
  const availableY = deltaY < 0 ? start.y - minY : height - start.y
  const size = Math.max(0, Math.min(Math.max(Math.abs(deltaX), Math.abs(deltaY)), availableX, availableY))
  return {
    x: start.x + Math.sign(deltaX || 1) * size,
    y: start.y + Math.sign(deltaY || 1) * size
  }
}

export function pointsBounds(points: SelectionPoint[]): SelectionBounds {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = points[0]!.x
  let minY = points[0]!.y
  let maxX = minX
  let maxY = minY
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function pointSegmentDistanceSquared(point: SelectionPoint, start: SelectionPoint, end: SelectionPoint) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  if (deltaX === 0 && deltaY === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2
  }
  const progress = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / (deltaX ** 2 + deltaY ** 2))
  )
  const projectedX = start.x + deltaX * progress
  const projectedY = start.y + deltaY * progress
  return (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2
}

export function simplifySelectionPoints(points: SelectionPoint[], tolerance = 0.75) {
  if (points.length <= 2) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  const toleranceSquared = tolerance ** 2

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop()!
    let furthestIndex = -1
    let furthestDistance = toleranceSquared
    for (let index = startIndex + 1; index < endIndex; index++) {
      const distance = pointSegmentDistanceSquared(points[index]!, points[startIndex]!, points[endIndex]!)
      if (distance <= furthestDistance) continue
      furthestDistance = distance
      furthestIndex = index
    }
    if (furthestIndex < 0) continue
    keep[furthestIndex] = 1
    stack.push([startIndex, furthestIndex], [furthestIndex, endIndex])
  }

  return points.filter((_, index) => keep[index])
}

export function createShapeSelection(
  mode: 'rectangle' | 'ellipse',
  start: SelectionPoint,
  end: SelectionPoint,
  constrainProportions = false
): RectangleSelection | EllipseSelection {
  return { kind: mode, bounds: dragSelectionBounds(start, end, constrainProportions) }
}

export function createLassoSelection(points: SelectionPoint[], tolerance = 0.75): LassoSelection {
  const simplified = simplifySelectionPoints(points, tolerance)
  return { kind: 'lasso', points: simplified, bounds: pointsBounds(simplified) }
}

export function intersectSelectionBounds(a: SelectionBounds, b: SelectionBounds): SelectionBounds {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.width, b.x + b.width)
  const y1 = Math.min(a.y + a.height, b.y + b.height)
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

export function clampSelectionToBounds(selection: SelectionRegion, bounds: SelectionBounds): SelectionRegion {
  if (selection.kind === 'pixels') return selection
  if (selection.kind === 'lasso') {
    const points = selection.points.map((point) =>
      clampSelectionPoint(point, bounds.x + bounds.width, bounds.y + bounds.height, bounds.x, bounds.y)
    )
    return { kind: 'lasso', points, bounds: pointsBounds(points) }
  }
  return { ...selection, bounds: intersectSelectionBounds(selection.bounds, bounds) }
}

export function snapShapeSelectionToBounds(
  selection: SelectionRegion,
  bounds: SelectionBounds,
  tolerance: number
): SelectionRegion {
  if (selection.kind === 'pixels' || selection.kind === 'lasso') return selection
  const threshold = Math.max(0, tolerance)
  let x0 = selection.bounds.x
  let y0 = selection.bounds.y
  let x1 = selection.bounds.x + selection.bounds.width
  let y1 = selection.bounds.y + selection.bounds.height
  const boundsX1 = bounds.x + bounds.width
  const boundsY1 = bounds.y + bounds.height
  if (Math.abs(x0 - bounds.x) <= threshold) x0 = bounds.x
  if (Math.abs(y0 - bounds.y) <= threshold) y0 = bounds.y
  if (Math.abs(x1 - boundsX1) <= threshold) x1 = boundsX1
  if (Math.abs(y1 - boundsY1) <= threshold) y1 = boundsY1
  return {
    ...selection,
    bounds: {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0)
    }
  }
}

export function selectionIsEmpty(selection: SelectionRegion | null | undefined) {
  if (!selection) return true
  if (selection.kind === 'pixels') return selection.pixelCount === 0 || selection.spans.length === 0
  if (selection.kind === 'lasso') return selection.points.length < 3 || selection.bounds.width < 0.5 || selection.bounds.height < 0.5
  return selection.bounds.width < 0.5 || selection.bounds.height < 0.5
}

function pathNumber(value: number) {
  return String(Math.round(value * 100) / 100)
}

export function vectorSelectionPath(selection: Exclude<SelectionRegion, PixelSelection>) {
  if (selection.kind === 'rectangle') {
    const { x, y, width, height } = selection.bounds
    return `M${pathNumber(x)} ${pathNumber(y)}h${pathNumber(width)}v${pathNumber(height)}h-${pathNumber(width)}Z`
  }
  if (selection.kind === 'ellipse') {
    const { x, y, width, height } = selection.bounds
    const radiusX = width / 2
    const radiusY = height / 2
    const centerX = x + radiusX
    const centerY = y + radiusY
    return `M${pathNumber(centerX - radiusX)} ${pathNumber(centerY)}a${pathNumber(radiusX)} ${pathNumber(radiusY)} 0 1 0 ${pathNumber(width)} 0a${pathNumber(radiusX)} ${pathNumber(radiusY)} 0 1 0 -${pathNumber(width)} 0Z`
  }
  return `${selection.points.map((point, index) => `${index ? 'L' : 'M'}${pathNumber(point.x)} ${pathNumber(point.y)}`).join('')}Z`
}

const MAXIMUM_DETAILED_SELECTION_SPANS = 20_000

function selectionBoundsPath(bounds: SelectionBounds) {
  return `M${bounds.x} ${bounds.y}h${bounds.width}v${bounds.height}H${bounds.x}Z`
}

export function pixelSpansFillPath(spans: PixelSpans, fallbackBounds?: SelectionBounds) {
  if (spans.length > MAXIMUM_DETAILED_SELECTION_SPANS && fallbackBounds) return selectionBoundsPath(fallbackBounds)
  const path: string[] = []
  forEachPixelSpan(spans, (span) => path.push(`M${span.x0} ${span.y}h${span.x1 - span.x0}v1H${span.x0}Z`))
  return path.join('')
}

function subtractIntervals(start: number, end: number, intervals: Array<[number, number]>) {
  const result: Array<[number, number]> = []
  let cursor = start
  for (const [otherStart, otherEnd] of intervals) {
    if (otherEnd <= cursor) continue
    if (otherStart >= end) break
    if (otherStart > cursor) result.push([cursor, Math.min(otherStart, end)])
    cursor = Math.max(cursor, otherEnd)
    if (cursor >= end) break
  }
  if (cursor < end) result.push([cursor, end])
  return result
}

export function pixelSpansOutlinePath(spans: PixelSpans, fallbackBounds?: SelectionBounds) {
  if (spans.length > MAXIMUM_DETAILED_SELECTION_SPANS && fallbackBounds) return selectionBoundsPath(fallbackBounds)
  const rows = new Map<number, Array<[number, number]>>()
  forEachPixelSpan(spans, (span) => {
    const row = rows.get(span.y) ?? []
    row.push([span.x0, span.x1])
    rows.set(span.y, row)
  })
  for (const row of rows.values()) row.sort((first, second) => first[0] - second[0])

  const path: string[] = []
  forEachPixelSpan(spans, (span) => {
    path.push(`M${span.x0} ${span.y}v1`, `M${span.x1} ${span.y}v1`)
    for (const [start, end] of subtractIntervals(span.x0, span.x1, rows.get(span.y - 1) ?? [])) {
      path.push(`M${start} ${span.y}H${end}`)
    }
    for (const [start, end] of subtractIntervals(span.x0, span.x1, rows.get(span.y + 1) ?? [])) {
      path.push(`M${start} ${span.y + 1}H${end}`)
    }
  })
  return path.join('')
}

export function traceSelectionPath(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  selection: SelectionRegion
) {
  context.beginPath()
  if (selection.kind === 'pixels') {
    forEachPixelSpan(selection.spans, (span) => context.rect(span.x0, span.y, span.x1 - span.x0, 1))
    return
  }

  if (selection.kind === 'rectangle') {
    const { x, y, width, height } = selection.bounds
    context.rect(x, y, width, height)
  } else if (selection.kind === 'ellipse') {
    const { x, y, width, height } = selection.bounds
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
  } else {
    const first = selection.points[0]
    if (!first) return
    context.moveTo(first.x, first.y)
    for (let index = 1; index < selection.points.length; index++) {
      const point = selection.points[index]!
      context.lineTo(point.x, point.y)
    }
    context.closePath()
  }
}

export function translateSelection(
  selection: SelectionRegion,
  deltaX: number,
  deltaY: number
): SelectionRegion {
  if (selection.kind === 'pixels') {
    return {
      ...selection,
      sourceToDocument: multiplyMatrices([1, 0, 0, 1, deltaX, deltaY], selection.sourceToDocument)
    }
  }
  if (selection.kind === 'lasso') {
    return {
      ...selection,
      points: selection.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })),
      bounds: { ...selection.bounds, x: selection.bounds.x + deltaX, y: selection.bounds.y + deltaY }
    }
  }
  return {
    ...selection,
    bounds: { ...selection.bounds, x: selection.bounds.x + deltaX, y: selection.bounds.y + deltaY }
  }
}

export function selectionNudgeDelta(key: string, accelerated = false) {
  const step = accelerated ? 10 : 1
  const movements: Record<string, SelectionPoint> = {
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 }
  }
  return movements[key]
}

export function selectionMoveDelta(
  start: SelectionPoint,
  point: SelectionPoint,
  constrain = false
): SelectionPoint {
  let x = point.x - start.x
  let y = point.y - start.y
  if (constrain && (x || y)) {
    const distance = Math.hypot(x, y)
    const angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4)
    x = Math.cos(angle) * distance
    y = Math.sin(angle) * distance
  }
  return { x: Math.round(x), y: Math.round(y) }
}

export function cloneSelection(selection: SelectionRegion | null): SelectionRegion | null {
  if (!selection) return null
  if (selection.kind === 'pixels') {
    return {
      ...selection,
      sourceToDocument: [...selection.sourceToDocument],
      spans: clonePixelSpans(selection.spans),
      bounds: { ...selection.bounds }
    }
  }
  if (selection.kind === 'lasso') {
    return {
      ...selection,
      points: selection.points.map((point) => ({ ...point })),
      bounds: { ...selection.bounds }
    }
  }
  return { ...selection, bounds: { ...selection.bounds } }
}

export function transformSelectionBounds(matrix: Matrix2D, bounds: SelectionBounds): SelectionBounds {
  const corners = [
    transformSelectionPoint(matrix, { x: bounds.x, y: bounds.y }),
    transformSelectionPoint(matrix, { x: bounds.x + bounds.width, y: bounds.y }),
    transformSelectionPoint(matrix, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }),
    transformSelectionPoint(matrix, { x: bounds.x, y: bounds.y + bounds.height })
  ]
  return pointsBounds(corners)
}

export function selectionDocumentBounds(selection: SelectionRegion) {
  return selection.kind === 'pixels'
    ? transformSelectionBounds(selection.sourceToDocument, selection.bounds)
    : { ...selection.bounds }
}

export function selectionContainsPoint(selection: SelectionRegion, point: SelectionPoint) {
  if (selection.kind === 'pixels') {
    const sourcePoint = transformSelectionPoint(invertMatrix(selection.sourceToDocument), point)
    const y = Math.floor(sourcePoint.y)
    return pixelSpansContainPoint(selection.spans, y, sourcePoint.x)
  }
  const { x, y, width, height } = selection.bounds
  if (point.x < x || point.y < y || point.x > x + width || point.y > y + height) return false
  if (selection.kind === 'rectangle') return true
  if (selection.kind === 'ellipse') {
    const radiusX = width / 2
    const radiusY = height / 2
    if (radiusX <= 0 || radiusY <= 0) return false
    const normalizedX = (point.x - x - radiusX) / radiusX
    const normalizedY = (point.y - y - radiusY) / radiusY
    return normalizedX ** 2 + normalizedY ** 2 <= 1
  }

  let inside = false
  for (let index = 0, previousIndex = selection.points.length - 1; index < selection.points.length; previousIndex = index++) {
    const current = selection.points[index]!
    const previous = selection.points[previousIndex]!
    const intersects =
      (current.y > point.y) !== (previous.y > point.y) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x
    if (intersects) inside = !inside
  }
  return inside
}

export function selectionExtractionGeometry(
  sourceWidth: number,
  sourceHeight: number,
  transform: LayerTransform,
  selection: SelectionRegion
) {
  const documentToSource = invertMatrix(layerSourceToDocumentMatrix(transform, sourceWidth, sourceHeight))
  const sourceBounds = transformSelectionBounds(documentToSource, selectionDocumentBounds(selection))
  const clippedBounds = intersectSelectionBounds(sourceBounds, { x: 0, y: 0, width: sourceWidth, height: sourceHeight })
  const originX = Math.max(0, Math.floor(clippedBounds.x))
  const originY = Math.max(0, Math.floor(clippedBounds.y))
  const right = Math.min(sourceWidth, Math.ceil(clippedBounds.x + clippedBounds.width))
  const bottom = Math.min(sourceHeight, Math.ceil(clippedBounds.y + clippedBounds.height))
  return {
    documentToSource,
    originX,
    originY,
    width: Math.max(0, right - originX),
    height: Math.max(0, bottom - originY)
  }
}

export function selectionMoveGeometry(
  sourceWidth: number,
  sourceHeight: number,
  transform: LayerTransform,
  selection: SelectionRegion,
  deltaX: number,
  deltaY: number
) {
  const documentToSource = invertMatrix(layerSourceToDocumentMatrix(transform, sourceWidth, sourceHeight))
  const sourceBounds = transformSelectionBounds(documentToSource, selectionDocumentBounds(selection))
  const clippedBounds = intersectSelectionBounds(sourceBounds, { x: 0, y: 0, width: sourceWidth, height: sourceHeight })
  const [a, b, c, d] = documentToSource
  const sourceDeltaX = a * deltaX + c * deltaY
  const sourceDeltaY = b * deltaX + d * deltaY
  const axisAlignedSelection =
    (Math.abs(b) < 1e-8 && Math.abs(c) < 1e-8) ||
    (Math.abs(a) < 1e-8 && Math.abs(d) < 1e-8)
  const hardRectangularMask = selection.kind === 'rectangle' && axisAlignedSelection
  // Canvas/WebView interpolation can turn a single opaque neighbour beside a
  // transparent cut into a visible hairline. Rectangular masks are hard-edged,
  // so carry one source pixel of bleed with the selection instead of deleting it.
  const bleed = hardRectangularMask && clippedBounds.width > 0 && clippedBounds.height > 0 ? 1 : 0
  const selectionOriginX = Math.max(0, Math.floor(clippedBounds.x) - bleed)
  const selectionOriginY = Math.max(0, Math.floor(clippedBounds.y) - bleed)
  const selectionRight = Math.min(sourceWidth, Math.ceil(clippedBounds.x + clippedBounds.width) + bleed)
  const selectionBottom = Math.min(sourceHeight, Math.ceil(clippedBounds.y + clippedBounds.height) + bleed)
  const selectionWidth = Math.max(0, selectionRight - selectionOriginX)
  const selectionHeight = Math.max(0, selectionBottom - selectionOriginY)
  const hasSelectionArea = selectionWidth > 0 && selectionHeight > 0
  const originX = hasSelectionArea ? Math.min(0, Math.floor(selectionOriginX + sourceDeltaX)) : 0
  const originY = hasSelectionArea ? Math.min(0, Math.floor(selectionOriginY + sourceDeltaY)) : 0
  const maxX = hasSelectionArea
    ? Math.max(sourceWidth, Math.ceil(selectionOriginX + selectionWidth + sourceDeltaX))
    : sourceWidth
  const maxY = hasSelectionArea
    ? Math.max(sourceHeight, Math.ceil(selectionOriginY + selectionHeight + sourceDeltaY))
    : sourceHeight
  return {
    documentToSource,
    sourceDeltaX,
    sourceDeltaY,
    selectionOriginX,
    selectionOriginY,
    selectionWidth,
    selectionHeight,
    hardRectangularMask,
    originX,
    originY,
    width: Math.max(1, maxX - originX),
    height: Math.max(1, maxY - originY)
  }
}

export function drawVectorSelection(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  selection: SelectionRegion
) {
  traceSelectionPath(context, selection)
  context.fill()
}

export function clipContextToSelection(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  selection: SelectionRegion,
  documentToTarget: Matrix2D
) {
  const selectionToTarget = selection.kind === 'pixels'
    ? multiplyMatrices(documentToTarget, selection.sourceToDocument)
    : documentToTarget
  context.setTransform(...selectionToTarget)
  traceSelectionPath(context, selection)
  context.clip()
  context.setTransform(...documentToTarget)
}

export function matrixToSvg(matrix: Matrix2D) {
  return `matrix(${matrix.join(' ')})`
}

export function multiplyMatrices(left: Matrix2D, right: Matrix2D): Matrix2D {
  const [a1, b1, c1, d1, e1, f1] = left
  const [a2, b2, c2, d2, e2, f2] = right
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1
  ]
}

export function invertMatrix(matrix: Matrix2D): Matrix2D {
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (Math.abs(determinant) < Number.EPSILON) return IDENTITY_MATRIX
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ]
}

export function transformSelectionPoint(matrix: Matrix2D, point: SelectionPoint): SelectionPoint {
  const [a, b, c, d, e, f] = matrix
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}

export const SELECTION_EXTRACTION_ALPHA_THRESHOLD = 1

export function opaquePixelBounds(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  alphaThreshold = 0
): SelectionBounds | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      if (pixels[(rowOffset + x) * 4 + 3]! <= alphaThreshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

export function layerSourceToDocumentMatrix(
  transform: LayerTransform,
  sourceWidth: number,
  sourceHeight: number
): Matrix2D {
  if (sourceWidth <= 0 || sourceHeight <= 0) return IDENTITY_MATRIX
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
  return [a, b, c, d, centerX - a * sourceWidth / 2 - c * sourceHeight / 2, centerY - b * sourceWidth / 2 - d * sourceHeight / 2]
}

/**
 * Converts a document-space distance (e.g. a brush radius) into the layer's
 * local source-pixel space, using the geometric mean of the x/y scale as an
 * approximation. Exact for uniform scale + rotation; for a non-uniformly
 * stretched layer a "round" document-space brush becomes a slightly
 * elliptical stroke in source pixels — which is self-correcting on screen
 * (transforming it back through the same non-uniform scale looks round
 * again), but the stored pixels themselves are not perfectly circular. This
 * is a deliberate v1 approximation, not a bug.
 */
export function sourceScaleFactor(transform: LayerTransform, sourceWidth: number, sourceHeight: number) {
  if (sourceWidth <= 0 || sourceHeight <= 0) return 1
  const scaleX = transform.width / sourceWidth
  const scaleY = transform.height / sourceHeight
  return Math.sqrt(scaleX * scaleY)
}

export function magicWandSpans(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  tolerance: number,
  contiguous = true
): WandResult {
  return colorRegionSpans(pixels, width, height, { startX, startY, tolerance, contiguous })
}

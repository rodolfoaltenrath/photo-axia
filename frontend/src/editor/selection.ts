import type { LayerTransform } from '../types/editor'

export type SelectionMode = 'rectangle' | 'ellipse' | 'lasso' | 'magic-wand'

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

export type Matrix2D = [number, number, number, number, number, number]

export interface PixelSelection {
  kind: 'pixels'
  layerId: string
  sourceWidth: number
  sourceHeight: number
  sourceToDocument: Matrix2D
  spans: PixelSpan[]
  bounds: SelectionBounds
  pixelCount: number
}

export type SelectionRegion = RectangleSelection | EllipseSelection | LassoSelection | PixelSelection

export interface WandResult {
  spans: PixelSpan[]
  bounds: SelectionBounds
  pixelCount: number
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

export function pixelSpansFillPath(spans: PixelSpan[]) {
  return spans.map((span) => `M${span.x0} ${span.y}h${span.x1 - span.x0}v1H${span.x0}Z`).join('')
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

export function pixelSpansOutlinePath(spans: PixelSpan[]) {
  const rows = new Map<number, Array<[number, number]>>()
  for (const span of spans) {
    const row = rows.get(span.y) ?? []
    row.push([span.x0, span.x1])
    rows.set(span.y, row)
  }
  for (const row of rows.values()) row.sort((first, second) => first[0] - second[0])

  const path: string[] = []
  for (const span of spans) {
    path.push(`M${span.x0} ${span.y}v1`, `M${span.x1} ${span.y}v1`)
    for (const [start, end] of subtractIntervals(span.x0, span.x1, rows.get(span.y - 1) ?? [])) {
      path.push(`M${start} ${span.y}H${end}`)
    }
    for (const [start, end] of subtractIntervals(span.x0, span.x1, rows.get(span.y + 1) ?? [])) {
      path.push(`M${start} ${span.y + 1}H${end}`)
    }
  }
  return path.join('')
}

export function traceSelectionPath(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  selection: SelectionRegion
) {
  context.beginPath()
  if (selection.kind === 'pixels') {
    for (const span of selection.spans) context.rect(span.x0, span.y, span.x1 - span.x0, 1)
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

export function cloneSelection(selection: SelectionRegion | null): SelectionRegion | null {
  if (!selection) return null
  if (selection.kind === 'pixels') {
    return {
      ...selection,
      sourceToDocument: [...selection.sourceToDocument],
      spans: selection.spans.map((span) => ({ ...span })),
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
    return selection.spans.some((span) => span.y === y && sourcePoint.x >= span.x0 && sourcePoint.x < span.x1)
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
  const selectionOriginX = Math.floor(clippedBounds.x)
  const selectionOriginY = Math.floor(clippedBounds.y)
  const selectionWidth = Math.max(0, Math.ceil(clippedBounds.x + clippedBounds.width) - selectionOriginX)
  const selectionHeight = Math.max(0, Math.ceil(clippedBounds.y + clippedBounds.height) - selectionOriginY)
  const hasSelectionArea = selectionWidth > 0 && selectionHeight > 0
  const originX = hasSelectionArea ? Math.min(0, Math.floor(clippedBounds.x + sourceDeltaX)) : 0
  const originY = hasSelectionArea ? Math.min(0, Math.floor(clippedBounds.y + sourceDeltaY)) : 0
  const maxX = hasSelectionArea
    ? Math.max(sourceWidth, Math.ceil(clippedBounds.x + clippedBounds.width + sourceDeltaX))
    : sourceWidth
  const maxY = hasSelectionArea
    ? Math.max(sourceHeight, Math.ceil(clippedBounds.y + clippedBounds.height + sourceDeltaY))
    : sourceHeight
  return {
    documentToSource,
    sourceDeltaX,
    sourceDeltaY,
    selectionOriginX,
    selectionOriginY,
    selectionWidth,
    selectionHeight,
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

function colorMatches(
  pixels: Uint8ClampedArray | Uint8Array,
  pixelIndex: number,
  target: readonly [number, number, number, number],
  tolerance: number
) {
  const offset = pixelIndex * 4
  const alpha = pixels[offset + 3]!
  if (alpha === 0 && target[3] === 0) return true
  return (
    Math.abs(pixels[offset]! - target[0]) <= tolerance &&
    Math.abs(pixels[offset + 1]! - target[1]) <= tolerance &&
    Math.abs(pixels[offset + 2]! - target[2]) <= tolerance &&
    Math.abs(alpha - target[3]) <= tolerance
  )
}

function resultFromSpans(spans: PixelSpan[]): WandResult {
  if (!spans.length) return { spans, bounds: { x: 0, y: 0, width: 0, height: 0 }, pixelCount: 0 }
  let minX = spans[0]!.x0
  let maxX = spans[0]!.x1
  let minY = spans[0]!.y
  let maxY = minY + 1
  let pixelCount = 0
  for (const span of spans) {
    minX = Math.min(minX, span.x0)
    maxX = Math.max(maxX, span.x1)
    minY = Math.min(minY, span.y)
    maxY = Math.max(maxY, span.y + 1)
    pixelCount += span.x1 - span.x0
  }
  spans.sort((first, second) => first.y - second.y || first.x0 - second.x0)
  return { spans, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, pixelCount }
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
  const x = Math.max(0, Math.min(width - 1, Math.floor(startX)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(startY)))
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return resultFromSpans([])
  const targetOffset = (y * width + x) * 4
  const target = [
    pixels[targetOffset]!,
    pixels[targetOffset + 1]!,
    pixels[targetOffset + 2]!,
    pixels[targetOffset + 3]!
  ] as const
  const threshold = Math.max(0, Math.min(255, Math.round(tolerance)))
  const matches = (pixelX: number, pixelY: number) =>
    colorMatches(pixels, pixelY * width + pixelX, target, threshold)
  const spans: PixelSpan[] = []

  if (!contiguous) {
    for (let row = 0; row < height; row++) {
      let runStart = -1
      for (let column = 0; column <= width; column++) {
        const selected = column < width && matches(column, row)
        if (selected && runStart < 0) runStart = column
        if (!selected && runStart >= 0) {
          spans.push({ y: row, x0: runStart, x1: column })
          runStart = -1
        }
      }
    }
    return resultFromSpans(spans)
  }

  const visited = new Uint8Array(width * height)
  const stack: number[] = [x, y]
  while (stack.length) {
    const seedY = stack.pop()!
    const seedX = stack.pop()!
    const seedIndex = seedY * width + seedX
    if (visited[seedIndex] || !matches(seedX, seedY)) continue

    let left = seedX
    let right = seedX
    while (left > 0 && !visited[seedY * width + left - 1] && matches(left - 1, seedY)) left--
    while (right + 1 < width && !visited[seedY * width + right + 1] && matches(right + 1, seedY)) right++

    for (let column = left; column <= right; column++) visited[seedY * width + column] = 1
    spans.push({ y: seedY, x0: left, x1: right + 1 })

    for (const neighborY of [seedY - 1, seedY + 1]) {
      if (neighborY < 0 || neighborY >= height) continue
      let insideRun = false
      for (let column = left; column <= right; column++) {
        const neighborIndex = neighborY * width + column
        const eligible = !visited[neighborIndex] && matches(column, neighborY)
        if (eligible && !insideRun) stack.push(column, neighborY)
        insideRun = eligible
      }
    }
  }

  return resultFromSpans(spans)
}

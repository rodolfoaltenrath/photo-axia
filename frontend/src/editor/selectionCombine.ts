import {
  cloneSelection,
  forEachPixelSpan,
  invertMatrix,
  pixelSpansContainPoint,
  selectionContainsPoint,
  selectionDocumentBounds,
  selectionIsEmpty,
  transformSelectionPoint,
  type PixelSelection,
  type PixelSpan,
  type PixelSpans,
  type SelectionBounds,
  type SelectionPoint,
  type SelectionRegion
} from './selection.ts'

export const SELECTION_COMBINE_MODES = ['replace', 'add', 'subtract', 'intersect'] as const
export type SelectionCombineMode = (typeof SELECTION_COMBINE_MODES)[number]

export interface SelectionCombineModifiers {
  altKey: boolean
  shiftKey: boolean
}

export interface SelectionDocumentSize {
  width: number
  height: number
}

export interface CooperativeSelectionCombineOptions {
  rowsPerChunk?: number
  throwIfCancelled?: () => void
  yieldControl: () => Promise<void>
}

export function resolveSelectionCombineMode(
  configured: SelectionCombineMode,
  modifiers: SelectionCombineModifiers
): SelectionCombineMode {
  if (modifiers.shiftKey && modifiers.altKey) return 'intersect'
  if (modifiers.shiftKey) return 'add'
  if (modifiers.altKey) return 'subtract'
  return configured
}

function unionBounds(first: SelectionBounds, second: SelectionBounds): SelectionBounds {
  const x = Math.min(first.x, second.x)
  const y = Math.min(first.y, second.y)
  const right = Math.max(first.x + first.width, second.x + second.width)
  const bottom = Math.max(first.y + first.height, second.y + second.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

function intersectBounds(first: SelectionBounds, second: SelectionBounds): SelectionBounds {
  const x = Math.max(first.x, second.x)
  const y = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

function scanBounds(bounds: SelectionBounds, document: SelectionDocumentSize) {
  const width = Math.max(0, Math.floor(document.width))
  const height = Math.max(0, Math.floor(document.height))
  const x0 = Math.max(0, Math.min(width, Math.floor(bounds.x)))
  const y0 = Math.max(0, Math.min(height, Math.floor(bounds.y)))
  const x1 = Math.max(x0, Math.min(width, Math.ceil(bounds.x + bounds.width)))
  const y1 = Math.max(y0, Math.min(height, Math.ceil(bounds.y + bounds.height)))
  return { width, height, x0, y0, x1, y1 }
}

type SelectionTester = (point: SelectionPoint) => boolean
type RowIntervals = Array<[x0: number, x1: number]>
type SelectionRows = (y: number) => RowIntervals

function clippedInterval(x0: number, x1: number, scan: ReturnType<typeof scanBounds>): RowIntervals {
  const start = Math.max(scan.x0, Math.ceil(x0 - 0.5))
  const end = Math.min(scan.x1, Math.ceil(x1 - 0.5))
  return end > start ? [[start, end]] : []
}

function selectionRows(selection: SelectionRegion, scan: ReturnType<typeof scanBounds>): SelectionRows | undefined {
  if (selection.kind === 'rectangle') {
    const interval = clippedInterval(selection.bounds.x, selection.bounds.x + selection.bounds.width, scan)
    const y0 = Math.max(scan.y0, Math.ceil(selection.bounds.y - 0.5))
    const y1 = Math.min(scan.y1, Math.ceil(selection.bounds.y + selection.bounds.height - 0.5))
    return (y) => y >= y0 && y < y1 ? interval : []
  }
  if (selection.kind === 'ellipse') {
    const bounds = selection.bounds
    const radiusX = bounds.width / 2
    const radiusY = bounds.height / 2
    if (radiusX <= 0 || radiusY <= 0) return () => []
    const centerX = bounds.x + radiusX
    const centerY = bounds.y + radiusY
    const boundsX0 = Math.ceil(bounds.x - 0.5)
    const boundsX1 = Math.ceil(bounds.x + bounds.width - 0.5)
    return (y) => {
      const normalizedY = (y + 0.5 - centerY) / radiusY
      if (Math.abs(normalizedY) > 1) return []
      const halfWidth = radiusX * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY))
      const x0 = Math.max(scan.x0, boundsX0, Math.ceil(centerX - halfWidth - 0.5))
      const x1 = Math.min(scan.x1, boundsX1, Math.floor(centerX + halfWidth - 0.5) + 1)
      return x1 > x0 ? [[x0, x1]] : []
    }
  }
  if (selection.kind !== 'pixels') return undefined
  const [a, b, c, d, e, f] = selection.sourceToDocument
  if (a !== 1 || b !== 0 || c !== 0 || d !== 1 || !Number.isInteger(e) || !Number.isInteger(f)) return undefined
  const rows = new Map<number, RowIntervals>()
  forEachPixelSpan(selection.spans, (span) => {
    const y = span.y + f
    if (y < scan.y0 || y >= scan.y1) return
    const interval = clippedInterval(span.x0 + e, span.x1 + e, scan)[0]
    if (!interval) return
    const row = rows.get(y)
    if (row) row.push(interval)
    else rows.set(y, [interval])
  })
  return (y) => rows.get(y) ?? []
}

function unionIntervals(first: RowIntervals, second: RowIntervals): RowIntervals {
  const sorted = [...first, ...second].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const result: RowIntervals = []
  for (const interval of sorted) {
    const previous = result.at(-1)
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1])
    else result.push([...interval])
  }
  return result
}

function intersectIntervals(first: RowIntervals, second: RowIntervals): RowIntervals {
  const result: RowIntervals = []
  let firstIndex = 0
  let secondIndex = 0
  while (firstIndex < first.length && secondIndex < second.length) {
    const left = first[firstIndex]!
    const right = second[secondIndex]!
    const x0 = Math.max(left[0], right[0])
    const x1 = Math.min(left[1], right[1])
    if (x1 > x0) result.push([x0, x1])
    if (left[1] < right[1]) firstIndex++
    else secondIndex++
  }
  return result
}

function subtractIntervals(first: RowIntervals, second: RowIntervals): RowIntervals {
  const result: RowIntervals = []
  let secondIndex = 0
  for (const interval of first) {
    let cursor = interval[0]
    while (secondIndex < second.length && second[secondIndex]![1] <= cursor) secondIndex++
    let index = secondIndex
    while (index < second.length && second[index]![0] < interval[1]) {
      const blocker = second[index]!
      if (blocker[0] > cursor) result.push([cursor, Math.min(blocker[0], interval[1])])
      cursor = Math.max(cursor, blocker[1])
      if (cursor >= interval[1]) break
      index++
    }
    if (cursor < interval[1]) result.push([cursor, interval[1]])
  }
  return result
}

function combineIntervals(first: RowIntervals, second: RowIntervals, mode: Exclude<SelectionCombineMode, 'replace'>) {
  if (mode === 'add') return unionIntervals(first, second)
  if (mode === 'subtract') return subtractIntervals(first, second)
  return intersectIntervals(first, second)
}

function intervalsContain(intervals: PixelSpan[], x: number) {
  let low = 0
  let high = intervals.length - 1
  while (low <= high) {
    const index = (low + high) >>> 1
    const span = intervals[index]!
    if (x < span.x0) high = index - 1
    else if (x >= span.x1) low = index + 1
    else return true
  }
  return false
}

function pixelSelectionTester(selection: PixelSelection): SelectionTester {
  const documentToSource = invertMatrix(selection.sourceToDocument)
  if (!Array.isArray(selection.spans)) {
    return (point) => {
      const source = transformSelectionPoint(documentToSource, point)
      return pixelSpansContainPoint(selection.spans, Math.floor(source.y), source.x)
    }
  }
  const rows = new Map<number, PixelSpan[]>()
  for (const span of selection.spans) {
    const intervals = rows.get(span.y) ?? []
    intervals.push(span)
    rows.set(span.y, intervals)
  }
  for (const intervals of rows.values()) intervals.sort((first, second) => first.x0 - second.x0)
  return (point) => {
    const source = transformSelectionPoint(documentToSource, point)
    const intervals = rows.get(Math.floor(source.y))
    return Boolean(intervals && intervalsContain(intervals, source.x))
  }
}

function vectorSelectionTester(selection: Exclude<SelectionRegion, PixelSelection>): SelectionTester {
  return (point) => selectionContainsPoint(selection, point)
}

function selectionTester(selection: SelectionRegion): SelectionTester {
  return selection.kind === 'pixels' ? pixelSelectionTester(selection) : vectorSelectionTester(selection)
}

const OBJECT_SPAN_LIMIT = 20_000

class PixelSpanBuilder {
  private objectSpans: Array<{ y: number; x0: number; x1: number }> = []
  private packedData: Int32Array<ArrayBuffer> | undefined
  private spanCount = 0
  private minX = Number.POSITIVE_INFINITY
  private minY = Number.POSITIVE_INFINITY
  private maxX = Number.NEGATIVE_INFINITY
  private maxY = Number.NEGATIVE_INFINITY
  private pixels = 0

  private ensurePackedCapacity(requiredValues: number) {
    if (this.packedData && this.packedData.length >= requiredValues) return
    const next = new Int32Array(Math.max(requiredValues, this.packedData ? this.packedData.length * 2 : OBJECT_SPAN_LIMIT * 6))
    if (this.packedData) next.set(this.packedData)
    else {
      for (let index = 0; index < this.objectSpans.length; index++) {
        const span = this.objectSpans[index]!
        const offset = index * 3
        next[offset] = span.y
        next[offset + 1] = span.x0
        next[offset + 2] = span.x1
      }
      this.objectSpans = []
    }
    this.packedData = next
  }

  append(y: number, x0: number, x1: number) {
    if (x1 <= x0) return
    if (!this.packedData && this.spanCount < OBJECT_SPAN_LIMIT) this.objectSpans.push({ y, x0, x1 })
    else {
      this.ensurePackedCapacity((this.spanCount + 1) * 3)
      const offset = this.spanCount * 3
      this.packedData![offset] = y
      this.packedData![offset + 1] = x0
      this.packedData![offset + 2] = x1
    }
    this.spanCount++
    this.pixels += x1 - x0
    this.minX = Math.min(this.minX, x0)
    this.minY = Math.min(this.minY, y)
    this.maxX = Math.max(this.maxX, x1)
    this.maxY = Math.max(this.maxY, y + 1)
  }

  result(document: SelectionDocumentSize): PixelSelection | null {
    if (!this.spanCount) return null
    const spans: PixelSpans = this.packedData
      ? { kind: 'packed-spans', data: this.packedData.slice(0, this.spanCount * 3), length: this.spanCount }
      : this.objectSpans
    return {
      kind: 'pixels',
      sourceWidth: Math.max(0, Math.floor(document.width)),
      sourceHeight: Math.max(0, Math.floor(document.height)),
      sourceToDocument: [1, 0, 0, 1, 0, 0],
      spans,
      bounds: {
        x: this.minX,
        y: this.minY,
        width: this.maxX - this.minX,
        height: this.maxY - this.minY
      },
      pixelCount: this.pixels
    }
  }
}

function pixelIncluded(mode: Exclude<SelectionCombineMode, 'replace'>, previous: boolean, incoming: boolean) {
  if (mode === 'add') return previous || incoming
  if (mode === 'subtract') return previous && !incoming
  return previous && incoming
}

export function combineSelections(
  previous: SelectionRegion | null,
  incoming: SelectionRegion | null,
  mode: SelectionCombineMode,
  document: SelectionDocumentSize
): SelectionRegion | null {
  const first = selectionIsEmpty(previous) ? null : previous
  const second = selectionIsEmpty(incoming) ? null : incoming
  if (mode === 'replace') return cloneSelection(second)
  if (!first) return mode === 'add' ? cloneSelection(second) : null
  if (!second) return mode === 'intersect' ? null : cloneSelection(first)

  const firstBounds = selectionDocumentBounds(first)
  const secondBounds = selectionDocumentBounds(second)
  const operationBounds = mode === 'add'
    ? unionBounds(firstBounds, secondBounds)
    : mode === 'subtract'
      ? firstBounds
      : intersectBounds(firstBounds, secondBounds)
  const scan = scanBounds(operationBounds, document)
  if (scan.x1 <= scan.x0 || scan.y1 <= scan.y0) return mode === 'subtract' ? cloneSelection(first) : null

  const firstRows = selectionRows(first, scan)
  const secondRows = selectionRows(second, scan)
  const containsFirst = firstRows && secondRows ? undefined : selectionTester(first)
  const containsSecond = firstRows && secondRows ? undefined : selectionTester(second)
  const spans = new PixelSpanBuilder()
  for (let y = scan.y0; y < scan.y1; y++) {
    if (firstRows && secondRows) {
      for (const [x0, x1] of combineIntervals(firstRows(y), secondRows(y), mode)) spans.append(y, x0, x1)
      continue
    }
    let runStart = -1
    for (let x = scan.x0; x <= scan.x1; x++) {
      const selected = x < scan.x1 && pixelIncluded(
        mode,
        containsFirst!({ x: x + 0.5, y: y + 0.5 }),
        containsSecond!({ x: x + 0.5, y: y + 0.5 })
      )
      if (selected && runStart < 0) runStart = x
      if (!selected && runStart >= 0) {
        spans.append(y, runStart, x)
        runStart = -1
      }
    }
  }
  return spans.result(document)
}

export async function combineSelectionsCooperatively(
  previous: SelectionRegion | null,
  incoming: SelectionRegion | null,
  mode: SelectionCombineMode,
  document: SelectionDocumentSize,
  cooperative: CooperativeSelectionCombineOptions
): Promise<SelectionRegion | null> {
  const first = selectionIsEmpty(previous) ? null : previous
  const second = selectionIsEmpty(incoming) ? null : incoming
  if (mode === 'replace') return cloneSelection(second)
  if (!first) return mode === 'add' ? cloneSelection(second) : null
  if (!second) return mode === 'intersect' ? null : cloneSelection(first)

  const firstBounds = selectionDocumentBounds(first)
  const secondBounds = selectionDocumentBounds(second)
  const operationBounds = mode === 'add'
    ? unionBounds(firstBounds, secondBounds)
    : mode === 'subtract'
      ? firstBounds
      : intersectBounds(firstBounds, secondBounds)
  const scan = scanBounds(operationBounds, document)
  if (scan.x1 <= scan.x0 || scan.y1 <= scan.y0) return mode === 'subtract' ? cloneSelection(first) : null

  const firstRows = selectionRows(first, scan)
  const secondRows = selectionRows(second, scan)
  const containsFirst = firstRows && secondRows ? undefined : selectionTester(first)
  const containsSecond = firstRows && secondRows ? undefined : selectionTester(second)
  const spans = new PixelSpanBuilder()
  const rowsPerChunk = Math.max(1, Math.floor(cooperative.rowsPerChunk ?? 32))
  cooperative.throwIfCancelled?.()
  for (let y = scan.y0; y < scan.y1; y++) {
    if (firstRows && secondRows) {
      for (const [x0, x1] of combineIntervals(firstRows(y), secondRows(y), mode)) spans.append(y, x0, x1)
    } else {
      let runStart = -1
      for (let x = scan.x0; x <= scan.x1; x++) {
        const selected = x < scan.x1 && pixelIncluded(
          mode,
          containsFirst!({ x: x + 0.5, y: y + 0.5 }),
          containsSecond!({ x: x + 0.5, y: y + 0.5 })
        )
        if (selected && runStart < 0) runStart = x
        if (!selected && runStart >= 0) {
          spans.append(y, runStart, x)
          runStart = -1
        }
      }
    }
    if ((y - scan.y0 + 1) % rowsPerChunk === 0) {
      cooperative.throwIfCancelled?.()
      await cooperative.yieldControl()
      cooperative.throwIfCancelled?.()
    }
  }
  cooperative.throwIfCancelled?.()
  return spans.result(document)
}

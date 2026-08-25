import {
  cloneSelection,
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

  const containsFirst = selectionTester(first)
  const containsSecond = selectionTester(second)
  const spans = new PixelSpanBuilder()
  for (let y = scan.y0; y < scan.y1; y++) {
    let runStart = -1
    for (let x = scan.x0; x <= scan.x1; x++) {
      const selected = x < scan.x1 && pixelIncluded(
        mode,
        containsFirst({ x: x + 0.5, y: y + 0.5 }),
        containsSecond({ x: x + 0.5, y: y + 0.5 })
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

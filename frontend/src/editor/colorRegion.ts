import type { PackedPixelSpans, PixelSpan, PixelSpans, SelectionBounds } from './selection.ts'

export interface ColorRegionResult { spans: PixelSpans; bounds: SelectionBounds; pixelCount: number }
export interface ColorRegionOptions { contiguous: boolean; startX: number; startY: number; tolerance: number }
export interface ColorRegionSummary { bounds: SelectionBounds; pixelCount: number; spanCount: number }
export interface CooperativeColorRegionOptions {
  spansPerChunk?: number
  throwIfCancelled?: () => void
  yieldControl: () => Promise<void>
}
export type ColorRegionSpanVisitor = (y: number, x0: number, x1: number) => void
export type ColorRegionSpanTuple = readonly [y: number, x0: number, x1: number]

function colorMatches(pixels: Uint8ClampedArray | Uint8Array, pixelIndex: number, target: readonly [number, number, number, number], tolerance: number) {
  const offset = pixelIndex * 4
  const alpha = pixels[offset + 3]!
  if (alpha === 0 && target[3] === 0) return true
  return Math.abs(pixels[offset]! - target[0]) <= tolerance &&
    Math.abs(pixels[offset + 1]! - target[1]) <= tolerance &&
    Math.abs(pixels[offset + 2]! - target[2]) <= tolerance &&
    Math.abs(alpha - target[3]) <= tolerance
}

function resultFromSpans(spans: PixelSpan[]): ColorRegionResult {
  if (!spans.length) return { spans, bounds: { x: 0, y: 0, width: 0, height: 0 }, pixelCount: 0 }
  let minX = spans[0]!.x0, maxX = spans[0]!.x1, minY = spans[0]!.y, maxY = minY + 1, pixelCount = 0
  for (const span of spans) {
    minX = Math.min(minX, span.x0); maxX = Math.max(maxX, span.x1)
    minY = Math.min(minY, span.y); maxY = Math.max(maxY, span.y + 1)
    pixelCount += span.x1 - span.x0
  }
  spans.sort((first, second) => first.y - second.y || first.x0 - second.x0)
  return { spans, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, pixelCount }
}

export function* colorRegionSpanIterator(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, options: ColorRegionOptions): Generator<ColorRegionSpanTuple> {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return
  const x = Math.max(0, Math.min(width - 1, Math.floor(options.startX)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(options.startY)))
  const targetOffset = (y * width + x) * 4
  const target = [pixels[targetOffset]!, pixels[targetOffset + 1]!, pixels[targetOffset + 2]!, pixels[targetOffset + 3]!] as const
  const threshold = Math.max(0, Math.min(255, Math.round(options.tolerance)))
  const matches = (pixelX: number, pixelY: number) => colorMatches(pixels, pixelY * width + pixelX, target, threshold)

  if (!options.contiguous) {
    for (let row = 0; row < height; row++) {
      let runStart = -1
      for (let column = 0; column <= width; column++) {
        const selected = column < width && matches(column, row)
        if (selected && runStart < 0) runStart = column
        if (!selected && runStart >= 0) { yield [row, runStart, column]; runStart = -1 }
      }
    }
    return
  }

  const visited = new Uint8Array(width * height)
  const stack: number[] = [x, y]
  while (stack.length) {
    const seedY = stack.pop()!, seedX = stack.pop()!, seedIndex = seedY * width + seedX
    if (visited[seedIndex] || !matches(seedX, seedY)) continue
    let left = seedX, right = seedX
    while (left > 0 && !visited[seedY * width + left - 1] && matches(left - 1, seedY)) left--
    while (right + 1 < width && !visited[seedY * width + right + 1] && matches(right + 1, seedY)) right++
    for (let column = left; column <= right; column++) visited[seedY * width + column] = 1
    yield [seedY, left, right + 1]
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
}

export function visitColorRegionSpans(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, options: ColorRegionOptions, visit: ColorRegionSpanVisitor): ColorRegionSummary {
  let minX = width, maxX = 0, minY = height, maxY = 0, pixelCount = 0, spanCount = 0
  for (const [y, x0, x1] of colorRegionSpanIterator(pixels, width, height, options)) {
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y + 1)
    pixelCount += x1 - x0; spanCount += 1
    visit(y, x0, x1)
  }
  return spanCount
    ? { bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, pixelCount, spanCount }
    : { bounds: { x: 0, y: 0, width: 0, height: 0 }, pixelCount: 0, spanCount: 0 }
}

export function colorRegionSpans(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, options: ColorRegionOptions): ColorRegionResult {
  if (!options.contiguous) {
    const objectLimit = 20_000
    const objectSpans: PixelSpan[] = []
    let packedData: Int32Array<ArrayBuffer> | undefined
    let spanCount = 0
    const ensurePackedCapacity = (requiredValues: number) => {
      if (packedData && packedData.length >= requiredValues) return
      const next = new Int32Array(Math.max(requiredValues, packedData ? packedData.length * 2 : objectLimit * 6))
      if (packedData) next.set(packedData)
      else for (let index = 0; index < objectSpans.length; index++) {
        const span = objectSpans[index]!, offset = index * 3
        next[offset] = span.y; next[offset + 1] = span.x0; next[offset + 2] = span.x1
      }
      packedData = next
    }
    const summary = visitColorRegionSpans(pixels, width, height, options, (y, x0, x1) => {
      if (!packedData && spanCount < objectLimit) objectSpans.push({ y, x0, x1 })
      else {
        ensurePackedCapacity((spanCount + 1) * 3)
        const offset = spanCount * 3
        packedData![offset] = y; packedData![offset + 1] = x0; packedData![offset + 2] = x1
      }
      spanCount += 1
    })
    if (!packedData) return { spans: objectSpans, bounds: summary.bounds, pixelCount: summary.pixelCount }
    const spans: PackedPixelSpans = {
      kind: 'packed-spans',
      data: packedData.slice(0, spanCount * 3),
      length: spanCount
    }
    return { spans, bounds: summary.bounds, pixelCount: summary.pixelCount }
  }
  const spans: PixelSpan[] = []
  visitColorRegionSpans(pixels, width, height, options, (y, x0, x1) => spans.push({ y, x0, x1 }))
  return resultFromSpans(spans)
}

export async function colorRegionSpansCooperatively(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: ColorRegionOptions,
  cooperative: CooperativeColorRegionOptions
): Promise<ColorRegionResult> {
  const objectLimit = 20_000
  const objectSpans: PixelSpan[] = []
  let packedData: Int32Array<ArrayBuffer> | undefined
  let spanCount = 0
  let pixelCount = 0
  let minX = width, maxX = 0, minY = height, maxY = 0
  const workUnitsPerChunk = Math.max(1, Math.floor(cooperative.spansPerChunk ?? 128))

  const ensurePackedCapacity = (requiredValues: number) => {
    if (packedData && packedData.length >= requiredValues) return
    const next = new Int32Array(Math.max(requiredValues, packedData ? packedData.length * 2 : objectLimit * 6))
    if (packedData) next.set(packedData)
    else for (let index = 0; index < objectSpans.length; index++) {
      const span = objectSpans[index]!, offset = index * 3
      next[offset] = span.y; next[offset + 1] = span.x0; next[offset + 2] = span.x1
    }
    packedData = next
  }

  const appendSpan = (y: number, x0: number, x1: number) => {
    if (options.contiguous || (!packedData && spanCount < objectLimit)) objectSpans.push({ y, x0, x1 })
    else {
      ensurePackedCapacity((spanCount + 1) * 3)
      const offset = spanCount * 3
      packedData![offset] = y; packedData![offset + 1] = x0; packedData![offset + 2] = x1
    }
    spanCount += 1
    pixelCount += x1 - x0
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y + 1)
  }

  const yieldAndCheck = async () => {
    cooperative.throwIfCancelled?.()
    await cooperative.yieldControl()
    cooperative.throwIfCancelled?.()
  }

  cooperative.throwIfCancelled?.()
  if (!options.contiguous) {
    if (width > 0 && height > 0 && pixels.length >= width * height * 4) {
      const startX = Math.max(0, Math.min(width - 1, Math.floor(options.startX)))
      const startY = Math.max(0, Math.min(height - 1, Math.floor(options.startY)))
      const targetOffset = (startY * width + startX) * 4
      const target = [
        pixels[targetOffset]!,
        pixels[targetOffset + 1]!,
        pixels[targetOffset + 2]!,
        pixels[targetOffset + 3]!
      ] as const
      const threshold = Math.max(0, Math.min(255, Math.round(options.tolerance)))
      for (let row = 0; row < height; row++) {
        let runStart = -1
        for (let column = 0; column <= width; column++) {
          const selected = column < width && colorMatches(pixels, row * width + column, target, threshold)
          if (selected && runStart < 0) runStart = column
          if (!selected && runStart >= 0) {
            appendSpan(row, runStart, column)
            runStart = -1
          }
        }
        if ((row + 1) % workUnitsPerChunk === 0) await yieldAndCheck()
      }
    }
  } else {
    let processedSpans = 0
    for (const [y, x0, x1] of colorRegionSpanIterator(pixels, width, height, options)) {
      appendSpan(y, x0, x1)
      processedSpans += 1
      if (processedSpans % workUnitsPerChunk === 0) await yieldAndCheck()
    }
    objectSpans.sort((first, second) => first.y - second.y || first.x0 - second.x0)
  }
  cooperative.throwIfCancelled?.()
  const bounds = spanCount
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 0, height: 0 }
  if (!packedData) return { spans: objectSpans, bounds, pixelCount }
  return {
    spans: { kind: 'packed-spans', data: packedData.slice(0, spanCount * 3), length: spanCount },
    bounds,
    pixelCount
  }
}

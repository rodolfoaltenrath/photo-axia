import type { PixelSpan, PixelSpans, SelectionBounds, SelectionPoint } from './selection.ts'

export interface QuickSelectionOptions {
  positiveSeeds: readonly SelectionPoint[]
  negativeSeeds?: readonly SelectionPoint[]
  colorTolerance?: number
  edgeTolerance?: number
}

export interface QuickSelectionResult {
  spans: PixelSpans
  bounds: SelectionBounds
  pixelCount: number
}

export interface CooperativeQuickSelectionOptions {
  pixelsPerChunk?: number
  throwIfCancelled?: () => void
  yieldControl: () => Promise<void>
}

interface NormalizedQuickSelectionOptions {
  positiveSeeds: SelectionPoint[]
  negativeSeeds: SelectionPoint[]
  colorTolerance: number
  edgeTolerance: number
}

/**
 * FIFO compacta. Diferente de reservar `width * height` posições, esta fila retém
 * apenas a fronteira ainda pendente do flood fill. Em uma imagem 4K isso evita uma
 * alocação fixa adicional de ~32 MiB antes de existir trabalho suficiente para ela.
 */
class PixelQueue {
  private data = new Int32Array(4_096)
  private head = 0
  private tail = 0
  private size = 0

  get isEmpty() { return this.size === 0 }

  push(value: number) {
    if (this.size === this.data.length) this.grow()
    this.data[this.tail] = value
    this.tail = (this.tail + 1) % this.data.length
    this.size += 1
  }

  shift() {
    if (!this.size) return undefined
    const value = this.data[this.head]!
    this.head = (this.head + 1) % this.data.length
    this.size -= 1
    return value
  }

  private grow() {
    const next = new Int32Array(this.data.length * 2)
    for (let index = 0; index < this.size; index++) next[index] = this.data[(this.head + index) % this.data.length]!
    this.data = next
    this.head = 0
    this.tail = this.size
  }
}

interface QuickSelectionState {
  pixels: Uint8ClampedArray | Uint8Array
  width: number
  height: number
  config: NormalizedQuickSelectionOptions
  blocked: Uint8Array
  selected: Uint8Array
  queue: PixelQueue
  reference: [number, number, number, number]
}

function clampTolerance(value: number | undefined, fallback: number) {
  return Math.max(0, Math.min(255, Math.round(value ?? fallback)))
}

function normalizedSeeds(seeds: readonly SelectionPoint[], width: number, height: number) {
  const unique = new Set<number>()
  const result: SelectionPoint[] = []
  for (const seed of seeds) {
    const x = Math.floor(seed.x)
    const y = Math.floor(seed.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) continue
    const index = y * width + x
    if (unique.has(index)) continue
    unique.add(index)
    result.push({ x, y })
  }
  return result
}

export function normalizeQuickSelectionOptions(
  options: QuickSelectionOptions,
  width: number,
  height: number
): NormalizedQuickSelectionOptions {
  return {
    positiveSeeds: normalizedSeeds(options.positiveSeeds, width, height),
    negativeSeeds: normalizedSeeds(options.negativeSeeds ?? [], width, height),
    colorTolerance: clampTolerance(options.colorTolerance, 48),
    edgeTolerance: clampTolerance(options.edgeTolerance, 32)
  }
}

function channelDistance(
  pixels: Uint8ClampedArray | Uint8Array,
  firstPixel: number,
  secondPixel: number
) {
  const first = firstPixel * 4
  const second = secondPixel * 4
  const firstAlpha = pixels[first + 3]!
  const secondAlpha = pixels[second + 3]!
  if (firstAlpha === 0 && secondAlpha === 0) return 0
  return Math.max(
    Math.abs(pixels[first]! - pixels[second]!),
    Math.abs(pixels[first + 1]! - pixels[second + 1]!),
    Math.abs(pixels[first + 2]! - pixels[second + 2]!),
    Math.abs(firstAlpha - secondAlpha)
  )
}

function distanceFromReference(
  pixels: Uint8ClampedArray | Uint8Array,
  pixel: number,
  reference: readonly [number, number, number, number]
) {
  const offset = pixel * 4
  const alpha = pixels[offset + 3]!
  if (alpha === 0 && reference[3] === 0) return 0
  return Math.max(
    Math.abs(pixels[offset]! - reference[0]),
    Math.abs(pixels[offset + 1]! - reference[1]),
    Math.abs(pixels[offset + 2]! - reference[2]),
    Math.abs(alpha - reference[3])
  )
}

function seedReference(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  seeds: readonly SelectionPoint[]
): [number, number, number, number] {
  const sums = [0, 0, 0, 0]
  for (const seed of seeds) {
    const offset = (seed.y * width + seed.x) * 4
    sums[0] += pixels[offset]!
    sums[1] += pixels[offset + 1]!
    sums[2] += pixels[offset + 2]!
    sums[3] += pixels[offset + 3]!
  }
  return [
    Math.round(sums[0] / seeds.length),
    Math.round(sums[1] / seeds.length),
    Math.round(sums[2] / seeds.length),
    Math.round(sums[3] / seeds.length)
  ]
}

function emptyResult(): QuickSelectionResult {
  return { spans: [], bounds: { x: 0, y: 0, width: 0, height: 0 }, pixelCount: 0 }
}

function createState(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: QuickSelectionOptions
): QuickSelectionState | undefined {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return undefined
  const pixelCount = width * height
  if (!Number.isSafeInteger(pixelCount) || pixelCount > Math.floor(pixels.length / 4)) return undefined

  const config = normalizeQuickSelectionOptions(options, width, height)
  if (!config.positiveSeeds.length) return undefined
  const blocked = new Uint8Array(pixelCount)
  for (const seed of config.negativeSeeds) blocked[seed.y * width + seed.x] = 1
  const selected = new Uint8Array(pixelCount)
  const queue = new PixelQueue()
  for (const seed of config.positiveSeeds) {
    const index = seed.y * width + seed.x
    if (blocked[index] || selected[index]) continue
    selected[index] = 1
    queue.push(index)
  }
  return {
    pixels,
    width,
    height,
    config,
    blocked,
    selected,
    queue,
    reference: seedReference(pixels, width, config.positiveSeeds)
  }
}

function candidateCanJoin(state: QuickSelectionState, current: number, candidate: number) {
  return !state.selected[candidate] &&
    !state.blocked[candidate] &&
    distanceFromReference(state.pixels, candidate, state.reference) <= state.config.colorTolerance &&
    channelDistance(state.pixels, current, candidate) <= state.config.edgeTolerance
}

/** Processes up to `budget` queued pixels. Returns true when the region is complete. */
function growSelection(state: QuickSelectionState, budget: number) {
  let processed = 0
  while (!state.queue.isEmpty && processed < budget) {
    const current = state.queue.shift()!
    const x = current % state.width
    const y = Math.floor(current / state.width)
    const candidates = [
      x > 0 ? current - 1 : -1,
      x + 1 < state.width ? current + 1 : -1,
      y > 0 ? current - state.width : -1,
      y + 1 < state.height ? current + state.width : -1
    ]
    for (const candidate of candidates) {
      if (candidate < 0 || !candidateCanJoin(state, current, candidate)) continue
      state.selected[candidate] = 1
      state.queue.push(candidate)
    }
    processed += 1
  }
  return state.queue.isEmpty
}

function resultFromState(state: QuickSelectionState): QuickSelectionResult {
  const { selected, width, height } = state
  const spans: PixelSpan[] = []
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let selectedCount = 0
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      while (x < width && !selected[y * width + x]) x++
      const x0 = x
      while (x < width && selected[y * width + x]) x++
      if (x === x0) continue
      spans.push({ y, x0, x1: x })
      minX = Math.min(minX, x0)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y + 1)
      selectedCount += x - x0
    }
  }
  return selectedCount
    ? { spans, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, pixelCount: selectedCount }
    : emptyResult()
}

/**
 * Grows a region from positive seeds. A candidate must resemble the aggregate seed
 * colour and cross only local colour transitions below edgeTolerance. The latter is
 * what keeps a loose painted stroke from leaking through a high-contrast boundary.
 */
export function quickSelectionSpans(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: QuickSelectionOptions
): QuickSelectionResult {
  const state = createState(pixels, width, height, options)
  if (!state) return emptyResult()
  growSelection(state, Number.MAX_SAFE_INTEGER)
  return resultFromState(state)
}

/**
 * Sem Worker, mantém a mesma máscara do núcleo síncrono, mas divide a busca em
 * lotes para que cancelamento e repintura do navegador continuem possíveis.
 */
export async function quickSelectionSpansCooperatively(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: QuickSelectionOptions,
  cooperative: CooperativeQuickSelectionOptions
): Promise<QuickSelectionResult> {
  cooperative.throwIfCancelled?.()
  const state = createState(pixels, width, height, options)
  if (!state) return emptyResult()
  const pixelsPerChunk = Math.max(1, Math.floor(cooperative.pixelsPerChunk ?? 8_192))
  while (!growSelection(state, pixelsPerChunk)) {
    cooperative.throwIfCancelled?.()
    await cooperative.yieldControl()
    cooperative.throwIfCancelled?.()
  }
  cooperative.throwIfCancelled?.()
  return resultFromState(state)
}

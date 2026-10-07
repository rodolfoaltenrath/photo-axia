import { RustPixelPocError } from './rustPixelPocError.ts'

export interface RustStyleDecodeTimings {
  headerMs: number
  bitmapMs: number
  canvasDrawMs: number
  readbackMs: number
  rasterDecodes: number
  textDraws: number
  rgbaBytes: number
}

export interface RustStyleMediaTimings {
  sourceReused: boolean
  source: RustStyleDecodeTimings | null
  patterns: RustStyleDecodeTimings | null
  sourcePaddingMs: number
  sourceStagingMs: number
}

export function emptyRustStyleDecodeTimings(): RustStyleDecodeTimings {
  return { headerMs: 0, bitmapMs: 0, canvasDrawMs: 0, readbackMs: 0, rasterDecodes: 0, textDraws: 0, rgbaBytes: 0 }
}

export function snapshotRustStyleDecodeTimings(value: RustStyleDecodeTimings | undefined) {
  if (value === undefined) return null
  const timings = emptyRustStyleDecodeTimings()
  for (const key of Object.keys(timings) as (keyof RustStyleDecodeTimings)[]) {
    const number = value?.[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) throw new RustPixelPocError('wasm-failure')
    timings[key] = number
  }
  for (const key of ['rasterDecodes', 'textDraws', 'rgbaBytes'] as const) {
    if (!Number.isSafeInteger(timings[key])) throw new RustPixelPocError('wasm-failure')
  }
  if (timings.rasterDecodes > 64 || timings.textDraws > 1 || timings.rgbaBytes > 96 * 1024 * 1024) {
    throw new RustPixelPocError('wasm-failure')
  }
  return timings
}

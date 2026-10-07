import { snapshotRustStyleDecodeTimings, type RustStyleMediaTimings } from './rustStyleMediaTimings.ts'

export interface RustStyleMediaSample {
  wallMs: number
  media: RustStyleMediaTimings
  kernelMs: number
  pngEncodeMs: number
  canvasUploadMs: number
}

export function summarizeRustStyleMediaSamples(samples: readonly RustStyleMediaSample[]) {
  if (!samples.length || samples.length > 100) throw new Error('invalid-media-samples')
  const phases = { wallMs: [] as number[], sourceHeaderMs: [] as number[], sourceBitmapMs: [] as number[],
    sourceCanvasDrawMs: [] as number[], sourceReadbackMs: [] as number[], sourcePaddingMs: [] as number[],
    sourceStagingMs: [] as number[], patternHeaderMs: [] as number[], patternBitmapMs: [] as number[],
    patternCanvasDrawMs: [] as number[], patternReadbackMs: [] as number[], kernelMs: [] as number[],
    pngEncodeMs: [] as number[], canvasUploadMs: [] as number[] }
  let sourceDecodes = 0, patternDecodes = 0, reusedSources = 0
  for (const sample of samples) {
    const { sourceReused } = sample.media
    const source = snapshotRustStyleDecodeTimings(sample.media.source ?? undefined)
    const patterns = snapshotRustStyleDecodeTimings(sample.media.patterns ?? undefined)
    if (!source || !patterns || typeof sourceReused !== 'boolean') throw new Error('missing-media-timings')
    if (sourceReused && (Object.values(source).some(value => value !== 0) || sample.media.sourcePaddingMs !== 0 || sample.media.sourceStagingMs !== 0)) {
      throw new Error('reused-source-charged')
    }
    sourceDecodes += source.rasterDecodes; patternDecodes += patterns.rasterDecodes; reusedSources += Number(sourceReused)
    const values = { wallMs: sample.wallMs, sourceHeaderMs: source.headerMs, sourceBitmapMs: source.bitmapMs,
      sourceCanvasDrawMs: source.canvasDrawMs, sourceReadbackMs: source.readbackMs,
      sourcePaddingMs: sample.media.sourcePaddingMs, sourceStagingMs: sample.media.sourceStagingMs,
      patternHeaderMs: patterns.headerMs, patternBitmapMs: patterns.bitmapMs,
      patternCanvasDrawMs: patterns.canvasDrawMs, patternReadbackMs: patterns.readbackMs,
      kernelMs: sample.kernelMs, pngEncodeMs: sample.pngEncodeMs, canvasUploadMs: sample.canvasUploadMs }
    for (const key of Object.keys(phases) as (keyof typeof phases)[]) {
      const value = values[key]
      if (!Number.isFinite(value) || value < 0) throw new Error('invalid-media-timing')
      phases[key].push(value)
    }
  }
  return { samples: samples.length, sourceDecodes, patternDecodes, reusedSources,
    timings: Object.fromEntries(Object.entries(phases).map(([key, values]) => {
      const sorted = [...values].sort((a, b) => a - b)
      return [key, { medianMs: sorted[Math.ceil(sorted.length / 2) - 1]!, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]! }]
    })) }
}

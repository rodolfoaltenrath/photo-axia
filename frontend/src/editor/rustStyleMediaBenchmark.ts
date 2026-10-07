import { createRustPixelPocStyleService } from '../services/rustPixelPocStyleService.ts'
import { normalizeLayerStyleConfig } from './layerStyles.ts'
import { summarizeRustStyleMediaSamples, type RustStyleMediaSample } from './rustStyleMediaMeasurement.ts'

export async function runRustStyleMediaBenchmark() {
  const samples = 7, warmups = 2
  const rows: { side: number; scenario: string; summary: ReturnType<typeof summarizeRustStyleMediaSamples> }[] = []
  const service = createRustPixelPocStyleService()
  async function fixture(side: number, color: string) {
    const canvas = new OffscreenCanvas(side, side)
    try {
      const context = canvas.getContext('2d')
      if (!context) throw new Error('benchmark-canvas-unavailable')
      const gradient = context.createLinearGradient(0, 0, side, side)
      gradient.addColorStop(0, color); gradient.addColorStop(1, '#ffffff')
      context.fillStyle = gradient; context.fillRect(0, 0, side, side)
      context.clearRect(side / 4, side / 4, side / 2, side / 2)
      return await canvas.convertToBlob({ type: 'image/png' })
    } finally { canvas.width = 1; canvas.height = 1 }
  }
  try {
    const patternBlob = await fixture(512, '#0000ff')
    const pattern = { id: 'benchmark-pattern', name: 'Synthetic', width: 512, height: 512,
      mimeType: 'image/png', sourceUrl: 'blob:benchmark-pattern' }
    for (const side of [512, 1024]) {
      const sourceA = await fixture(side, '#ff0000'), sourceB = await fixture(side, '#00ff00')
      const measurements = new Map<string, RustStyleMediaSample[]>()
      for (let iteration = -warmups; iteration < samples; iteration++) {
        const scenarios = ['fresh-source', 'reused-source', 'alternating-layers', 'reused-source-pattern']
        if (iteration % 2 === 0) scenarios.reverse()
        for (const scenario of scenarios) {
          const base = { sourceIdentity: `${side}:${scenario}:${iteration}`, sourceWidth: side, sourceHeight: side,
            styles: normalizeLayerStyleConfig({ effects: [{ type: 'color-overlay', color: '#804020', opacity: 50 }] }),
            globalLight: { angle: 30, altitude: 30 }, source: { type: 'raster' as const, blob: sourceA } }
          const usesPattern = scenario === 'reused-source-pattern'
          if (usesPattern) base.styles = normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern, opacity: 50 }] })
          const request = { ...base, patterns: usesPattern ? { [pattern.id]: patternBlob } : {} }
          if (scenario !== 'fresh-source') {
            const setup = await service.render(request)
            setup.release()
            if (scenario === 'alternating-layers') {
              const other = await service.render({ ...request, sourceIdentity: `${base.sourceIdentity}:other`, source: { type: 'raster', blob: sourceB } })
              other.release()
            }
          }
          const started = performance.now(), lease = await service.render(request)
          try {
            const { result } = lease
            if (result.width !== side || result.height !== side || result.blob.type !== 'image/png' || !result.blob.size ||
              !result.media.source || !result.media.patterns || result.media.sourceReused !== scenario.startsWith('reused-') ||
              result.media.source.rasterDecodes !== Number(!scenario.startsWith('reused-')) ||
              result.media.patterns.rasterDecodes !== Number(usesPattern)) throw new Error('benchmark-media-contract-failed')
            const measurement = { wallMs: performance.now() - started, media: result.media,
              kernelMs: result.timings.kernelMs, pngEncodeMs: result.encoding.pngEncodeMs, canvasUploadMs: result.encoding.canvasUploadMs }
            if (iteration >= 0) {
              const values = measurements.get(scenario) ?? []
              values.push(measurement); measurements.set(scenario, values)
            }
          } finally { lease.release() }
        }
      }
      for (const [scenario, values] of measurements) rows.push({ side, scenario, summary: summarizeRustStyleMediaSamples(values) })
    }
    if (service.stats.leases !== 0 || service.stats.retainedResultBytes !== 0) throw new Error('benchmark-media-leak')
    return { samples, warmups, patternSide: 512, rows,
      scope: 'Synthetic PNGs, one Worker/WASM service, real WebView Canvas/decoder. Wall times, not CPU/FPS/RSS. Fixture creation, setup renders, warmups and UI excluded. No decoded cache or scheduler queue.' }
  } finally { await service.dispose() }
}

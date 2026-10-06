import { buildLayerStylePipeline, layerStyleInsets, type LayerStyleRaster, type LayerStyleRenderQuality } from './layerStyleCompositor.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from './layerStyles.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { prepareRustStyleStages, styleStagesLayout } from './rustPixelPocStages.ts'
import type { RustPixelPocPatternRaster, RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { LayerStyleConfig, LayerStyleGlobalLight } from '../types/editor.ts'

export interface RustPixelPocStyleSourceInput {
  sourceIdentity: string
  sourceWidth: number
  sourceHeight: number
  styles: LayerStyleConfig
  globalLight: LayerStyleGlobalLight
  resolutionScale?: number
  quality?: LayerStyleRenderQuality
}

export interface RustPixelPocStyleInput extends RustPixelPocStyleSourceInput {
  patterns?: ReadonlyMap<string, RustPixelPocPatternRaster>
  /** Coordinates in the padded raster, not the document. */
  region?: RustPixelPocRegion
}

export function prepareRustStyleSourceLayout(input: RustPixelPocStyleSourceInput) {
  if (!input) throw new RustPixelPocError('invalid-input')
  const { sourceWidth, sourceHeight } = input
  if (typeof input.sourceIdentity !== 'string' || !input.sourceIdentity ||
      !Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight) ||
      sourceWidth <= 0 || sourceHeight <= 0) throw new RustPixelPocError('invalid-input')
  const sourceBytes = sourceWidth * sourceHeight * 4
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes > 64 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  const quality = input.quality ?? 'final'
  if (quality !== 'interactive' && quality !== 'final') throw new RustPixelPocError('invalid-input')
  const styles = normalizeLayerStyleConfig(input.styles), light = normalizeLayerStyleGlobalLight(input.globalLight)
  const scale = Number.isFinite(input.resolutionScale) && input.resolutionScale! > 0 ? Math.min(8, input.resolutionScale!) : 1
  const insets = layerStyleInsets(styles, light, scale)
  const width = sourceWidth + insets.left + insets.right, height = sourceHeight + insets.top + insets.bottom
  const paddedBytes = width * height * 4
  if (![width, height, paddedBytes].every(Number.isSafeInteger) || paddedBytes > 64 * 1024 * 1024) {
    throw new RustPixelPocError('memory-limit')
  }
  // Original + JS padding + staged WASM; the previous source is released first.
  const preparationBytes = sourceBytes + paddedBytes * 2
  if (preparationBytes > 96 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  const sourceKey = JSON.stringify([input.sourceIdentity, sourceWidth, sourceHeight,
    insets.left, insets.top, insets.right, insets.bottom, scale, quality])
  return { sourceKey, sourceIdentity: input.sourceIdentity, sourceWidth, sourceHeight, width, height, insets, scale, quality, styles, light,
    offsetX: insets.left ? -insets.left : 0, offsetY: insets.top ? -insets.top : 0,
    preparationBytes }
}

export function prepareRustStyleJob(input: RustPixelPocStyleInput) {
  const source = prepareRustStyleSourceLayout(input)
  const region = input.region ? { ...input.region } : { x: 0, y: 0, width: source.width, height: source.height }
  const plan = prepareRustStyleStages(source.styles, source.light, source.scale, input.patterns)
  const layout = styleStagesLayout(plan, source.width, source.height, region)
  return { ...source, region, plan, ...layout }
}

export type RustPixelPocStyleJob = ReturnType<typeof prepareRustStyleJob>
export type RustPixelPocStyleSourceLayout = ReturnType<typeof prepareRustStyleSourceLayout>

export function describeRustStyleSource(job: RustPixelPocStyleJob): RustPixelPocStyleSourceInput {
  const pipeline = buildLayerStylePipeline(job.styles)
  const effects: Record<string, unknown>[] = []
  // Padding never needs decoded assets or their encoded URLs.
  for (const effect of pipeline.external) {
    const base = { id: effect.id, type: effect.type, enabled: effect.enabled, opacity: effect.opacity }
    switch (effect.type) {
      case 'drop-shadow': effects.push({ ...base, size: effect.size, distance: effect.distance,
        angle: effect.angle, useGlobalLight: effect.useGlobalLight }); break
      case 'outer-glow': effects.push({ ...base, size: effect.size }); break
      default: effect satisfies never; throw new RustPixelPocError('invalid-input')
    }
  }
  for (const effect of pipeline.upper) {
    const base = { id: effect.id, type: effect.type, enabled: effect.enabled, opacity: effect.opacity }
    switch (effect.type) {
      case 'stroke': effects.push({ ...base, size: effect.size, position: effect.position }); break
      case 'bevel-emboss': effects.push({ ...base, size: effect.size, soften: effect.soften, style: effect.style }); break
      default: effect satisfies never; throw new RustPixelPocError('invalid-input')
    }
  }
  return { sourceIdentity: job.sourceIdentity, sourceWidth: job.sourceWidth, sourceHeight: job.sourceHeight,
    styles: normalizeLayerStyleConfig({ enabled: job.styles.enabled, effects }), globalLight: job.light,
    resolutionScale: job.scale, quality: job.quality }
}

function validateStyleSource(source: LayerStyleRaster, job: RustPixelPocStyleSourceLayout) {
  if (source.width !== job.sourceWidth || source.height !== job.sourceHeight ||
      !(source.data instanceof Uint8ClampedArray) || source.data.byteLength !== source.width * source.height * 4) {
    throw new RustPixelPocError('invalid-input')
  }
}

export function copyRustStyleSource(source: LayerStyleRaster, job: RustPixelPocStyleSourceLayout): Uint8Array<ArrayBuffer> {
  validateStyleSource(source, job)
  return new Uint8Array(source.data)
}

export function padRustStyleSource(source: LayerStyleRaster, job: RustPixelPocStyleSourceLayout): Uint8Array<ArrayBuffer> {
  validateStyleSource(source, job)
  const padded = new Uint8Array(job.width * job.height * 4), rowBytes = source.width * 4
  for (let y = 0; y < source.height; y++) {
    padded.set(source.data.subarray(y * rowBytes, (y + 1) * rowBytes),
      ((y + job.insets.top) * job.width + job.insets.left) * 4)
  }
  return padded
}

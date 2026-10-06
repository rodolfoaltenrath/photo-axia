import { layerStyleInsets, type LayerStyleRaster, type LayerStyleRenderQuality } from './layerStyleCompositor.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from './layerStyles.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { prepareRustStyleStages, styleStagesLayout } from './rustPixelPocStages.ts'
import type { RustPixelPocPatternRaster, RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { LayerStyleConfig, LayerStyleGlobalLight } from '../types/editor.ts'

export interface RustPixelPocStyleInput {
  sourceIdentity: string
  sourceWidth: number
  sourceHeight: number
  styles: LayerStyleConfig
  globalLight: LayerStyleGlobalLight
  resolutionScale?: number
  quality?: LayerStyleRenderQuality
  patterns?: ReadonlyMap<string, RustPixelPocPatternRaster>
  /** Coordinates in the padded raster, not the document. */
  region?: RustPixelPocRegion
}

export function prepareRustStyleJob(input: RustPixelPocStyleInput) {
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
  const region = input.region ? { ...input.region } : { x: 0, y: 0, width, height }
  const plan = prepareRustStyleStages(styles, light, scale, input.patterns)
  const layout = styleStagesLayout(plan, width, height, region)
  const sourceKey = JSON.stringify([input.sourceIdentity, sourceWidth, sourceHeight,
    insets.left, insets.top, insets.right, insets.bottom, scale, quality])
  return { sourceKey, sourceWidth, sourceHeight, width, height, insets, scale, quality, region, plan,
    offsetX: insets.left ? -insets.left : 0, offsetY: insets.top ? -insets.top : 0,
    preparationBytes, ...layout }
}

export type RustPixelPocStyleJob = ReturnType<typeof prepareRustStyleJob>

export function padRustStyleSource(source: LayerStyleRaster, job: RustPixelPocStyleJob): Uint8Array {
  if (source.width !== job.sourceWidth || source.height !== job.sourceHeight ||
      !(source.data instanceof Uint8ClampedArray) || source.data.byteLength !== source.width * source.height * 4) {
    throw new RustPixelPocError('invalid-input')
  }
  const padded = new Uint8Array(job.width * job.height * 4), rowBytes = source.width * 4
  for (let y = 0; y < source.height; y++) {
    padded.set(source.data.subarray(y * rowBytes, (y + 1) * rowBytes),
      ((y + job.insets.top) * job.width + job.insets.left) * 4)
  }
  return padded
}

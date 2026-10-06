import type { LayerStyleWorkerSource } from './layerStyleRenderProtocol.ts'
import { prepareRustStyleAssets, validateRustStyleMediaSource } from './rustPixelPocMedia.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { rustStylePngLayout } from './rustPixelPocPng.ts'
import { prepareRustStyleSourceLayout, type RustPixelPocStyleSourceInput } from './rustPixelPocStylePreparation.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'

const MiB = 1024 * 1024
const METADATA_BYTES = 4 * MiB
export const RUST_STYLE_WORKING_BYTES = 96 * MiB

export interface RustPixelPocServiceRequest extends RustPixelPocStyleSourceInput {
  source: LayerStyleWorkerSource
  patterns?: Record<string, Blob>
  region?: RustPixelPocRegion
}

export interface RustPixelPocServiceLimits {
  maxResidentBytes?: number
  maxResultBytes?: number
  maxLeases?: number
  taskTimeoutMs?: number
}

export function rustPixelPocServiceLimits(input: RustPixelPocServiceLimits = {}): Required<RustPixelPocServiceLimits> {
  const limits = { maxResidentBytes: input.maxResidentBytes ?? 256 * MiB,
    maxResultBytes: input.maxResultBytes ?? 64 * MiB, maxLeases: input.maxLeases ?? 64,
    taskTimeoutMs: input.taskTimeoutMs ?? 30_000 }
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0) ||
      limits.maxResidentBytes < RUST_STYLE_WORKING_BYTES || limits.maxResidentBytes > 512 * MiB ||
      limits.maxResultBytes > 64 * MiB || limits.maxLeases > 64 || limits.taskTimeoutMs > 60_000) {
    throw new RustPixelPocError('invalid-input')
  }
  return limits
}

function metadataBytes(value: unknown) {
  let bytes = 0, nodes = 0
  function visit(item: unknown, depth: number) {
    if (++nodes > 100_000 || depth > 16) throw new RustPixelPocError('memory-limit')
    if (typeof item === 'string') bytes += item.length * 2
    else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) { bytes += key.length * 2; visit(child, depth + 1) }
    } else bytes += 8
    if (bytes > METADATA_BYTES) throw new RustPixelPocError('memory-limit')
  }
  visit(value, 0)
  return bytes
}

export function snapshotRustPixelPocStyleRequest(input: RustPixelPocServiceRequest) {
  if (!input || typeof input.sourceIdentity !== 'string' || input.sourceIdentity.length > 4096) {
    throw new RustPixelPocError('invalid-input')
  }
  validateRustStyleMediaSource(input.source)
  const layout = prepareRustStyleSourceLayout(input)
  const region = input.region ? { ...input.region } : { x: 0, y: 0, width: layout.width, height: layout.height }
  if (![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) ||
      region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
      region.x + region.width > layout.width || region.y + region.height > layout.height) throw new RustPixelPocError('invalid-input')
  const patterns = { ...input.patterns }
  const assets = prepareRustStyleAssets(layout, patterns)
  rustStylePngLayout(region.width, region.height, layout.width * layout.height * 4 + assets.decodedBytes)
  const metadata = { sourceIdentity: input.sourceIdentity, styles: layout.styles, globalLight: layout.light,
    text: input.source.type === 'text' ? input.source.text : null, region }
  const bytes = metadataBytes(metadata) + metadataBytes(Object.keys(patterns))
  if (bytes > METADATA_BYTES) throw new RustPixelPocError('memory-limit')
  const copy = structuredClone(metadata)
  const source: LayerStyleWorkerSource = input.source.type === 'raster' ? { type: 'raster', blob: input.source.blob } :
    { type: 'text', text: copy.text!, drawScaleX: input.source.drawScaleX, drawScaleY: input.source.drawScaleY }
  const request: RustPixelPocServiceRequest = { sourceIdentity: copy.sourceIdentity, sourceWidth: layout.sourceWidth,
    sourceHeight: layout.sourceHeight, styles: copy.styles, globalLight: copy.globalLight,
    resolutionScale: layout.scale, quality: layout.quality, source, region, patterns }
  return { request, inputBytes: bytes + (source.type === 'raster' ? source.blob.size : 0) +
    Object.values(patterns).reduce((total, blob) => total + blob.size, 0) }
}

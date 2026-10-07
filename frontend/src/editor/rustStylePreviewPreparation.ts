import { RustPixelPocError } from './rustPixelPocError.ts'
import { validateRustStyleMediaSource } from './rustPixelPocMedia.ts'
import { rustStylePreviewPatternAssets } from './rustStylePreview.ts'
import type { LayerStylePreviewRequest } from './rustStylePreviewProtocol.ts'
import type { RustPixelPocServiceRequest } from './rustPixelPocStyleService.ts'
import { RustStylePreviewMediaCache, type RustStyleMediaReader } from './rustStylePreviewMediaCache.ts'

export async function prepareRustStylePreviewMedia(request: LayerStylePreviewRequest, signal: AbortSignal,
  sourceIdentity: string, cache: RustStylePreviewMediaCache, reader?: RustStyleMediaReader)
  : Promise<Pick<RustPixelPocServiceRequest, 'source' | 'patterns'>> {
  signal.throwIfAborted()
  if (!request.sourceUrl) {
    if (typeof request.source === 'function') throw new RustPixelPocError('invalid-input')
    validateRustStyleMediaSource(request.source instanceof Blob ? { type: 'raster', blob: request.source } : request.source)
  }
  const patterns: Record<string, Blob> = Object.create(null)
  let encodedBytes = 0
  for (const asset of rustStylePreviewPatternAssets(request)) {
    const blob = await cache.read(`pattern:${asset.id}`, `${asset.width}x${asset.height}`, asset.sourceUrl, signal,
      64 * 1024 * 1024 - encodedBytes, reader)
    encodedBytes += blob.size
    patterns[asset.id] = blob
  }
  if (request.sourceUrl) return { source: { type: 'raster', blob: await cache.read(`source:${request.consumerId}`,
    sourceIdentity, request.sourceUrl, signal, 64 * 1024 * 1024, reader) }, patterns }
  if (request.source instanceof Blob) return { source: { type: 'raster', blob: request.source }, patterns }
  if (typeof request.source === 'function') throw new RustPixelPocError('invalid-input')
  return { source: request.source, patterns }
}

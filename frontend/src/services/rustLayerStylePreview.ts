import { RustStylePreview, rustStylePreviewPatternAssets } from '../editor/rustStylePreview.ts'
import { RustPixelPocError } from '../editor/rustPixelPocError.ts'
import { renderLayerStyle } from './layerStyleCompositor.ts'
import { readRustStylePreviewBlob } from '../editor/rustStylePreviewMedia.ts'
import { validateRustStyleMediaSource } from '../editor/rustPixelPocMedia.ts'

export function createRustLayerStylePreview() {
  const preview = new RustStylePreview({
    createScheduler: async (limits, onChange) => (await import('./rustPixelPocStyleService.ts')).createRustPixelPocStyleScheduler(limits, onChange),
    fallback: renderLayerStyle,
    prepare: async (request, signal) => {
      if (!request.sourceUrl) {
        if (typeof request.source === 'function') throw new RustPixelPocError('invalid-input')
        validateRustStyleMediaSource(request.source instanceof Blob ? { type: 'raster', blob: request.source } : request.source)
      }
      const patterns: Record<string, Blob> = {}
      let encodedBytes = 0
      for (const asset of rustStylePreviewPatternAssets(request)) {
        const blob = await readRustStylePreviewBlob(asset.sourceUrl, signal, 64 * 1024 * 1024 - encodedBytes)
        encodedBytes += blob.size
        if (encodedBytes > 64 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
        patterns[asset.id] = blob
      }
      if (request.sourceUrl) return { source: { type: 'raster', blob: await readRustStylePreviewBlob(request.sourceUrl, signal) }, patterns }
      if (request.source instanceof Blob) return { source: { type: 'raster', blob: request.source }, patterns }
      if (typeof request.source === 'function') throw new RustPixelPocError('invalid-input')
      return { source: request.source, patterns }
    },
    onChange: () => { document.documentElement.dataset.axiaRustStylePreview = JSON.stringify(preview.stats) }
  })
  return preview
}

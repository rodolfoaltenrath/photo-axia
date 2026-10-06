import { RustStylePreview, rustStylePreviewPatternAssets } from '../editor/rustStylePreview.ts'
import { RustPixelPocError } from '../editor/rustPixelPocError.ts'
import { renderLayerStyle } from './layerStyleCompositor.ts'

async function readBlob(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new RustPixelPocError('invalid-input')
  const declared = Number(response.headers.get('content-length'))
  if (declared > 64 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  const blob = await response.blob()
  if (!blob.size || blob.size > 64 * 1024 * 1024) throw new RustPixelPocError(blob.size ? 'memory-limit' : 'invalid-input')
  return blob
}

export function createRustLayerStylePreview() {
  const preview = new RustStylePreview({
    createService: async () => (await import('./rustPixelPocStyleService.ts')).createRustPixelPocStyleService(),
    fallback: renderLayerStyle,
    prepare: async (request, signal) => {
      const patterns: Record<string, Blob> = {}
      let encodedBytes = 0
      for (const asset of rustStylePreviewPatternAssets(request)) {
        const blob = await readBlob(asset.sourceUrl, signal)
        encodedBytes += blob.size
        if (encodedBytes > 64 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
        patterns[asset.id] = blob
      }
      if (request.sourceUrl) return { source: { type: 'raster', blob: await readBlob(request.sourceUrl, signal) }, patterns }
      if (request.source instanceof Blob) return { source: { type: 'raster', blob: request.source }, patterns }
      if (typeof request.source === 'function') throw new RustPixelPocError('invalid-input')
      return { source: request.source, patterns }
    },
    onChange: () => { document.documentElement.dataset.axiaRustStylePreview = JSON.stringify(preview.stats) }
  })
  return preview
}

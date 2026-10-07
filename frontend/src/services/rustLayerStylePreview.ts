import { RustStylePreview } from '../editor/rustStylePreview.ts'
import { renderLayerStyle } from './layerStyleCompositor.ts'
import { RustStylePreviewMediaCache } from '../editor/rustStylePreviewMediaCache.ts'
import { prepareRustStylePreviewMedia } from '../editor/rustStylePreviewPreparation.ts'

export function createRustLayerStylePreview() {
  const mediaCache = new RustStylePreviewMediaCache()
  const preview = new RustStylePreview({
    createScheduler: async (limits, onChange) => (await import('./rustPixelPocStyleService.ts')).createRustPixelPocStyleScheduler(limits, onChange),
    fallback: renderLayerStyle,
    mediaCache,
    prepare: (request, signal, sourceIdentity) => prepareRustStylePreviewMedia(request, signal, sourceIdentity, mediaCache),
    onChange: () => { document.documentElement.dataset.axiaRustStylePreview = JSON.stringify(preview.stats) }
  })
  return preview
}

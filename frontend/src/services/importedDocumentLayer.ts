import { createImagePreview, editorPreviewSize, prepareImageSource, releasePreparedImage } from './imageImport'
import type { LayerItem } from '../types/editor'

export async function prepareImportedDocumentLayer(layer: LayerItem, previewPixels: number) {
  const asset = layer.image
  const transform = layer.transform
  if (!asset || !transform) throw new Error('A mídia não possui conteúdo visual válido.')
  const target = editorPreviewSize(asset, transform.width, transform.height, 1, typeof window === 'undefined' ? 1 : window.devicePixelRatio, previewPixels)
  let preview: Awaited<ReturnType<typeof createImagePreview>>
  try {
    preview = await createImagePreview(asset, target.width, target.height)
    await prepareImageSource(preview?.url ?? asset.sourceUrl)
    asset.previewUrl = preview?.url
    asset.previewWidth = preview?.width ?? asset.width
    asset.previewHeight = preview?.height ?? asset.height
  } catch (error) {
    if (preview?.url.startsWith('blob:')) URL.revokeObjectURL(preview.url)
    releasePreparedImage(preview?.url ?? asset.sourceUrl)
    throw error
  }
}

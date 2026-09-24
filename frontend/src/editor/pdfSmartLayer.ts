import { cloneSmartLayerContent } from './smartLayers.ts'
import type { ImportedImage, LayerItem, SmartLayerContent } from '../types/editor.ts'

/**
 * Troca somente o raster de cache de uma página PDF preservada. A camada
 * externa continua com a mesma transformação física no documento.
 */
export function replacePDFSmartLayerCache(content: SmartLayerContent, image: ImportedImage) {
  if (!content.pdf) throw new Error('Esta camada não possui uma origem PDF preservada.')
  const next = cloneSmartLayerContent(content)
  if (!next?.pdf) throw new Error('Não foi possível preparar a camada PDF.')

  const cache = findPDFCacheLayer(next)
  if (!cache?.image || !cache.transform) {
    throw new Error('O cache original desta página PDF não está disponível para ser re-renderizado.')
  }

  cache.image = {
    width: image.width,
    height: image.height,
    mimeType: image.mimeType,
    sourceUrl: image.sourceUrl,
    byteSize: image.byteSize,
    resolutionDpiX: image.resolutionDpiX,
    resolutionDpiY: image.resolutionDpiY,
    resolutionSource: 'pdf-render'
  }
  cache.transform = { ...cache.transform, width: image.width, height: image.height }
  next.pdf.cacheLayerId = cache.id
  next.width = image.width
  next.height = image.height
  next.resolutionDpi = Math.max(1, Math.round(image.resolutionDpiX ?? image.resolutionDpiY ?? next.resolutionDpi))
  next.revision = Math.max(1, Math.floor(next.revision) + 1)
  return next
}

function findPDFCacheLayer(content: SmartLayerContent): LayerItem | undefined {
  const cacheId = content.pdf?.cacheLayerId
  if (cacheId) {
    const cache = content.layers.find((layer) => layer.id === cacheId)
    if (cache) return cache
  }
  // Compatibilidade com projetos salvos antes do identificador do cache.
  return content.layers.find((layer) => layer.kind === 'pixel' && layer.image?.resolutionSource === 'pdf-render')
}

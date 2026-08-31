import { MAX_DOCUMENT_DIMENSION, MAX_DOCUMENT_PIXELS } from './document.ts'
import { createLayerStyleConfig } from './layerStyles.ts'
import type { DocumentBackground, ImportedImage, LayerItem, NewDocumentSettings } from '../types/editor.ts'

export const MEDIA_DOCUMENT_FALLBACK_DPI = 72

function validDocumentDpi(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 2400
}

export function importedImageDocumentDpi(image: ImportedImage) {
  if (validDocumentDpi(image.resolutionDpiX)) return Math.round(image.resolutionDpiX!)
  if (validDocumentDpi(image.resolutionDpiY)) return Math.round(image.resolutionDpiY!)
  return MEDIA_DOCUMENT_FALLBACK_DPI
}

export function validateImportedImageDocument(image: ImportedImage) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
    return 'A mídia não possui dimensões válidas.'
  }
  if (image.width > MAX_DOCUMENT_DIMENSION || image.height > MAX_DOCUMENT_DIMENSION) {
    return `A mídia excede o limite de ${MAX_DOCUMENT_DIMENSION.toLocaleString('pt-BR')} px por dimensão.`
  }
  if (image.width * image.height > MAX_DOCUMENT_PIXELS) {
    return 'A mídia excede o limite de 64 megapixels por documento.'
  }
  return ''
}

export function importedImageDocumentSettings(
  image: ImportedImage,
  documentName = image.name,
  background: DocumentBackground = 'transparent'
): NewDocumentSettings {
  return {
    name: documentName.trim() || 'Imagem',
    unit: 'px',
    width: image.width,
    height: image.height,
    resolutionDpi: importedImageDocumentDpi(image),
    background
  }
}

export function createNativeImageLayer(image: ImportedImage): LayerItem {
  return {
    id: image.id || crypto.randomUUID(),
    name: image.name.trim() || 'Imagem',
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind: 'image',
    styles: createLayerStyleConfig(),
    image: {
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
      sourceUrl: image.sourceUrl,
      byteSize: image.byteSize,
      resolutionDpiX: image.resolutionDpiX,
      resolutionDpiY: image.resolutionDpiY,
      resolutionSource: image.resolutionSource
    },
    transform: {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
      rotation: 0
    }
  }
}

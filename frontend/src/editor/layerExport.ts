import type { DocumentBackground, LayerItem } from '../types/editor.ts'

export function layerCanExportPNG(layer: LayerItem | undefined, background: DocumentBackground) {
  if (!layer || layer.kind === 'adjustment') return false
  if (layer.kind === 'background' && !layer.image) return background !== 'transparent'
  if (!layer.transform) return false
  return Boolean(layer.image || layer.text || layer.shape || (layer.kind === 'smart' && layer.smart))
}

function safeFilePart(value: string, fallback: string, stripExtension = false) {
  const cleaned = (stripExtension ? value.replace(/\.[^.]+$/, '') : value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  const result = cleaned || fallback
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(result) ? `_${result}` : result
}

export function quickLayerExportName(documentName: string, layerName: string) {
  const documentPart = safeFilePart(documentName, 'imagem', true)
  const layerPart = safeFilePart(layerName, 'camada')
  return `${documentPart} - ${layerPart}`.slice(0, 120).replace(/[. ]+$/g, '') || 'imagem - camada'
}

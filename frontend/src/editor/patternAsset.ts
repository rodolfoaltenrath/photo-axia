import { LAYER_STYLE_LIMITS } from './layerStyles.ts'
import type { LayerStylePatternAsset } from '../types/editor.ts'

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
type AllowedPatternMimeType = typeof ALLOWED_MIME_TYPES[number]

export class PatternAssetError extends Error {}

let fallbackPatternSequence = 0

function patternAssetId() {
  if (globalThis.crypto?.randomUUID) return `pattern-${globalThis.crypto.randomUUID()}`
  fallbackPatternSequence += 1
  return `pattern-${Date.now().toString(36)}-${fallbackPatternSequence.toString(36)}`
}

function isAllowedMimeType(value: string): value is AllowedPatternMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value)
}

export async function createLayerStylePatternAssetFromFile(file: File): Promise<LayerStylePatternAsset> {
  if (!isAllowedMimeType(file.type)) {
    throw new PatternAssetError('Formato de imagem não suportado para padrão. Use PNG, JPEG ou WEBP.')
  }
  let width: number
  let height: number
  const bitmap = await createImageBitmap(file)
  try {
    width = bitmap.width
    height = bitmap.height
  } finally {
    bitmap.close()
  }
  if (
    width < 1 || height < 1 ||
    width > LAYER_STYLE_LIMITS.patternDimension || height > LAYER_STYLE_LIMITS.patternDimension ||
    width * height > LAYER_STYLE_LIMITS.patternPixels
  ) {
    throw new PatternAssetError('Dimensões da imagem excedem o limite permitido para padrões.')
  }
  const sourceUrl = URL.createObjectURL(file)
  return {
    id: patternAssetId(),
    name: file.name.trim() ? file.name.slice(0, 256) : 'Padrão',
    width,
    height,
    mimeType: file.type,
    sourceUrl,
    byteSize: file.size
  }
}

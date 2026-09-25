export type ExportFormat = 'png' | 'jpeg' | 'webp'
export type PngCompressionEffort = 'fast' | 'balanced' | 'smallest'

export interface ExportSettings {
  format: ExportFormat
  quality?: number
  pngEffort?: PngCompressionEffort
  resolutionDpi: number
  preserveMetadata: boolean
  matteColor?: string
}

export interface ExportFormatCapabilities {
  mimeType: string
  extension: string
  supportsAlpha: boolean
  supportsLossyQuality: boolean
}

export const EXPORT_FORMAT_CAPABILITIES: Record<ExportFormat, ExportFormatCapabilities> = {
  png: { mimeType: 'image/png', extension: '.png', supportsAlpha: true, supportsLossyQuality: false },
  jpeg: { mimeType: 'image/jpeg', extension: '.jpg', supportsAlpha: false, supportsLossyQuality: true },
  webp: { mimeType: 'image/webp', extension: '.webp', supportsAlpha: true, supportsLossyQuality: true }
}

export const MAX_EXPORT_DIMENSION = 16_384
export const MAX_EXPORT_PIXELS = 64_000_000

/** Dimensões reais do raster de saída para a resolução escolhida na exportação. */
export function exportPixelSize(
  width: number,
  height: number,
  documentDpi: number,
  exportDpi: number
) {
  const sourceDpi = Math.max(1, Number.isFinite(documentDpi) ? documentDpi : 72)
  const targetDpi = Math.max(1, Number.isFinite(exportDpi) ? exportDpi : sourceDpi)
  const scale = targetDpi / sourceDpi
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale
  }
}

export function validateExportPixelSize(
  width: number,
  height: number,
  documentDpi: number,
  exportDpi: number
) {
  const size = exportPixelSize(width, height, documentDpi, exportDpi)
  if (size.width > MAX_EXPORT_DIMENSION || size.height > MAX_EXPORT_DIMENSION) {
    return `A resolução escolhida ultrapassa ${MAX_EXPORT_DIMENSION.toLocaleString('pt-BR')} px em uma das dimensões.`
  }
  if (size.width * size.height > MAX_EXPORT_PIXELS) {
    return 'A resolução escolhida ultrapassa o limite seguro de 64 megapixels para exportação.'
  }
  return ''
}

export function normalizeExportSettings(settings: Partial<ExportSettings>): ExportSettings {
  const format: ExportFormat = settings.format && settings.format in EXPORT_FORMAT_CAPABILITIES
    ? settings.format
    : 'png'
  const resolutionDpi = Number.isFinite(settings.resolutionDpi)
    ? Math.min(2400, Math.max(1, Math.round(settings.resolutionDpi!)))
    : 72
  const normalized: ExportSettings = {
    format,
    resolutionDpi,
    preserveMetadata: settings.preserveMetadata !== false
  }
  if (format === 'png') normalized.pngEffort = settings.pngEffort ?? 'balanced'
  else normalized.quality = Math.min(1, Math.max(0.01, settings.quality ?? 0.9))
  if (!EXPORT_FORMAT_CAPABILITIES[format].supportsAlpha) {
    normalized.matteColor = /^#[0-9a-f]{6}$/i.test(settings.matteColor ?? '') ? settings.matteColor : '#ffffff'
  }
  return normalized
}

export function exportFilename(name: string, format: ExportFormat) {
  const extension = EXPORT_FORMAT_CAPABILITIES[format].extension
  const clean = name.trim().replace(/\.(gif|pdf|png|jpe?g|webp)$/i, '') || 'imagem'
  return `${clean}${extension}`
}

export function pngPixelsPerMeter(dpi: number) {
  if (!Number.isFinite(dpi)) return 2835
  return Math.max(39, Math.min(94_488, Math.round(dpi / 0.0254)))
}

import type { DocumentUnit, NewDocumentSettings } from '../types/editor'

export const MAX_DOCUMENT_DIMENSION = 16_384
export const MAX_DOCUMENT_PIXELS = 64_000_000

export interface DocumentPreset extends NewDocumentSettings {
  id: string
  category: 'screen' | 'photo' | 'print' | 'saved'
  label: string
}

export const BUILTIN_DOCUMENT_PRESETS: DocumentPreset[] = [
  { id: 'screen-full-hd', category: 'screen', label: 'Full HD', name: 'Sem título', unit: 'px', width: 1920, height: 1080, resolutionDpi: 72, background: 'transparent' },
  { id: 'screen-4k', category: 'screen', label: '4K UHD', name: 'Sem título', unit: 'px', width: 3840, height: 2160, resolutionDpi: 72, background: 'transparent' },
  { id: 'screen-square', category: 'screen', label: 'Quadrado', name: 'Sem título', unit: 'px', width: 1080, height: 1080, resolutionDpi: 72, background: 'transparent' },
  { id: 'photo-10x15', category: 'photo', label: 'Foto 10 × 15', name: 'Sem título', unit: 'cm', width: 10, height: 15, resolutionDpi: 300, background: 'white' },
  { id: 'photo-13x18', category: 'photo', label: 'Foto 13 × 18', name: 'Sem título', unit: 'cm', width: 13, height: 18, resolutionDpi: 300, background: 'white' },
  { id: 'print-a4', category: 'print', label: 'A4', name: 'Sem título', unit: 'cm', width: 21, height: 29.7, resolutionDpi: 300, background: 'white' },
  { id: 'print-a3', category: 'print', label: 'A3', name: 'Sem título', unit: 'cm', width: 29.7, height: 42, resolutionDpi: 300, background: 'white' }
]

export function pixelsPerDocumentUnit(unit: DocumentUnit, resolutionDpi: number) {
  const dpi = Math.max(1, resolutionDpi || 72)
  if (unit === 'in') return dpi
  if (unit === 'cm') return dpi / 2.54
  if (unit === 'mm') return dpi / 25.4
  return 1
}

export function documentPixelSize(settings: Pick<NewDocumentSettings, 'unit' | 'width' | 'height' | 'resolutionDpi'>) {
  const factor = pixelsPerDocumentUnit(settings.unit, settings.resolutionDpi)
  return {
    width: Math.max(1, Math.round(settings.width * factor)),
    height: Math.max(1, Math.round(settings.height * factor))
  }
}

function roundedDimension(value: number, unit: DocumentUnit) {
  if (unit === 'px') return Math.max(1, Math.round(value))
  const decimals = unit === 'mm' ? 3 : 4
  return Number(Math.max(0.0001, value).toFixed(decimals))
}

export function convertDocumentUnit(
  settings: Pick<NewDocumentSettings, 'unit' | 'width' | 'height' | 'resolutionDpi'>,
  nextUnit: DocumentUnit
) {
  if (settings.unit === nextUnit) {
    return { unit: nextUnit, width: settings.width, height: settings.height }
  }
  const currentFactor = pixelsPerDocumentUnit(settings.unit, settings.resolutionDpi)
  const nextFactor = pixelsPerDocumentUnit(nextUnit, settings.resolutionDpi)
  return {
    unit: nextUnit,
    width: roundedDimension((settings.width * currentFactor) / nextFactor, nextUnit),
    height: roundedDimension((settings.height * currentFactor) / nextFactor, nextUnit)
  }
}

export function validateDocumentSettings(settings: NewDocumentSettings) {
  if (!Number.isFinite(settings.width) || !Number.isFinite(settings.height) || settings.width <= 0 || settings.height <= 0) {
    return 'Informe dimensões válidas.'
  }
  if (!Number.isFinite(settings.resolutionDpi) || settings.resolutionDpi < 1 || settings.resolutionDpi > 2400) {
    return 'A resolução deve estar entre 1 e 2.400 pixels por polegada.'
  }
  const pixels = documentPixelSize(settings)
  if (pixels.width > MAX_DOCUMENT_DIMENSION || pixels.height > MAX_DOCUMENT_DIMENSION) {
    return 'Cada dimensão pode ter no máximo 16.384 px.'
  }
  if (pixels.width * pixels.height > MAX_DOCUMENT_PIXELS) {
    return 'O documento pode ter no máximo 64 megapixels.'
  }
  return ''
}

export function parseCustomDocumentPresets(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): DocumentPreset[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const preset = candidate as Partial<DocumentPreset>
    if (preset.category !== 'saved' ||
      typeof preset.id !== 'string' || !preset.id.trim() || preset.id.length > 80 ||
      typeof preset.label !== 'string' || !preset.label.trim() || preset.label.length > 80 ||
      typeof preset.name !== 'string' || preset.name.length > 160 ||
      !['px', 'cm', 'mm', 'in'].includes(preset.unit ?? '') ||
      !['transparent', 'white', 'black'].includes(preset.background ?? '') ||
      typeof preset.width !== 'number' || typeof preset.height !== 'number' ||
      typeof preset.resolutionDpi !== 'number' ||
      validateDocumentSettings(preset as NewDocumentSettings)) return []
    return [{
      ...preset,
      id: preset.id.trim(),
      label: preset.label.trim(),
      name: preset.name.trim() || 'Sem título'
    } as DocumentPreset]
  }).filter((preset, index, presets) =>
    presets.findIndex((candidate) => candidate.id === preset.id) === index
  ).slice(0, 20)
}

export function documentBaseMemoryBytes(settings: NewDocumentSettings) {
  const pixels = documentPixelSize(settings)
  return pixels.width * pixels.height * 4
}

export interface DocumentPhysicalSize {
  widthInches: number
  heightInches: number
  widthCentimeters: number
  heightCentimeters: number
}

/**
 * Returns the physical size represented by the final raster at the selected PPI.
 * Pixel dimensions never change here: PPI only describes their physical density.
 */
export function documentPhysicalSize(
  settings: Pick<NewDocumentSettings, 'unit' | 'width' | 'height' | 'resolutionDpi'>
): DocumentPhysicalSize {
  const pixels = documentPixelSize(settings)
  const dpi = Math.max(1, Number.isFinite(settings.resolutionDpi) ? settings.resolutionDpi : 72)
  const widthInches = pixels.width / dpi
  const heightInches = pixels.height / dpi
  return {
    widthInches,
    heightInches,
    widthCentimeters: widthInches * 2.54,
    heightCentimeters: heightInches * 2.54
  }
}

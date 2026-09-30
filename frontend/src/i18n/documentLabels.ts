import { BUILTIN_DOCUMENT_PRESETS, MAX_DOCUMENT_DIMENSION, MAX_DOCUMENT_PIXELS, type DocumentPreset, type DocumentSettingsErrorCode } from '../editor/document.ts'
import { formatOfficialMessage, type MessageKey, type OfficialLocale } from './catalogs.ts'

const BUILTIN_PRESET_KEYS: Readonly<Record<string, MessageKey>> = {
  'screen-full-hd': 'document.preset.screen-full-hd',
  'screen-4k': 'document.preset.screen-4k',
  'screen-square': 'document.preset.screen-square',
  'photo-10x15': 'document.preset.photo-10x15',
  'photo-13x18': 'document.preset.photo-13x18',
  'print-a4': 'document.preset.print-a4',
  'print-a3': 'document.preset.print-a3'
}

export function documentPresetDisplayLabel(locale: OfficialLocale, preset: DocumentPreset): string {
  // Saved labels belong to the user, even if their IDs happen to match a built-in.
  if (preset.category === 'saved') return preset.label
  const key = BUILTIN_PRESET_KEYS[preset.id]
  return key ? formatOfficialMessage(locale, key) : preset.label
}

export function documentSettingsErrorMessage(locale: OfficialLocale, code: DocumentSettingsErrorCode): string {
  switch (code) {
    case '': return ''
    case 'invalid-dimensions': return formatOfficialMessage(locale, 'document.error.dimensions')
    case 'invalid-dpi': return formatOfficialMessage(locale, 'document.error.dpi', { maximum: 2400 })
    case 'dimension-limit': return formatOfficialMessage(locale, 'document.error.dimensionLimit', { maximum: MAX_DOCUMENT_DIMENSION })
    case 'pixel-limit': return formatOfficialMessage(locale, 'document.error.pixelLimit', { maximum: MAX_DOCUMENT_PIXELS / 1_000_000 })
  }
}

// Keep this assertion close to the mapping: adding a built-in preset must add a translated label.
export function builtInDocumentPresetLabelsComplete(): boolean {
  return BUILTIN_DOCUMENT_PRESETS.every((preset) => Object.prototype.hasOwnProperty.call(BUILTIN_PRESET_KEYS, preset.id))
}

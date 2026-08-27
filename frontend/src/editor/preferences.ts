export const AUTO_SELECT_LAYER_PREFERENCE = 'axia:auto-select-layer'

interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readAutoSelectLayerPreference(storage?: PreferenceStorage | null) {
  if (!storage) return true
  try {
    const stored = storage.getItem(AUTO_SELECT_LAYER_PREFERENCE)
    if (stored === 'false') return false
    if (stored === 'true') return true
  } catch {
    // Armazenamento indisponível: mantém o padrão seguro da ferramenta.
  }
  return true
}

export function writeAutoSelectLayerPreference(
  storage: PreferenceStorage | null | undefined,
  enabled: boolean
) {
  if (!storage) return false
  try {
    storage.setItem(AUTO_SELECT_LAYER_PREFERENCE, String(enabled))
    return true
  } catch {
    return false
  }
}

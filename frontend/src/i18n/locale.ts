export const OFFICIAL_LOCALES = ['pt-BR', 'en-US', 'zh-Hans'] as const
export const LANGUAGE_PREFERENCE_KEY = 'axia:language'

interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function canonicalLanguageTag(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 64) return undefined
  try {
    return Intl.getCanonicalLocales(value)[0]
  } catch {
    return undefined
  }
}

export function readLanguagePreference(storage?: PreferenceStorage | null): string {
  try {
    const value = storage?.getItem(LANGUAGE_PREFERENCE_KEY)
    return value === 'auto' ? 'auto' : canonicalLanguageTag(value) ?? 'auto'
  } catch {
    return 'auto'
  }
}

export function writeLanguagePreference(storage: PreferenceStorage | null | undefined, value: string): boolean {
  const preference = value === 'auto' ? value : canonicalLanguageTag(value)
  if (!storage || !preference) return false
  try {
    storage.setItem(LANGUAGE_PREFERENCE_KEY, preference)
    return true
  } catch {
    return false
  }
}

function matchLanguage(language: string, available: ReadonlySet<string>): string | undefined {
  const tag = canonicalLanguageTag(language)
  if (!tag) return undefined
  if (available.has(tag)) return tag
  if (/^zh-(TW|HK|MO)(?:-|$)/i.test(tag) && available.has('zh-Hant')) return 'zh-Hant'

  const parts = tag.split('-')
  while (parts.length > 1) {
    parts.pop()
    const parent = parts.join('-')
    if (available.has(parent)) return parent
  }

  if (tag === 'zh' || /^zh-(Hans|CN|SG)(?:-|$)/i.test(tag)) return 'zh-Hans'
  if (/^pt(?:-|$)/i.test(tag)) return 'pt-BR'
  if (/^en(?:-|$)/i.test(tag)) return 'en-US'
  return undefined
}

/** A lista do SO deve vir do desktop; navigator.languages é apenas fallback. */
export function resolveLanguage(
  preference: string,
  systemLanguages: readonly string[],
  externalLocales: readonly string[] = []
): string {
  const available = new Set<string>(OFFICIAL_LOCALES)
  for (const locale of externalLocales) {
    const tag = canonicalLanguageTag(locale)
    if (tag) available.add(tag)
  }
  if (preference !== 'auto') {
    const chosen = matchLanguage(preference, available)
    if (chosen) return chosen
  }
  for (const language of systemLanguages) {
    const chosen = matchLanguage(language, available)
    if (chosen) return chosen
  }
  return 'en-US'
}

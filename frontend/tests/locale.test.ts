import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LANGUAGE_PREFERENCE_KEY,
  canonicalLanguageTag,
  preferredLanguageCandidates,
  readLanguagePreference,
  resolveLanguage,
  writeLanguagePreference
} from '../src/i18n/locale.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { values.set(key, value) },
    value: (key: string) => values.get(key)
  }
}

test('preferência ausente ou inválida mantém modo automático', () => {
  assert.equal(readLanguagePreference(undefined), 'auto')
  assert.equal(readLanguagePreference(memoryStorage({ [LANGUAGE_PREFERENCE_KEY]: '??' })), 'auto')
  assert.equal(canonicalLanguageTag('zh-cn'), 'zh-CN')
})

test('lista do SO prevalece sobre WebView e rejeita entradas inválidas/duplicadas', () => {
  assert.deepEqual(preferredLanguageCandidates(['pt_BR', 'pt-BR', 'zh-CN', '??'], ['en-US']), ['pt-BR', 'zh-CN'])
  assert.deepEqual(preferredLanguageCandidates([], ['en-US', 'en-us', 'fr-FR']), ['en-US', 'fr-FR'])
  assert.deepEqual(preferredLanguageCandidates(['??'], ['zh-TW']), ['zh-TW'])
  assert.deepEqual(preferredLanguageCandidates(null, []), [])
})

test('grava idioma manual e tolera armazenamento indisponível', () => {
  const storage = memoryStorage()
  assert.equal(writeLanguagePreference(storage, 'pt-br'), true)
  assert.equal(storage.value(LANGUAGE_PREFERENCE_KEY), 'pt-BR')
  assert.equal(readLanguagePreference(storage), 'pt-BR')
  assert.equal(writeLanguagePreference(storage, 'auto'), true)
  assert.equal(readLanguagePreference(storage), 'auto')
  assert.equal(writeLanguagePreference(storage, '??'), false)
  const blocked = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') }
  }
  assert.equal(readLanguagePreference(blocked), 'auto')
  assert.equal(writeLanguagePreference(blocked, 'en-US'), false)
})

test('idioma manual tem prioridade; idioma indisponível respeita preferência do SO', () => {
  assert.equal(resolveLanguage('pt-BR', ['en-US']), 'pt-BR')
  assert.equal(resolveLanguage('fr-FR', ['zh-CN']), 'zh-Hans')
  assert.equal(resolveLanguage('auto', ['fr-FR', 'pt-PT']), 'pt-BR')
  assert.equal(resolveLanguage('auto', ['fr-FR']), 'en-US')
})

test('chinês tradicional não vira simplificado sem escolha explícita', () => {
  assert.equal(resolveLanguage('auto', ['zh-TW', 'en-GB']), 'en-US')
  assert.equal(resolveLanguage('auto', ['zh-Hant-HK']), 'en-US')
  assert.equal(resolveLanguage('auto', ['zh-SG']), 'zh-Hans')
  assert.equal(resolveLanguage('zh-Hans', ['zh-TW']), 'zh-Hans')
})

test('pacote externo pode ser escolhido e tem prioridade sobre aproximação oficial', () => {
  assert.equal(resolveLanguage('auto', ['es-MX', 'pt-BR'], ['es']), 'es')
  assert.equal(resolveLanguage('auto', ['zh-TW'], ['zh-Hant']), 'zh-Hant')
  assert.equal(resolveLanguage('auto', ['zh-HK'], ['zh-Hant']), 'zh-Hant')
  assert.equal(resolveLanguage('fr-FR', ['en-US'], ['fr-FR']), 'fr-FR')
})

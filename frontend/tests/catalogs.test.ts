import assert from 'node:assert/strict'
import test from 'node:test'
import { OFFICIAL_LOCALES } from '../src/i18n/locale.ts'
import {
  formatOfficialMessage,
  OFFICIAL_CATALOGS,
  type MessageKey,
  type MessageTemplate
} from '../src/i18n/catalogs.ts'

function placeholders(template: string) {
  return [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((match) => match[1]).sort()
}

function variants(value: MessageTemplate) {
  return typeof value === 'string' ? { other: value } : value
}

test('catálogos oficiais têm as mesmas chaves, formas e parâmetros nomeados', () => {
  const reference = OFFICIAL_CATALOGS['en-US']
  const keys = Object.keys(reference).sort() as MessageKey[]
  for (const locale of OFFICIAL_LOCALES) {
    const catalog = OFFICIAL_CATALOGS[locale]
    assert.deepEqual(Object.keys(catalog).sort(), keys, locale)
    for (const key of keys) {
      const expected = variants(reference[key])
      const actual = variants(catalog[key])
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${locale}:${key}`)
      for (const form of Object.keys(expected) as (keyof typeof expected)[]) {
        assert.equal(typeof actual[form], 'string', `${locale}:${key}:${form}`)
        assert.ok(actual[form].trim(), `${locale}:${key}:${form}`)
        assert.deepEqual(placeholders(actual[form]), placeholders(expected[form]), `${locale}:${key}:${form}`)
      }
    }
  }
})

test('formata parâmetros nomeados sem concatenar frases', () => {
  assert.equal(formatOfficialMessage('pt-BR', 'recent.open', { path: 'C:/foto.axia' }), 'Abrir C:/foto.axia')
  assert.equal(formatOfficialMessage('en-US', 'recent.thumbnailAlt', { name: 'Axia' }), 'Thumbnail of Axia')
  assert.equal(formatOfficialMessage('zh-Hans', 'recent.fileMissingAtPath', { path: 'foto.axia' }), '找不到文件：foto.axia')
  assert.throws(() => formatOfficialMessage('en-US', 'recent.open'), /Parâmetro path ausente/)
})

test('plurais e números seguem o locale sem alterar o valor original', () => {
  assert.equal(formatOfficialMessage('en-US', 'home.recent.count', { count: 1 }), '1 recent project')
  assert.equal(formatOfficialMessage('en-US', 'home.recent.count', { count: 2 }), '2 recent projects')
  assert.equal(formatOfficialMessage('pt-BR', 'home.recent.count', { count: 1 }), '1 projeto recente')
  assert.equal(formatOfficialMessage('pt-BR', 'home.recent.count', { count: 1200 }), '1.200 projetos recentes')
  assert.equal(formatOfficialMessage('zh-Hans', 'home.recent.count', { count: 2 }), '2 个最近的项目')
  assert.throws(() => formatOfficialMessage('pt-BR', 'home.recent.count'), /count ausente/)
})

test('menu preserva rótulos PT-BR e alterna singular/plural sem usar frases parciais', () => {
  assert.equal(formatOfficialMessage('pt-BR', 'menu.file.openImageDocument'), 'Abrir imagem como documento…')
  assert.equal(formatOfficialMessage('pt-BR', 'menu.edit.undoNamed', { action: 'Mover camada' }), 'Desfazer Mover camada')
  assert.equal(formatOfficialMessage('pt-BR', 'menu.layer.pasteStyle', { count: 1 }), 'Colar estilo da camada')
  assert.equal(formatOfficialMessage('pt-BR', 'menu.layer.pasteStyle', { count: 2 }), 'Colar estilo nas camadas')
  assert.equal(formatOfficialMessage('en-US', 'menu.layer.scaleEffects', { count: 2 }), 'Scale layer effects…')
})

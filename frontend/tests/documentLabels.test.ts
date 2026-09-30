import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_DOCUMENT_PRESETS, type DocumentPreset } from '../src/editor/document.ts'
import { OFFICIAL_LOCALES } from '../src/i18n/locale.ts'
import {
  builtInDocumentPresetLabelsComplete,
  documentPresetDisplayLabel,
  documentSettingsErrorMessage
} from '../src/i18n/documentLabels.ts'

test('todos os presets internos têm rótulo nos três idiomas sem alterar os valores persistidos', () => {
  assert.equal(builtInDocumentPresetLabelsComplete(), true)
  for (const locale of OFFICIAL_LOCALES) {
    for (const preset of BUILTIN_DOCUMENT_PRESETS) {
      assert.ok(documentPresetDisplayLabel(locale, preset))
      assert.equal(preset.name, 'Sem título')
    }
  }
  assert.equal(documentPresetDisplayLabel('en-US', BUILTIN_DOCUMENT_PRESETS[2]!), 'Square')
  assert.equal(documentPresetDisplayLabel('pt-BR', BUILTIN_DOCUMENT_PRESETS[2]!), 'Quadrado')
  assert.equal(documentPresetDisplayLabel('zh-Hans', BUILTIN_DOCUMENT_PRESETS[2]!), '正方形')
})

test('nome criado pelo usuário nunca é traduzido, mesmo com ID coincidente', () => {
  const saved: DocumentPreset = {
    ...BUILTIN_DOCUMENT_PRESETS[2]!,
    id: 'screen-square',
    category: 'saved',
    label: 'Meu quadrado'
  }
  for (const locale of OFFICIAL_LOCALES) {
    assert.equal(documentPresetDisplayLabel(locale, saved), 'Meu quadrado')
  }
})

test('erros de validação usam códigos estáveis e formatam os limites por idioma', () => {
  assert.equal(documentSettingsErrorMessage('pt-BR', ''), '')
  assert.equal(documentSettingsErrorMessage('pt-BR', 'invalid-dpi'), 'A resolução deve estar entre 1 e 2.400 pixels por polegada.')
  assert.equal(documentSettingsErrorMessage('en-US', 'invalid-dpi'), 'Resolution must be between 1 and 2,400 pixels per inch.')
  assert.equal(documentSettingsErrorMessage('zh-Hans', 'invalid-dimensions'), '请输入有效尺寸。')
  assert.equal(documentSettingsErrorMessage('en-US', 'dimension-limit'), 'Each dimension can be at most 16,384 px.')
  assert.equal(documentSettingsErrorMessage('en-US', 'pixel-limit'), 'The document can be at most 64 megapixels.')
})

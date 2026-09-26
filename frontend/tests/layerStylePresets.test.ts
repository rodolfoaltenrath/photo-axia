import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultLayerStylePresets,
  normalizeLayerStylePresets,
  presetStyles
} from '../src/editor/layerStylePresets.ts'
import { createDefaultLayerEffect, createLayerStyleConfig } from '../src/editor/layerStyles.ts'
import type { LayerEffect } from '../src/types/editor.ts'

test('oferece estilos iniciais completos sem compartilhar efeitos entre leituras', () => {
  const first = defaultLayerStylePresets()
  const second = defaultLayerStylePresets()

  assert.deepEqual(first.map((preset) => preset.name), ['Sombra suave', 'Contorno escuro', 'Brilho suave'])
  assert.ok(first.every((preset) => preset.builtin && preset.styles.effects.length === 1))
  first[0].styles.effects[0].opacity = 1
  assert.equal(second[0].styles.effects[0].opacity, 35)
})

test('normaliza a biblioteca, remove IDs duplicados e ordena por nome', () => {
  const styles = { ...createLayerStyleConfig(), effects: [createDefaultLayerEffect('color-overlay', 'overlay')] }
  const result = normalizeLayerStylePresets([
    { id: 'z', name: '  Zebra  ', styles, createdAt: 10, updatedAt: 20 },
    { id: 'a', name: 'Azul', styles },
    { id: 'a', name: 'Duplicado', styles },
    { id: '', name: 'Inválido', styles },
    null
  ])

  assert.deepEqual(result.map((preset) => preset.name), ['Azul', 'Zebra'])
  assert.equal(result[1].createdAt, 10)
  assert.equal(result[1].updatedAt, 20)
})

test('aplicar um estilo devolve snapshot profundo e preserva textura incorporada', () => {
  const pattern = createDefaultLayerEffect('pattern-overlay', 'pattern') as Extract<LayerEffect, { type: 'pattern-overlay' }>
  pattern.pattern = {
    id: 'asset', name: 'Textura', width: 1, height: 1,
    mimeType: 'image/png', sourceUrl: 'data:image/png;base64,AA=='
  }
  const preset = normalizeLayerStylePresets([{
    id: 'portable', name: 'Portátil',
    styles: { ...createLayerStyleConfig(), effects: [pattern] }
  }])[0]
  const copied = presetStyles(preset)

  const copiedPattern = copied.effects[0]
  const presetPattern = preset.styles.effects[0]
  assert.equal(copiedPattern.type, 'pattern-overlay')
  assert.equal(presetPattern.type, 'pattern-overlay')
  if (copiedPattern.type !== 'pattern-overlay' || presetPattern.type !== 'pattern-overlay') {
    assert.fail('O preset normalizado deve preservar a sobreposição de padrão.')
  }
  assert.equal(copiedPattern.pattern?.sourceUrl, 'data:image/png;base64,AA==')
  copiedPattern.pattern!.name = 'Alterada'
  assert.equal(presetPattern.pattern?.name, 'Textura')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearedLayerStyleChange,
  copyLayerStyleConfig,
  layerCanPasteStyle,
  pastedLayerStyleChange
} from '../src/editor/layerStyleOperations.ts'
import { createDefaultLayerEffect, createLayerStyleConfig } from '../src/editor/layerStyles.ts'

function layer(kind = 'image') {
  return {
    id: kind,
    name: kind,
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind,
    styles: createLayerStyleConfig(),
    image: kind === 'image'
      ? { width: 10, height: 10, mimeType: 'image/png', sourceUrl: 'blob:image' }
      : undefined
  }
}

test('cópia de estilo é profunda e preserva padrões sem compartilhar estado', () => {
  const effect = createDefaultLayerEffect('pattern-overlay', 'pattern-copy')
  effect.pattern = {
    id: 'pattern', name: 'Padrão', width: 2, height: 2,
    mimeType: 'image/png', sourceUrl: 'blob:pattern'
  }
  const source = { ...createLayerStyleConfig(), effects: [effect] }
  const copied = copyLayerStyleConfig(source)

  copied.effects[0].opacity = 25
  copied.effects[0].pattern.name = 'Alterado'
  assert.equal(source.effects[0].opacity, 100)
  assert.equal(source.effects[0].pattern.name, 'Padrão')
})

test('efeitos podem ser colados em raster, mas não ficam invisíveis em camada vetorial', () => {
  const styled = { ...createLayerStyleConfig(), effects: [createDefaultLayerEffect('color-overlay')] }
  assert.equal(layerCanPasteStyle(layer('image'), styled), true)
  assert.equal(layerCanPasteStyle(layer('shape'), styled), false)
  assert.equal(layerCanPasteStyle(layer('shape'), { ...createLayerStyleConfig(), fillOpacity: 45 }), true)
  assert.equal(layerCanPasteStyle(layer('image')), false)
})

test('colar e limpar geram snapshots independentes e ignoram operações sem mudança', () => {
  const target = layer()
  const styled = { ...createLayerStyleConfig(), fillOpacity: 60 }
  const pasted = pastedLayerStyleChange(target, styled)
  assert.equal(pasted.after.fillOpacity, 60)
  styled.fillOpacity = 10
  assert.equal(pasted.after.fillOpacity, 60)

  target.styles = pasted.after
  assert.equal(pastedLayerStyleChange(target, pasted.after), null)
  const cleared = clearedLayerStyleChange(target)
  assert.equal(cleared.after.fillOpacity, 100)
  target.styles = cleared.after
  assert.equal(clearedLayerStyleChange(target), null)
})

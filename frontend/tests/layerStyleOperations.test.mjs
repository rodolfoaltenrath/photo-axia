import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearedLayerStyleChange,
  clearedLayerStyleChanges,
  copyLayerStyleConfig,
  layerCanPasteStyle,
  layerStyleCanClear,
  layerStylesCanScale,
  normalizeLayerEffectScale,
  pastedLayerStyleChange,
  pastedLayerStyleChanges,
  scaledLayerStyleChange,
  scaledLayerStyleChanges,
  toggledLayerEffectVisibilityChange,
  toggledLayerStyleVisibilityChange
} from '../src/editor/layerStyleOperations.ts'
import { createDefaultLayerEffect, createLayerStyleConfig } from '../src/editor/layerStyles.ts'

function layer(kind = 'pixel') {
  return {
    id: kind,
    name: kind,
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind,
    styles: createLayerStyleConfig(),
    image: kind === 'pixel'
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
  assert.equal(layerCanPasteStyle(layer('pixel'), styled), true)
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

test('escala somente medidas em pixels e preserva percentuais, cores e fonte', () => {
  const target = layer()
  const shadow = createDefaultLayerEffect('drop-shadow', 'shadow')
  shadow.distance = 7
  shadow.size = 9
  shadow.spread = 35
  shadow.opacity = 62
  const stroke = createDefaultLayerEffect('stroke', 'stroke')
  stroke.size = 3
  stroke.paint = {
    type: 'pattern',
    angle: 0,
    scale: 80,
    linkWithLayer: true,
    pattern: { id: 'pattern', name: 'Padrão', width: 2, height: 2, mimeType: 'image/png', sourceUrl: 'blob:pattern' }
  }
  const bevel = createDefaultLayerEffect('bevel-emboss', 'bevel')
  bevel.size = 5
  bevel.soften = 2
  bevel.depth = 140
  target.styles = { ...createLayerStyleConfig(), fillOpacity: 75, effects: [shadow, stroke, bevel] }

  const change = scaledLayerStyleChange(target, 200)
  assert.equal(change.after.effects[0].distance, 14)
  assert.equal(change.after.effects[0].size, 18)
  assert.equal(change.after.effects[0].spread, 35)
  assert.equal(change.after.effects[0].opacity, 62)
  assert.equal(change.after.effects[1].size, 6)
  assert.equal(change.after.effects[1].paint.scale, 80)
  assert.equal(change.after.effects[2].size, 10)
  assert.equal(change.after.effects[2].soften, 4)
  assert.equal(change.after.effects[2].depth, 140)
  assert.equal(change.after.fillOpacity, 75)
  assert.equal(target.styles.effects[0].distance, 7)
})

test('normaliza a porcentagem, respeita limites e ignora estilos sem dimensões', () => {
  assert.equal(normalizeLayerEffectScale('50.4'), 50)
  assert.equal(normalizeLayerEffectScale(0), 1)
  assert.equal(normalizeLayerEffectScale(5_000), 1_000)
  assert.equal(normalizeLayerEffectScale('inválido'), 100)

  const target = layer()
  target.styles = { ...createLayerStyleConfig(), effects: [createDefaultLayerEffect('color-overlay')] }
  assert.equal(layerStylesCanScale(target.styles), false)
  assert.equal(scaledLayerStyleChange(target, 200), null)

  const shadow = createDefaultLayerEffect('drop-shadow', 'limited')
  shadow.distance = 900
  shadow.size = 200
  target.styles = { ...createLayerStyleConfig(), effects: [shadow] }
  assert.equal(layerStylesCanScale(target.styles), true)
  assert.equal(scaledLayerStyleChange(target, 100), null)
  const scaled = scaledLayerStyleChange(target, 200)
  assert.equal(scaled.after.effects[0].distance, 1_000)
  assert.equal(scaled.after.effects[0].size, 250)
})

test('operações em lote retornam somente mudanças e preservam cada snapshot', () => {
  const first = layer()
  first.id = 'first'
  const second = layer()
  second.id = 'second'
  const style = { ...createLayerStyleConfig(), fillOpacity: 55 }

  const pasted = pastedLayerStyleChanges([first, second], style)
  assert.deepEqual(pasted.map((change) => change.layerId), ['first', 'second'])
  pasted[0].after.fillOpacity = 10
  assert.equal(pasted[1].after.fillOpacity, 55)

  first.styles = style
  const cleared = clearedLayerStyleChanges([first, second])
  assert.deepEqual(cleared.map((change) => change.layerId), ['first'])

  const shadow = createDefaultLayerEffect('drop-shadow', 'batch-shadow')
  first.styles = { ...createLayerStyleConfig(), effects: [shadow] }
  second.styles = { ...createLayerStyleConfig(), effects: [createDefaultLayerEffect('color-overlay', 'overlay')] }
  const scaled = scaledLayerStyleChanges([first, second], 200)
  assert.deepEqual(scaled.map((change) => change.layerId), ['first'])
})

test('detecta estilos removíveis sem depender de efeitos ativos', () => {
  assert.equal(layerStyleCanClear(createLayerStyleConfig()), false)
  assert.equal(layerStyleCanClear({ ...createLayerStyleConfig(), enabled: false }), true)
  assert.equal(layerStyleCanClear({ ...createLayerStyleConfig(), fillOpacity: 99 }), true)
  assert.equal(layerStyleCanClear({ ...createLayerStyleConfig(), effects: [createDefaultLayerEffect('color-overlay')] }), true)
})

test('olhos geral e individual ocultam efeitos sem apagar configurações', () => {
  const target = layer()
  const shadow = createDefaultLayerEffect('drop-shadow', 'eye-shadow')
  shadow.distance = 18
  target.styles = { ...createLayerStyleConfig(), effects: [shadow] }

  const master = toggledLayerStyleVisibilityChange(target)
  assert.equal(master.after.enabled, false)
  assert.equal(master.after.effects[0].distance, 18)
  assert.equal(target.styles.enabled, true)

  const effect = toggledLayerEffectVisibilityChange(target, 'eye-shadow')
  assert.equal(effect.after.effects[0].enabled, false)
  assert.equal(effect.after.effects[0].distance, 18)
  assert.equal(toggledLayerEffectVisibilityChange(target, 'ausente'), null)
})

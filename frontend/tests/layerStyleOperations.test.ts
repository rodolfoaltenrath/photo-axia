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
import { image, layer as testLayer } from './editorTestFixtures.ts'
import type { LayerEffect, LayerEffectType, LayerItem, LayerKind } from '../src/types/editor.ts'

function layer(kind: LayerKind = 'pixel'): LayerItem {
  return testLayer({
    id: kind,
    name: kind,
    kind,
    image: kind === 'pixel' ? image() : undefined
  })
}

function effectOfType<Type extends LayerEffectType>(
  effects: LayerEffect[],
  index: number,
  type: Type
): Extract<LayerEffect, { type: Type }> {
  const effect = effects[index]
  assert.ok(hasEffectType(effect, type))
  return effect
}

function hasEffectType<Type extends LayerEffectType>(
  effect: LayerEffect | undefined,
  type: Type
): effect is Extract<LayerEffect, { type: Type }> {
  return effect?.type === type
}

function requireChange<Value>(value: Value | null): Value {
  assert.ok(value)
  return value
}

function patternOverlay(id: string) {
  const effect = createDefaultLayerEffect('pattern-overlay', id)
  assert.ok(effect.type === 'pattern-overlay')
  return effect
}

function dropShadow(id: string) {
  const effect = createDefaultLayerEffect('drop-shadow', id)
  assert.ok(effect.type === 'drop-shadow')
  return effect
}

function stroke(id: string) {
  const effect = createDefaultLayerEffect('stroke', id)
  assert.ok(effect.type === 'stroke')
  return effect
}

function bevelEmboss(id: string) {
  const effect = createDefaultLayerEffect('bevel-emboss', id)
  assert.ok(effect.type === 'bevel-emboss')
  return effect
}

test('cópia de estilo é profunda e preserva padrões sem compartilhar estado', () => {
  const effect = patternOverlay('pattern-copy')
  effect.pattern = {
    id: 'pattern', name: 'Padrão', width: 2, height: 2,
    mimeType: 'image/png', sourceUrl: 'blob:pattern'
  }
  const source = { ...createLayerStyleConfig(), effects: [effect] }
  const copied = copyLayerStyleConfig(source)

  effectOfType(copied.effects, 0, 'pattern-overlay').opacity = 25
  effectOfType(copied.effects, 0, 'pattern-overlay').pattern!.name = 'Alterado'
  assert.equal(effectOfType(source.effects, 0, 'pattern-overlay').opacity, 100)
  assert.equal(effectOfType(source.effects, 0, 'pattern-overlay').pattern!.name, 'Padrão')
})

test('efeitos podem ser colados em raster, mas não ficam invisíveis em camada vetorial', () => {
  const styled = { ...createLayerStyleConfig(), effects: [createDefaultLayerEffect('color-overlay')] }
  const blendIf = {
    ...createLayerStyleConfig(),
    blendIf: {
      ...createLayerStyleConfig().blendIf,
      channel: 'gray' as const,
      thisLayer: { shadows: [18, 64] as [number, number], highlights: [255, 255] as [number, number] }
    }
  }
  assert.equal(layerCanPasteStyle(layer('pixel'), styled), true)
  assert.equal(layerCanPasteStyle(layer('shape'), styled), false)
  assert.equal(layerCanPasteStyle(layer('shape'), { ...createLayerStyleConfig(), fillOpacity: 45 }), true)
  assert.equal(layerCanPasteStyle(layer('pixel'), blendIf), true)
  assert.equal(layerCanPasteStyle(layer('shape'), blendIf), false)
  assert.equal(layerCanPasteStyle(layer('background')), false)
})

test('colar e limpar geram snapshots independentes e ignoram operações sem mudança', () => {
  const target = layer()
  const styled = { ...createLayerStyleConfig(), fillOpacity: 60 }
  const pasted = requireChange(pastedLayerStyleChange(target, styled))
  assert.equal(pasted.after.fillOpacity, 60)
  styled.fillOpacity = 10
  assert.equal(pasted.after.fillOpacity, 60)

  target.styles = pasted.after
  assert.equal(pastedLayerStyleChange(target, pasted.after), null)
  const cleared = requireChange(clearedLayerStyleChange(target))
  assert.equal(cleared.after.fillOpacity, 100)
  target.styles = cleared.after
  assert.equal(clearedLayerStyleChange(target), null)
})

test('escala somente medidas em pixels e preserva percentuais, cores e fonte', () => {
  const target = layer()
  const shadow = dropShadow('shadow')
  shadow.distance = 7
  shadow.size = 9
  shadow.spread = 35
  shadow.opacity = 62
  const strokeEffect = stroke('stroke')
  strokeEffect.size = 3
  strokeEffect.paint = {
    type: 'pattern',
    angle: 0,
    scale: 80,
    linkWithLayer: true,
    pattern: { id: 'pattern', name: 'Padrão', width: 2, height: 2, mimeType: 'image/png', sourceUrl: 'blob:pattern' }
  }
  const bevel = bevelEmboss('bevel')
  bevel.size = 5
  bevel.soften = 2
  bevel.depth = 140
  target.styles = { ...createLayerStyleConfig(), fillOpacity: 75, effects: [shadow, strokeEffect, bevel] }

  const change = requireChange(scaledLayerStyleChange(target, 200))
  assert.equal(effectOfType(change.after.effects, 0, 'drop-shadow').distance, 14)
  assert.equal(effectOfType(change.after.effects, 0, 'drop-shadow').size, 18)
  assert.equal(effectOfType(change.after.effects, 0, 'drop-shadow').spread, 35)
  assert.equal(effectOfType(change.after.effects, 0, 'drop-shadow').opacity, 62)
  assert.equal(effectOfType(change.after.effects, 1, 'stroke').size, 6)
  const scaledStroke = effectOfType(change.after.effects, 1, 'stroke')
  assert.ok(scaledStroke.paint.type === 'pattern')
  assert.equal(scaledStroke.paint.scale, 80)
  assert.equal(effectOfType(change.after.effects, 2, 'bevel-emboss').size, 10)
  assert.equal(effectOfType(change.after.effects, 2, 'bevel-emboss').soften, 4)
  assert.equal(effectOfType(change.after.effects, 2, 'bevel-emboss').depth, 140)
  assert.equal(change.after.fillOpacity, 75)
  assert.equal(effectOfType(target.styles.effects, 0, 'drop-shadow').distance, 7)
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

  const shadow = dropShadow('limited')
  shadow.distance = 900
  shadow.size = 200
  target.styles = { ...createLayerStyleConfig(), effects: [shadow] }
  assert.equal(layerStylesCanScale(target.styles), true)
  assert.equal(scaledLayerStyleChange(target, 100), null)
  const scaled = requireChange(scaledLayerStyleChange(target, 200))
  assert.equal(effectOfType(scaled.after.effects, 0, 'drop-shadow').distance, 1_000)
  assert.equal(effectOfType(scaled.after.effects, 0, 'drop-shadow').size, 250)
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

  const shadow = dropShadow('batch-shadow')
  first.styles = { ...createLayerStyleConfig(), effects: [shadow] }
  second.styles = { ...createLayerStyleConfig(), effects: [createDefaultLayerEffect('color-overlay', 'overlay')] }
  const scaled = scaledLayerStyleChanges([first, second], 200)
  assert.deepEqual(scaled.map((change) => change.layerId), ['first'])
})

test('detecta estilos removíveis sem depender de efeitos ativos', () => {
  assert.equal(layerStyleCanClear(createLayerStyleConfig()), false)
  assert.equal(layerStyleCanClear({ ...createLayerStyleConfig(), enabled: false }), true)
  assert.equal(layerStyleCanClear({ ...createLayerStyleConfig(), fillOpacity: 99 }), true)
  assert.equal(layerStyleCanClear({
    ...createLayerStyleConfig(),
    blendIf: {
      ...createLayerStyleConfig().blendIf,
      channel: 'gray' as const,
      thisLayer: { shadows: [0, 32], highlights: [255, 255] }
    }
  }), true)
  assert.equal(layerStyleCanClear({ ...createLayerStyleConfig(), effects: [createDefaultLayerEffect('color-overlay')] }), true)
})

test('olhos geral e individual ocultam efeitos sem apagar configurações', () => {
  const target = layer()
  const shadow = dropShadow('eye-shadow')
  shadow.distance = 18
  target.styles = { ...createLayerStyleConfig(), effects: [shadow] }

  const master = requireChange(toggledLayerStyleVisibilityChange(target))
  assert.equal(master.after.enabled, false)
  assert.equal(effectOfType(master.after.effects, 0, 'drop-shadow').distance, 18)
  assert.equal(target.styles.enabled, true)

  const effect = requireChange(toggledLayerEffectVisibilityChange(target, 'eye-shadow'))
  assert.equal(effect.after.effects[0].enabled, false)
  assert.equal(effectOfType(effect.after.effects, 0, 'drop-shadow').distance, 18)
  assert.equal(toggledLayerEffectVisibilityChange(target, 'ausente'), null)
})

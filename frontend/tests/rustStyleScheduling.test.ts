import assert from 'node:assert/strict'
import test from 'node:test'
import { layerStylePreviewInsets, layerStylePreviewPriority, rustStylePriorityValid } from '../src/editor/rustStyleScheduling.ts'
import { layerStyleInsets } from '../src/editor/layerStyleCompositor.ts'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'

const viewport = { offsetX: 0, offsetY: 0, scale: 1, width: 100, height: 100 }
const transform = { x: 10, y: 10, width: 20, height: 20, rotation: 0 }
const insets = { left: 0, right: 0, top: 0, bottom: 0 }

test('Prioridade aceita apenas os três níveis explícitos', () => {
  for (const value of ['background', 'visible', 'active']) assert.equal(rustStylePriorityValid(value), true)
  for (const value of ['', 'urgent', 2, null, undefined, {}]) assert.equal(rustStylePriorityValid(value), false)
})

test('Camada ativa tem prioridade mesmo fora do viewport', () => {
  assert.equal(layerStylePreviewPriority(true, { ...transform, x: 1000 }, viewport, insets), 'active')
})

test('Visibilidade usa offset e zoom do viewport, sem DPR ou coordenadas de janela', () => {
  assert.equal(layerStylePreviewPriority(false, transform, viewport, insets), 'visible')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: 110 }, viewport, insets), 'background')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: -30 }, viewport, insets), 'background')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: 110 }, { ...viewport, offsetX: -100 }, insets), 'visible')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: 60 }, { ...viewport, scale: 2 }, insets), 'background')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: 60 }, { ...viewport, scale: 0.5 }, insets), 'visible')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: 100 }, viewport, insets), 'visible')
})

test('Rotação e halo externo mantêm prioridade para efeitos que alcançam o viewport', () => {
  const rotated = { x: 105, y: 20, width: 10, height: 80, rotation: 90 }
  assert.equal(layerStylePreviewPriority(false, rotated, viewport, insets), 'visible')
  const styles = normalizeLayerStyleConfig({ effects: [{ type: 'outer-glow', size: 30 }] })
  const halo = layerStyleInsets(styles, { angle: 30, altitude: 30 })
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: 125 }, viewport, halo), 'visible')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: 200 }, viewport, halo), 'background')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: 120, rotation: 45 }, viewport,
    { ...insets, left: 30 }), 'visible')
})

test('Geometria indefinida conserva prioridade visível em vez de descartar conteúdo', () => {
  for (const invalid of [{ ...viewport, scale: 0 }, { ...viewport, width: 0 }, { ...viewport, offsetX: NaN }]) {
    assert.equal(layerStylePreviewPriority(false, transform, invalid, insets), 'visible')
  }
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: Infinity }, viewport, insets), 'visible')
  assert.equal(layerStylePreviewPriority(false, transform, viewport, { ...insets, left: NaN }), 'visible')
  assert.equal(layerStylePreviewPriority(false, { ...transform, x: Number.MAX_VALUE }, { ...viewport, scale: 100 }, insets), 'visible')
})

test('Halo considera escala do raster, arredondamento e alongamento não uniforme', () => {
  const styles = normalizeLayerStyleConfig({ effects: [{ type: 'outer-glow', size: 10 }] }), light = { angle: 30, altitude: 30 }
  const stretched = { x: 130, y: 20, width: 100, height: 25, rotation: 0 }
  const halo = layerStylePreviewInsets(styles, light, stretched, { width: 50, height: 50, resolutionScale: 1 })
  assert.deepEqual(halo, { left: 20, right: 20, top: 5, bottom: 5 })
  assert.equal(layerStylePreviewPriority(false, stretched, viewport, halo), 'background')
  const near = { ...stretched, x: 125 }
  assert.equal(layerStylePreviewPriority(false, near, viewport, halo), 'visible')
  const textHalo = layerStylePreviewInsets(styles, light, transform, { width: 60, height: 60, resolutionScale: 3 })
  assert.deepEqual(textHalo, { left: 10, right: 10, top: 10, bottom: 10 })
  const clamped = layerStylePreviewInsets(styles, light, transform, { width: 20, height: 20, resolutionScale: 20 })
  assert.deepEqual(clamped, { left: 80, right: 80, top: 80, bottom: 80 })
  const tiny = layerStylePreviewInsets(styles, light, transform, { width: 2, height: 2, resolutionScale: 0.01 })
  assert.deepEqual(tiny, { left: 10, right: 10, top: 10, bottom: 10 })
})

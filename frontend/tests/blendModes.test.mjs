import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blendModeLabel,
  canvasBlendOperation,
  cssBlendMode,
  isLayerBlendMode,
  layerCompositingStyle,
  LAYER_BLEND_MODES,
  normalizeLayerBlendMode
} from '../src/editor/blendModes.ts'

test('oferece somente modos suportados igualmente pelo preview e exportação', () => {
  assert.deepEqual(
    LAYER_BLEND_MODES.map(({ value }) => value),
    ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']
  )
  for (const { value, label } of LAYER_BLEND_MODES) {
    assert.equal(isLayerBlendMode(value), true)
    assert.equal(cssBlendMode(value), value)
    assert.equal(blendModeLabel(value), label)
    assert.equal(canvasBlendOperation(value), value === 'normal' ? 'source-over' : value)
  }
})

test('não cria etapas de composição para o modo padrão opaco', () => {
  assert.deepEqual(layerCompositingStyle('normal', 100), {
    mixBlendMode: undefined,
    opacity: undefined
  })
  assert.deepEqual(layerCompositingStyle('multiply', 40), {
    mixBlendMode: 'multiply',
    opacity: 0.4
  })
  assert.deepEqual(layerCompositingStyle('invalid', 150), {
    mixBlendMode: undefined,
    opacity: undefined
  })
})

test('valores ausentes ou desconhecidos usam composição normal', () => {
  for (const value of [undefined, null, '', 'difference', 42]) {
    assert.equal(normalizeLayerBlendMode(value), 'normal')
    assert.equal(cssBlendMode(value), 'normal')
    assert.equal(canvasBlendOperation(value), 'source-over')
  }
})

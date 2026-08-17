import assert from 'node:assert/strict'
import test from 'node:test'
import {
  layerTransformStyle,
  layerTransformsMatch,
  moveLayerTransform,
  resizeLayerTransform,
  rotateLayerTransform
} from '../src/editor/freeTransform.ts'

test('gera posicionamento visual sem arredondar a geometria da camada', () => {
  assert.deepEqual(
    layerTransformStyle({ x: 10.25, y: -3.5, width: 640.75, height: 480.125, rotation: 12.5 }),
    {
      left: '0',
      top: '0',
      width: '640.75px',
      height: '480.125px',
      transform: 'translate3d(10.25px, -3.5px, 0) rotate(12.5deg)'
    }
  )
})

test('considera rotacao ausente equivalente a zero', () => {
  const base = { x: 2, y: 3, width: 100, height: 80 }
  assert.equal(layerTransformsMatch(base, { ...base, rotation: 0 }), true)
  assert.equal(layerTransformsMatch(base, { ...base, x: 2.01 }), false)
})

test('move a camada no espaço do documento preservando tamanho e rotação', () => {
  assert.deepEqual(
    moveLayerTransform(
      { x: 10, y: 20, width: 100, height: 50, rotation: 30 },
      { x: 4, y: 5 },
      { x: 7.333, y: 0 }
    ),
    { x: 13.33, y: 15, width: 100, height: 50, rotation: 30 }
  )
})

test('redimensiona pela alça leste mantendo a borda oposta fixa', () => {
  assert.deepEqual(
    resizeLayerTransform(
      { x: 10, y: 20, width: 100, height: 50, rotation: 0 },
      { x: 1, y: 0 },
      { x: 160, y: 45 },
      false,
      false
    ),
    { x: 10, y: 20, width: 150, height: 50, rotation: 0 }
  )
})

test('encaixa a rotação em incrementos de quinze graus', () => {
  const angle = (22 * Math.PI) / 180
  assert.equal(
    rotateLayerTransform(
      { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
      0,
      { x: 50 + Math.cos(angle) * 50, y: 50 + Math.sin(angle) * 50 },
      true
    ).rotation,
    15
  )
})

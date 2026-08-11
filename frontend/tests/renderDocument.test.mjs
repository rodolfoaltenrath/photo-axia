import assert from 'node:assert/strict'
import test from 'node:test'
import { layerIntersectsDocument } from '../src/editor/renderBounds.ts'

const document = { width: 1000, height: 800 }
const layer = (transform) => ({ transform })

test('miniatura ignora camadas completamente fora do documento', () => {
  assert.equal(layerIntersectsDocument(layer({ x: 10, y: 20, width: 100, height: 80 }), document), true)
  assert.equal(layerIntersectsDocument(layer({ x: 1100, y: 20, width: 100, height: 80 }), document), false)
  assert.equal(layerIntersectsDocument(layer({ x: -200, y: 20, width: 100, height: 80 }), document), false)
})

test('interseção considera a caixa visual de uma camada rotacionada', () => {
  assert.equal(layerIntersectsDocument(layer({ x: -60, y: 100, width: 40, height: 160, rotation: 90 }), document), true)
})

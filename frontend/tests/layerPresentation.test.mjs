import assert from 'node:assert/strict'
import test from 'node:test'
import { layerIsPixelBased, layerKindHelp, layerKindLabel } from '../src/editor/layerPresentation.ts'

test('imagem legada e camada rasterizada usam a mesma categoria visível', () => {
  assert.equal(layerKindLabel({ kind: 'image' }), 'Camada de pixels')
  assert.equal(layerKindLabel({ kind: 'pixel' }), 'Camada de pixels')
  assert.equal(layerIsPixelBased({ kind: 'image' }), true)
  assert.equal(layerIsPixelBased({ kind: 'pixel' }), true)
})

test('forma vetorial permanece distinta de Objeto Inteligente', () => {
  assert.equal(layerKindLabel({ kind: 'shape' }), 'Forma vetorial')
  assert.equal(layerKindLabel({ kind: 'smart' }), 'Objeto inteligente')
  assert.equal(layerIsPixelBased({ kind: 'shape' }), false)
  assert.match(layerKindHelp({ kind: 'smart' }), /dois cliques/)
})

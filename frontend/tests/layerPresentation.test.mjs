import assert from 'node:assert/strict'
import test from 'node:test'
import { layerIsPixelBased, layerKindHelp, layerKindLabel } from '../src/editor/layerPresentation.ts'

test('camada rasterizada usa a categoria canônica de pixels', () => {
  assert.equal(layerKindLabel({ kind: 'pixel' }), 'Camada rasterizada')
  assert.equal(layerIsPixelBased({ kind: 'pixel' }), true)
})

test('forma vetorial permanece distinta de Objeto Inteligente', () => {
  assert.equal(layerKindLabel({ kind: 'shape' }), 'Forma')
  assert.equal(layerKindLabel({ kind: 'smart' }), 'Objeto inteligente')
  assert.equal(layerIsPixelBased({ kind: 'shape' }), false)
  assert.match(layerKindHelp({ kind: 'smart' }), /dois cliques/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { moveLayerBy, moveLayerRelativeTo } from '../src/editor/layerOrder.ts'

const layers = ['top', 'middle', 'background'].map((id) => ({ id }))

test('a camada inicial sobe e desce como qualquer outra camada', () => {
  const raised = moveLayerBy(layers, 'background', -1)
  assert.deepEqual(raised?.layers.map(({ id }) => id), ['top', 'background', 'middle'])
  assert.deepEqual(
    moveLayerBy(raised?.layers ?? [], 'background', 1)?.layers.map(({ id }) => id),
    ['top', 'middle', 'background']
  )
})

test('drag and drop permite atravessar a antiga posição reservada ao fundo', () => {
  assert.deepEqual(
    moveLayerRelativeTo(layers, 'background', 'top', 'before')?.layers.map(({ id }) => id),
    ['background', 'top', 'middle']
  )
  assert.deepEqual(
    moveLayerRelativeTo(layers, 'top', 'background', 'after')?.layers.map(({ id }) => id),
    ['middle', 'background', 'top']
  )
})

test('movimentos fora da lista ou sem alteração são ignorados', () => {
  assert.equal(moveLayerBy(layers, 'top', -1), undefined)
  assert.equal(moveLayerRelativeTo(layers, 'middle', 'middle', 'after'), undefined)
  assert.equal(moveLayerRelativeTo(layers, 'top', 'middle', 'before'), undefined)
})

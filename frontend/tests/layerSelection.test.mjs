import test from 'node:test'
import assert from 'node:assert/strict'
import { updateLayerSelection } from '../src/editor/layerSelection.ts'

const layers = ['top', 'middle-a', 'middle-b', 'background'].map((id) => ({ id }))

test('Ctrl+clique alterna camadas não contíguas mantendo a ordem visual', () => {
  let state = updateLayerSelection(layers, ['top'], 'top', 'top', 'middle-b', 'toggle')
  assert.deepEqual(state.selectedIds, ['top', 'middle-b'])
  assert.equal(state.activeId, 'middle-b')

  state = updateLayerSelection(layers, state.selectedIds, state.activeId, state.anchorId, 'top', 'toggle')
  assert.deepEqual(state.selectedIds, ['middle-b'])
  assert.equal(state.activeId, 'middle-b')
})

test('Ctrl+clique nunca deixa o painel sem uma camada selecionada', () => {
  const state = updateLayerSelection(layers, ['top'], 'top', 'top', 'top', 'toggle')
  assert.deepEqual(state.selectedIds, ['top'])
  assert.equal(state.activeId, 'top')
})

test('Shift+clique seleciona o intervalo a partir da âncora', () => {
  const state = updateLayerSelection(layers, ['middle-a'], 'middle-a', 'middle-a', 'background', 'range')
  assert.deepEqual(state.selectedIds, ['middle-a', 'middle-b', 'background'])
  assert.equal(state.activeId, 'background')
  assert.equal(state.anchorId, 'middle-a')
})

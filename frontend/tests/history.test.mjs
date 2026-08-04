import assert from 'node:assert/strict'
import test from 'node:test'
import { useHistory } from '../src/editor/history.ts'

test('desfaz e refaz o estado mais recente', () => {
  const history = useHistory(10)
  history.record('Mover camada', { x: 0 }, { x: 24 })

  assert.equal(history.undo()?.snapshot.x, 0)
  assert.equal(history.canRedo.value, true)
  assert.equal(history.redo()?.snapshot.x, 24)
  assert.equal(history.canUndo.value, true)
})

test('agrupa alterações contínuas em uma única entrada', () => {
  const history = useHistory(10)
  history.record('Editar texto', { text: '' }, { text: 'A' }, { mergeKey: 'text:1' })
  history.record('Editar texto', { text: 'A' }, { text: 'Axia' }, { mergeKey: 'text:1' })

  assert.equal(history.currentPosition.value, 1)
  assert.equal(history.undo()?.snapshot.text, '')
  assert.equal(history.redo()?.snapshot.text, 'Axia')
})

test('descarta ações futuras ao criar uma nova ramificação', () => {
  const history = useHistory(10)
  history.record('A', { value: 0 }, { value: 1 })
  history.record('B', { value: 1 }, { value: 2 })
  history.undo()
  history.record('C', { value: 1 }, { value: 3 })

  assert.equal(history.canRedo.value, false)
  assert.deepEqual(history.timeline.value.map((item) => item.label), ['Documento criado', 'A', 'C'])
})

test('salta diretamente entre estados da linha do tempo', () => {
  const history = useHistory(10)
  history.record('A', { value: 0 }, { value: 1 })
  history.record('B', { value: 1 }, { value: 2 })
  history.record('C', { value: 2 }, { value: 3 })

  assert.equal(history.jump(0)?.snapshot.value, 0)
  assert.equal(history.currentPosition.value, 0)
  assert.equal(history.jump(2)?.snapshot.value, 2)
  assert.equal(history.currentPosition.value, 2)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { combineSelections } from '../src/editor/selectionCombine.ts'
import {
  combineSelectionsAsync,
  disposeSelectionCombineEngine
} from '../src/services/selectionCombineEngine.ts'

const documentSize = { width: 12, height: 8 }

test('combinação assíncrona evita Worker e cópias desnecessárias nos casos triviais', async () => {
  const incoming = { kind: 'rectangle', bounds: { x: 1, y: 2, width: 4, height: 3 } }
  const cloned = await combineSelectionsAsync(null, incoming, 'replace', documentSize)
  const owned = await combineSelectionsAsync(null, incoming, 'replace', documentSize, undefined, true)
  assert.deepEqual(cloned, incoming)
  assert.notEqual(cloned, incoming)
  assert.equal(owned, incoming)
})

test('fallback assíncrono preserva a máscara do núcleo síncrono', async () => {
  const previous = {
    kind: 'pixels',
    sourceWidth: 3,
    sourceHeight: 2,
    sourceToDocument: [0, 1, -1, 0, 6, 1],
    spans: [{ y: 0, x0: 0, x1: 3 }, { y: 1, x0: 0, x1: 2 }],
    bounds: { x: 0, y: 0, width: 3, height: 2 },
    pixelCount: 5
  }
  const incoming = { kind: 'rectangle', bounds: { x: 3, y: 1, width: 3, height: 3 } }
  const expected = combineSelections(previous, incoming, 'intersect', documentSize)
  const actual = await combineSelectionsAsync(previous, incoming, 'intersect', documentSize)
  assert.deepEqual(actual, expected)
})

test('combinação assíncrona rejeita sinal já cancelado sem alterar entradas', async () => {
  const controller = new AbortController()
  const incoming = { kind: 'rectangle', bounds: { x: 1, y: 1, width: 2, height: 2 } }
  controller.abort()
  await assert.rejects(
    combineSelectionsAsync(null, incoming, 'replace', documentSize, controller.signal, true),
    { name: 'AbortError' }
  )
  assert.deepEqual(incoming, { kind: 'rectangle', bounds: { x: 1, y: 1, width: 2, height: 2 } })
})

test.after(() => disposeSelectionCombineEngine())

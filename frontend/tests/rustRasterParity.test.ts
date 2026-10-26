import assert from 'node:assert/strict'
import test from 'node:test'
import { rasterParityAnyPrecision, rasterParityDifference, rasterParityWithin, rasterPixelIsTie,
  rasterSourceEdges } from '../src/editor/rustRasterParity.ts'

test('bordas da fonte seguem translação, escala, quarto de volta e origem da saída', () => {
  assert.deepEqual(rasterSourceEdges([1.5, 0, 0, 2, 2.25, 0.5], 2, 2), { x: [2.25, 5.25], y: [0.5, 4.5] })
  assert.deepEqual(rasterSourceEdges([0, 1, -1, 0, 4.5, 2.25], 2, 2), { x: [2.5, 4.5], y: [2.25, 4.25] })
  assert.deepEqual(rasterSourceEdges([1, 0, 0, 1, 10.5, 3], 2, 2, 8, 2), { x: [2.5, 4.5], y: [1, 3] })
})

test('só é empate o pixel cujo centro cai exatamente sobre uma borda', () => {
  const edges = [{ x: [2.5, 4.5], y: [2.25, 4.25] }]
  assert.equal(rasterPixelIsTie(2, 7, edges), true)
  assert.equal(rasterPixelIsTie(4, 0, edges), true)
  assert.equal(rasterPixelIsTie(3, 3, edges), false)
  assert.equal(rasterPixelIsTie(2, 2, [{ x: [2.25, 4.25], y: [2.25, 4.25] }]), false)
})

test('diferença ignora apenas pixels de empate e mantém tolerância estrita no resto', () => {
  const expected = new Uint8Array(3 * 1 * 4), actual = new Uint8Array(3 * 1 * 4)
  actual.set([255, 0, 0, 255], 0) // pixel 0: empate (borda x = 0,5)
  actual.set([0, 0, 0, 3], 8) // pixel 2: fora de empate, alfa 3
  const edges = [{ x: [0.5, 9.5], y: [-10, 10] }]
  const difference = rasterParityDifference(expected, actual, 3, 1, edges)
  assert.deepEqual([difference.alpha, difference.ignored], [3, 1])
  assert.equal(rasterParityWithin(difference), false)
  assert.equal(rasterParityWithin(rasterParityDifference(expected, expected, 3, 1)), true)
  assert.throws(() => rasterParityDifference(expected, new Uint8Array(4), 3, 1), /divergentes/)
})

test('aceita a precisão que casar estritamente, e só ela', () => {
  const expected = [10, 20, 30, 200]
  const best = rasterParityAnyPrecision(expected, [
    { variant: 'quantizado', rgba: [10, 20, 40, 200] },
    { variant: 'exato', rgba: [10, 21, 30, 200] }
  ], 1, 1)
  assert.equal(best.variant, 'exato'); assert.equal(rasterParityWithin(best), true)
  const none = rasterParityAnyPrecision(expected, [{ variant: 'quantizado', rgba: [10, 20, 40, 200] }], 1, 1)
  assert.equal(rasterParityWithin(none), false)
  assert.throws(() => rasterParityAnyPrecision(expected, [], 1, 1), /Nenhuma variante/)
})

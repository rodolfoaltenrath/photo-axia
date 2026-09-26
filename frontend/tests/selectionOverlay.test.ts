import assert from 'node:assert/strict'
import test from 'node:test'
import {
  selectionOverlayMetrics,
  selectionOverlayOutlinePath,
  selectionOverlayShouldAnimate
} from '../src/editor/selectionOverlay.ts'
import type { PixelSelection } from '../src/editor/selection.ts'

test('métricas do overlay preservam um pixel visual em qualquer zoom', () => {
  assert.deepEqual(selectionOverlayMetrics(1), { strokeWidth: 1, dashLength: 4, dashOffset: -8 })
  assert.deepEqual(selectionOverlayMetrics(4), { strokeWidth: 0.25, dashLength: 1, dashOffset: -2 })
  assert.deepEqual(selectionOverlayMetrics(Number.NaN), { strokeWidth: 1, dashLength: 4, dashOffset: -8 })
})

test('formato complexo ou zoom contínuo não anima milhares de arestas', () => {
  const simple: PixelSelection = { kind: 'pixels', spans: [], bounds: { x: 0, y: 0, width: 1, height: 1 }, sourceWidth: 1, sourceHeight: 1, sourceToDocument: [1, 0, 0, 1, 0, 0], pixelCount: 1 }
  const complex: PixelSelection = { ...simple, spans: { kind: 'packed-spans', data: new Int32Array(6_003), length: 2_001 } }
  assert.equal(selectionOverlayShouldAnimate(simple, false), true)
  assert.equal(selectionOverlayShouldAnimate(simple, true), false)
  assert.equal(selectionOverlayShouldAnimate(complex, false), false)
  assert.equal(selectionOverlayShouldAnimate({ kind: 'rectangle', bounds: { x: 0, y: 0, width: 1, height: 1 } }, false), true)
})

test('zoom contínuo reduz seleção pixelada a um único contorno temporário', () => {
  const selection: PixelSelection = {
    kind: 'pixels',
    spans: [
      { y: 0, x0: 2, x1: 8 },
      { y: 1, x0: 2, x1: 3 },
      { y: 1, x0: 6, x1: 9 }
    ],
    bounds: { x: 2, y: 0, width: 7, height: 2 },
    sourceWidth: 20, sourceHeight: 20, sourceToDocument: [1, 0, 0, 1, 0, 0], pixelCount: 12
  }
  assert.equal(selectionOverlayOutlinePath(selection, true), 'M2 0h7v2H2Z')
  assert.notEqual(selectionOverlayOutlinePath(selection, false), 'M2 0h7v2H2Z')
})

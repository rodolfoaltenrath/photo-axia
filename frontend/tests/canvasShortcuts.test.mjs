import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canvasArrowNudgeDelta,
  canvasPageScrollDelta,
  canvasZoomShortcut
} from '../src/editor/canvasShortcuts.ts'

test('normaliza atalhos de zoom do teclado principal e numérico', () => {
  assert.deepEqual(canvasZoomShortcut('Digit0'), { type: 'fit' })
  assert.deepEqual(canvasZoomShortcut('Numpad1'), { type: 'zoom', value: 100 })
  assert.deepEqual(canvasZoomShortcut('Digit2'), { type: 'zoom', value: 200 })
  assert.deepEqual(canvasZoomShortcut('NumpadAdd'), { type: 'step', direction: 1 })
  assert.deepEqual(canvasZoomShortcut('Minus'), { type: 'step', direction: -1 })
  assert.equal(canvasZoomShortcut('KeyZ'), undefined)
})

test('setas movem conteúdo em um pixel ou dez com Shift', () => {
  assert.deepEqual(canvasArrowNudgeDelta('ArrowLeft', false), { x: -1, y: 0 })
  assert.deepEqual(canvasArrowNudgeDelta('ArrowDown', true), { x: 0, y: 10 })
  assert.equal(canvasArrowNudgeDelta('Enter', false), undefined)
})

test('PageUp e PageDown deslocam noventa por cento no eixo correto', () => {
  const viewport = { width: 1000, height: 600 }
  assert.deepEqual(canvasPageScrollDelta('PageUp', false, viewport), { left: 0, top: -540 })
  assert.deepEqual(canvasPageScrollDelta('PageDown', true, viewport), { left: 900, top: 0 })
  assert.equal(canvasPageScrollDelta('Home', false, viewport), undefined)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  centerFloatingWindow,
  fitFloatingWindow,
  moveFloatingWindow,
  resizeFloatingWindow
} from '../src/editor/floatingWindow.ts'

const viewport = { width: 1200, height: 800 }
const minimum = { width: 560, height: 420 }

test('centraliza a janela com tamanho inicial estável e respeita viewports menores', () => {
  assert.deepEqual(centerFloatingWindow(viewport, { width: 680, height: 580 }, minimum), {
    left: 260,
    top: 110,
    width: 680,
    height: 580
  })
  assert.deepEqual(centerFloatingWindow({ width: 500, height: 400 }, { width: 680, height: 580 }, minimum), {
    left: 8,
    top: 8,
    width: 484,
    height: 384
  })
})

test('move a janela sem permitir que ela saia da área visível', () => {
  const rect = { left: 260, top: 110, width: 680, height: 580 }
  assert.deepEqual(moveFloatingWindow(rect, -1000, 1000, viewport, minimum), {
    left: 8,
    top: 212,
    width: 680,
    height: 580
  })
})

test('redimensiona pelas quatro quinas preservando mínimo e limites do viewport', () => {
  const rect = { left: 260, top: 110, width: 680, height: 580 }
  assert.deepEqual(resizeFloatingWindow(rect, 'north-west', -40, -30, viewport, minimum), {
    left: 220,
    top: 80,
    width: 720,
    height: 610
  })
  assert.deepEqual(resizeFloatingWindow(rect, 'south-east', 500, 500, viewport, minimum), {
    left: 260,
    top: 110,
    width: 932,
    height: 682
  })
  assert.deepEqual(resizeFloatingWindow(rect, 'south-west', 500, -500, viewport, minimum), {
    left: 380,
    top: 110,
    width: 560,
    height: 420
  })
  assert.deepEqual(fitFloatingWindow({ left: -20, top: -10, width: 100, height: 100 }, viewport, minimum), {
    left: 8,
    top: 8,
    width: 560,
    height: 420
  })
})

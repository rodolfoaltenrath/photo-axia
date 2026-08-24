import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GRADIENT_CONFIG,
  gradientIsDegenerate,
  gradientLength,
  gradientLineBounds,
  interpolateGradientColor,
  linearGradientProgress,
  parseGradientColor,
  snapGradientEndpoint
} from '../src/editor/gradient.ts'

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} deveria se aproximar de ${expected}`)
}

test('define o degradê linear preto para branco como configuração inicial', () => {
  assert.deepEqual(DEFAULT_GRADIENT_CONFIG, {
    type: 'linear',
    foregroundColor: '#000000',
    backgroundColor: '#ffffff',
    reversed: false
  })
})

test('interpreta cores hexadecimais e rejeita entradas ambíguas', () => {
  assert.deepEqual(parseGradientColor('#0c80Ff'), [12, 128, 255])
  assert.throws(() => parseGradientColor('#fff'), /Cor hexadecimal inválida/)
  assert.throws(() => parseGradientColor('rgb(0, 0, 0)'), /Cor hexadecimal inválida/)
})

test('interpola canais RGB em sRGB e limita o progresso', () => {
  assert.deepEqual(interpolateGradientColor('#000000', '#ffffff', 0), [0, 0, 0])
  assert.deepEqual(interpolateGradientColor('#000000', '#ffffff', 0.5), [128, 128, 128])
  assert.deepEqual(interpolateGradientColor('#000000', '#ffffff', 1), [255, 255, 255])
  assert.deepEqual(interpolateGradientColor('#123456', '#abcdef', -2), [18, 52, 86])
  assert.deepEqual(interpolateGradientColor('#123456', '#abcdef', 4), [171, 205, 239])
})

test('inverte somente o sentido das cores usadas na interpolação', () => {
  assert.deepEqual(interpolateGradientColor('#102030', '#d0e0f0', 0, true), [208, 224, 240])
  assert.deepEqual(interpolateGradientColor('#102030', '#d0e0f0', 1, true), [16, 32, 48])
})

test('calcula o progresso linear horizontal, vertical e diagonal', () => {
  const horizontal = { start: { x: 10, y: 20 }, end: { x: 110, y: 20 } }
  assert.equal(linearGradientProgress({ x: 10, y: 300 }, horizontal), 0)
  assert.equal(linearGradientProgress({ x: 60, y: -100 }, horizontal), 0.5)
  assert.equal(linearGradientProgress({ x: 110, y: 20 }, horizontal), 1)
  assert.equal(linearGradientProgress({ x: -20, y: 20 }, horizontal), 0)
  assert.equal(linearGradientProgress({ x: 200, y: 20 }, horizontal), 1)

  const vertical = { start: { x: 5, y: 5 }, end: { x: 5, y: 25 } }
  assert.equal(linearGradientProgress({ x: 400, y: 15 }, vertical), 0.5)

  const diagonal = { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }
  assert.equal(linearGradientProgress({ x: 5, y: 5 }, diagonal), 0.5)
  assert.equal(linearGradientProgress({ x: 10, y: 0 }, diagonal), 0.5)
})

test('trata gesto curto, degenerado ou inválido como no-op', () => {
  assert.equal(gradientIsDegenerate({ start: { x: 0, y: 0 }, end: { x: 0.49, y: 0 } }), true)
  assert.equal(gradientIsDegenerate({ start: { x: 0, y: 0 }, end: { x: 0.5, y: 0 } }), false)
  assert.equal(gradientIsDegenerate({ start: { x: 0, y: 0 }, end: { x: Number.NaN, y: 0 } }), true)
  assert.equal(linearGradientProgress(
    { x: 100, y: 100 },
    { start: { x: 4, y: 8 }, end: { x: 4, y: 8 } }
  ), 0)
})

test('mede a linha e retorna bounds independentes do sentido do arraste', () => {
  const geometry = { start: { x: 20, y: 35 }, end: { x: 8, y: 30 } }
  assert.equal(gradientLength(geometry), 13)
  assert.deepEqual(gradientLineBounds(geometry), { x: 8, y: 30, width: 12, height: 5 })
})

test('Shift encaixa o ângulo em passos de quinze graus preservando comprimento', () => {
  const start = { x: 10, y: 20 }
  const end = { x: 109, y: 40 }
  const snapped = snapGradientEndpoint(start, end)
  const originalLength = Math.hypot(end.x - start.x, end.y - start.y)
  closeTo(Math.hypot(snapped.x - start.x, snapped.y - start.y), originalLength)
  closeTo(Math.atan2(snapped.y - start.y, snapped.x - start.x), 15 * Math.PI / 180)

  assert.deepEqual(snapGradientEndpoint(start, start), start)
  assert.deepEqual(snapGradientEndpoint(start, end, 0), end)
})

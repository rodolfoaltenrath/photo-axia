import assert from 'node:assert/strict'
import test from 'node:test'
import {
  colorSampleButtonIsPressed,
  colorSampleTarget,
  sampledDocumentPixel,
  sampledPixelToHex
} from '../src/editor/colorSampler.ts'

test('direciona os botões esquerdo e direito para as cores corretas', () => {
  assert.equal(colorSampleTarget(0), 'foreground')
  assert.equal(colorSampleTarget(2), 'background')
  assert.equal(colorSampleTarget(1), undefined)
})

test('mantém a coleta somente enquanto o botão de origem continua pressionado', () => {
  assert.equal(colorSampleButtonIsPressed('foreground', 1), true)
  assert.equal(colorSampleButtonIsPressed('foreground', 2), false)
  assert.equal(colorSampleButtonIsPressed('background', 2), true)
  assert.equal(colorSampleButtonIsPressed('background', 0), false)
})

test('normaliza a coleta para um pixel válido do documento', () => {
  assert.deepEqual(sampledDocumentPixel(12.9, 7.1, 100, 80), { x: 12, y: 7 })
  assert.deepEqual(sampledDocumentPixel(99.999, 79.999, 100, 80), { x: 99, y: 79 })
  assert.equal(sampledDocumentPixel(-0.01, 2, 100, 80), null)
  assert.equal(sampledDocumentPixel(100, 2, 100, 80), null)
  assert.equal(sampledDocumentPixel(Number.NaN, 2, 100, 80), null)
})

test('converte o pixel coletado para uma cor hexadecimal', () => {
  assert.equal(sampledPixelToHex(new Uint8ClampedArray([12, 128, 255, 255])), '#0c80ff')
  assert.equal(sampledPixelToHex([300, -4, 127.6, 128]), '#ff0080')
})

test('ignora pixels completamente transparentes ou incompletos', () => {
  assert.equal(sampledPixelToHex([255, 0, 0, 0]), null)
  assert.equal(sampledPixelToHex([255, 0, 0]), null)
})

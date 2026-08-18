import assert from 'node:assert/strict'
import test from 'node:test'
import {
  colorSampleButtonIsPressed,
  colorSampleTarget,
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

test('converte o pixel coletado para uma cor hexadecimal', () => {
  assert.equal(sampledPixelToHex(new Uint8ClampedArray([12, 128, 255, 255])), '#0c80ff')
  assert.equal(sampledPixelToHex([300, -4, 127.6, 128]), '#ff0080')
})

test('ignora pixels completamente transparentes ou incompletos', () => {
  assert.equal(sampledPixelToHex([255, 0, 0, 0]), null)
  assert.equal(sampledPixelToHex([255, 0, 0]), null)
})

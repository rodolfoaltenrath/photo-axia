import assert from 'node:assert/strict'
import test from 'node:test'
import {
  documentBaseMemoryBytes,
  documentPixelSize,
  parseCustomDocumentPresets,
  pixelsPerDocumentUnit,
  validateDocumentSettings
} from '../src/editor/document.ts'

const settings = (overrides = {}) => ({
  name: 'Documento',
  unit: 'px',
  width: 1920,
  height: 1080,
  resolutionDpi: 72,
  background: 'transparent',
  ...overrides
})

test('converte pixels, centímetros, milímetros e polegadas', () => {
  assert.equal(pixelsPerDocumentUnit('px', 300), 1)
  assert.equal(pixelsPerDocumentUnit('in', 300), 300)
  assert.equal(pixelsPerDocumentUnit('cm', 254), 100)
  assert.equal(pixelsPerDocumentUnit('mm', 254), 10)
  assert.deepEqual(documentPixelSize(settings({ unit: 'cm', width: 21, height: 29.7, resolutionDpi: 300 })), {
    width: 2480,
    height: 3508
  })
})

test('valida limites de dimensão, resolução e megapixels', () => {
  assert.equal(validateDocumentSettings(settings()), '')
  assert.match(validateDocumentSettings(settings({ width: 0 })), /dimensões válidas/)
  assert.match(validateDocumentSettings(settings({ resolutionDpi: 2401 })), /2.400/)
  assert.match(validateDocumentSettings(settings({ width: 10_000, height: 10_000 })), /64 megapixels/)
  assert.match(validateDocumentSettings(settings({ width: 20_000, height: 10 })), /16.384/)
})

test('estima a memória RGBA base sem contar camadas futuras', () => {
  assert.equal(documentBaseMemoryBytes(settings({ width: 100, height: 50 })), 20_000)
})

test('descarta predefinições locais adulteradas e normaliza as válidas', () => {
  const valid = {
    ...settings(),
    id: '  preset-1  ',
    category: 'saved',
    label: '  Meu preset  '
  }
  const presets = parseCustomDocumentPresets([
    valid,
    { ...valid, label: 'ID duplicado' },
    { ...valid, id: 'invalid-unit', unit: 'meters' },
    { ...valid, id: 'invalid-background', background: 'purple' },
    { ...valid, id: 'invalid-size', width: 100_000 },
    null
  ])
  assert.equal(presets.length, 1)
  assert.equal(presets[0].id, 'preset-1')
  assert.equal(presets[0].label, 'Meu preset')
})

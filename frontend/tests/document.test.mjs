import assert from 'node:assert/strict'
import test from 'node:test'
import {
  convertDocumentUnit,
  documentBaseMemoryBytes,
  documentPhysicalSize,
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

test('trocar a unidade preserva o tamanho raster do documento', () => {
  const a4 = settings({ unit: 'cm', width: 21, height: 29.7, resolutionDpi: 300 })
  const pixels = convertDocumentUnit(a4, 'px')
  assert.deepEqual(pixels, { unit: 'px', width: 2480, height: 3508 })
  assert.deepEqual(documentPixelSize({ ...a4, ...pixels }), documentPixelSize(a4))

  const centimeters = convertDocumentUnit({ ...a4, ...pixels }, 'cm')
  assert.deepEqual(documentPixelSize({ ...a4, ...centimeters }), documentPixelSize(a4))

  assert.deepEqual(
    convertDocumentUnit({ ...a4, resolutionDpi: 150 }, 'px'),
    { unit: 'px', width: 1240, height: 1754 }
  )
})

test('trocar entre unidades físicas não reinterpreta os números', () => {
  assert.deepEqual(
    convertDocumentUnit(settings({ unit: 'cm', width: 21, height: 29.7, resolutionDpi: 150 }), 'mm'),
    { unit: 'mm', width: 210, height: 297 }
  )
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

test('DPI descreve tamanho físico sem alterar documentos definidos em pixels', () => {
  const at150 = settings({ width: 1754, height: 1240, resolutionDpi: 150 })
  const at300 = { ...at150, resolutionDpi: 300 }

  assert.deepEqual(documentPixelSize(at150), { width: 1754, height: 1240 })
  assert.deepEqual(documentPixelSize(at300), { width: 1754, height: 1240 })

  const physical150 = documentPhysicalSize(at150)
  const physical300 = documentPhysicalSize(at300)
  assert.ok(Math.abs(physical150.widthCentimeters - 29.701) < 0.001)
  assert.ok(Math.abs(physical150.heightCentimeters - 20.997) < 0.001)
  assert.ok(Math.abs(physical300.widthCentimeters - physical150.widthCentimeters / 2) < 0.001)
  assert.ok(Math.abs(physical300.heightCentimeters - physical150.heightCentimeters / 2) < 0.001)
})

test('tamanho físico deriva do raster arredondado criado por unidades físicas', () => {
  const a4 = settings({ unit: 'cm', width: 29.7, height: 21, resolutionDpi: 150 })
  assert.deepEqual(documentPixelSize(a4), { width: 1754, height: 1240 })
  const physical = documentPhysicalSize(a4)
  assert.ok(Math.abs(physical.widthCentimeters - 29.701) < 0.001)
  assert.ok(Math.abs(physical.heightCentimeters - 20.997) < 0.001)
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

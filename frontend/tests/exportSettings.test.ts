import assert from 'node:assert/strict'
import test from 'node:test'
import {
  exportFilename,
  exportPixelSize,
  normalizeExportSettings,
  pngPixelsPerMeter,
  validateExportPixelSize
} from '../src/editor/exportSettings.ts'

test('normaliza formato, qualidade, esforço PNG e fundo JPEG', () => {
  assert.deepEqual(normalizeExportSettings({ format: 'png', resolutionDpi: 150 }), {
    format: 'png', resolutionDpi: 150, preserveMetadata: true, pngEffort: 'balanced'
  })
  assert.deepEqual(normalizeExportSettings({ format: 'jpeg', quality: 2, resolutionDpi: 300 }), {
    format: 'jpeg', resolutionDpi: 300, preserveMetadata: true, quality: 1, matteColor: '#ffffff'
  })
  assert.equal(normalizeExportSettings({ format: 'webp', quality: 0 }).quality, 0.01)
})

test('normaliza nome e extensão conforme o formato', () => {
  assert.equal(exportFilename('folha.png', 'jpeg'), 'folha.jpg')
  assert.equal(exportFilename('  ', 'webp'), 'imagem.webp')
  assert.equal(exportFilename('foto.JPEG', 'png'), 'foto.png')
  assert.equal(exportFilename('contrato.pdf', 'png'), 'contrato.png')
  assert.equal(exportFilename('animação.gif', 'webp'), 'animação.webp')
})

test('converte DPI para pixels por metro usados pelo PNG', () => {
  assert.equal(pngPixelsPerMeter(150), 5906)
  assert.equal(pngPixelsPerMeter(300), 11811)
})

test('converte DPI de exportação em dimensões reais do raster e limita excessos', () => {
  assert.deepEqual(exportPixelSize(1920, 1080, 72, 300), {
    width: 8000, height: 4500, scale: 300 / 72
  })
  assert.equal(validateExportPixelSize(1920, 1080, 72, 300), '')
  assert.match(validateExportPixelSize(3840, 2160, 72, 300), /64 megapixels/)
  assert.match(validateExportPixelSize(20_000, 10, 300, 300), /16\.384/)
})

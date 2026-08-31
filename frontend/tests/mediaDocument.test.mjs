import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MEDIA_DOCUMENT_FALLBACK_DPI,
  createNativeImageLayer,
  importedImageDocumentDpi,
  importedImageDocumentSettings,
  validateImportedImageDocument
} from '../src/editor/mediaDocument.ts'

function image(overrides = {}) {
  return {
    id: 'source-1',
    name: 'foto.png',
    width: 1754,
    height: 1240,
    mimeType: 'image/png',
    sourceUrl: 'blob:source',
    ...overrides
  }
}

test('cria documento e camada nas dimensões nativas sem reamostragem', () => {
  const source = image({ resolutionDpiX: 150, resolutionDpiY: 150, resolutionSource: 'png-phys' })
  const settings = importedImageDocumentSettings(source)
  const layer = createNativeImageLayer(source)

  assert.deepEqual(settings, {
    name: 'foto.png', unit: 'px', width: 1754, height: 1240, resolutionDpi: 150, background: 'transparent'
  })
  assert.deepEqual(layer.transform, { x: 0, y: 0, width: 1754, height: 1240, rotation: 0 })
  assert.equal(layer.image.sourceUrl, source.sourceUrl)
  assert.equal(layer.image.resolutionSource, 'png-phys')
})

test('usa resolução vertical válida ou o padrão sem inventar metadado no asset', () => {
  assert.equal(importedImageDocumentDpi(image({ resolutionDpiY: 300 })), 300)
  assert.equal(importedImageDocumentDpi(image()), MEDIA_DOCUMENT_FALLBACK_DPI)
  assert.equal(createNativeImageLayer(image()).image.resolutionDpiX, undefined)
})

test('permite que o fundo escolhido para PDF faça parte do documento', () => {
  assert.equal(importedImageDocumentSettings(image(), 'documento.pdf', 'white').background, 'white')
})

test('rejeita dimensões fora dos limites do editor', () => {
  assert.match(validateImportedImageDocument(image({ width: 16_385 })), /16\.384 px/)
  assert.match(validateImportedImageDocument(image({ width: 10_000, height: 10_000 })), /64 megapixels/)
  assert.match(validateImportedImageDocument(image({ width: 0 })), /dimensões válidas/)
  assert.equal(validateImportedImageDocument(image()), '')
})

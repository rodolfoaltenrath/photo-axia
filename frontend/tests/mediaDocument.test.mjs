import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MEDIA_DOCUMENT_FALLBACK_DPI,
  createNativePixelLayer,
  createPlacedImageSmartLayer,
  createPlacedPDFSmartLayer,
  importedImageDocumentDpi,
  importedImageDocumentSettings,
  validateImportedImageDocument
} from '../src/editor/mediaDocument.ts'
import { replacePDFSmartLayerCache } from '../src/editor/pdfSmartLayer.ts'

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
  const layer = createNativePixelLayer(source)

  assert.deepEqual(settings, {
    name: 'foto.png', unit: 'px', width: 1754, height: 1240, resolutionDpi: 150, background: 'transparent'
  })
  assert.deepEqual(layer.transform, { x: 0, y: 0, width: 1754, height: 1240, rotation: 0 })
  assert.equal(layer.kind, 'pixel')
  assert.equal(layer.image.sourceUrl, source.sourceUrl)
  assert.equal(layer.image.resolutionSource, 'png-phys')
})

test('coloca imagem como Objeto Inteligente com uma camada de pixels interna', () => {
  const source = image({ resolutionDpiX: 150 })
  const transform = { x: 20, y: 30, width: 877, height: 620, rotation: 0 }
  const layer = createPlacedImageSmartLayer(source, {
    colorSpace: 'sRGB',
    layerStyleGlobalLight: { angle: 120, altitude: 30 }
  }, transform)

  assert.equal(layer.kind, 'smart')
  assert.deepEqual(layer.transform, transform)
  assert.equal(layer.smart.width, 1754)
  assert.equal(layer.smart.height, 1240)
  assert.equal(layer.smart.resolutionDpi, 150)
  assert.equal(layer.smart.layers.length, 1)
  assert.equal(layer.smart.layers[0].kind, 'pixel')
  assert.deepEqual(layer.smart.layers[0].transform, {
    x: 0, y: 0, width: 1754, height: 1240, rotation: 0
  })
  assert.equal(layer.image.sourceUrl, source.sourceUrl)
  assert.equal(layer.smart.layers[0].image.sourceUrl, source.sourceUrl)
  assert.notEqual(layer.image, layer.smart.layers[0].image)
})

test('mantém a origem da página no Objeto Inteligente de PDF', () => {
  const source = image({ name: 'contrato — página 2', resolutionDpiX: 150 })
  const pdf = {
    name: 'contrato.pdf', sourceUrl: 'blob:contrato-pdf', byteSize: 22_000,
    pageNumber: 2, widthPoints: 595.28, heightPoints: 841.89, background: 'white'
  }
  const layer = createPlacedPDFSmartLayer(source, pdf, {
    colorSpace: 'sRGB', layerStyleGlobalLight: { angle: 120, altitude: 30 }
  }, { x: 0, y: 0, width: 1754, height: 1240, rotation: 0 })

  assert.deepEqual({ ...layer.smart.pdf, cacheLayerId: undefined }, { ...pdf, cacheLayerId: undefined })
  assert.notEqual(layer.smart.pdf, pdf)
  assert.equal(layer.smart.pdf.cacheLayerId, layer.smart.layers[0].id)
  assert.equal(layer.smart.layers[0].image.mimeType, 'image/png')
})

test('re-renderiza apenas o cache da camada PDF e preserva sua fonte', () => {
  const layer = createPlacedPDFSmartLayer(image({ resolutionDpiX: 150 }), {
    name: 'arquivo.pdf', sourceUrl: 'blob:pdf', pageNumber: 1,
    widthPoints: 72, heightPoints: 72, background: 'white'
  }, { colorSpace: 'sRGB', layerStyleGlobalLight: { angle: 120, altitude: 30 } }, {
    x: 10, y: 20, width: 877, height: 620, rotation: 0
  })
  const updated = replacePDFSmartLayerCache(layer.smart, image({
    id: 'cache-300', name: 'arquivo — página 1', width: 300, height: 300,
    sourceUrl: 'blob:cache-300', resolutionDpiX: 300, resolutionDpiY: 300, resolutionSource: 'pdf-render'
  }))

  assert.equal(updated.pdf.sourceUrl, 'blob:pdf')
  assert.equal(updated.pdf.cacheLayerId, layer.smart.layers[0].id)
  assert.equal(updated.layers[0].image.sourceUrl, 'blob:cache-300')
  assert.deepEqual(updated.layers[0].transform, { x: 0, y: 0, width: 300, height: 300, rotation: 0 })
  assert.equal(updated.resolutionDpi, 300)
  assert.equal(updated.revision, layer.smart.revision + 1)
  assert.equal(layer.smart.layers[0].image.sourceUrl, 'blob:source')
})

test('usa resolução vertical válida ou o padrão sem inventar metadado no asset', () => {
  assert.equal(importedImageDocumentDpi(image({ resolutionDpiY: 300 })), 300)
  assert.equal(importedImageDocumentDpi(image()), MEDIA_DOCUMENT_FALLBACK_DPI)
  assert.equal(createNativePixelLayer(image()).image.resolutionDpiX, undefined)
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

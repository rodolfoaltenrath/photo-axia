import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GRADIENT_PREVIEW_LUT_SIZE,
  MAXIMUM_INTERACTIVE_GRADIENT_PREVIEW_PIXELS,
  MAXIMUM_GRADIENT_PREVIEW_LUT_SIZE,
  createGradientPreviewLookup,
  renderGradientPreviewPixels
} from '../src/editor/gradientPreview.ts'
import { applyGradientRaster } from '../src/editor/gradientRaster.ts'
import { threeStopTransparentGradientFixture } from './gradientStops.fixtures.mjs'

const geometry = {
  start: { x: 0.5, y: 0.5 },
  end: { x: 4.5, y: 0.5 }
}

test('preview interativo respeita orçamento de 512² pixels', () => {
  assert.equal(MAXIMUM_INTERACTIVE_GRADIENT_PREVIEW_PIXELS, 512 * 512)
})

test('LUT preserva extremos, transparência e limites de tamanho', () => {
  const lookup = createGradientPreviewLookup(threeStopTransparentGradientFixture, 5)
  assert.equal(lookup.size, 5)
  assert.deepEqual([...lookup.pixels], [
    255, 0, 0, 255,
    128, 128, 0, 128,
    0, 255, 0, 0,
    0, 128, 128, 128,
    0, 0, 255, 255
  ])
  assert.equal(createGradientPreviewLookup(threeStopTransparentGradientFixture, 1).size, 2)
  assert.equal(
    createGradientPreviewLookup(threeStopTransparentGradientFixture, Number.POSITIVE_INFINITY).size,
    DEFAULT_GRADIENT_PREVIEW_LUT_SIZE
  )
  assert.equal(
    createGradientPreviewLookup(threeStopTransparentGradientFixture, 1_000_000).size,
    MAXIMUM_GRADIENT_PREVIEW_LUT_SIZE
  )
})

test('preview linear coincide com o raster definitivo nos pontos de controle', () => {
  const preview = renderGradientPreviewPixels({
    width: 5,
    height: 1,
    documentWidth: 5,
    documentHeight: 1,
    geometry,
    config: threeStopTransparentGradientFixture,
    lookup: createGradientPreviewLookup(threeStopTransparentGradientFixture, 5)
  })
  const raster = applyGradientRaster({
    sourcePixels: new Uint8ClampedArray(5 * 4),
    sourceWidth: 5,
    sourceHeight: 1,
    transform: { x: 0, y: 0, width: 5, height: 1, rotation: 0 },
    geometry,
    config: threeStopTransparentGradientFixture,
    selection: null,
    documentWidth: 5,
    documentHeight: 1
  })
  assert.deepEqual(preview, raster.pixels)
})

test('preview radial usa centros de pixel no mesmo espaço do documento', () => {
  const config = { ...threeStopTransparentGradientFixture, type: 'radial' }
  const pixels = renderGradientPreviewPixels({
    width: 5,
    height: 5,
    documentWidth: 5,
    documentHeight: 5,
    geometry: { start: { x: 2.5, y: 2.5 }, end: { x: 4.5, y: 2.5 } },
    config
  })
  const pixel = (x, y) => [...pixels.slice((y * 5 + x) * 4, (y * 5 + x + 1) * 4)]
  assert.deepEqual(pixel(2, 2), [255, 0, 0, 255])
  assert.deepEqual(pixel(4, 2), [0, 0, 255, 255])
  assert.deepEqual(pixel(0, 0), [0, 0, 255, 255])
})

test('preview reutiliza o buffer quando as dimensões permanecem estáveis', () => {
  const output = new Uint8ClampedArray(5 * 4)
  const result = renderGradientPreviewPixels({
    width: 5,
    height: 1,
    documentWidth: 5,
    documentHeight: 1,
    geometry,
    config: threeStopTransparentGradientFixture,
    output
  })
  assert.equal(result, output)
})

test('contrato legado continua produzindo preview opaco equivalente', () => {
  const pixels = renderGradientPreviewPixels({
    width: 3,
    height: 1,
    documentWidth: 3,
    documentHeight: 1,
    geometry: { start: { x: 0.5, y: 0.5 }, end: { x: 2.5, y: 0.5 } },
    config: {
      type: 'linear',
      foregroundColor: '#000000',
      backgroundColor: '#ffffff',
      reversed: false
    }
  })
  assert.deepEqual([...pixels], [
    0, 0, 0, 255,
    128, 128, 128, 255,
    255, 255, 255, 255
  ])
})

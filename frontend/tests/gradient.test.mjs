import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GRADIENT_CONFIG,
  gradientGestureAction,
  gradientIsDegenerate,
  gradientLength,
  gradientLineBounds,
  interpolateGradientColor,
  linearGradientProgress,
  parseGradientColor,
  snapGradientEndpoint
} from '../src/editor/gradient.ts'
import {
  applyGradientRaster,
  createGradientRasterState,
  gradientRasterGeometry,
  gradientResultTransform,
  renderGradientRasterRows
} from '../src/editor/gradientRaster.ts'

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

test('confirma somente pointerup válido e cancela os demais encerramentos', () => {
  const geometry = { start: { x: 1, y: 1 }, end: { x: 20, y: 1 } }
  assert.equal(gradientGestureAction('pointerup', geometry), 'confirm')
  assert.equal(gradientGestureAction('pointercancel', geometry), 'cancel')
  assert.equal(gradientGestureAction('lostpointercapture', geometry), 'cancel')
  assert.equal(gradientGestureAction('pointerup', {
    start: { x: 1, y: 1 },
    end: { x: 1.49, y: 1 }
  }), 'cancel')
})

const transparentPixels = (width, height) => new Uint8ClampedArray(width * height * 4)
const identityTransform = (width, height, x = 0, y = 0) => ({ x, y, width, height, rotation: 0 })
const linearConfig = {
  type: 'linear',
  foregroundColor: '#000000',
  backgroundColor: '#ffffff',
  reversed: false
}

function redChannels(pixels) {
  const channels = []
  for (let index = 0; index < pixels.length; index += 4) channels.push(pixels[index])
  return channels
}

test('aplica o degradê em RGBA usando o centro dos pixels do documento', () => {
  const result = applyGradientRaster({
    sourcePixels: transparentPixels(4, 1),
    sourceWidth: 4,
    sourceHeight: 1,
    transform: identityTransform(4, 1),
    geometry: { start: { x: 0.5, y: 0.5 }, end: { x: 3.5, y: 0.5 } },
    config: linearConfig,
    selection: null,
    documentWidth: 4,
    documentHeight: 1
  })
  assert.deepEqual(redChannels(result.pixels), [0, 85, 170, 255])
  assert.deepEqual([...result.pixels.filter((_, index) => index % 4 === 3)], [255, 255, 255, 255])
})

test('expande raster compacto até os limites do documento e preserva sua origem', () => {
  const geometry = gradientRasterGeometry(2, 1, identityTransform(2, 1, 1, 0), 4, 1, true)
  assert.deepEqual(geometry, { originX: -1, originY: 0, width: 4, height: 1 })

  const result = applyGradientRaster({
    sourcePixels: transparentPixels(2, 1),
    sourceWidth: 2,
    sourceHeight: 1,
    transform: identityTransform(2, 1, 1, 0),
    geometry: { start: { x: 0.5, y: 0.5 }, end: { x: 3.5, y: 0.5 } },
    config: linearConfig,
    selection: null,
    documentWidth: 4,
    documentHeight: 1
  })
  assert.deepEqual(result.geometry, geometry)
  assert.deepEqual(redChannels(result.pixels), [0, 85, 170, 255])
  assert.deepEqual(
    gradientResultTransform(identityTransform(2, 1, 1, 0), 2, 1, geometry),
    { x: 0, y: 0, width: 4, height: 1, rotation: 0 }
  )
})

test('seleções vetoriais e por pixels limitam a composição sem expandir o raster', () => {
  const baseRequest = {
    sourcePixels: transparentPixels(4, 1),
    sourceWidth: 4,
    sourceHeight: 1,
    transform: identityTransform(4, 1),
    geometry: { start: { x: 0.5, y: 0.5 }, end: { x: 3.5, y: 0.5 } },
    config: linearConfig,
    documentWidth: 4,
    documentHeight: 1
  }
  const rectangle = applyGradientRaster({
    ...baseRequest,
    selection: { kind: 'rectangle', bounds: { x: 1, y: 0, width: 2, height: 1 } }
  })
  assert.deepEqual(redChannels(rectangle.pixels), [0, 85, 170, 0])
  assert.deepEqual(rectangle.geometry, { originX: 0, originY: 0, width: 4, height: 1 })

  const pixels = applyGradientRaster({
    ...baseRequest,
    selection: {
      kind: 'pixels',
      layerId: 'layer-1',
      sourceWidth: 4,
      sourceHeight: 1,
      sourceToDocument: [1, 0, 0, 1, 0, 0],
      spans: [{ y: 0, x0: 2, x1: 4 }],
      bounds: { x: 2, y: 0, width: 2, height: 1 },
      pixelCount: 2
    }
  })
  assert.deepEqual(redChannels(pixels.pixels), [0, 0, 170, 255])
})

test('elipse e laço usam a mesma máscara no núcleo compartilhado', () => {
  const baseRequest = {
    sourcePixels: transparentPixels(4, 4),
    sourceWidth: 4,
    sourceHeight: 4,
    transform: identityTransform(4, 4),
    geometry: { start: { x: 0, y: 2 }, end: { x: 4, y: 2 } },
    config: linearConfig,
    documentWidth: 4,
    documentHeight: 4
  }
  const ellipse = applyGradientRaster({
    ...baseRequest,
    selection: { kind: 'ellipse', bounds: { x: 0, y: 0, width: 4, height: 4 } }
  })
  assert.equal(ellipse.pixels[(1 * 4 + 1) * 4 + 3], 255)
  assert.equal(ellipse.pixels[3], 0)

  const lasso = applyGradientRaster({
    ...baseRequest,
    selection: {
      kind: 'lasso',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }],
      bounds: { x: 0, y: 0, width: 4, height: 4 }
    }
  })
  assert.equal(lasso.pixels[(0 * 4 + 0) * 4 + 3], 255)
  assert.equal(lasso.pixels[(3 * 4 + 3) * 4 + 3], 0)
})

test('calcula as cores em espaço do documento para camada rotacionada', () => {
  const result = applyGradientRaster({
    sourcePixels: transparentPixels(2, 2),
    sourceWidth: 2,
    sourceHeight: 2,
    transform: { x: 0, y: 0, width: 2, height: 2, rotation: 90 },
    geometry: { start: { x: 0, y: 1 }, end: { x: 2, y: 1 } },
    config: linearConfig,
    selection: { kind: 'rectangle', bounds: { x: 0, y: 0, width: 2, height: 2 } },
    documentWidth: 2,
    documentHeight: 2
  })
  assert.deepEqual(redChannels(result.pixels), [191, 191, 64, 64])
})

test('processamento integral e processamento em lotes produzem pixels idênticos', () => {
  const request = {
    sourcePixels: transparentPixels(5, 4),
    sourceWidth: 5,
    sourceHeight: 4,
    transform: identityTransform(5, 4),
    geometry: { start: { x: 0, y: 0 }, end: { x: 5, y: 4 } },
    config: { ...linearConfig, reversed: true },
    selection: null,
    documentWidth: 5,
    documentHeight: 4
  }
  const complete = applyGradientRaster(request)
  const chunked = createGradientRasterState(request)
  renderGradientRasterRows(chunked, 0, 2)
  renderGradientRasterRows(chunked, 2, 4)
  assert.deepEqual(chunked.geometry, complete.geometry)
  assert.deepEqual(chunked.pixels, complete.pixels)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GRADIENT_STOPS_CONFIG,
  MAX_GRADIENT_COLOR_STOPS,
  MAX_GRADIENT_OPACITY_STOPS,
  createGradientInterpolator,
  interpolateGradientColor,
  interpolateGradientStops,
  normalizeGradientStopsConfig
} from '../src/editor/gradient.ts'
import {
  applyGradientRaster,
  createGradientRasterState,
  renderGradientRasterRows
} from '../src/editor/gradientRaster.ts'
import {
  eightStopGradientFixture,
  gradientStopsFixture,
  thirtyTwoStopGradientFixture,
  threeStopTransparentGradientFixture,
  twoStopGradientFixture
} from './gradientStops.fixtures.mjs'

test('define duas cores e opacidade total como contrato canônico inicial', () => {
  assert.deepEqual(DEFAULT_GRADIENT_STOPS_CONFIG, {
    type: 'linear',
    colorStops: [
      { id: 'color-start', position: 0, color: '#000000' },
      { id: 'color-end', position: 1, color: '#ffffff' }
    ],
    opacityStops: [
      { id: 'opacity-start', position: 0, opacity: 100 },
      { id: 'opacity-end', position: 1, opacity: 100 }
    ],
    reversed: false,
    interpolation: 'srgb'
  })
  assert.equal(Object.isFrozen(DEFAULT_GRADIENT_STOPS_CONFIG.colorStops), true)
})

test('migra o contrato legado sem alterar seus pixels', () => {
  const legacy = {
    type: 'radial',
    foregroundColor: '#102030',
    backgroundColor: '#d0e0f0',
    reversed: true
  }
  const normalized = normalizeGradientStopsConfig(legacy)
  assert.equal(normalized.type, 'radial')
  assert.deepEqual(normalized.colorStops.map(({ position, color }) => ({ position, color })), [
    { position: 0, color: '#102030' },
    { position: 1, color: '#d0e0f0' }
  ])
  for (const progress of [-1, 0, 0.125, 0.5, 0.875, 1, 2]) {
    assert.deepEqual(
      interpolateGradientStops(normalized, progress),
      [...interpolateGradientColor('#102030', '#d0e0f0', progress, true), 255]
    )
  }
})

test('normaliza ordem, limites, cores, opacidades e IDs duplicados', () => {
  const normalized = normalizeGradientStopsConfig({
    type: 'desconhecido',
    colorStops: [
      { id: 'repetido', position: 2, color: '#ABCDEF' },
      { id: 'repetido', position: -1, color: '#123456' },
      { id: 'inválido', position: Number.NaN, color: '#ffffff' },
      { position: 0.5, color: 'red' }
    ],
    opacityStops: [
      { id: 'repetido', position: 1.5, opacity: 150 },
      { id: 'repetido', position: -0.5, opacity: -20 }
    ],
    reversed: 'sim',
    interpolation: 'lab'
  })
  assert.equal(normalized.type, 'linear')
  assert.equal(normalized.reversed, false)
  assert.equal(normalized.interpolation, 'srgb')
  assert.deepEqual(normalized.colorStops, [
    { id: 'repetido-2', position: 0, color: '#123456' },
    { id: 'repetido', position: 1, color: '#abcdef' }
  ])
  assert.deepEqual(normalized.opacityStops, [
    { id: 'repetido-2', position: 0, opacity: 0 },
    { id: 'repetido', position: 1, opacity: 100 }
  ])
})

test('repara entradas vazias ou com um único ponto sem produzir arrays inválidos', () => {
  assert.equal(normalizeGradientStopsConfig(null).colorStops.length, 2)
  const normalized = normalizeGradientStopsConfig({
    colorStops: [{ id: 'only-color', position: 0.25, color: '#336699' }],
    opacityStops: [{ id: 'only-opacity', position: 0.75, opacity: 40 }]
  })
  assert.deepEqual(normalized.colorStops.map((stop) => [stop.position, stop.color]), [
    [0.25, '#336699'],
    [1, '#336699']
  ])
  assert.deepEqual(normalized.opacityStops.map((stop) => [stop.position, stop.opacity]), [
    [0, 40],
    [0.75, 40]
  ])
})

test('limita cada trilha a 32 pontos e devolve snapshots clonáveis e independentes', () => {
  const oversized = gradientStopsFixture(40)
  oversized.opacityStops = Array.from({ length: 40 }, (_, index) => ({
    id: `opacity-${index}`,
    position: index / 39,
    opacity: index * 100 / 39
  }))
  const normalized = normalizeGradientStopsConfig(oversized)
  assert.equal(normalized.colorStops.length, MAX_GRADIENT_COLOR_STOPS)
  assert.equal(normalized.opacityStops.length, MAX_GRADIENT_OPACITY_STOPS)
  assert.doesNotThrow(() => structuredClone(normalized))
  const second = normalizeGradientStopsConfig(normalized)
  assert.notEqual(second.colorStops, normalized.colorStops)
  assert.notEqual(second.colorStops[0], normalized.colorStops[0])
})

test('fixtures de 2, 8 e 32 pontos permanecem válidas', () => {
  for (const [fixture, count] of [
    [twoStopGradientFixture, 2],
    [eightStopGradientFixture, 8],
    [thirtyTwoStopGradientFixture, 32]
  ]) {
    assert.equal(normalizeGradientStopsConfig(fixture).colorStops.length, count)
  }
})

test('interpola três cores e uma trilha de opacidade independente', () => {
  assert.deepEqual(interpolateGradientStops(threeStopTransparentGradientFixture, 0), [255, 0, 0, 255])
  assert.deepEqual(interpolateGradientStops(threeStopTransparentGradientFixture, 0.25), [128, 128, 0, 128])
  assert.deepEqual(interpolateGradientStops(threeStopTransparentGradientFixture, 0.5), [0, 255, 0, 0])
  assert.deepEqual(interpolateGradientStops(threeStopTransparentGradientFixture, 0.75), [0, 128, 128, 128])
  assert.deepEqual(interpolateGradientStops(threeStopTransparentGradientFixture, 1), [0, 0, 255, 255])
})

test('inversão espelha a posição sem perder valores de cor ou opacidade', () => {
  const reversed = { ...threeStopTransparentGradientFixture, reversed: true }
  for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
    assert.deepEqual(
      interpolateGradientStops(reversed, progress),
      interpolateGradientStops(threeStopTransparentGradientFixture, 1 - progress)
    )
  }
})

test('interpolador compilado mantém snapshot próprio e evita depender do estado reativo', () => {
  const source = structuredClone(threeStopTransparentGradientFixture)
  const interpolate = createGradientInterpolator(source)
  source.colorStops[1].color = '#ffffff'
  source.opacityStops[1].opacity = 100
  assert.deepEqual(interpolate(0.5), [0, 255, 0, 0])
})

test('interpolador escreve no buffer sem alocar uma cor por pixel e preserva o resultado', () => {
  const interpolate = createGradientInterpolator(threeStopTransparentGradientFixture)
  const output = new Uint8ClampedArray(12).fill(17)
  for (const [index, progress] of [-0.5, 0.25, 1.5].entries()) {
    interpolate.write(output, index * 4, progress)
    assert.deepEqual(
      [...output.slice(index * 4, index * 4 + 4)],
      [...interpolate(progress)]
    )
  }
})

test('pontos coincidentes formam uma transição determinística', () => {
  const config = {
    ...twoStopGradientFixture,
    colorStops: [
      { id: 'black', position: 0, color: '#000000' },
      { id: 'red', position: 0.5, color: '#ff0000' },
      { id: 'blue', position: 0.5, color: '#0000ff' },
      { id: 'white', position: 1, color: '#ffffff' }
    ]
  }
  assert.deepEqual(interpolateGradientStops(config, 0.5), [0, 0, 255, 255])
  assert.deepEqual(interpolateGradientStops(config, 0.75), [128, 128, 255, 255])
})

const transparentPixels = (width, height) => new Uint8ClampedArray(width * height * 4)
const identityTransform = (width, height) => ({ x: 0, y: 0, width, height, rotation: 0 })

test('raster aplica múltiplas cores e transparência real no alfa', () => {
  const result = applyGradientRaster({
    sourcePixels: transparentPixels(5, 1),
    sourceWidth: 5,
    sourceHeight: 1,
    transform: identityTransform(5, 1),
    geometry: { start: { x: 0.5, y: 0.5 }, end: { x: 4.5, y: 0.5 } },
    config: threeStopTransparentGradientFixture,
    selection: null,
    documentWidth: 5,
    documentHeight: 1
  })
  assert.deepEqual([...result.pixels], [
    255, 0, 0, 255,
    128, 128, 0, 128,
    0, 255, 0, 0,
    0, 128, 128, 128,
    0, 0, 255, 255
  ])
})

test('processamento integral e em lotes permanecem idênticos com 32 pontos', () => {
  const request = {
    sourcePixels: transparentPixels(17, 9),
    sourceWidth: 17,
    sourceHeight: 9,
    transform: identityTransform(17, 9),
    geometry: { start: { x: 1, y: 1 }, end: { x: 16, y: 8 } },
    config: {
      ...thirtyTwoStopGradientFixture,
      type: 'radial',
      opacityStops: thirtyTwoStopGradientFixture.colorStops.map((stop, index) => ({
        id: `opacity-${index}`,
        position: stop.position,
        opacity: index % 2 === 0 ? 100 : 20
      }))
    },
    selection: null,
    documentWidth: 17,
    documentHeight: 9
  }
  const complete = applyGradientRaster(request)
  const chunked = createGradientRasterState(request)
  for (let row = 0; row < chunked.geometry.height; row += 3) {
    renderGradientRasterRows(chunked, row, row + 3)
  }
  assert.deepEqual(chunked.pixels, complete.pixels)
})

test('buffer de origem só é reutilizado quando o chamador autoriza explicitamente', () => {
  const baseRequest = {
    sourceWidth: 2,
    sourceHeight: 1,
    transform: identityTransform(2, 1),
    geometry: { start: { x: 0.5, y: 0.5 }, end: { x: 1.5, y: 0.5 } },
    config: twoStopGradientFixture,
    selection: null,
    documentWidth: 2,
    documentHeight: 1
  }
  const preserved = transparentPixels(2, 1)
  assert.notEqual(createGradientRasterState({ ...baseRequest, sourcePixels: preserved }).pixels, preserved)
  const owned = transparentPixels(2, 1)
  assert.equal(createGradientRasterState({
    ...baseRequest,
    sourcePixels: owned,
    reuseSourceBuffer: true
  }).pixels, owned)
})

test('transparência afeta somente a seleção e preserva o raster externo', () => {
  const sourcePixels = new Uint8ClampedArray([
    10, 20, 30, 40,
    10, 20, 30, 40,
    10, 20, 30, 40
  ])
  const result = applyGradientRaster({
    sourcePixels,
    sourceWidth: 3,
    sourceHeight: 1,
    transform: identityTransform(3, 1),
    geometry: { start: { x: 0.5, y: 0.5 }, end: { x: 2.5, y: 0.5 } },
    config: threeStopTransparentGradientFixture,
    selection: { kind: 'rectangle', bounds: { x: 1, y: 0, width: 1, height: 1 } },
    documentWidth: 3,
    documentHeight: 1
  })
  assert.deepEqual([...result.pixels], [
    10, 20, 30, 40,
    0, 255, 0, 0,
    10, 20, 30, 40
  ])
})

test('estado raster mantém snapshot independente da configuração recebida', () => {
  const config = structuredClone(threeStopTransparentGradientFixture)
  const state = createGradientRasterState({
    sourcePixels: transparentPixels(1, 1),
    sourceWidth: 1,
    sourceHeight: 1,
    transform: identityTransform(1, 1),
    geometry: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
    config,
    selection: null,
    documentWidth: 1,
    documentHeight: 1
  })
  config.colorStops[1].color = '#ffffff'
  config.opacityStops[1].opacity = 100
  renderGradientRasterRows(state, 0, 1)
  assert.deepEqual([...state.pixels], [0, 255, 0, 0])
})

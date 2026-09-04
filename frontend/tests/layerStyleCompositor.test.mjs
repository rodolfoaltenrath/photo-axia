import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeLayerStyleEffects,
  applyLayerFillOpacity,
  buildLayerStylePipeline,
  composeLayerStyleBase,
  layerStyleCacheKey,
  layerStyleEffectIsRasterSupported,
  layerStyleHash,
  layerStyleInsets,
  layerStyleNeedsCompositing,
  LAYER_STYLE_COMPOSITION_ORDER
} from '../src/editor/layerStyleCompositor.ts'
import { createDefaultLayerEffect, normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import { ByteBudgetLruCache, LatestGenerationByKey } from '../src/editor/renderCache.ts'

const globalLight = { angle: 0, altitude: 30 }

function testPatternAsset(id) {
  return {
    id,
    name: 'Padrão de teste',
    width: 4,
    height: 4,
    mimeType: 'image/png',
    sourceUrl: `blob:test-${id}`
  }
}

function styles(effects = [], fillOpacity = 100) {
  return normalizeLayerStyleConfig({ enabled: true, fillOpacity, effects })
}

test('mantém uma única regra de efeitos aceitos pelo compositor raster', () => {
  for (const type of [
    'drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'satin',
    'color-overlay', 'gradient-overlay', 'pattern-overlay', 'bevel-emboss'
  ]) {
    assert.equal(layerStyleEffectIsRasterSupported(createDefaultLayerEffect(type, `supported-${type}`)), true)
  }
  const colorStroke = createDefaultLayerEffect('stroke', 'supported-stroke')
  assert.equal(layerStyleEffectIsRasterSupported(colorStroke), true)
  const patternStroke = {
    ...colorStroke,
    paint: { type: 'pattern', pattern: undefined, angle: 0, scale: 100, linkWithLayer: true }
  }
  assert.equal(layerStyleEffectIsRasterSupported(patternStroke), true)
  const texturedBevel = createDefaultLayerEffect('bevel-emboss', 'textured-bevel')
  texturedBevel.textureEnabled = true
  assert.equal(layerStyleEffectIsRasterSupported(texturedBevel), true)
})

test('formaliza a ordem estável dos estágios e preserva a ordem entre efeitos do mesmo estágio', () => {
  const config = styles([
    { type: 'color-overlay', id: 'color' },
    { type: 'drop-shadow', id: 'shadow-a' },
    { type: 'inner-glow', id: 'inner' },
    { type: 'outer-glow', id: 'glow' },
    { type: 'drop-shadow', id: 'shadow-b' },
    { type: 'stroke', id: 'stroke' }
  ])
  const pipeline = buildLayerStylePipeline(config)
  assert.deepEqual(LAYER_STYLE_COMPOSITION_ORDER, ['external', 'content', 'internal', 'overlay', 'upper'])
  assert.deepEqual(pipeline.external.map((effect) => effect.id), ['shadow-a', 'glow', 'shadow-b'])
  assert.deepEqual(pipeline.internal.map((effect) => effect.id), ['inner'])
  assert.deepEqual(pipeline.overlay.map((effect) => effect.id), ['color'])
  assert.deepEqual(pipeline.upper.map((effect) => effect.id), ['stroke'])
})

test('efeitos desligados ou estilos globalmente ocultos não participam da composição', () => {
  const config = styles([
    { type: 'outer-glow', id: 'visible' },
    { type: 'stroke', id: 'disabled', enabled: false },
    { type: 'drop-shadow', id: 'transparent', opacity: 0 }
  ])
  assert.deepEqual(activeLayerStyleEffects(config).map((effect) => effect.id), ['visible'])
  config.enabled = false
  assert.deepEqual(activeLayerStyleEffects(config), [])
})

test('bounds incluem sombra direcional, brilho e traçado sem depender dos bounds originais', () => {
  const config = styles([
    { type: 'drop-shadow', id: 'shadow', useGlobalLight: true, distance: 10, size: 5 },
    { type: 'outer-glow', id: 'glow', size: 8 },
    { type: 'stroke', id: 'stroke', size: 6, position: 'center' }
  ])
  assert.deepEqual(layerStyleInsets(config, globalLight), { top: 8, right: 8, bottom: 8, left: 15 })
  assert.deepEqual(layerStyleInsets(config, globalLight, 2), { top: 16, right: 16, bottom: 16, left: 30 })
})

test('fill opacity altera somente o alfa, mantém RGB e não modifica o buffer de origem', () => {
  const source = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([10, 20, 30, 255, 90, 80, 70, 101])
  }
  const result = applyLayerFillOpacity(source, 50)
  assert.deepEqual([...result.data], [10, 20, 30, 128, 90, 80, 70, 51])
  assert.deepEqual([...source.data], [10, 20, 30, 255, 90, 80, 70, 101])
  assert.notEqual(result.data, source.data)
})

test('compositor base aplica fill e recusa efeitos ainda não implementados em vez de ignorá-los', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 200]) }
  assert.equal(composeLayerStyleBase(source, styles([], 25)).data[3], 50)
  assert.throws(() => composeLayerStyleBase(source, styles([{ type: 'outer-glow', id: 'glow' }])), /ainda não suportados/)
  assert.equal(layerStyleNeedsCompositing(styles([], 100)), false)
  assert.equal(layerStyleNeedsCompositing(styles([], 99)), true)
})

test('hash é determinístico para objetos equivalentes e muda com configuração ou luz global', () => {
  const first = styles([{ type: 'drop-shadow', id: 'shadow', size: 12, distance: 4 }], 80)
  const reordered = normalizeLayerStyleConfig({
    effects: [{ distance: 4, size: 12, id: 'shadow', type: 'drop-shadow' }],
    fillOpacity: 80,
    enabled: true
  })
  assert.equal(layerStyleHash(first, { angle: 120, altitude: 30 }), layerStyleHash(reordered, { altitude: 30, angle: 120 }))
  assert.notEqual(layerStyleHash(first, { angle: 120, altitude: 30 }), layerStyleHash(first, { angle: 121, altitude: 30 }))
  assert.notEqual(layerStyleHash(first, globalLight), layerStyleHash({ ...first, fillOpacity: 79 }, globalLight))
  const noGlobalLight = styles([{ type: 'color-overlay', id: 'color' }])
  assert.equal(layerStyleHash(noGlobalLight, { angle: 10, altitude: 5 }), layerStyleHash(noGlobalLight, { angle: 170, altitude: 80 }))
  const disabled = styles([{ type: 'drop-shadow', id: 'disabled', enabled: false, size: 2 }])
  const disabledChanged = styles([{ type: 'drop-shadow', id: 'disabled', enabled: false, size: 200 }])
  assert.equal(layerStyleHash(disabled, globalLight), layerStyleHash(disabledChanged, globalLight))
})

test('chave de cache inclui raster, resolução, qualidade e configuração normalizada', () => {
  const base = {
    layerId: 'layer-1', sourceIdentity: 'raster-7', sourceWidth: 100, sourceHeight: 50,
    styles: styles(), globalLight, resolutionScale: 1, quality: 'final'
  }
  const key = layerStyleCacheKey(base)
  assert.equal(layerStyleCacheKey({ ...base }), key)
  assert.notEqual(layerStyleCacheKey({ ...base, sourceIdentity: 'raster-8' }), key)
  assert.notEqual(layerStyleCacheKey({ ...base, resolutionScale: 0.5 }), key)
  assert.notEqual(layerStyleCacheKey({ ...base, quality: 'interactive' }), key)
})

test('LRU respeita orçamento, atualiza recência e libera somente entradas removidas', () => {
  const disposed = []
  const cache = new ByteBudgetLruCache(20, 2)
  const value = (id, byteSize) => ({ byteSize, dispose: () => disposed.push(id) })
  assert.equal(cache.set('a', value('a', 8)), true)
  assert.equal(cache.set('b', value('b', 8)), true)
  assert.equal(cache.get('a').byteSize, 8)
  assert.equal(cache.set('c', value('c', 8)), true)
  assert.equal(cache.get('b'), undefined)
  assert.deepEqual(disposed, ['b'])
  assert.equal(cache.sizeBytes, 16)
  assert.equal(cache.set('huge', value('huge', 50)), false)
  assert.deepEqual(disposed, ['b'])
  cache.clear()
  assert.deepEqual(disposed.sort(), ['a', 'b', 'c'])
  assert.equal(cache.sizeBytes, 0)
})

test('controle de geração impede publicação de resultados obsoletos por consumidor', () => {
  const generations = new LatestGenerationByKey()
  const first = generations.begin('canvas:layer-1')
  const second = generations.begin('canvas:layer-1')
  const independent = generations.begin('thumbnail:layer-1')
  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
  assert.equal(independent.isCurrent(), true)
  generations.invalidate('canvas:layer-1')
  assert.equal(second.isCurrent(), false)
  assert.equal(independent.isCurrent(), true)
  generations.delete('thumbnail:layer-1')
  assert.equal(independent.isCurrent(), false)
})

test('brilho externo expande o raster, permanece atrás do conteúdo e sobrevive a fill zero', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([20, 40, 60, 255]) }
  const glow = createDefaultLayerEffect('outer-glow', 'glow')
  glow.size = 1
  glow.spread = 100
  glow.opacity = 80
  const result = composeLayerStyleRaster(source, styles([glow], 0), globalLight)

  assert.deepEqual(
    { width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY },
    { width: 3, height: 3, offsetX: -1, offsetY: -1 }
  )
  assert.equal(result.data[3], 204)
  assert.equal(result.data[(1 * 3 + 1) * 4 + 3], 0)
  assert.equal(result.data[(1 * 3 + 2) * 4 + 3], 204)
})

test('compositor raster preserva dimensões e aplica fill quando não há efeito externo', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 200]) }
  const result = composeLayerStyleRaster(source, styles([], 25), globalLight)
  assert.deepEqual(
    { width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY },
    { width: 1, height: 1, offsetX: 0, offsetY: 0 }
  )
  assert.deepEqual([...result.data], [10, 20, 30, 50])
})

test('sobreposição de padrão sem imagem escolhida não produz efeito nem exige dados decodificados', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }
  const overlay = createDefaultLayerEffect('pattern-overlay', 'overlay-empty')
  const result = composeLayerStyleRaster(source, styles([overlay]), globalLight)
  assert.deepEqual([...result.data], [0, 0, 0, 255])
})

test('compositor raster recusa compor quando o padrão referenciado não foi decodificado', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }
  const overlay = createDefaultLayerEffect('pattern-overlay', 'overlay-missing')
  overlay.pattern = testPatternAsset('missing-pattern')
  assert.throws(
    () => composeLayerStyleRaster(source, styles([overlay]), globalLight),
    /pattern-overlay/
  )
})

test('compositor raster recusa bisel e entalhe quando a textura referenciada não foi decodificada', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }
  const bevel = createDefaultLayerEffect('bevel-emboss', 'textured')
  bevel.textureEnabled = true
  bevel.texture = testPatternAsset('missing-texture')
  assert.throws(
    () => composeLayerStyleRaster(source, styles([bevel]), globalLight),
    /bevel-emboss/
  )
})

test('compositor raster recusa traçado com padrão referenciado que não foi decodificado', () => {
  const source = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) }
  const stroke = createDefaultLayerEffect('stroke', 'stroke-missing-pattern')
  stroke.paint = { type: 'pattern', pattern: testPatternAsset('missing-stroke-pattern'), angle: 0, scale: 100, linkWithLayer: true }
  assert.throws(
    () => composeLayerStyleRaster(source, styles([stroke]), globalLight),
    /stroke/
  )
})

test('sobreposição de padrão amostra o padrão decodificado, recorta pela máscara e tiling é determinístico', () => {
  const source = { width: 4, height: 1, data: new Uint8ClampedArray(16).fill(255) }
  const overlay = createDefaultLayerEffect('pattern-overlay', 'overlay-sample')
  overlay.pattern = testPatternAsset('checker')
  overlay.opacity = 100
  overlay.scale = 100
  overlay.angle = 0
  const patternData = new Uint8ClampedArray(2 * 2 * 4)
  patternData.set([255, 0, 0, 255], 0)
  patternData.set([0, 255, 0, 255], 4)
  patternData.set([0, 0, 255, 255], 8)
  patternData.set([255, 255, 0, 255], 12)
  const patterns = new Map([['checker', { width: 2, height: 2, data: patternData }]])
  const first = composeLayerStyleRaster(source, styles([overlay]), globalLight, 1, patterns)
  const second = composeLayerStyleRaster(source, styles([overlay]), globalLight, 1, patterns)
  assert.deepEqual([...first.data], [...second.data])
  assert.notDeepEqual([...first.data.slice(0, 4)], [...first.data.slice(4, 8)])
})

test('brilho externo com ruído produz raster determinístico', () => {
  const source = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) }
  const glow = createDefaultLayerEffect('outer-glow', 'stable-glow')
  glow.size = 2
  glow.noise = 35
  const config = styles([glow])
  const first = composeLayerStyleRaster(source, config, globalLight)
  const second = composeLayerStyleRaster(source, config, globalLight)
  assert.deepEqual(first.data, second.data)
})

test('brilho interno permanece nos limites e sobrevive à opacidade de preenchimento zero', () => {
  const data = new Uint8ClampedArray(5 * 5 * 4)
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) data[(y * 5 + x) * 4 + 3] = 255
  }
  const glow = createDefaultLayerEffect('inner-glow', 'inner-edge')
  glow.paint = { type: 'color', color: '#ff0000' }
  glow.size = 1
  glow.opacity = 100
  glow.source = 'edge'
  const result = composeLayerStyleRaster({ width: 5, height: 5, data }, styles([glow], 0), globalLight)

  assert.deepEqual(
    { width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY },
    { width: 5, height: 5, offsetX: 0, offsetY: 0 }
  )
  assert.equal(result.data[(0 * 5 + 0) * 4 + 3], 0)
  assert.ok(result.data[(1 * 5 + 1) * 4 + 3] > 0)
  assert.equal(result.data[(2 * 5 + 2) * 4 + 3], 0)
})

test('origem do brilho interno alterna entre borda e centro', () => {
  const source = { width: 5, height: 5, data: new Uint8ClampedArray(5 * 5 * 4).fill(255) }
  const edge = createDefaultLayerEffect('inner-glow', 'inner-source')
  edge.size = 1
  edge.source = 'edge'
  const center = { ...edge, source: 'center' }
  const edgeResult = composeLayerStyleRaster(source, styles([edge], 0), globalLight)
  const centerResult = composeLayerStyleRaster(source, styles([center], 0), globalLight)
  const middleAlpha = (result) => result.data[(2 * 5 + 2) * 4 + 3]

  assert.equal(middleAlpha(edgeResult), 0)
  assert.ok(middleAlpha(centerResult) > 0)
  assert.notDeepEqual(edgeResult.data, centerResult.data)
})

test('sombra projetada respeita direção, distância e bounds da luz global', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }
  const shadow = createDefaultLayerEffect('drop-shadow', 'directional-shadow')
  shadow.angle = 180
  shadow.useGlobalLight = true
  shadow.distance = 2
  shadow.size = 0
  shadow.opacity = 100
  const result = composeLayerStyleRaster(source, styles([shadow], 0), globalLight)

  assert.deepEqual(
    { width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY },
    { width: 3, height: 1, offsetX: -2, offsetY: 0 }
  )
  assert.equal(result.data[3], 255)
  assert.equal(result.data[2 * 4 + 3], 0)
})

test('recorte da camada remove a sombra sobre o próprio conteúdo', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }
  const shadow = createDefaultLayerEffect('drop-shadow', 'knockout-shadow')
  shadow.distance = 0
  shadow.size = 0
  shadow.opacity = 100
  shadow.layerKnocksOutShadow = true
  const knockedOut = composeLayerStyleRaster(source, styles([shadow], 0), globalLight)
  shadow.layerKnocksOutShadow = false
  const retained = composeLayerStyleRaster(source, styles([shadow], 0), globalLight)

  assert.equal(knockedOut.data[3], 0)
  assert.equal(retained.data[3], 255)
})

test('sombra interna respeita direção sem expandir os limites da camada', () => {
  const source = { width: 5, height: 1, data: new Uint8ClampedArray(5 * 4).fill(255) }
  const shadow = createDefaultLayerEffect('inner-shadow', 'inner-direction')
  shadow.useGlobalLight = true
  shadow.distance = 1
  shadow.size = 0
  shadow.opacity = 100
  const result = composeLayerStyleRaster(source, styles([shadow], 0), globalLight)

  assert.deepEqual(
    { width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY },
    { width: 5, height: 1, offsetX: 0, offsetY: 0 }
  )
  assert.equal(result.data[3], 255)
  assert.equal(result.data[4 * 4 + 3], 0)
})

test('sombra interna nunca colore pixels fora da máscara alfa', () => {
  const data = new Uint8ClampedArray(3 * 4)
  data.set([255, 255, 255, 255], 4)
  const shadow = createDefaultLayerEffect('inner-shadow', 'inner-clip')
  shadow.useGlobalLight = false
  shadow.angle = 0
  shadow.distance = 1
  shadow.size = 1
  shadow.opacity = 100
  const result = composeLayerStyleRaster({ width: 3, height: 1, data }, styles([shadow], 0), globalLight)

  assert.equal(result.data[3], 0)
  assert.ok(result.data[4 + 3] > 0)
  assert.equal(result.data[8 + 3], 0)
})

test('traçado externo expande os bounds e preserva o interior transparente com fill zero', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }
  const stroke = createDefaultLayerEffect('stroke', 'outside-stroke')
  stroke.position = 'outside'
  stroke.size = 1
  stroke.opacity = 100
  stroke.paint = { type: 'color', color: '#ff0000' }
  const result = composeLayerStyleRaster(source, styles([stroke], 0), globalLight)

  assert.deepEqual(
    { width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY },
    { width: 3, height: 3, offsetX: -1, offsetY: -1 }
  )
  assert.equal(result.data[3], 255)
  assert.deepEqual([...result.data.slice(0, 3)], [255, 0, 0])
  assert.equal(result.data[(1 * 3 + 1) * 4 + 3], 0)
})

test('traçado interno permanece recortado e não cobre o centro além da espessura', () => {
  const source = { width: 3, height: 3, data: new Uint8ClampedArray(3 * 3 * 4).fill(255) }
  const stroke = createDefaultLayerEffect('stroke', 'inside-stroke')
  stroke.position = 'inside'
  stroke.size = 1
  stroke.opacity = 100
  const result = composeLayerStyleRaster(source, styles([stroke], 0), globalLight)

  assert.deepEqual({ width: result.width, height: result.height }, { width: 3, height: 3 })
  assert.ok(result.data[3] > 0)
  assert.equal(result.data[(1 * 3 + 1) * 4 + 3], 0)
})

test('traçado aceita gradiente espacial e não produz efeito com padrão sem imagem escolhida', () => {
  const source = { width: 3, height: 1, data: new Uint8ClampedArray(3 * 4).fill(255) }
  const stroke = createDefaultLayerEffect('stroke', 'gradient-stroke')
  stroke.position = 'outside'
  stroke.size = 1
  stroke.paint = {
    type: 'gradient', angle: 0, scale: 100, reverse: false, alignWithLayer: true,
    gradient: {
      type: 'linear', interpolation: 'srgb',
      colorStops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }],
      opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }]
    }
  }
  const result = composeLayerStyleRaster(source, styles([stroke], 0), globalLight)
  const left = [...result.data.slice(0, 3)]
  const rightOffset = (result.width - 1) * 4
  const right = [...result.data.slice(rightOffset, rightOffset + 3)]
  assert.ok(left[0] > left[2])
  assert.ok(right[2] > right[0])

  stroke.paint = { type: 'pattern', pattern: undefined, angle: 0, scale: 100, linkWithLayer: true }
  const withoutPattern = composeLayerStyleRaster(source, styles([stroke], 0), globalLight)
  assert.deepEqual([...withoutPattern.data], [...new Uint8ClampedArray(withoutPattern.width * withoutPattern.height * 4)])
})

test('sobreposição de cor respeita a máscara e permanece visível com fill zero', () => {
  const data = new Uint8ClampedArray([
    10, 20, 30, 0,
    10, 20, 30, 255
  ])
  const overlay = createDefaultLayerEffect('color-overlay', 'red-overlay')
  overlay.color = '#ff0000'
  overlay.opacity = 50
  overlay.blendMode = 'normal'
  const result = composeLayerStyleRaster({ width: 2, height: 1, data }, styles([overlay], 0), globalLight)

  assert.deepEqual([...result.data.slice(0, 4)], [0, 0, 0, 0])
  assert.deepEqual([...result.data.slice(4, 8)], [255, 0, 0, 128])
})

test('sobreposição de cor é composta antes do traçado superior', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }
  const overlay = createDefaultLayerEffect('color-overlay', 'overlay-order')
  overlay.color = '#ff0000'
  overlay.opacity = 100
  const stroke = createDefaultLayerEffect('stroke', 'stroke-order')
  stroke.position = 'inside'
  stroke.size = 1
  stroke.paint = { type: 'color', color: '#0000ff' }
  const result = composeLayerStyleRaster(source, styles([overlay, stroke]), globalLight)

  assert.deepEqual([...result.data], [0, 0, 255, 255])
})

test('acetinado não expande os limites do raster e respeita a máscara alfa', () => {
  const width = 6
  const height = 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let x = 1; x < 5; x++) {
    const offset = x * 4
    data[offset] = 0
    data[offset + 1] = 0
    data[offset + 2] = 0
    data[offset + 3] = 255
  }
  const satin = createDefaultLayerEffect('satin', 'satin-bounds')
  satin.color = '#ff0000'
  satin.distance = 2
  satin.size = 1
  const result = composeLayerStyleRaster({ width, height, data }, styles([satin]), globalLight)

  assert.deepEqual(
    { width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY },
    { width, height, offsetX: 0, offsetY: 0 }
  )
  assert.equal(result.data[3], 0)
  assert.equal(result.data[(width - 1) * 4 + 3], 0)
})

test('acetinado permanece visível com fill zero e inverter altera o resultado', () => {
  const width = 6
  const height = 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let x = 1; x < 5; x++) {
    const offset = x * 4
    data[offset] = 10
    data[offset + 1] = 20
    data[offset + 2] = 30
    data[offset + 3] = 255
  }
  const baseSatin = createDefaultLayerEffect('satin', 'satin-invert')
  baseSatin.color = '#ff0000'
  baseSatin.angle = 0
  baseSatin.distance = 2
  baseSatin.size = 1
  baseSatin.opacity = 100

  const normal = composeLayerStyleRaster({ width, height, data }, styles([baseSatin], 0), globalLight)
  const normalAlphaSum = normal.data.reduce((sum, value, index) => index % 4 === 3 ? sum + value : sum, 0)
  assert.ok(normalAlphaSum > 0)

  const inverted = composeLayerStyleRaster(
    { width, height, data },
    styles([{ ...baseSatin, invert: !baseSatin.invert }], 0),
    globalLight
  )
  assert.notDeepEqual([...normal.data], [...inverted.data])
})

test('sobreposição de gradiente respeita a máscara e permanece visível com fill zero', () => {
  const data = new Uint8ClampedArray([
    10, 20, 30, 0,
    10, 20, 30, 255
  ])
  const overlay = createDefaultLayerEffect('gradient-overlay', 'gradient-mask')
  overlay.gradient = {
    type: 'linear',
    colorStops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#ff0000' }],
    opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }],
    interpolation: 'srgb'
  }
  overlay.opacity = 50
  overlay.blendMode = 'normal'
  const result = composeLayerStyleRaster({ width: 2, height: 1, data }, styles([overlay], 0), globalLight)

  assert.deepEqual([...result.data.slice(0, 4)], [0, 0, 0, 0])
  assert.deepEqual([...result.data.slice(4, 8)], [255, 0, 0, 128])
})

test('sobreposição de gradiente não expande os limites do raster e varia espacialmente', () => {
  const source = { width: 4, height: 1, data: new Uint8ClampedArray(16).fill(255) }
  const overlay = createDefaultLayerEffect('gradient-overlay', 'gradient-spatial')
  overlay.angle = 0
  overlay.gradient = {
    type: 'linear',
    colorStops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
    opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }],
    interpolation: 'srgb'
  }
  const result = composeLayerStyleRaster(source, styles([overlay]), globalLight)

  assert.deepEqual(
    { width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY },
    { width: 4, height: 1, offsetX: 0, offsetY: 0 }
  )
  const leftPixel = result.data[0]
  const rightPixel = result.data[(result.width - 1) * 4]
  assert.ok(rightPixel > leftPixel)
})

test('sobreposição de gradiente é composta antes do traçado superior', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) }
  const overlay = createDefaultLayerEffect('gradient-overlay', 'gradient-order')
  overlay.opacity = 100
  overlay.gradient = {
    type: 'linear',
    colorStops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#ff0000' }],
    opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }],
    interpolation: 'srgb'
  }
  const stroke = createDefaultLayerEffect('stroke', 'stroke-order-gradient')
  stroke.position = 'inside'
  stroke.size = 1
  stroke.paint = { type: 'color', color: '#0000ff' }
  const result = composeLayerStyleRaster(source, styles([overlay, stroke]), globalLight)

  assert.deepEqual([...result.data], [0, 0, 255, 255])
})

test('bisel interno não expande os limites, mas bisel externo e entalhe expandem', () => {
  const source = { width: 6, height: 6, data: new Uint8ClampedArray(144).fill(0) }
  for (let y = 1; y < 5; y++) {
    for (let x = 1; x < 5; x++) source.data[(y * 6 + x) * 4 + 3] = 255
  }
  const inner = createDefaultLayerEffect('bevel-emboss', 'inner')
  inner.style = 'inner-bevel'
  inner.size = 2
  const innerResult = composeLayerStyleRaster(source, styles([inner]), globalLight)
  assert.deepEqual(
    { width: innerResult.width, height: innerResult.height },
    { width: 6, height: 6 }
  )

  const outer = createDefaultLayerEffect('bevel-emboss', 'outer')
  outer.style = 'outer-bevel'
  outer.size = 2
  const outerResult = composeLayerStyleRaster(source, styles([outer]), globalLight)
  assert.ok(outerResult.width > 6)
  assert.ok(outerResult.height > 6)

  const emboss = createDefaultLayerEffect('bevel-emboss', 'emboss')
  emboss.style = 'emboss'
  emboss.size = 2
  const embossResult = composeLayerStyleRaster(source, styles([emboss]), globalLight)
  assert.ok(embossResult.width > 6)
  assert.ok(embossResult.height > 6)
})

test('bisel e entalhe produzem resultado determinístico e pintam realce ou sombra na borda', () => {
  const source = { width: 8, height: 8, data: new Uint8ClampedArray(256).fill(0) }
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 7; x++) source.data[(y * 8 + x) * 4 + 3] = 255
  }
  const bevel = createDefaultLayerEffect('bevel-emboss', 'shaded')
  bevel.style = 'inner-bevel'
  bevel.size = 2
  bevel.depth = 200
  bevel.angle = 0
  bevel.altitude = 30
  bevel.useGlobalLight = false
  bevel.highlightColor = '#ffffff'
  bevel.highlightOpacity = 100
  bevel.shadowColor = '#000000'
  bevel.shadowOpacity = 100

  const first = composeLayerStyleRaster(source, styles([bevel]), globalLight)
  const second = composeLayerStyleRaster(source, styles([bevel]), globalLight)
  assert.deepEqual([...first.data], [...second.data])

  let edgeAlphaSum = 0
  for (let y = 1; y < 7; y++) {
    edgeAlphaSum += first.data[(y * 8 + 1) * 4 + 3]
    edgeAlphaSum += first.data[(y * 8 + 6) * 4 + 3]
  }
  assert.ok(edgeAlphaSum > 0)
})

test('direção do bisel inverte o resultado da luz e a textura é recusada explicitamente', () => {
  const source = { width: 8, height: 8, data: new Uint8ClampedArray(256).fill(0) }
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 7; x++) source.data[(y * 8 + x) * 4 + 3] = 255
  }
  const up = createDefaultLayerEffect('bevel-emboss', 'direction-up')
  up.style = 'inner-bevel'
  up.size = 2
  up.depth = 200
  up.direction = 'up'
  up.useGlobalLight = false

  const down = { ...up, direction: 'down' }
  const upResult = composeLayerStyleRaster(source, styles([up]), globalLight)
  const downResult = composeLayerStyleRaster(source, styles([down]), globalLight)
  assert.notDeepEqual([...upResult.data], [...downResult.data])
})

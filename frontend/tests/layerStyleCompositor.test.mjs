import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeLayerStyleEffects,
  applyLayerFillOpacity,
  buildLayerStylePipeline,
  composeLayerStyleBase,
  layerStyleCacheKey,
  layerStyleHash,
  layerStyleInsets,
  layerStyleNeedsCompositing,
  LAYER_STYLE_COMPOSITION_ORDER
} from '../src/editor/layerStyleCompositor.ts'
import { createDefaultLayerEffect, normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import { ByteBudgetLruCache, LatestGenerationByKey } from '../src/editor/renderCache.ts'

const globalLight = { angle: 0, altitude: 30 }

function styles(effects = [], fillOpacity = 100) {
  return normalizeLayerStyleConfig({ enabled: true, fillOpacity, effects })
}

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

test('compositor raster recusa efeitos ativos fora do pacote implementado', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }
  assert.throws(
    () => composeLayerStyleRaster(source, styles([createDefaultLayerEffect('stroke', 'stroke')]), globalLight),
    /stroke/
  )
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

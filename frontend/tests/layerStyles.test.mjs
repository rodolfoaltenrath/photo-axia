import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cloneLayerStyleConfig,
  createDefaultLayerEffect,
  createLayerStyleConfig,
  layerStyleFillOpacity,
  layerStylePatternAssets,
  normalizeLayerStyleFillOpacity,
  normalizeLayerEffect,
  normalizeLayerStyleConfig,
  normalizeLayerStyleGlobalLight
} from '../src/editor/layerStyles.ts'

const effectTypes = [
  'drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'stroke',
  'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'bevel-emboss'
]

test('fornece defaults completos e IDs independentes para todos os efeitos', () => {
  for (const type of effectTypes) {
    const first = createDefaultLayerEffect(type)
    const second = createDefaultLayerEffect(type)
    assert.equal(first.type, type)
    assert.equal(first.enabled, true)
    assert.match(first.id, new RegExp(`^${type}-`))
    assert.notEqual(first.id, second.id)
  }
  assert.deepEqual(createLayerStyleConfig(), { enabled: true, fillOpacity: 100, effects: [] })
})

test('expõe a opacidade de preenchimento normalizada como fator de alfa', () => {
  assert.equal(normalizeLayerStyleFillOpacity(125), 100)
  assert.equal(normalizeLayerStyleFillOpacity('35'), 100)
  assert.equal(layerStyleFillOpacity(undefined), 1)
  assert.equal(layerStyleFillOpacity({ enabled: true, fillOpacity: 35, effects: [] }), 0.35)
  assert.equal(layerStyleFillOpacity({ enabled: false, fillOpacity: -20, effects: [] }), 0)
  assert.equal(layerStyleFillOpacity({ enabled: true, fillOpacity: Number.NaN, effects: [] }), 1)
})

test('normaliza limites, cores, IDs duplicados e descarta efeitos desconhecidos', () => {
  const styles = normalizeLayerStyleConfig({
    enabled: 'sim',
    fillOpacity: 900,
    effects: [
      { type: 'drop-shadow', id: 'efeito', opacity: -20, size: 9_000, distance: -5, color: 'red' },
      { type: 'inner-shadow', id: 'efeito', opacity: 120, angle: 721 },
      { type: 'efeito-futuro', id: 'ignorado' }
    ]
  })
  assert.equal(styles.enabled, true)
  assert.equal(styles.fillOpacity, 100)
  assert.equal(styles.effects.length, 2)
  assert.equal(styles.effects[0].opacity, 0)
  assert.equal(styles.effects[0].size, 250)
  assert.equal(styles.effects[0].distance, 0)
  assert.equal(styles.effects[0].color, '#000000')
  assert.notEqual(styles.effects[0].id, styles.effects[1].id)
  assert.equal(styles.effects[1].opacity, 100)
  assert.equal(styles.effects[1].angle, 1)
})

test('clona todas as estruturas mutáveis sem compartilhar efeitos, gradientes ou contornos', () => {
  const styles = normalizeLayerStyleConfig({
    effects: [{
      type: 'gradient-overlay',
      id: 'gradiente-1',
      gradient: {
        colorStops: [{ position: 0, color: '#112233' }, { position: 1, color: '#ffffff' }],
        opacityStops: [{ position: 0, opacity: 20 }, { position: 1, opacity: 100 }]
      }
    }, {
      type: 'satin',
      id: 'acetinado-1',
      contour: { preset: 'custom', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    }]
  })
  const cloned = cloneLayerStyleConfig(styles)
  cloned.effects[0].opacity = 12
  cloned.effects[0].gradient.colorStops[0].color = '#abcdef'
  cloned.effects[1].contour.points[0].y = 0.5
  assert.equal(styles.effects[0].opacity, 100)
  assert.equal(styles.effects[0].gradient.colorStops[0].color, '#112233')
  assert.equal(styles.effects[1].contour.points[0].y, 0)
})

test('valida padrões e expõe somente assets realmente referenciados', () => {
  const pattern = {
    id: 'pattern-1', name: 'Grade', width: 32, height: 32,
    mimeType: 'image/png', sourceUrl: 'blob:pattern', byteSize: 512
  }
  const styles = normalizeLayerStyleConfig({ effects: [
    { type: 'pattern-overlay', id: 'pattern-effect', pattern },
    { type: 'bevel-emboss', id: 'bevel-effect', texture: { ...pattern, id: 'pattern-2' } },
    { type: 'stroke', id: 'stroke-effect', paint: { type: 'pattern', pattern: { ...pattern, width: 99_999, height: 99_999 } } }
  ] })
  assert.deepEqual(layerStylePatternAssets(styles).map((asset) => asset.id), ['pattern-1', 'pattern-2'])
  assert.equal(styles.effects[2].paint.pattern, undefined)
})

test('normaliza a luz global do documento', () => {
  assert.deepEqual(normalizeLayerStyleGlobalLight({ angle: 480, altitude: -20 }), { angle: 120, altitude: 0 })
  assert.deepEqual(normalizeLayerStyleGlobalLight(undefined), { angle: 120, altitude: 30 })
})

test('normalização isolada de efeito rejeita discriminantes desconhecidos', () => {
  assert.equal(normalizeLayerEffect({ type: 'unknown' }), undefined)
})

test('normaliza origem e limites do brilho interno', () => {
  const effect = normalizeLayerEffect({
    type: 'inner-glow', id: 'inner', source: 'center', choke: 140, size: -10, range: 0
  })
  assert.equal(effect.source, 'center')
  assert.equal(effect.choke, 100)
  assert.equal(effect.size, 0)
  assert.equal(effect.range, 1)
  assert.equal(normalizeLayerEffect({ type: 'inner-glow', source: 'invalid' }).source, 'edge')
})

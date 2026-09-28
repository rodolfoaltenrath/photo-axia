import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cloneLayerStyleConfig,
  createDefaultLayerEffect,
  createLayerStyleBlendIf,
  createLayerStyleConfig,
  layerStyleBlendIfIsDefault,
  layerStyleBlendIfOpacity,
  layerStyleFillOpacity,
  layerStylePatternAssets,
  normalizeLayerStyleFillOpacity,
  normalizeLayerEffect,
  normalizeLayerStyleConfig,
  normalizeLayerStyleGlobalLight
} from '../src/editor/layerStyles.ts'
import type { LayerEffectType } from '../src/types/editor.ts'

const effectTypes = [
  'drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'stroke',
  'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'bevel-emboss'
] as const satisfies readonly LayerEffectType[]

test('fornece defaults completos e IDs independentes para todos os efeitos', () => {
  for (const type of effectTypes) {
    const first = createDefaultLayerEffect(type)
    const second = createDefaultLayerEffect(type)
    assert.equal(first.type, type)
    assert.equal(first.enabled, true)
    assert.match(first.id, new RegExp(`^${type}-`))
    assert.notEqual(first.id, second.id)
  }
  assert.deepEqual(createLayerStyleConfig(), {
    enabled: true,
    blendIf: {
      channel: 'gray',
      thisLayer: { shadows: [0, 0], highlights: [255, 255] },
      underlyingLayer: { shadows: [0, 0], highlights: [255, 255] }
    },
    fillOpacity: 100,
    effects: []
  })
})

test('normaliza Mesclar se, preserva os pares divididos e calcula a transição suave', () => {
  const blendIf = createLayerStyleBlendIf()
  blendIf.thisLayer = { shadows: [60, 20], highlights: [240, 200] }
  blendIf.underlyingLayer = { shadows: [80, 24], highlights: [245, 210] }
  const styles = normalizeLayerStyleConfig({ blendIf })
  assert.deepEqual(styles.blendIf.thisLayer, { shadows: [20, 60], highlights: [200, 240] })
  assert.deepEqual(styles.blendIf.underlyingLayer, { shadows: [24, 80], highlights: [210, 245] })
  assert.equal(layerStyleBlendIfIsDefault(styles.blendIf), false)
  assert.equal(layerStyleBlendIfOpacity(styles.blendIf, 20), 0)
  assert.equal(layerStyleBlendIfOpacity(styles.blendIf, 40), 0.5)
  assert.equal(layerStyleBlendIfOpacity(styles.blendIf, 100), 1)
  assert.equal(layerStyleBlendIfOpacity(styles.blendIf, 220), 0.5)
  assert.equal(layerStyleBlendIfOpacity(styles.blendIf, 240), 0)
  assert.equal(layerStyleBlendIfOpacity(styles.blendIf, 52, 'underlyingLayer'), 0.5)
})

test('Mesclar se seleciona um canal RGB e projetos antigos recebem Camada abaixo padrão', () => {
  const legacy = normalizeLayerStyleConfig({
    blendIf: { channel: 'red', thisLayer: { shadows: [20, 20], highlights: [255, 255] } }
  })
  assert.deepEqual(legacy.blendIf.underlyingLayer, { shadows: [0, 0], highlights: [255, 255] })
  assert.equal(layerStyleBlendIfOpacity(legacy.blendIf, { red: 10, green: 255, blue: 255 }), 0)
  assert.equal(layerStyleBlendIfOpacity(legacy.blendIf, { red: 24, green: 0, blue: 0 }), 1)
})

test('expõe a opacidade de preenchimento normalizada como fator de alfa', () => {
  assert.equal(normalizeLayerStyleFillOpacity(125), 100)
  assert.equal(normalizeLayerStyleFillOpacity('35'), 100)
  assert.equal(layerStyleFillOpacity(undefined), 1)
  assert.equal(layerStyleFillOpacity({ ...createLayerStyleConfig(), enabled: true, fillOpacity: 35 }), 0.35)
  assert.equal(layerStyleFillOpacity({ ...createLayerStyleConfig(), enabled: false, fillOpacity: -20 }), 0)
  assert.equal(layerStyleFillOpacity({ ...createLayerStyleConfig(), enabled: true, fillOpacity: Number.NaN }), 1)
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
  const shadow = styles.effects[0]
  const innerShadow = styles.effects[1]
  assert.ok(shadow?.type === 'drop-shadow')
  assert.ok(innerShadow?.type === 'inner-shadow')
  assert.equal(shadow.opacity, 0)
  assert.equal(shadow.size, 250)
  assert.equal(shadow.distance, 0)
  assert.equal(shadow.color, '#000000')
  assert.notEqual(shadow.id, innerShadow.id)
  assert.equal(innerShadow.opacity, 100)
  assert.equal(innerShadow.angle, 1)
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
  const clonedGradient = cloned.effects[0]
  const clonedSatin = cloned.effects[1]
  const gradient = styles.effects[0]
  const satin = styles.effects[1]
  assert.ok(clonedGradient?.type === 'gradient-overlay')
  assert.ok(clonedSatin?.type === 'satin')
  assert.ok(gradient?.type === 'gradient-overlay')
  assert.ok(satin?.type === 'satin')
  clonedGradient.opacity = 12
  clonedGradient.gradient.colorStops[0]!.color = '#abcdef'
  clonedSatin.contour.points[0]!.y = 0.5
  assert.equal(gradient.opacity, 100)
  assert.equal(gradient.gradient.colorStops[0]!.color, '#112233')
  assert.equal(satin.contour.points[0]!.y, 0)
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
  const stroke = styles.effects[2]
  assert.ok(stroke?.type === 'stroke')
  assert.equal(stroke.paint.type === 'pattern' ? stroke.paint.pattern : undefined, undefined)
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
  assert.ok(effect?.type === 'inner-glow')
  assert.equal(effect.source, 'center')
  assert.equal(effect.choke, 100)
  assert.equal(effect.size, 0)
  assert.equal(effect.range, 1)
  const invalidSource = normalizeLayerEffect({ type: 'inner-glow', source: 'invalid' })
  assert.ok(invalidSource?.type === 'inner-glow')
  assert.equal(invalidSource.source, 'edge')
})

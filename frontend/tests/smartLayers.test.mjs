import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cloneSmartLayerContent,
  createSmartLayer,
  layersCanConvertToSmart,
  smartLayerDepth
} from '../src/editor/smartLayers.ts'

const document = {
  resolutionDpi: 144,
  colorSpace: 'sRGB',
  background: 'transparent',
  layerStyleGlobalLight: { angle: 120, altitude: 30 }
}

const defaultStyles = () => ({ enabled: true, fillOpacity: 100, effects: [] })
const imageLayer = (overrides = {}) => ({
  id: 'image', name: 'Imagem', visible: true, opacity: 70, blendMode: 'multiply', kind: 'image',
  styles: defaultStyles(),
  image: { width: 100, height: 80, mimeType: 'image/png', sourceUrl: 'blob:image' },
  transform: { x: 40, y: 25, width: 100, height: 80, rotation: 15 },
  ...overrides
})

test('conversão individual mantém composição externa somente no invólucro', () => {
  const source = imageLayer()
  const smart = createSmartLayer(
    document,
    [{ index: 2, layer: source }],
    { x: 30, y: 10, width: 125, height: 110 },
    { width: 125, height: 110, mimeType: 'image/png', sourceUrl: 'blob:cache' },
    'smart'
  )

  assert.equal(smart.kind, 'smart')
  assert.equal(smart.opacity, 70)
  assert.equal(smart.blendMode, 'multiply')
  assert.equal(smart.styles.effects.length, 0)
  assert.deepEqual(smart.transform, { x: 30, y: 10, width: 125, height: 110, rotation: 0 })
  assert.equal(smart.smart.layers[0].opacity, 100)
  assert.equal(smart.smart.layers[0].blendMode, 'normal')
  assert.deepEqual(smart.smart.layers[0].transform, { x: 10, y: 15, width: 100, height: 80, rotation: 15 })
  assert.equal(source.transform.x, 40)
})

test('conversão múltipla preserva ordem, estados internos e normaliza coordenadas', () => {
  const first = imageLayer({ id: 'top', opacity: 45, visible: false })
  const second = imageLayer({ id: 'bottom', transform: { x: 10, y: 5, width: 40, height: 30, rotation: 0 } })
  const smart = createSmartLayer(
    document,
    [{ index: 1, layer: first }, { index: 4, layer: second }],
    { x: 5, y: 3, width: 150, height: 120 },
    { width: 150, height: 120, mimeType: 'image/png', sourceUrl: 'blob:cache' },
    'smart'
  )

  assert.deepEqual(smart.smart.layers.map((layer) => layer.id), ['top', 'bottom'])
  assert.equal(smart.smart.layers[0].visible, false)
  assert.equal(smart.smart.layers[0].opacity, 45)
  assert.equal(smart.smart.layers[1].transform.x, 5)
  assert.equal(smart.smart.layers[1].transform.y, 2)
  assert.equal(smart.opacity, 100)
  assert.equal(smart.blendMode, 'normal')
})

test('clonagem de conteúdo inteligente é recursiva e respeita o limite de profundidade', () => {
  const leaf = imageLayer()
  let layer = leaf
  for (let depth = 0; depth < 8; depth++) {
    layer = {
      ...imageLayer({ id: `smart-${depth}`, kind: 'smart' }),
      smart: {
        id: `content-${depth}`, width: 100, height: 80, resolutionDpi: 72, colorSpace: 'sRGB', background: 'transparent',
        layerStyleGlobalLight: { angle: 120, altitude: 30 }, layers: [layer], revision: 1
      }
    }
  }
  assert.equal(smartLayerDepth(layer), 8)
  assert.equal(layersCanConvertToSmart([{ index: 0, layer }]), false)

  const cloned = cloneSmartLayerContent(layer.smart)
  cloned.layers[0].name = 'Alterado'
  assert.notEqual(layer.smart.layers[0].name, 'Alterado')
})

test('rejeita seleção vazia, ajuste e conjunto oculto sem aparência, mas aceita camada oculta individual', () => {
  assert.equal(layersCanConvertToSmart([]), false)
  assert.equal(layersCanConvertToSmart([{ index: 0, layer: imageLayer({ kind: 'adjustment' }) }]), false)
  assert.equal(layersCanConvertToSmart([{
    index: 0,
    layer: imageLayer({
      kind: 'smart',
      smart: {
        id: 'content', width: 20, height: 10, resolutionDpi: 72, colorSpace: 'sRGB', background: 'transparent',
        layerStyleGlobalLight: { angle: 120, altitude: 30 }, layers: [imageLayer({ id: 'inner' })], revision: 1
      }
    })
  }]), false)
  assert.equal(layersCanConvertToSmart([
    { index: 0, layer: imageLayer({ id: 'plain' }) },
    {
      index: 1,
      layer: imageLayer({
        id: 'smart', kind: 'smart',
        smart: {
          id: 'nested', width: 20, height: 10, resolutionDpi: 72, colorSpace: 'sRGB', background: 'transparent',
          layerStyleGlobalLight: { angle: 120, altitude: 30 }, layers: [imageLayer({ id: 'nested-inner' })], revision: 1
        }
      })
    }
  ]), false)
  assert.equal(layersCanConvertToSmart([{ index: 0, layer: imageLayer({ visible: false }) }]), true)
  assert.equal(layersCanConvertToSmart([
    { index: 0, layer: imageLayer({ id: 'first', visible: false }) },
    { index: 1, layer: imageLayer({ id: 'second', visible: false }) }
  ]), false)
})

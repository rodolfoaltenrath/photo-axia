import assert from 'node:assert/strict'
import test from 'node:test'
import { layerCanRasterize, rasterizedLayerPatch } from '../src/editor/layerRasterization.ts'
import { createDefaultLayerEffect, createLayerStyleConfig } from '../src/editor/layerStyles.ts'

function baseLayer(patch = {}) {
  return {
    id: 'layer-1',
    name: 'Camada',
    visible: true,
    opacity: 45,
    blendMode: 'multiply',
    kind: 'image',
    styles: createLayerStyleConfig(),
    ...patch
  }
}

test('somente conteúdo visual suportado pode ser rasterizado', () => {
  assert.equal(layerCanRasterize(baseLayer({
    image: { width: 20, height: 10, mimeType: 'image/png', sourceUrl: 'blob:image' },
    transform: { x: 0, y: 0, width: 20, height: 10 }
  })), true)
  assert.equal(layerCanRasterize(baseLayer({
    kind: 'text',
    text: { content: 'Axia', fontFamily: 'Arial', fontSize: 20, fontWeight: 400, color: '#fff', alignment: 'left', lineHeight: 1.2, baseWidth: 50, baseHeight: 24 },
    transform: { x: 0, y: 0, width: 50, height: 24 }
  })), true)
  assert.equal(layerCanRasterize(baseLayer({
    kind: 'smart',
    image: { width: 20, height: 10, mimeType: 'image/png', sourceUrl: 'blob:smart' },
    transform: { x: 0, y: 0, width: 20, height: 10 }
  })), true)
  assert.equal(layerCanRasterize(baseLayer({
    kind: 'pixel',
    image: { width: 20, height: 10, mimeType: 'image/png', sourceUrl: 'blob:pixels' },
    transform: { x: 0, y: 0, width: 20, height: 10 }
  })), false)
  assert.equal(layerCanRasterize(baseLayer({ kind: 'pixel' })), false)
  assert.equal(layerCanRasterize(baseLayer({ kind: 'adjustment' })), false)
  assert.equal(layerCanRasterize(baseLayer({ kind: 'background' })), true)
})

test('patch rasterizado incorpora aparência local e não toca na composição externa', () => {
  const glow = createDefaultLayerEffect('outer-glow', 'glow')
  const source = baseLayer({ styles: { ...createLayerStyleConfig(), fillOpacity: 55, effects: [glow] } })
  const image = { width: 84, height: 62, mimeType: 'image/png', sourceUrl: 'blob:raster', byteSize: 2048 }
  const patch = rasterizedLayerPatch({ x: -12, y: 8, width: 84, height: 62 }, image)

  assert.equal(patch.kind, 'pixel')
  assert.deepEqual(patch.image, image)
  assert.notEqual(patch.image, image)
  assert.equal(patch.smart, undefined)
  assert.equal(patch.text, undefined)
  assert.deepEqual(patch.transform, { x: -12, y: 8, width: 84, height: 62, rotation: 0 })
  assert.deepEqual(patch.styles, createLayerStyleConfig())
  assert.equal(source.opacity, 45)
  assert.equal(source.blendMode, 'multiply')
})

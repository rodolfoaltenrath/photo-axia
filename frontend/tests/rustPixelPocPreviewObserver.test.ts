import assert from 'node:assert/strict'
import test from 'node:test'
import { createLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { rasterPreviewSnapshot, RustPixelPocPreviewObserver } from '../src/editor/rustPixelPocPreviewObserver.ts'
import { RustPixelPocTileGate } from '../src/editor/rustPixelPocTileGate.ts'
import type { DocumentSpec, LayerItem, LayerTransform } from '../src/types/editor.ts'

const document = {
  id: 'doc-1', width: 1920, height: 1080, background: 'transparent',
  colorSpace: 'srgb', resolutionDpi: 72, layerStyleGlobalLight: { angle: 30, altitude: 30 }
} satisfies Pick<DocumentSpec, 'id' | 'width' | 'height' | 'background' | 'colorSpace' |
  'resolutionDpi' | 'layerStyleGlobalLight'>
const layer = {
  id: 'layer-1', kind: 'pixel', visible: true, opacity: 100, blendMode: 'normal',
  styles: createLayerStyleConfig(),
  image: { sourceUrl: 'blob:original', previewUrl: 'blob:preview',
    width: 800, height: 600, previewWidth: 400, previewHeight: 300,
    editToken: 'edit-1', mimeType: 'image/png' }
} satisfies Pick<LayerItem, 'id' | 'kind' | 'image' | 'styles' | 'visible' | 'opacity' | 'blendMode'>
const transform: LayerTransform = { x: 20, y: 30, width: 800, height: 600, rotation: 0 }
const viewport = { scale: 1, devicePixelRatio: 1, scrollLeft: 0, scrollTop: 0,
  width: 1000, height: 700, stackKey: 'stack-1' }

function snapshot(options: {
  document?: typeof document
  layer?: Pick<LayerItem, 'id' | 'kind' | 'image' | 'styles' | 'visible' | 'opacity' | 'blendMode'>
  transform?: LayerTransform
  viewport?: typeof viewport
} = {}) {
  return rasterPreviewSnapshot(options.document ?? document, options.layer ?? layer,
    options.transform ?? transform, options.viewport ?? viewport)
}

test('fonte usa preview, editToken e dimensões; undo/redo avança geração', () => {
  const gate = new RustPixelPocTileGate()
  const observer = new RustPixelPocPreviewObserver(gate)
  const original = snapshot()
  assert.match(original.sourceKey ?? '', /blob:preview/)
  assert.deepEqual(observer.observe(original), { kind: 'source', generation: 1 })
  assert.equal(gate.adoptSource({ type: 'source-staged', id: 1, sourceId: 11, generation: 1, stagingMs: 0 }), true)
  assert.deepEqual(observer.observe(snapshot()), { kind: 'none' })
  assert.ok(gate.captureTile('0,0', 2))

  const edited = snapshot({ layer: { ...layer, image: { ...layer.image, editToken: 'edit-2' } } })
  assert.deepEqual(observer.observe(edited), { kind: 'source', generation: 2 })
  assert.equal(gate.captureTile('0,0', 3), null)
  assert.deepEqual(observer.observe(original), { kind: 'source', generation: 3 })

  const newPreview = snapshot({ layer: { ...layer, image: { ...layer.image,
    previewUrl: 'blob:preview-2', previewWidth: 500 } } })
  assert.deepEqual(observer.observe(newPreview), { kind: 'source', generation: 4 })
  assert.deepEqual(observer.observe(snapshot({ document: { ...document, id: 'doc-2' } })),
    { kind: 'source', generation: 5 })
})

test('zoom animado, pan, DPR, estilo, transformação e pilha invalidam só a vista', () => {
  const gate = new RustPixelPocTileGate()
  const observer = new RustPixelPocPreviewObserver(gate)
  let currentViewport = viewport
  let currentLayer: Pick<LayerItem, 'id' | 'kind' | 'image' | 'styles' | 'visible' | 'opacity' | 'blendMode'> = layer
  let currentTransform = transform
  const observe = () => observer.observe(snapshot({ layer: currentLayer,
    transform: currentTransform, viewport: currentViewport }))
  assert.deepEqual(observer.observe(snapshot()), { kind: 'source', generation: 1 })
  assert.equal(gate.adoptSource({ type: 'source-staged', id: 1, sourceId: 11, generation: 1, stagingMs: 0 }), true)
  const pending = gate.captureTile('0,0', 2)
  assert.ok(pending)
  currentViewport = { ...currentViewport, scale: 1.05 }
  assert.deepEqual(observe(), { kind: 'view' })
  assert.equal(pending.isCurrent({ type: 'rendered-staged-region', id: 2, sourceId: 11,
    generation: 1, rgba: new ArrayBuffer(4), width: 1, height: 1,
    timings: { allocationMs: 0, copyInMs: 0, kernelMs: 0, copyOutMs: 0, releaseMs: 0 } }), false)
  assert.ok(gate.captureTile('0,0', 3), 'zoom não recopia a fonte')
  currentViewport = { ...currentViewport, scrollLeft: 20 }
  assert.deepEqual(observe(), { kind: 'view' })
  currentViewport = { ...currentViewport, devicePixelRatio: 2 }
  assert.deepEqual(observe(), { kind: 'view' })
  currentLayer = { ...currentLayer, styles: { ...currentLayer.styles, fillOpacity: 50 } }
  assert.deepEqual(observe(), { kind: 'view' })
  currentTransform = { ...currentTransform, x: 80 }
  assert.deepEqual(observe(), { kind: 'view' })
  currentViewport = { ...currentViewport, stackKey: 'stack-2' }
  assert.deepEqual(observe(), { kind: 'view' })
  assert.deepEqual(observe(), { kind: 'none' })
})

test('retirada da imagem invalida a fonte e não publica tile antigo', () => {
  const gate = new RustPixelPocTileGate()
  const observer = new RustPixelPocPreviewObserver(gate)
  observer.observe(snapshot())
  assert.equal(gate.adoptSource({ type: 'source-staged', id: 1, sourceId: 11, generation: 1, stagingMs: 0 }), true)
  const old = gate.captureTile('0,0', 2)
  assert.ok(old)
  assert.deepEqual(observer.observe(snapshot({ layer: { ...layer, image: undefined } })),
    { kind: 'source', generation: 2 })
  assert.equal(gate.captureTile('0,0', 3), null)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { rasterPreviewSnapshot, RustPixelPocPreviewObserver } from '../src/editor/rustPixelPocPreviewObserver.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocRuntime.ts'
import { styledRasterPreviewSnapshot, type RustPixelPocStyledRasterIdentity } from '../src/editor/rustPixelPocStyledSource.ts'
import { RustPixelPocTileGate } from '../src/editor/rustPixelPocTileGate.ts'
import type { LayerStyleConfig } from '../src/types/editor.ts'

const document = { id: 'doc-1', width: 1920, height: 1080, background: 'transparent' as const,
  colorSpace: 'srgb' as const, resolutionDpi: 72, layerStyleGlobalLight: { angle: 30, altitude: 30 } }
const layer = { id: 'layer-1', kind: 'pixel' as const, visible: true, opacity: 100, blendMode: 'normal' as const,
  styles: normalizeLayerStyleConfig({ fillOpacity: 0, effects: [
    { type: 'color-overlay', id: 'color', color: '#ff0000', opacity: 100 }
  ] }), image: { sourceUrl: 'blob:original', width: 800, height: 600, mimeType: 'image/png', editToken: '1' } }
const transform = { x: 20, y: 30, width: 800, height: 600, rotation: 0 }
const viewport = { scale: 1, devicePixelRatio: 1, scrollLeft: 0, scrollTop: 0,
  width: 1000, height: 700, stackKey: 'stack-1' }
const raster: RustPixelPocStyledRasterIdentity = { contentKey: 'content-1', assetKey: '',
  width: 800, height: 600, offsetX: 0, offsetY: 0, resolutionScale: 1, quality: 'final' }
const snapshot = (styles: LayerStyleConfig = layer.styles, identity = raster) =>
  styledRasterPreviewSnapshot(document, { ...layer, styles }, transform, viewport, identity)

function adopt(gate: RustPixelPocTileGate, generation: number, sourceId = generation) {
  assert.equal(gate.adoptSource({ type: 'source-staged', id: generation, sourceId, generation, stagingMs: 0 }), true)
}

test('Fonte estilizada distingue a máscara original e invalida fill/efeitos antes de novos pixels', () => {
  const gate = new RustPixelPocTileGate()
  const observer = new RustPixelPocPreviewObserver(gate)
  observer.observe(rasterPreviewSnapshot(document, layer, transform, viewport))
  adopt(gate, 1)
  assert.deepEqual(observer.observe(snapshot()), { kind: 'source', generation: 2 })
  adopt(gate, 2)
  const pending = gate.captureTile('tile', 10)
  assert.ok(pending)
  assert.deepEqual(observer.observe(snapshot()), { kind: 'none' })
  assert.deepEqual(observer.observe(snapshot({ ...layer.styles, fillOpacity: 50 })), { kind: 'source', generation: 3 })
  assert.equal(gate.captureTile('tile', 11), null)
  assert.equal(pending.isCurrent({ type: 'rendered-staged-region', id: 10, sourceId: 2, generation: 2,
    rgba: new ArrayBuffer(4), width: 1, height: 1,
    timings: { allocationMs: 0, copyInMs: 0, kernelMs: 0, copyOutMs: 0, releaseMs: 0 } }), false)
  adopt(gate, 3)
  const changed = normalizeLayerStyleConfig({ ...layer.styles, effects: [
    { type: 'color-overlay', id: 'color', color: '#0000ff', opacity: 100 }
  ] })
  assert.deepEqual(observer.observe(snapshot(changed)), { kind: 'source', generation: 4 })
  assert.deepEqual(observer.observe(snapshot()), { kind: 'source', generation: 5 }, 'undo precisa de nova geração')
})

test('Canal/faixas dos dois Mesclar se invalidam a vista sem trocar pixels pré-filtro', () => {
  const gate = new RustPixelPocTileGate()
  const observer = new RustPixelPocPreviewObserver(gate)
  const first = snapshot()
  observer.observe(first)
  adopt(gate, 1)
  const styles = normalizeLayerStyleConfig({ ...layer.styles, blendIf: { channel: 'red',
    thisLayer: { shadows: [50, 100], highlights: [200, 240] },
    underlyingLayer: { shadows: [0, 10], highlights: [250, 255] } } })
  const next = snapshot(styles)
  assert.equal(next.sourceKey, first.sourceKey)
  assert.notEqual(next.appearanceKey, first.appearanceKey)
  assert.deepEqual(observer.observe(next), { kind: 'view' })
  assert.ok(gate.captureTile('tile', 10))
})

test('Geometria, halo, densidade sem quantização, qualidade e revisões pertencem à fonte', () => {
  const first = snapshot().sourceKey
  const changes: Partial<RustPixelPocStyledRasterIdentity>[] = [
    { width: 801 }, { height: 601 }, { offsetX: -12 }, { offsetY: 9 },
    { resolutionScale: 1.00001 }, { quality: 'interactive' },
    { contentKey: 'content-2' }, { assetKey: 'pattern-2' }
  ]
  for (const change of changes) assert.notEqual(snapshot(layer.styles, { ...raster, ...change }).sourceKey, first)
  assert.notEqual(snapshot(layer.styles, { ...raster, resolutionScale: 1.00001 }).sourceKey,
    snapshot(layer.styles, { ...raster, resolutionScale: 1.00002 }).sourceKey)
  assert.notEqual(styledRasterPreviewSnapshot(document, { ...layer, image: { ...layer.image, editToken: '2' } },
    transform, viewport, raster).sourceKey, first)
  assert.notEqual(styledRasterPreviewSnapshot({ ...document, resolutionDpi: 144 }, layer,
    transform, viewport, raster).sourceKey, first)
})

test('Zoom, pan, transformação, opacidade, visibilidade e backdrop mantêm raster local', () => {
  const first = snapshot()
  const changes = [
    styledRasterPreviewSnapshot(document, layer, transform, { ...viewport, scale: 2 }, raster),
    styledRasterPreviewSnapshot(document, layer, transform, { ...viewport, scrollLeft: 50 }, raster),
    styledRasterPreviewSnapshot(document, layer, transform, { ...viewport, devicePixelRatio: 2 }, raster),
    styledRasterPreviewSnapshot(document, layer, { ...transform, x: 100, rotation: 45 }, viewport, raster),
    styledRasterPreviewSnapshot(document, { ...layer, opacity: 50, visible: false, blendMode: 'multiply' }, transform, viewport, raster),
    styledRasterPreviewSnapshot(document, layer, transform, { ...viewport, stackKey: 'stack-2' }, raster)
  ]
  for (const next of changes) {
    const gate = new RustPixelPocTileGate()
    const observer = new RustPixelPocPreviewObserver(gate)
    observer.observe(first)
    adopt(gate, 1)
    assert.equal(next.sourceKey, first.sourceKey)
    assert.deepEqual(observer.observe(next), { kind: 'view' })
    assert.ok(gate.captureTile('tile', 10))
  }
})

test('Luz global invalida a fonte somente quando um efeito ativo a utiliza', () => {
  const light = { ...document, layerStyleGlobalLight: { angle: 90, altitude: 60 } }
  assert.equal(styledRasterPreviewSnapshot(light, layer, transform, viewport, raster).sourceKey, snapshot().sourceKey)
  for (const useGlobalLight of [true, false]) {
    const styles = normalizeLayerStyleConfig({ effects: [{ type: 'drop-shadow', id: 'shadow', useGlobalLight }] })
    const source = snapshot(styles)
    const next = styledRasterPreviewSnapshot(light, { ...layer, styles }, transform, viewport, raster)
    assert.equal(source.sourceKey === next.sourceKey, !useGlobalLight)
  }
})

test('Efeitos inativos não refazem a fonte, mas habilitação e ordem ativa refazem', () => {
  const disabled = normalizeLayerStyleConfig({ ...layer.styles, effects: [
    ...layer.styles.effects, { type: 'color-overlay', id: 'off', color: '#00ff00', enabled: false }
  ] })
  assert.equal(snapshot(disabled).sourceKey, snapshot().sourceKey)
  const disabledChanged = normalizeLayerStyleConfig({ ...disabled, effects: [
    ...layer.styles.effects, { type: 'color-overlay', id: 'off', color: '#0000ff', enabled: false }
  ] })
  assert.equal(snapshot(disabledChanged).sourceKey, snapshot(disabled).sourceKey)
  const active = normalizeLayerStyleConfig({ ...disabled, effects: disabled.effects.map(effect => ({ ...effect, enabled: true })) })
  assert.notEqual(snapshot(active).sourceKey, snapshot(disabled).sourceKey)
  assert.notEqual(snapshot({ ...active, effects: [...active.effects].reverse() }).sourceKey, snapshot(active).sourceKey)
  assert.notEqual(snapshot({ ...layer.styles, enabled: false }).sourceKey, snapshot().sourceKey)
})

test('Texto/forma sem imagem possuem identidade explícita e troca de documento/camada não colide', () => {
  const withoutImage = { ...layer, image: undefined, kind: 'text' as const }
  const source = styledRasterPreviewSnapshot(document, withoutImage, transform, viewport, raster)
  assert.notEqual(source.sourceKey, null)
  assert.notEqual(source.sourceKey, styledRasterPreviewSnapshot(document, withoutImage, transform, viewport,
    { ...raster, contentKey: 'text-edit-2' }).sourceKey)
  assert.notEqual(source.sourceKey, styledRasterPreviewSnapshot({ ...document, id: 'doc-2' }, withoutImage,
    transform, viewport, raster).sourceKey)
  assert.notEqual(source.sourceKey, styledRasterPreviewSnapshot(document, { ...withoutImage, id: 'layer-2' },
    transform, viewport, raster).sourceKey)
  assert.notEqual(source.sourceKey, styledRasterPreviewSnapshot(document, { ...withoutImage, kind: 'shape' },
    transform, viewport, raster).sourceKey)
})

test('Ausência do raster invalida geração e rejeita uploads atrasados', () => {
  const gate = new RustPixelPocTileGate()
  const observer = new RustPixelPocPreviewObserver(gate)
  observer.observe(snapshot())
  adopt(gate, 1)
  const unavailable = styledRasterPreviewSnapshot(document, layer, transform, viewport, null)
  assert.equal(unavailable.sourceKey, null)
  assert.deepEqual(observer.observe(unavailable), { kind: 'source', generation: 2 })
  assert.equal(gate.adoptSource({ type: 'source-staged', id: 3, sourceId: 3, generation: 1, stagingMs: 0 }), false)
  assert.equal(gate.captureTile('tile', 4), null)
  assert.deepEqual(observer.observe(snapshot()), { kind: 'source', generation: 3 })
})

test('Identidade inválida é rejeitada; snapshots não alteram os dados da camada', () => {
  const before = structuredClone({ layer, raster, document, transform, viewport })
  const invalid: Partial<RustPixelPocStyledRasterIdentity>[] = [
    { contentKey: '' }, { contentKey: 3 as unknown as string }, { assetKey: undefined },
    { width: 0 }, { width: 1.5 }, { height: NaN }, { width: 8192, height: 8192 },
    { offsetX: 0.5 }, { offsetY: Infinity }, { resolutionScale: 0 }, { resolutionScale: Infinity },
    { quality: 'unknown' as 'final' }
  ]
  for (const change of invalid) assert.throws(() => snapshot(layer.styles, { ...raster, ...change }),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input')
  assert.ok(snapshot().sourceKey)
  assert.deepEqual({ layer, raster, document, transform, viewport }, before)
})

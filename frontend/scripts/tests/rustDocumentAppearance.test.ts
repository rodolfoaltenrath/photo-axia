import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { planRustEditorialDocument } from '../../src/editor/rustDocumentEditorial.ts'
import { loadRustDocumentMedia } from '../../src/editor/rustDocumentOffscreen.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { DEFAULT_SHAPE_CONFIG } from '../../src/editor/shape.ts'
import { layerAppearanceRenderPlan } from '../../src/services/renderDocument.ts'
import type { DocumentSpec } from '../../src/types/editor.ts'
import { image, layer, transform } from '../../tests/editorTestFixtures.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { rustMediaBlob } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const document: DocumentSpec = { id: 'appearance', name: 'appearance', width: 2, height: 1, unit: 'px',
  physicalWidth: 2, physicalHeight: 1, resolutionDpi: 72, colorSpace: 'srgb', background: 'transparent',
  createdAt: '', layerStyleGlobalLight: { angle: 120, altitude: 30 } }

test('Worker conserva halo fora do documento e aplica opacidade local/export uma vez (decode double)', async () => {
  const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
  const source = layer({ kind: 'pixel', visible: false, opacity: 50, blendMode: 'screen',
    image: image({ width: 1, height: 1, sourceUrl: 'blob:fixture' }),
    transform: transform({ x: -2, y: -1, width: 1, height: 1 }),
    styles: normalizeLayerStyleConfig({ fillOpacity: 0, effects: [
      { type: 'drop-shadow', color: '#ff0000', size: 0, distance: 1, angle: 0, useGlobalLight: false,
        opacity: 100, layerKnocksOutShadow: false }, { type: 'color-overlay', color: '#0000ff', opacity: 50 }
    ] }) })
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    for (const [index, mode] of (['local', 'isolated-export'] as const).entries()) {
      const appearance = layerAppearanceRenderPlan(document, source, mode)!, bounds = appearance.viewport
      assert.deepEqual(bounds, { x: -3, y: -1, width: 2, height: 1 })
      const plan = planRustEditorialDocument(document, [appearance.layer], bounds.width, bounds.height, bounds, 'appearance')
      const input = await loadRustDocumentMedia(plan, new AbortController().signal, async () => rustMediaBlob())
      const prepared = await worker.send({ type: 'prepare-document-media', input, generation: index + 1 })
      if (prepared.type !== 'document-prepared') throw new Error('preparo ausente')
      const tile = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId,
        region: { x: 0, y: 0, width: 2, height: 1 }, grid: plan.grid })
      if (tile.type !== 'rendered-prepared-document') throw new Error('tile ausente')
      assert.deepEqual([...new Uint8Array(tile.rgba)], mode === 'local' ? [255, 0, 0, 255, 0, 0, 255, 128] : [255, 0, 0, 128, 0, 0, 255, 64])
      await worker.send({ type: 'release-document', documentId: prepared.documentId })
    }
    assert.equal(source.visible, false); assert.equal(source.transform!.x, -2); assert.equal(source.opacity, 50)
  } finally { await worker.close() }
})

test('Worker traça forma fora do documento no frame isolado sem novo decode (Canvas double)', async () => {
  const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
  const source = layer({ kind: 'shape', opacity: 50, styles: normalizeLayerStyleConfig({ fillOpacity: 50 }),
    shape: { ...DEFAULT_SHAPE_CONFIG, color: '#ff0000', baseWidth: 100, baseHeight: 50 },
    transform: transform({ x: 4, y: -2, width: 2, height: 1 }) })
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    const appearance = layerAppearanceRenderPlan(document, source, 'isolated-export')!, bounds = appearance.viewport
    const plan = planRustEditorialDocument(document, [appearance.layer], 2, 1, bounds, 'appearance')
    const input = await loadRustDocumentMedia(plan, new AbortController().signal, async () => { throw new Error('unexpected-decode') })
    const prepared = await worker.send({ type: 'prepare-document-media', input, generation: 1 })
    if (prepared.type !== 'document-prepared') throw new Error('preparo ausente')
    const tile = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId, region: { x: 0, y: 0, width: 2, height: 1 } })
    if (tile.type !== 'rendered-prepared-document') throw new Error('tile ausente')
    assert.deepEqual([...new Uint8Array(tile.rgba)], [255, 0, 0, 64, 255, 0, 0, 64])
  } finally { await worker.close() }
})

test('mesclagem regional usa backdrop inferior real e mesma grade da exportação (decode double)', async () => {
  const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
  const lower = layer({ id: 'lower', kind: 'pixel', image: image({ width: 1, height: 1, sourceUrl: 'blob:lower' }),
    transform: transform({ x: 1, y: 0, width: 1, height: 1 }) })
  const upper = structuredClone(lower); upper.id = 'upper'; upper.opacity = 50
  upper.styles = normalizeLayerStyleConfig({ effects: [{ type: 'color-overlay', color: '#ff0000', opacity: 100 }] })
  upper.styles.blendIf.channel = 'red'; upper.styles.blendIf.underlyingLayer.shadows = [0, 80]
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    const plan = planRustEditorialDocument(document, [upper, lower], 1, 1, { x: 1, y: 0, width: 1, height: 1 })
    const input = await loadRustDocumentMedia(plan, new AbortController().signal, async () => rustMediaBlob())
    const prepared = await worker.send({ type: 'prepare-document-media', input, generation: 1 })
    if (prepared.type !== 'document-prepared') throw new Error('preparo ausente')
    const region = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId,
      region: { x: 0, y: 0, width: 1, height: 1 }, grid: plan.grid })
    const full = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId,
      region: { x: 0, y: 0, width: 2, height: 1 }, grid: { ...plan.grid, originX: 0 } })
    if (region.type !== 'rendered-prepared-document' || full.type !== 'rendered-prepared-document') throw new Error('tile ausente')
    assert.deepEqual([...new Uint8Array(region.rgba)], [...new Uint8Array(full.rgba).slice(4)])
    assert.deepEqual([...new Uint8Array(region.rgba)], [94, 45, 60, 255])
  } finally { await worker.close() }
})

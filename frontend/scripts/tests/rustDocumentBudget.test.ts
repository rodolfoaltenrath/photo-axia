import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeStyledDocument } from '../../src/editor/rustStyledDocument.ts'
import { RUST_DOCUMENT_SOURCE_BYTES } from '../../src/editor/rustDocumentBudget.ts'
import { prepareRustDocumentMedia, rustStylePlanIsIdentity } from '../../src/editor/rustDocumentMedia.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { rustMediaBlob, installRustMediaFixtures } from './support/rustMediaFixture.ts'
import type { RustDocumentRasterLayer } from '../../src/editor/rustDocumentComposite.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer

function packet(width: number, height: number) {
  const rgba = new Uint8Array(width * height * 4)
  for (let index = 0; index < rgba.length; index += 4) rgba.set([91, 31, 201, 255], index)
  const layers: RustDocumentRasterLayer[] = [
    { rgba: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1, x: 0, y: 0, visible: true, opacity: 100,
      blendMode: 'normal', sourceToDocument: [width, 0, 0, height, 0, 0] },
    { rgba, width, height, x: 0, y: 0, visible: true, opacity: 50, blendMode: 'multiply', sourceToDocument: [1, 0, 0, 1, 0, 0] }]
  return encodeStyledDocument({ documentWidth: width, documentHeight: height, region: { x: 0, y: 0, width: 256, height: 256 },
    resolutionScale: 1, outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: layers }, [null, null])
}

test('documento no limite do orçamento de fontes cabe no preparo do núcleo, inclusive no preparo seguinte', async () => {
  const width = 4096, height = Math.floor(RUST_DOCUMENT_SOURCE_BYTES / 4 / width)
  assert.ok(width * height * 4 > 45.8 * 1024 * 1024, 'precisa admitir uma foto de 4000×3000')
  const bytes = packet(width, height)
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const first = runtime.prepareDocumentPacket(bytes, 1)
    const tile = runtime.composePreparedDocument(first.documentId, { x: 3840, y: height - 256, width: 256, height: 256 })
    // Multiply a 50% sobre branco: 127,5 + c / 2, sem empates de arredondamento para estes canais.
    assert.deepEqual([...tile.rgba.subarray(0, 4)], [173, 143, 228, 255])
    assert.deepEqual([...tile.rgba.subarray(tile.rgba.length - 4)], [173, 143, 228, 255])
    // A sessão libera o documento antes do próximo preparo (rustDocumentOffscreen.ts).
    runtime.releaseDocument(first.documentId)
    const second = runtime.prepareDocumentPacket(bytes, 2)
    assert.equal(second.bytes, first.bytes)
    assert.ok(runtime.memoryBytes <= 100 * 1024 * 1024, `memória WASM ${runtime.memoryBytes}`)
  } finally { runtime.dispose() }
})

test('camada raster sem estilo efetivo não envia STG1 ao núcleo', () => {
  const plan = { fillOpacity: 100, external: [], internal: [], overlay: [], upper: [] }
  assert.equal(rustStylePlanIsIdentity(plan), true)
  assert.equal(rustStylePlanIsIdentity({ ...plan, fillOpacity: 99.5 }), false)
  assert.equal(rustStylePlanIsIdentity({ ...plan, thisLayerBlendIf: { channel: 'gray', shadows: [0, 10], highlights: [255, 255] } }), false)
  assert.equal(rustStylePlanIsIdentity({ ...plan, overlay: [{} as never] }), false)
  assert.equal(rustStylePlanIsIdentity({ ...plan, external: [{} as never] }), false)
})

test('foto de 12 MP sem estilo passa pela carga de mídia do Worker e pelo preparo no núcleo', async () => {
  const fixtures = installRustMediaFixtures(), runtime = await createRustPixelPocRuntime(wasm)
  try {
    const packet = await prepareRustDocumentMedia({ documentWidth: 4000, documentHeight: 3000, width: 4000, height: 3000,
      grid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layers: [{
        source: { type: 'raster', blob: rustMediaBlob({ width: 4000, height: 3000 }) }, patterns: {},
        input: { sourceIdentity: 'photo', sourceWidth: 4000, sourceHeight: 3000, styles: normalizeLayerStyleConfig({}),
          globalLight: { angle: 120, altitude: 30 } },
        matrix: [1, 0, 0, 1, 0, 0], opacity: 100, blendMode: 'normal' }] }, () => {})
    // Sem STG1: só o SDP1 e o DCP com a fonte, nenhuma cópia estilizada contabilizada.
    assert.ok(packet.length < 4000 * 3000 * 4 + 4096)
    const prepared = runtime.prepareDocumentPacket(packet, 1)
    const tile = runtime.composePreparedDocument(prepared.documentId, { x: 3744, y: 2744, width: 256, height: 256 })
    assert.deepEqual([...tile.rgba.subarray(tile.rgba.length - 4)], [40, 60, 80, 255])
  } finally { fixtures.restore(); runtime.dispose() }
})

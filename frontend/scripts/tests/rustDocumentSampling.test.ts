import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeDocumentComposite, decodeDocumentComposite, documentCompositePacketLayout,
  type RustDocumentCompositeJob, type RustDocumentRasterLayer } from '../../src/editor/rustDocumentComposite.ts'
import { encodeStyledDocument } from '../../src/editor/rustStyledDocument.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { planRustEditorialDocument } from '../../src/editor/rustDocumentEditorial.ts'
import { loadRustDocumentMedia } from '../../src/editor/rustDocumentOffscreen.ts'
import { layer, image, transform } from '../../tests/editorTestFixtures.ts'
import type { DocumentSpec } from '../../src/types/editor.ts'
import { rustMediaBlob } from './support/rustMediaFixture.ts'
import { rustRasterBilinearMode } from '../../src/editor/rustDocumentSampling.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
type Matrix = NonNullable<RustDocumentRasterLayer['sourceToDocument']>
function source(matrix: Matrix = [1, 0, 0, 1, 0.25, 0], rgba = new Uint8Array([255, 0, 0, 255])): RustDocumentRasterLayer {
  return { rgba, width: rgba.length / 4, height: 1, x: 0, y: 0, visible: true, opacity: 100,
    blendMode: 'normal', sourceToDocument: matrix, sampling: 'raster-bilinear' }
}
function job(layers = [source()], width = 2, height = 1): RustDocumentCompositeJob {
  return { documentWidth: width, documentHeight: height, region: { x: 0, y: 0, width, height },
    resolutionScale: 1, outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: layers }
}
const fill = (fillOpacity: number) => ({ fillOpacity, external: [], internal: [], overlay: [], upper: [] })

test('DCP4 versiona sampler por camada sem alterar layouts DCP1/2/3', () => {
  const request = job(), packet = encodeDocumentComposite(request), view = new DataView(packet.buffer)
  assert.equal(view.getUint32(4, true), 4); assert.equal(packet.byteLength, 180)
  assert.equal(view.getUint32(80, true), 176); assert.equal(view.getUint32(172, true), 1)
  assert.equal(decodeDocumentComposite(packet).layersBottomToTop[0]!.sampling, 'raster-bilinear')
  assert.equal(documentCompositePacketLayout(packet).packetBytes, 180)
  const legacy = { ...source(), sampling: undefined }
  assert.equal(new DataView(encodeDocumentComposite(job([legacy])).buffer).getUint32(4, true), 2)
  legacy.underlyingBlendIf = { channel: 'red', shadows: [0, 128], highlights: [255, 255] }
  assert.equal(new DataView(encodeDocumentComposite(job([legacy])).buffer).getUint32(4, true), 3)
  const disabled = packet.slice(); new DataView(disabled.buffer).setUint32(172, 0, true)
  assert.equal(documentCompositePacketLayout(disabled).packetBytes, 180)
  assert.equal(documentCompositePacketLayout(disabled).workingBytes, 316)
})

test('DCP4 preflight rejeita flags, reserva, redução, shear e grade sem suporte', () => {
  const sparse = [1, 0, 0, 1, 0, 0]; delete sparse[4]
  assert.throws(() => encodeDocumentComposite(job([source(sparse as unknown as Matrix)])), /invalid-input/)
  for (const matrix of [[0.5, 0, 0, 1, 0, 0], [1, 0.1, 0, 1, 0, 0]] as Matrix[]) {
    assert.throws(() => encodeDocumentComposite(job([source(matrix)])), /invalid-input/)
  }
  for (const grid of [{ scaleX: 2, scaleY: 1, originX: 0, originY: 0 }, { scaleX: 1, scaleY: 1, originX: 0.25, originY: 0 }]) {
    assert.throws(() => encodeDocumentComposite({ ...job(), outputGrid: grid }), /invalid-input/)
  }
  for (const [offset, value] of [[172, 3], [160, 2], [164, 1], [72, 1]]) {
    const packet = encodeDocumentComposite(job()); new DataView(packet.buffer).setUint32(offset!, value!, true)
    assert.throws(() => decodeDocumentComposite(packet), /invalid-input/)
  }
  const packet = encodeDocumentComposite(job()); packet[3] = 51; packet[4] = 3
  assert.throws(() => decodeDocumentComposite(packet), /invalid-input/)
})

test('WASM mantém cobertura antiga e executa as novas regras de borda, empate e pesos', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    assert.deepEqual([...runtime.composeDocumentRegion(job()).rgba], [255, 0, 0, 255, 0, 0, 0, 0])
    assert.deepEqual([...runtime.composeDocumentRegion(job([{ ...source(), sampling: undefined }])).rgba], [255, 0, 0, 191, 255, 0, 0, 64])
    assert.deepEqual([...runtime.composeDocumentRegion(job([source([1, 0, 0, 1, 0.5, 0])])).rgba], [0, 0, 0, 0, 255, 0, 0, 255])
    const request = job([source([1.5, 0, 0, 1, 0.25, 0], new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]))], 4)
    assert.deepEqual([...runtime.composeDocumentRegion(request).rgba], [255, 0, 0, 255, 175, 80, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0])
  } finally { runtime.dispose() }
})

test('SDP1 mantém DCP4 e stride de múltiplas camadas; tiles reutilizam preparo/Fill', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const lower = source(), upper = source([1, 0, 0, 1, 1.25, 0], new Uint8Array([0, 0, 255, 255]))
    const packet = encodeStyledDocument(job([lower, upper]), [fill(50), fill(25)])
    const prepared = runtime.prepareDocumentPacket(packet, 1)
    const full = runtime.composePreparedDocument(prepared.documentId, job().region)
    assert.deepEqual([...full.rgba], [255, 0, 0, 128, 0, 0, 255, 64])
    const left = runtime.composePreparedDocument(prepared.documentId, { x: 0, y: 0, width: 1, height: 1 })
    const right = runtime.composePreparedDocument(prepared.documentId, { x: 1, y: 0, width: 1, height: 1 })
    assert.deepEqual([...left.rgba, ...right.rgba], [...full.rgba]); assert.equal(right.timings.copyInMs, 0)
    assert.throws(() => runtime.composePreparedDocument(prepared.documentId, job().region,
      { scaleX: 2, scaleY: 1, originX: 0, originY: 0 }), /invalid-input/)
    assert.deepEqual(runtime.composePreparedDocument(prepared.documentId, job().region).rgba, full.rgba)
  } finally { runtime.dispose() }
})

test('WASM DCP3 continua utilizável e recusa DCP4 cru/SDP1 antes de alterar o residente', async () => {
  const instantiate = WebAssembly.instantiate, base = await instantiate(wasm, {})
  const exports = { ...base.instance.exports, axia_poc_document_packet_version: () => 3 }
  WebAssembly.instantiate = (async () => ({ module: base.module, instance: { exports } })) as unknown as typeof instantiate
  let runtime: Awaited<ReturnType<typeof createRustPixelPocRuntime>>
  try { runtime = await createRustPixelPocRuntime(wasm) } finally { WebAssembly.instantiate = instantiate }
  try {
    const legacy = job([{ ...source(), sampling: undefined }]), prepared = runtime.prepareDocumentPacket(encodeStyledDocument(legacy, [null]), 1)
    assert.throws(() => runtime.composeDocumentRegion(job()), /wasm-unavailable/)
    assert.throws(() => runtime.prepareDocumentPacket(encodeStyledDocument(job(), [null]), 2), /wasm-unavailable/)
    assert.deepEqual([...runtime.composePreparedDocument(prepared.documentId, job().region).rgba], [255, 0, 0, 191, 255, 0, 0, 64])
  } finally { runtime.dispose() }
})

test('Worker transfere DCP4/SDP1, respeita geração e libera preparo', async () => {
  const worker = createRustPixelWorkerHarness()
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    const packet = encodeDocumentComposite(job()), raw = await worker.send({ type: 'compose-document-region', packet: packet.buffer }, [packet.buffer])
    assert.equal(packet.byteLength, 0)
    if (raw.type !== 'rendered-document-region') throw new Error('render ausente')
    assert.deepEqual([...new Uint8Array(raw.rgba)], [255, 0, 0, 255, 0, 0, 0, 0])
    const envelope = encodeStyledDocument(job(), [fill(50)]), prepared = await worker.send({ type: 'prepare-document', packet: envelope.buffer, generation: 1 }, [envelope.buffer])
    if (prepared.type !== 'document-prepared') throw new Error('preparo ausente')
    const tile = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId, region: job().region })
    if (tile.type !== 'rendered-prepared-document') throw new Error('tile ausente')
    assert.deepEqual([...new Uint8Array(tile.rgba)], [255, 0, 0, 128, 0, 0, 0, 0]); assert.equal(tile.generation, 1)
    assert.equal((await worker.send({ type: 'release-document', documentId: prepared.documentId })).type, 'document-released')
  } finally { await worker.close() }
})

test('mídia editorial escolhe DCP4 sem decode na UI e compõe posição fracionária (decode double)', async () => {
  const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    const document: DocumentSpec = { id: 'sample', name: 'sample', width: 2, height: 1, unit: 'px', physicalWidth: 2,
      physicalHeight: 1, resolutionDpi: 72, colorSpace: 'srgb', background: 'transparent', createdAt: '', layerStyleGlobalLight: { angle: 120, altitude: 30 } }
    const item = layer({ image: image({ width: 1, height: 1, sourceUrl: 'blob:fixture' }), transform: transform({ x: 0.25, y: 0, width: 1, height: 1 }) })
    const plan = planRustEditorialDocument(document, [item], 2, 1, { x: 0, y: 0, width: 2, height: 1 })
    assert.equal(plan.layers[0]!.sampling, 'raster-bilinear')
    const input = await loadRustDocumentMedia(plan, new AbortController().signal, async () => rustMediaBlob())
    const prepared = await worker.send({ type: 'prepare-document-media', input, generation: 1 })
    if (prepared.type !== 'document-prepared') throw new Error('preparo ausente')
    const tile = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId, region: { x: 0, y: 0, width: 2, height: 1 } })
    if (tile.type !== 'rendered-prepared-document') throw new Error('tile ausente')
    assert.deepEqual([...new Uint8Array(tile.rgba)], [40, 60, 80, 255, 0, 0, 0, 0])
  } finally { await worker.close() }
})

test('DCP4: precisões, modos e tiles irregulares mantêm os mesmos pixels globais', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 109])
    for (const mode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const) {
      for (const matrix of [[1.5, 0, 0, 2, 0.25, 0.5], [0, 1.5, -2, 0, 5.5, 0.25]] as Matrix[]) {
        const upper = { ...source(matrix, pixels), blendMode: mode, opacity: 63.7, sampling: rustRasterBilinearMode(matrix, mode) }
        const request = job([source([4, 0, 0, 4, 0, 0], new Uint8Array([20, 80, 160, 109])), upper], 7, 5)
        const full = runtime.composeDocumentRegion(request).rgba
        for (const size of [1, 2, 3]) {
          const stitched = new Uint8Array(full.length)
          for (let y = 0; y < 5; y += size) for (let x = 0; x < 7; x += size) {
            const region = { x, y, width: Math.min(size, 7 - x), height: Math.min(size, 5 - y) }
            const tile = runtime.composeDocumentRegion({ ...request, region }).rgba
            for (let row = 0; row < region.height; row++) stitched.set(tile.subarray(row * region.width * 4, (row + 1) * region.width * 4), ((y + row) * 7 + x) * 4)
          }
          assert.deepEqual(stitched, full)
        }
      }
    }
  } finally { runtime.dispose() }
})

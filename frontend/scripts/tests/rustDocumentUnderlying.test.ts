import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError, type RustPixelPocUnderlyingBlendIf } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeDocumentComposite, decodeDocumentComposite, documentCompositePacketLayout,
  type RustDocumentCompositeJob, type RustDocumentRasterLayer } from '../../src/editor/rustDocumentComposite.ts'
import { encodeStyledDocument } from '../../src/editor/rustStyledDocument.ts'
import type { RustPixelPocStagesPlan } from '../../src/editor/rustPixelPocStages.ts'
import { applyLayerStyleBlendIfUnderlying } from '../../src/editor/layerStyleRaster.ts'
import { createLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const filter: RustPixelPocUnderlyingBlendIf = { channel: 'red', shadows: [0, 128], highlights: [200, 255] }
const noStyle = { fillOpacity: 100, external: [], internal: [], overlay: [], upper: [] }
function layer(rgba: Uint8Array = new Uint8Array([255, 255, 255, 1])): RustDocumentRasterLayer {
  return { rgba, width: rgba.length / 4, height: 1, x: 0, y: 0, visible: true, opacity: 100,
    blendMode: 'normal', sourceToDocument: [1, 0, 0, 1, 0, 0] }
}
function job(): RustDocumentCompositeJob {
  return { documentWidth: 1, documentHeight: 1, region: { x: 0, y: 0, width: 1, height: 1 }, resolutionScale: 1,
    outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: [
      layer(new Uint8Array([64, 20, 30, 255])), { ...layer(), opacity: 50, underlyingBlendIf: filter }] }
}
const code = (expected: RustPixelPocError['code']) => (error: unknown) => error instanceof RustPixelPocError && error.code === expected

test('DCP3 usa descritor versionado, preserva DCP1/DCP2 e cobra todos os bytes do pacote', () => {
  const request = job(), packet = encodeDocumentComposite(request), view = new DataView(packet.buffer)
  assert.equal(view.getUint32(0, true), 0x33504344); assert.equal(view.getUint32(4, true), 3)
  assert.equal(packet.length, 280); assert.equal(view.getUint32(80, true), 272)
  assert.deepEqual([...packet.slice(160, 176)], new Array(16).fill(0))
  assert.equal(view.getUint32(256, true), 1); assert.equal(view.getUint32(260, true), 1)
  assert.deepEqual([...packet.slice(264, 272)], [0, 128, 200, 255, 0, 0, 0, 0])
  assert.deepEqual(decodeDocumentComposite(packet), request)
  const disabled = packet.slice(); disabled.fill(0, 256, 272)
  assert.equal(documentCompositePacketLayout(disabled).packetBytes, 280)
  assert.equal(documentCompositePacketLayout(disabled).workingBytes, 540)
  const old = { ...request, layersBottomToTop: request.layersBottomToTop.map(item => ({ ...item, underlyingBlendIf: undefined })) }
  assert.equal(encodeDocumentComposite(old)[3], 50)
  assert.equal(encodeDocumentComposite({ ...old, outputGrid: undefined,
    layersBottomToTop: old.layersBottomToTop.map(item => ({ ...item, sourceToDocument: undefined })) })[3], 49)
})

test('DCP3 rejeita thresholds, canais, gaps e flags inválidos antes de staging', () => {
  for (const config of [null, { ...filter, channel: 'alpha' }, { ...filter, shadows: [80, 10] },
    { ...filter, shadows: [0, NaN] }, { ...filter, highlights: [90, 255] }, { ...filter, highlights: [200, 256] }]) {
    const request = job(); request.layersBottomToTop[1]!.underlyingBlendIf = config as RustPixelPocUnderlyingBlendIf
    assert.throws(() => encodeDocumentComposite(request), code('invalid-input'))
  }
  const noGrid = job(); noGrid.outputGrid = undefined
  assert.throws(() => encodeDocumentComposite(noGrid), code('invalid-input'))
  const sparse = [0, 128]; delete sparse[0]
  const request = job(); request.layersBottomToTop[1]!.underlyingBlendIf = { ...filter, shadows: sparse as [number, number] }
  assert.throws(() => encodeDocumentComposite(request), code('invalid-input'))
  for (const [offset, value] of [[256, 2], [260, 4], [264, 200], [267, 100], [268, 1], [160, 2], [164, 1]]) {
    const packet = encodeDocumentComposite(job()); packet[offset!] = value!
    assert.throws(() => documentCompositePacketLayout(packet), code('invalid-input'))
  }
})

test('DCP3 sem filtros ativos cobra os registros maiores no limite de memória', () => {
  const request = job(), large = new Uint8Array(4096 * 2048 * 4)
  request.documentWidth = 4096; request.documentHeight = 4082
  request.region = { x: 0, y: 0, width: 4096, height: 4082 }
  request.layersBottomToTop = [{ ...layer(large), width: 4096, height: 2048, visible: false },
    ...Array.from({ length: 1023 }, () => ({ ...layer(), visible: false }))]
  const dcp2 = encodeDocumentComposite(request), packet = new Uint8Array(dcp2.length + 1024 * 16)
  const view = new DataView(packet.buffer), original = new DataView(dcp2.buffer)
  packet.set(dcp2.subarray(0, 80)); packet[3] = 51; view.setUint32(4, 3, true)
  for (let index = 0; index < 1024; index++) {
    const old = 80 + index * 80, target = 80 + index * 96
    packet.set(dcp2.subarray(old, old + 80), target)
    view.setUint32(target, original.getUint32(old, true) + 1024 * 16, true)
  }
  packet.set(dcp2.subarray(80 + 1024 * 80), 80 + 1024 * 96)
  assert.ok(documentCompositePacketLayout(dcp2).workingBytes < 96 * 1024 * 1024)
  assert.throws(() => documentCompositePacketLayout(packet), code('memory-limit'))
})

test('WASM DCP3 mantém o arredondamento duplo de opacidade/filtro e default não quantiza novamente', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    assert.deepEqual([...runtime.composeDocumentRegion(job()).rgba], [65, 21, 31, 255])
    const request = job(); const upper = request.layersBottomToTop[1]!
    upper.rgba = new Uint8Array([250, 20, 100, 3]); upper.opacity = 13.5; upper.underlyingBlendIf = undefined
    const expected = runtime.composeDocumentRegion(request).rgba
    upper.underlyingBlendIf = { channel: 'red', shadows: [0, 0], highlights: [255, 255] }
    assert.deepEqual(runtime.composeDocumentRegion(request).rgba, expected)
  } finally { runtime.dispose() }
})

test('WASM: quatro canais e seis modos concordam com filtro TS independente após transformação/opacidade', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const pixels = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i * 29) % 256)
    for (const channel of ['gray', 'red', 'green', 'blue'] as const) {
      for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const) {
        const request = job(); request.documentWidth = 7; request.documentHeight = 5
        request.region = { x: 0, y: 0, width: 9, height: 6 }
        request.outputGrid = { scaleX: 1.375, scaleY: 0.875, originX: -0.125, originY: 0.25 }
        const bottom = { ...layer(new Uint8Array(7 * 5 * 4).map((_, i) => [64, 125, 200, 109][i % 4]!)), width: 7, height: 5 }
        const upper = { ...layer(pixels), width: 3, height: 2, opacity: 63.7, blendMode,
          sourceToDocument: [0.8, 0.6, -0.6, 0.8, 3.25, 1.125] as const, underlyingBlendIf: { ...filter, channel } }
        request.layersBottomToTop = [bottom, upper]
        const base = runtime.composeDocumentRegion({ ...request, layersBottomToTop: [bottom] }).rgba
        const source = runtime.composeDocumentRegion({ ...request, layersBottomToTop: [{ ...upper, underlyingBlendIf: undefined, blendMode: 'normal' }] }).rgba
        const styles = createLayerStyleConfig(); styles.blendIf.channel = channel
        styles.blendIf.underlyingLayer = { shadows: filter.shadows, highlights: filter.highlights }
        const filtered = new Uint8ClampedArray(source); applyLayerStyleBlendIfUnderlying(filtered, new Uint8ClampedArray(base), styles)
        const raster = (rgba: Uint8Array): RustDocumentRasterLayer => ({ ...layer(rgba), width: 9, height: 6, sourceToDocument: undefined })
        const expected = runtime.composeDocumentRegion({ ...request, outputGrid: undefined,
          documentWidth: 9, documentHeight: 6, layersBottomToTop: [raster(base), { ...raster(new Uint8Array(filtered)), blendMode }] }).rgba
        assert.deepEqual(runtime.composeDocumentRegion(request).rgba, expected, `${channel}/${blendMode}`)
      }
    }
  } finally { runtime.dispose() }
})

test('SDP1 retém filtro DCP3 e tiles/zoom/pan consultam o backdrop de cada região sem emendas', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const request = job(); request.documentWidth = 8; request.documentHeight = 6; request.region = { x: 0, y: 0, width: 11, height: 7 }
    request.outputGrid = { scaleX: 1.375, scaleY: 0.875, originX: -0.125, originY: 0.25 }
    request.layersBottomToTop = [
      { ...layer(Uint8Array.from({ length: 8 * 6 * 4 }, (_, i) => (i * 31) % 256)), width: 8, height: 6 },
      { ...layer(new Uint8Array([240, 50, 130, 101, 0, 0, 0, 0])), opacity: 63.7,
        sourceToDocument: [2, 0.25, -0.25, 2, 2.25, 1.125], underlyingBlendIf: filter }]
    const plan: RustPixelPocStagesPlan = { ...noStyle, fillOpacity: 73.5,
      overlay: [{ type: 'color-overlay', effect: { color: [40, 210, 70, 255], opacity: 37, blendMode: 'normal' } }],
      thisLayerBlendIf: { channel: 'green' as const, shadows: [0, 80] as [number, number], highlights: [255, 255] as [number, number] } }
    const staged = runtime.stageSource(request.layersBottomToTop[1]!.rgba, 2, 1, 1)
    const styled = runtime.styleStagesStagedRegion(staged.sourceId, { x: 0, y: 0, width: 2, height: 1 }, plan).rgba
    runtime.releaseSource(staged.sourceId)
    const expected = runtime.composeDocumentRegion({ ...request, layersBottomToTop: [request.layersBottomToTop[0]!, { ...request.layersBottomToTop[1]!, rgba: styled }] }).rgba
    const prepared = runtime.prepareDocumentPacket(encodeStyledDocument(request, [null, plan]), 1)
    const full = runtime.composePreparedDocument(prepared.documentId, request.region).rgba
    assert.deepEqual(full, expected)
    for (const size of [1, 2, 3, 7]) {
      const stitched = new Uint8Array(full.length)
      for (let y = 0; y < 7; y += size) for (let x = 0; x < 11; x += size) {
        const region = { x, y, width: Math.min(size, 11 - x), height: Math.min(size, 7 - y) }
        const tile = runtime.composePreparedDocument(prepared.documentId, region)
        assert.equal(tile.timings.copyInMs, 0)
        for (let row = 0; row < region.height; row++) stitched.set(tile.rgba.subarray(row * region.width * 4, (row + 1) * region.width * 4), ((y + row) * 11 + x) * 4)
      }
      assert.deepEqual(stitched, full)
    }
    const grid = { scaleX: 0.875, scaleY: 1.25, originX: 1.25, originY: -0.125 }
    const zoom = runtime.composePreparedDocument(prepared.documentId, request.region, grid).rgba
    assert.deepEqual(zoom, runtime.composeDocumentRegion({ ...request, outputGrid: grid,
      layersBottomToTop: [request.layersBottomToTop[0]!, { ...request.layersBottomToTop[1]!, rgba: styled }] }).rgba)
    assert.deepEqual(runtime.composePreparedDocument(prepared.documentId, request.region).rgba, full)
  } finally { runtime.dispose() }
})

test('SDP1 rejeita filtro inválido sem substituir o cache ou avançar a geração', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const packet = encodeStyledDocument(job(), [null, noStyle]), prepared = runtime.prepareDocumentPacket(packet, 1)
    const bad = packet.slice(), view = new DataView(bad.buffer), doc = view.getUint32(16, true)
    bad[doc + 268] = 1
    assert.throws(() => runtime.prepareDocumentPacket(bad, 2), code('invalid-input'))
    assert.deepEqual([...runtime.composePreparedDocument(prepared.documentId, job().region).rgba], [65, 21, 31, 255])
    const next = runtime.prepareDocumentPacket(packet, 2)
    assert.notEqual(next.documentId, prepared.documentId)
  } finally { runtime.dispose() }
})

test('DCP3 não é enviado a WASM com capacidade DCP2, inclusive dentro de SDP1', async () => {
  const instantiate = WebAssembly.instantiate, base = await instantiate(wasm, {})
  const exports = { ...base.instance.exports, axia_poc_document_packet_version: () => 2 }
  WebAssembly.instantiate = (async () => ({ module: base.module, instance: { exports } })) as unknown as typeof instantiate
  let runtime: Awaited<ReturnType<typeof createRustPixelPocRuntime>>
  try { runtime = await createRustPixelPocRuntime(wasm) } finally { WebAssembly.instantiate = instantiate }
  try {
    const old = job(); old.layersBottomToTop[1]!.underlyingBlendIf = undefined
    const good = runtime.prepareDocumentPacket(encodeStyledDocument(old, [null, null]), 1)
    assert.throws(() => runtime.composeDocumentRegion(job()), code('wasm-unavailable'))
    assert.throws(() => runtime.prepareDocumentPacket(encodeStyledDocument(job(), [null, null]), 2), code('wasm-unavailable'))
    assert.ok(runtime.composePreparedDocument(good.documentId, old.region).rgba.length)
    runtime.prepareDocumentPacket(encodeStyledDocument(old, [null, null]), 2)
  } finally { runtime.dispose() }
})

test('Worker real transfere DCP3, reutiliza SDP1 e libera os resultados sem mudar lifecycle', async () => {
  const worker = createRustPixelWorkerHarness()
  try {
    assert.equal((await worker.send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
    const packet = encodeDocumentComposite(job())
    const result = await worker.send({ type: 'compose-document-region', packet: packet.buffer }, [packet.buffer])
    assert.equal(packet.byteLength, 0); assert.equal(result.type, 'rendered-document-region')
    if (result.type !== 'rendered-document-region') throw new Error('render ausente')
    assert.deepEqual([...new Uint8Array(result.rgba)], [65, 21, 31, 255])
    const envelope = encodeStyledDocument(job(), [null, noStyle])
    const prepared = await worker.send({ type: 'prepare-document', packet: envelope.buffer, generation: 1 }, [envelope.buffer])
    assert.equal(envelope.byteLength, 0)
    if (prepared.type !== 'document-prepared') throw new Error('preparação ausente')
    const tile = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId, region: job().region })
    if (tile.type !== 'rendered-prepared-document') throw new Error('tile ausente')
    assert.deepEqual([...new Uint8Array(tile.rgba)], [65, 21, 31, 255]); assert.equal(tile.timings.copyInMs, 0)
    assert.equal((await worker.send({ type: 'release-document', documentId: prepared.documentId })).type, 'document-released')
  } finally { await worker.close() }
})

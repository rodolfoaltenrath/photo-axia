import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeStyledDocument, styledDocumentPacketLayout } from '../../src/editor/rustStyledDocument.ts'
import { type RustDocumentCompositeJob, type RustDocumentRasterLayer } from '../../src/editor/rustDocumentComposite.ts'
import { type RustPixelPocStagesPlan } from '../../src/editor/rustPixelPocStages.ts'
import { combinedStages, stagesFixture } from './support/rustStagesFixture.ts'
import { strokePatternAsset, strokePattern } from './support/rustStrokeFixture.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const empty = (fillOpacity = 73.5): RustPixelPocStagesPlan => ({ fillOpacity, external: [], internal: [], overlay: [], upper: [] })
function layer(rgba = new Uint8Array([20, 40, 60, 101])): RustDocumentRasterLayer {
  return { rgba, width: rgba.length / 4, height: 1, x: 0, y: 0, visible: true, opacity: 100,
    blendMode: 'normal', sourceToDocument: [1, 0, 0, 1, 0.25, 0] }
}
function job(layers = [layer()]): RustDocumentCompositeJob {
  return { documentWidth: 2, documentHeight: 1, region: { x: 0, y: 0, width: 2, height: 1 },
    resolutionScale: 1, outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: layers }
}
const code = (expected: RustPixelPocError['code']) => (error: unknown) => error instanceof RustPixelPocError && error.code === expected

test('SDP1 versiona envelope, preserva fontes e rejeita tabelas inválidas antes de staging', () => {
  const request = job(), packet = encodeStyledDocument(request, [empty()]), view = new DataView(packet.buffer)
  assert.equal(packet.length, 236); assert.equal(view.getUint32(0, true), 0x31504453)
  assert.deepEqual(styledDocumentPacketLayout(packet), { documentOffset: 40, documentBytes: 164, layerCount: 1, workingBytes: 2980 })
  const original = packet.slice(); request.layersBottomToTop[0]!.rgba.fill(0); assert.deepEqual(packet, original)
  for (const [offset, value] of [[4, 2], [8, 40], [12, 1025], [16, 44], [20, 160], [24, 1], [32, 208], [36, 24]]) {
    const bad = packet.slice(); new DataView(bad.buffer).setUint32(offset!, value!, true)
    assert.throws(() => styledDocumentPacketLayout(bad), code('invalid-input'))
  }
  assert.throws(() => encodeStyledDocument(job(), []), code('invalid-input'))
  const sparse = [empty()]; delete sparse[0]
  assert.throws(() => encodeStyledDocument(job(), sparse), code('invalid-input'))
})

test('WASM prepara Fill uma vez; tiles e zoom/pan reutilizam o documento sem alterar a grade original', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), source = layer(), original = source.rgba.slice()
  try {
    const packet = encodeStyledDocument(job([source]), [empty()]), prepared = runtime.prepareDocumentPacket(packet, 1)
    packet.fill(0)
    const first = runtime.composePreparedDocument(prepared.documentId, job().region)
    assert.deepEqual([...first.rgba], [20, 40, 60, 56, 20, 40, 60, 19])
    const zoom = runtime.composePreparedDocument(prepared.documentId, { x: 0, y: 0, width: 4, height: 1 },
      { scaleX: 2, scaleY: 1, originX: 0, originY: 0 })
    assert.deepEqual([...zoom.rgba], [20, 40, 60, 37, 20, 40, 60, 74, 20, 40, 60, 37, 0, 0, 0, 0])
    const left = runtime.composePreparedDocument(prepared.documentId, { x: 0, y: 0, width: 1, height: 1 })
    const right = runtime.composePreparedDocument(prepared.documentId, { x: 1, y: 0, width: 1, height: 1 })
    assert.deepEqual([...left.rgba, ...right.rgba], [...first.rgba])
    assert.deepEqual(runtime.composePreparedDocument(prepared.documentId, job().region).rgba, first.rgba)
    assert.deepEqual(source.rgba, original)
    assert.equal(first.timings.copyInMs, 0); assert.equal(first.generation, 1)
    runtime.dispose(); runtime.dispose()
    assert.deepEqual([...first.rgba], [20, 40, 60, 56, 20, 40, 60, 19])
    assert.throws(() => runtime.composePreparedDocument(prepared.documentId, job().region), code('wasm-unavailable'))
  } finally { runtime.dispose() }
})

test('SDP1 aceita DCP1, camadas sem estilos e pilha vazia sem reinterpretar Fill', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const integer = { ...layer(), sourceToDocument: undefined }
    const request = { ...job([integer]), outputGrid: undefined }
    const prepared = runtime.prepareDocumentPacket(encodeStyledDocument(request, [null]), 1)
    assert.deepEqual([...runtime.composePreparedDocument(prepared.documentId, request.region).rgba], [20, 40, 60, 101, 0, 0, 0, 0])
    assert.throws(() => runtime.composePreparedDocument(prepared.documentId, request.region, job().outputGrid), code('invalid-input'))
    const next = runtime.prepareDocumentPacket(encodeStyledDocument(job([]), []), 2)
    assert.throws(() => runtime.documentMetadata(prepared.documentId), code('invalid-input'))
    assert.deepEqual([...runtime.composePreparedDocument(next.documentId, job().region).rgba], [0, 0, 0, 0, 0, 0, 0, 0])
    assert.throws(() => runtime.prepareDocumentPacket(encodeStyledDocument(job([]), []), 2), code('invalid-input'))
  } finally { runtime.dispose() }
})

test('dez efeitos STG1, padrões, Fill e seis modos concordam com kernels separados e tiles afins', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), oracle = await createRustPixelPocRuntime(wasm)
  const source = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => i * 29 % 256)
  let generation = 0
  try {
    for (const mode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const) {
      const fixture = stagesFixture(source, 3, 2, combinedStages(mode), { angle: 123.5, altitude: 48 }, 1,
        new Map([[strokePatternAsset.id, strokePattern]]))
      const staged = oracle.stageSource(fixture.rgba, fixture.width, fixture.height, ++generation)
      const styled = oracle.styleStagesStagedRegion(staged.sourceId, fixture.region, fixture.plan).rgba
      const background = Uint8Array.from({ length: 12 * 9 * 4 }, (_, index) => [100, 150, 200, 128][index % 4]!)
      const layers: RustDocumentRasterLayer[] = [{ ...layer(background), width: 12, height: 9, sourceToDocument: [1, 0, 0, 1, 0, 0] },
        { ...layer(fixture.rgba), width: fixture.width, height: fixture.height,
        opacity: 63.7, blendMode: mode, sourceToDocument: [0.8, 0.6, -0.6, 0.8,
          4 + 0.8 * fixture.expected.offsetX - 0.6 * fixture.expected.offsetY,
          2 + 0.6 * fixture.expected.offsetX + 0.8 * fixture.expected.offsetY] }]
      const request = { ...job(layers), documentWidth: 12, documentHeight: 9, region: { x: 0, y: 0, width: 11, height: 7 },
        outputGrid: { scaleX: 1.375, scaleY: 0.875, originX: -0.125, originY: 0.25 } }
      const expected = oracle.composeDocumentRegion({ ...request, layersBottomToTop: [layers[0]!, { ...layers[1]!, rgba: styled }] })
      const prepared = runtime.prepareDocumentPacket(encodeStyledDocument(request, [null, fixture.plan]), generation)
      const full = runtime.composePreparedDocument(prepared.documentId, request.region)
      assert.deepEqual(full.rgba, expected.rgba, mode)
      for (const size of [1, 2, 3, 7]) {
        const stitched = new Uint8Array(full.rgba.length)
        for (let y = 0; y < 7; y += size) for (let x = 0; x < 11; x += size) {
          const region = { x, y, width: Math.min(size, 11 - x), height: Math.min(size, 7 - y) }
          const tile = runtime.composePreparedDocument(prepared.documentId, region)
          for (let row = 0; row < region.height; row++) stitched.set(tile.rgba.subarray(row * region.width * 4, (row + 1) * region.width * 4), ((y + row) * 11 + x) * 4)
        }
        assert.deepEqual(stitched, full.rgba, `${mode}/${size}`)
      }
    }
  } finally { runtime.dispose(); oracle.dispose() }
})

test('falha tardia de estilo não substitui cache válido; região/grade inválidas não o corrompem', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const good = runtime.prepareDocumentPacket(encodeStyledDocument(job(), [empty()]), 1)
    const expected = runtime.composePreparedDocument(good.documentId, job().region).rgba
    const bad = encodeStyledDocument(job(), [empty()]); new DataView(bad.buffer).setFloat64(220, NaN, true)
    assert.throws(() => runtime.prepareDocumentPacket(bad, 2), code('invalid-input'))
    for (const value of [-1, 0.5, NaN, 0xffffffff]) {
      assert.throws(() => runtime.composePreparedDocument(good.documentId, { ...job().region, x: value }), code('invalid-input'))
    }
    assert.throws(() => runtime.composePreparedDocument(good.documentId, job().region, { ...job().outputGrid!, scaleX: 0 }), code('invalid-input'))
    assert.deepEqual(runtime.composePreparedDocument(good.documentId, job().region).rgba, expected)
    assert.throws(() => runtime.releaseDocument(good.documentId + 1), code('invalid-input'))
    const next = runtime.prepareDocumentPacket(encodeStyledDocument(job(), [empty(0)]), 2)
    assert.throws(() => runtime.composePreparedDocument(good.documentId, job().region), code('invalid-input'))
    runtime.releaseDocument(next.documentId)
    assert.throws(() => runtime.documentMetadata(next.documentId), code('invalid-input'))
  } finally { runtime.dispose() }
})

test('fonte staged e cache documental exigem release explícito, sem invalidação cruzada', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(new Uint8Array([7, 8, 9, 255]), 1, 1, 1)
    const packet = encodeStyledDocument(job(), [empty()])
    assert.throws(() => runtime.prepareDocumentPacket(packet, 1), code('invalid-input'))
    assert.deepEqual([...runtime.renderStagedRegion(staged.sourceId, { x: 0, y: 0, width: 1, height: 1 }, 100).rgba], [7, 8, 9, 255])
    runtime.releaseSource(staged.sourceId)
    let unlock = () => {}
    const latch = new Promise<void>(resolve => { unlock = resolve })
    const pending = runtime.stagePreparedSourceAsync(async () => {
      await latch
      return { rgba: new Uint8Array([7, 8, 9, 255]), width: 1, height: 1 }
    }, 2)
    assert.throws(() => runtime.prepareDocumentPacket(packet, 1), code('invalid-input'))
    unlock(); runtime.releaseSource((await pending).sourceId)
    const document = runtime.prepareDocumentPacket(packet, 1)
    assert.throws(() => runtime.stageSource(new Uint8Array([7, 8, 9, 255]), 1, 1, 3), code('invalid-input'))
    runtime.invalidateSource(3)
    assert.equal(runtime.documentMetadata(document.documentId).generation, 1)
    assert.deepEqual([...runtime.render(new Uint8Array([1, 2, 3, 255]), 100).rgba], [1, 2, 3, 255])
    runtime.releaseDocument(document.documentId)
    assert.ok(runtime.stageSource(new Uint8Array([7, 8, 9, 255]), 1, 1, 3).sourceId > 0)
  } finally { runtime.dispose() }
})

test('encoder cobra todas as fontes preparadas e limita passes mesmo para um tile pequeno', () => {
  const source = new Uint8Array(4096 * 512 * 4)
  const raster = { ...layer(source), width: 4096, height: 512 }
  assert.throws(() => encodeStyledDocument({ ...job(Array(4).fill(raster)), region: { x: 0, y: 0, width: 1, height: 1 } }, Array(4).fill(empty())), code('memory-limit'))
  const many = empty(); many.overlay = Array.from({ length: 64 }, () => ({ type: 'color-overlay', effect: { color: [255, 0, 0, 255], opacity: 100, blendMode: 'normal' } }))
  const small = { ...layer(new Uint8Array(512 * 512 * 4)), width: 512, height: 512 }
  assert.throws(() => encodeStyledDocument({ ...job([small]), region: { x: 0, y: 0, width: 1, height: 1 } }, [many]), code('work-limit'))
})

test('Worker transfere SDP1 e tiles, recupera de erro e rejeita handle após release/reinit', async () => {
  const harness = createRustPixelWorkerHarness()
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const packet = encodeStyledDocument(job(), [empty()])
    const prepared = await harness.send({ type: 'prepare-document', packet: packet.buffer, generation: 1 }, [packet.buffer])
    assert.equal(packet.byteLength, 0)
    if (prepared.type !== 'document-prepared') assert.fail('documento preparado esperado')
    const first = await harness.send({ type: 'compose-prepared-document', documentId: prepared.documentId, region: job().region })
    if (first.type !== 'rendered-prepared-document') assert.fail('tile esperado')
    assert.deepEqual([...new Uint8Array(first.rgba)], [20, 40, 60, 56, 20, 40, 60, 19])
    assert.equal(first.generation, 1); assert.equal(first.timings.copyInMs, 0)
    const invalid = await harness.send({ type: 'compose-prepared-document', documentId: prepared.documentId, region: { ...job().region, width: 0 } })
    assert.equal(invalid.type, 'error')
    assert.equal((await harness.send({ type: 'compose-prepared-document', documentId: prepared.documentId, region: job().region })).type, 'rendered-prepared-document')
    assert.equal((await harness.send({ type: 'release-document', documentId: prepared.documentId })).type, 'document-released')
    assert.equal((await harness.send({ type: 'compose-prepared-document', documentId: prepared.documentId, region: job().region })).type, 'error')
    const second = await harness.send({ type: 'prepare-document', packet: encodeStyledDocument(job(), [empty()]).buffer, generation: 2 })
    if (second.type !== 'document-prepared') assert.fail('documento preparado esperado')
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    assert.equal((await harness.send({ type: 'compose-prepared-document', documentId: second.documentId, region: job().region })).type, 'error')
    const third = await harness.send({ type: 'prepare-document', packet: encodeStyledDocument(job(), [empty()]).buffer, generation: 1 })
    if (third.type !== 'document-prepared') assert.fail('documento preparado esperado')
    assert.notEqual(third.documentId, second.documentId)
    assert.equal((await harness.send({ type: 'compose-prepared-document', documentId: second.documentId, region: job().region })).type, 'error')
    await harness.send({ type: 'dispose' })
  } finally { await harness.close() }
})

test('ABI SDP1 rejeita overlap e reserva extra sem modificar a saída', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {}), exports = instance.exports
  const alloc = exports.axia_poc_alloc as (n: number) => number, free = exports.axia_poc_free as (p: number, n: number) => void
  const apply = exports.axia_poc_document_prepare_styles as (p: number, n: number, o: number, l: number, e: number) => number
  const memory = exports.memory as WebAssembly.Memory, packet = encodeStyledDocument(job(), [empty()])
  const p = alloc(packet.length), o = alloc(164)
  try {
    new Uint8Array(memory.buffer, p, packet.length).set(packet); new Uint8Array(memory.buffer, o, 164).fill(99)
    assert.equal(apply(p, packet.length, p + 40, 164, 0), 5)
    assert.equal(apply(p, packet.length, o, 164, 96 * 1024 * 1024), 6)
    assert.ok(new Uint8Array(memory.buffer, o, 164).every(v => v === 99))
    assert.equal(apply(p, packet.length, o, 164, 0), 0)
  } finally { free(o, 164); free(p, packet.length) }
})

test('cache WASM libera pares uma vez, sobrevive a falhas e recria views após memory.grow', async () => {
  const instantiate = WebAssembly.instantiate, base = await instantiate(wasm, {}), exports = base.instance.exports
  const alloc = exports.axia_poc_alloc as (n: number) => number, free = exports.axia_poc_free as (p: number, n: number) => void
  const prepare = exports.axia_poc_document_prepare_styles as (p: number, n: number, o: number, l: number, e: number) => number
  const compose = exports.axia_poc_document_region as (p: number, n: number, o: number, l: number) => number
  const memory = exports.memory as WebAssembly.Memory, live = new Map<number, number>()
  let allocations = 0, failAllocation = 0, prepareCalls = 0, composeCalls = 0, prepareStatus = 0, composeStatus = 0
  const wrapped = { ...exports,
    axia_poc_alloc(n: number) {
      if (++allocations === failAllocation) return 0
      const pointer = alloc(n); assert.ok(pointer > 0); assert.equal(live.has(pointer), false)
      live.set(pointer, n); memory.grow(1); return pointer
    },
    axia_poc_free(p: number, n: number) { assert.equal(live.get(p), n); live.delete(p); free(p, n) },
    axia_poc_document_prepare_styles(p: number, n: number, o: number, l: number, e: number) {
      prepareCalls++; return prepareStatus || prepare(p, n, o, l, e)
    },
    axia_poc_document_region(p: number, n: number, o: number, l: number) {
      composeCalls++; return composeStatus || compose(p, n, o, l)
    }
  }
  WebAssembly.instantiate = (async () => ({ module: base.module, instance: { exports: wrapped } })) as unknown as typeof instantiate
  let runtime: Awaited<ReturnType<typeof createRustPixelPocRuntime>>
  try { runtime = await createRustPixelPocRuntime(wasm) } finally { WebAssembly.instantiate = instantiate }
  try {
    const packet = encodeStyledDocument(job(), [empty()]), prepared = runtime.prepareDocumentPacket(packet, 1)
    assert.equal(live.size, 1); assert.equal(allocations, 2)
    const expected = runtime.composePreparedDocument(prepared.documentId, job().region).rgba
    for (let index = 0; index < 3; index++) runtime.composePreparedDocument(prepared.documentId, job().region)
    assert.equal(prepareCalls, 1); assert.equal(composeCalls, 4); assert.equal(allocations, 6); assert.equal(live.size, 1)
    failAllocation = allocations + 2
    assert.throws(() => runtime.prepareDocumentPacket(packet, 2), code('wasm-failure')); assert.equal(live.size, 1)
    for (const [status, expectedCode] of [[2, 'invalid-input'], [6, 'memory-limit'], [7, 'work-limit'], [9, 'wasm-failure']] as const) {
      prepareStatus = status
      assert.throws(() => runtime.prepareDocumentPacket(packet, 2), code(expectedCode)); assert.equal(live.size, 1)
      assert.deepEqual(runtime.composePreparedDocument(prepared.documentId, job().region).rgba, expected)
    }
    prepareStatus = 0; composeStatus = 6
    assert.throws(() => runtime.composePreparedDocument(prepared.documentId, job().region,
      { scaleX: 2, scaleY: 1, originX: 0.25, originY: 0 }), code('memory-limit'))
    composeStatus = 0
    assert.deepEqual(runtime.composePreparedDocument(prepared.documentId, job().region).rgba, expected)
    const next = runtime.prepareDocumentPacket(packet, 2)
    assert.equal(live.size, 1); assert.notEqual(next.documentId, prepared.documentId)
    runtime.releaseDocument(next.documentId); assert.equal(live.size, 0)
    runtime.dispose(); runtime.dispose(); assert.equal(live.size, 0)
  } finally { runtime.dispose() }
})

test('substituição e renders avulsos incluem o cache residente no budget antes de alocar', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const rgba = new Uint8Array(4096 * 2048 * 4), large = { ...layer(rgba), width: 4096, height: 2048 }
  const request = job([large]), packet = encodeStyledDocument(request, [null])
  try {
    const prepared = runtime.prepareDocumentPacket(packet, 1)
    assert.throws(() => runtime.prepareDocumentPacket(packet, 2), code('memory-limit'))
    const region = { x: 0, y: 0, width: 4096, height: 2048 }
    assert.throws(() => runtime.renderRegion(rgba, 4096, 2048, region, 100), code('memory-limit'))
    assert.throws(() => runtime.composeDocumentRegion({ ...request, region }), code('memory-limit'))
    assert.deepEqual(runtime.composePreparedDocument(prepared.documentId, request.region).rgba, new Uint8Array(8))
  } finally { runtime.dispose() }
})

test('WASM antigo sem preparação documental mantém DCP1 e estilos disponíveis', async () => {
  const instantiate = WebAssembly.instantiate, base = await instantiate(wasm, {})
  const exports = { ...base.instance.exports }; delete exports.axia_poc_document_prepare_styles
  WebAssembly.instantiate = (async () => ({ module: base.module, instance: { exports } })) as unknown as typeof instantiate
  let runtime: Awaited<ReturnType<typeof createRustPixelPocRuntime>>
  try { runtime = await createRustPixelPocRuntime(wasm) } finally { WebAssembly.instantiate = instantiate }
  try {
    assert.throws(() => runtime.prepareDocumentPacket(encodeStyledDocument(job(), [empty()]), 1), code('wasm-unavailable'))
    assert.deepEqual([...runtime.composeDocumentRegion({ ...job([{ ...layer(), sourceToDocument: undefined }]), outputGrid: undefined }).rgba], [20, 40, 60, 101, 0, 0, 0, 0])
    assert.deepEqual([...runtime.render(new Uint8Array([7, 8, 9, 255]), 100).rgba], [7, 8, 9, 255])
  } finally { runtime.dispose() }
})

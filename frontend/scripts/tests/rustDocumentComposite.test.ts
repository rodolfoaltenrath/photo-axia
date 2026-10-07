import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeDocumentComposite, documentCompositePacketLayout,
  type RustDocumentCompositeJob, type RustDocumentRasterLayer } from '../../src/editor/rustDocumentComposite.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
function layer(rgba = new Uint8Array([40, 80, 120, 255])): RustDocumentRasterLayer {
  return { rgba, width: rgba.length / 4, height: 1, x: 0, y: 0, visible: true, opacity: 100, blendMode: 'normal' }
}
function job(layersBottomToTop: RustDocumentRasterLayer[] = [layer()]): RustDocumentCompositeJob {
  return { documentWidth: 1, documentHeight: 1, region: { x: 0, y: 0, width: 1, height: 1 },
    resolutionScale: 1, layersBottomToTop }
}
function invalid(operation: () => unknown, code: RustPixelPocError['code'] = 'invalid-input') {
  assert.throws(operation, error => error instanceof RustPixelPocError && error.code === code)
}

test('DCP1 registra campos little-endian, origem assinada e fonte independente', () => {
  const source = layer(); source.x = -7; source.y = 12; source.opacity = 63.7
  const packet = encodeDocumentComposite(job([source])), view = new DataView(packet.buffer)
  assert.equal(packet.length, 92); assert.equal(view.getUint32(0, true), 0x31504344)
  assert.equal(view.getUint32(4, true), 1); assert.equal(view.getUint32(8, true), 48)
  assert.equal(view.getUint32(48, true), 88); assert.equal(view.getInt32(64, true), -7)
  assert.equal(view.getInt32(68, true), 12); assert.equal(view.getFloat64(80, true), 63.7)
  assert.deepEqual(documentCompositePacketLayout(packet), {
    region: job().region, packetBytes: 92, outputBytes: 4, workingBytes: 224
  })
  source.rgba.fill(0)
  assert.deepEqual([...packet.slice(88)], [40, 80, 120, 255])
})

test('preflight TS rejeita campos inválidos, fontes compartilhadas e budgets antes de montar pacote', () => {
  for (const value of [0, -1, NaN, Infinity, 0x100000000]) invalid(() => encodeDocumentComposite({ ...job(), documentWidth: value }))
  for (const resolutionScale of [0, 0.5, 2, NaN, Infinity]) invalid(() => encodeDocumentComposite({ ...job(), resolutionScale }))
  for (const opacity of [-1, 101, NaN, Infinity]) invalid(() => encodeDocumentComposite(job([{ ...layer(), opacity }])))
  invalid(() => encodeDocumentComposite(job([{ ...layer(), x: 0.5 }])))
  invalid(() => encodeDocumentComposite(job([{ ...layer(), y: 0x80000000 }])))
  invalid(() => encodeDocumentComposite(job([{ ...layer(), visible: 2 as unknown as boolean }])))
  invalid(() => encodeDocumentComposite(job([{ ...layer(), blendMode: 'toString' as 'normal' }])))
  invalid(() => encodeDocumentComposite(job([{ ...layer(), rgba: new Uint8Array(3) }])))
  invalid(() => encodeDocumentComposite(job([{ ...layer(), rgba: new Uint8Array(new SharedArrayBuffer(4)) }])))
  invalid(() => encodeDocumentComposite(job(Array(1025).fill(layer()))))
  invalid(() => encodeDocumentComposite({ ...job(), region: { x: 0xffffffff, y: 0, width: 1, height: 1 } }))
  const large = { ...layer(new Uint8Array(1024 * 1024)), width: 512, height: 512 }
  invalid(() => encodeDocumentComposite(job(Array(64).fill(large))), 'memory-limit')
  invalid(() => encodeDocumentComposite({ ...job(Array(63).fill(large)), region: { x: 0, y: 0, width: 4096, height: 3072 } }), 'memory-limit')
})

test('layout TS rejeita pacote adulterado e aceita subview com byteOffset', () => {
  const packet = encodeDocumentComposite(job())
  for (const [offset, value] of [[0, 0], [4, 2], [8, 44], [12, 1025], [48, 84], [48, 0xffffffff], [52, 0], [52, 0xffffffff], [72, 2], [76, 6]]) {
    const changed = packet.slice(); new DataView(changed.buffer).setUint32(offset!, value!, true)
    invalid(() => documentCompositePacketLayout(changed))
  }
  const extra = new Uint8Array(96); extra.set(packet)
  invalid(() => documentCompositePacketLayout(extra))
  invalid(() => documentCompositePacketLayout(packet.slice(0, 88)))
  const wrapped = new Uint8Array(packet.length + 8); wrapped.set(packet, 4)
  assert.deepEqual(documentCompositePacketLayout(wrapped.subarray(4, wrapped.length - 4)), documentCompositePacketLayout(packet))
})

test('WASM reproduz valores fixos de todos os modos e opacidade parcial', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const backdrop = layer(new Uint8Array([100, 150, 200, 255]))
    for (const [blendMode, expected] of [
      ['normal', [200, 100, 50, 255]], ['multiply', [78, 59, 39, 255]],
      ['screen', [222, 191, 211, 255]], ['overlay', [157, 127, 167, 255]],
      ['darken', [100, 100, 50, 255]], ['lighten', [200, 150, 200, 255]]
    ] as const) {
      const source = { ...layer(new Uint8Array([200, 100, 50, 255])), blendMode }
      assert.deepEqual([...runtime.composeDocumentRegion(job([backdrop, source])).rgba], expected)
      assert.deepEqual([...runtime.composeDocumentRegion(job([{ ...source, rgba: new Uint8Array([200, 100, 50, 128]) }])).rgba], [200, 100, 50, 128])
    }
    assert.deepEqual([...runtime.composeDocumentRegion(job([])).rgba], [0, 0, 0, 0])
    assert.deepEqual([...runtime.composeDocumentRegion(job([{ ...layer(), opacity: 50 }])).rgba], [40, 80, 120, 128])
    assert.deepEqual([...runtime.composeDocumentRegion(job([{ ...layer(), opacity: 0.1 }])).rgba], [0, 0, 0, 0])
    assert.deepEqual([...runtime.composeDocumentRegion(job([
      layer(new Uint8Array([100, 150, 200, 128])), layer(new Uint8Array([200, 50, 100, 128]))
    ])).rgba], [167, 83, 133, 192])
  } finally { runtime.dispose() }
})

test('WASM recompõe tiles irregulares da mesma grade e preserva fontes', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const rgba = Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => (i * 31) % 256), original = rgba.slice()
  try {
    for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const) {
      const layers = [{ ...layer(rgba), width: 7, height: 5 }, { ...layer(rgba), width: 7, height: 5, x: -2, y: 1, opacity: 63.7, blendMode }]
      const request = { ...job(layers), documentWidth: 7, documentHeight: 5, region: { x: 0, y: 0, width: 7, height: 5 } }
      const full = runtime.composeDocumentRegion(request), stitched = new Uint8Array(full.rgba.length)
      for (let y = 0; y < 5; y += 2) for (let x = 0; x < 7; x += 3) {
        const region = { x, y, width: Math.min(3, 7 - x), height: Math.min(2, 5 - y) }
        const tile = runtime.composeDocumentRegion({ ...request, region })
        for (let row = 0; row < region.height; row++) stitched.set(tile.rgba.subarray(row * region.width * 4, (row + 1) * region.width * 4), ((y + row) * 7 + x) * 4)
      }
      assert.deepEqual(stitched, full.rgba)
    }
    assert.deepEqual(rgba, original)
    const outside = runtime.composeDocumentRegion({ ...job(), region: { x: 1, y: 1, width: 2, height: 2 } })
    assert.deepEqual(outside.rgba, new Uint8Array(16))
  } finally { runtime.dispose() }
})

test('ABI direta rejeita corrupção e overlap sem escrever, depois recupera', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const memory = instance.exports.memory as WebAssembly.Memory
  const alloc = instance.exports.axia_poc_alloc as (n: number) => number
  const free = instance.exports.axia_poc_free as (p: number, n: number) => void
  const apply = instance.exports.axia_poc_document_region as (p: number, n: number, o: number, l: number) => number
  assert.equal(apply.length, 4)
  const packet = encodeDocumentComposite(job([layer(), layer()])), p = alloc(packet.length), o = alloc(4)
  try {
    new Uint8Array(memory.buffer, p, packet.length).set(packet)
    new Uint8Array(memory.buffer, o, 4).fill(99)
    assert.equal(apply(0, packet.length, o, 4), 3)
    assert.equal(apply(p, packet.length, p, 4), 5)
    assert.equal(apply(p, packet.length, p + packet.length - 4, 4), 5)
    assert.equal(apply(p, packet.length, o, 3), 1)
    for (const [offset, value] of [[0, 0], [4, 2], [8, 44], [12, 1025], [48, 0], [48, 0xffffffff], [52, 0xffffffff], [88 + 24, 2], [88 + 28, 6]]) {
      new Uint8Array(memory.buffer, p, packet.length).set(packet)
      new DataView(memory.buffer).setUint32(p + offset!, value!, true)
      assert.equal(apply(p, packet.length, o, 4), 2)
      assert.deepEqual([...new Uint8Array(memory.buffer, o, 4)], [99, 99, 99, 99])
    }
    new Uint8Array(memory.buffer, p, packet.length).set(packet)
    assert.equal(apply(p, packet.length, o, 4), 0)
    assert.deepEqual([...new Uint8Array(memory.buffer, o, 4)], [40, 80, 120, 255])
  } finally { free(o, 4); free(p, packet.length) }
})

test('adapter não modifica staging e resultados continuam próprios após novos renders/dispose', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), staged = runtime.stageSource(new Uint8Array([7, 8, 9, 255]), 1, 1, 1)
  const first = runtime.composeDocumentRegion(job())
  assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, job().region, 100).rgba, new Uint8Array([7, 8, 9, 255]))
  invalid(() => runtime.composeDocumentPacket(new Uint8Array(48)))
  for (let i = 0; i < 20; i++) runtime.composeDocumentRegion(job([]))
  runtime.dispose(); runtime.dispose()
  assert.deepEqual(first.rgba, new Uint8Array([40, 80, 120, 255]))
  invalid(() => runtime.composeDocumentRegion(job()), 'wasm-unavailable')
  for (const value of Object.values(first.timings)) assert.ok(Number.isFinite(value) && value >= 0)
})

test('Worker transfere DCP1/saída, preserva fonte editorial e recupera após pacote inválido', async () => {
  const harness = createRustPixelWorkerHarness(), source = layer(), original = source.rgba.slice()
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const packet = encodeDocumentComposite(job([source]))
    const response = await harness.send({ type: 'compose-document-region', packet: packet.buffer }, [packet.buffer])
    assert.equal(packet.byteLength, 0); assert.deepEqual(source.rgba, original)
    assert.equal(response.type, 'rendered-document-region')
    if (response.type !== 'rendered-document-region') assert.fail('resposta documental esperada')
    assert.deepEqual(new Uint8Array(response.rgba), original); assert.deepEqual(response.region, job().region)
    const malformed = await harness.send({ type: 'compose-document-region', packet: new ArrayBuffer(48) })
    assert.deepEqual(malformed, { type: 'error', id: malformed.id, code: 'invalid-input' })
    const empty = encodeDocumentComposite(job([]))
    assert.equal((await harness.send({ type: 'compose-document-region', packet: empty.buffer }, [empty.buffer])).type, 'rendered-document-region')
    await harness.send({ type: 'dispose' })
    assert.equal((await harness.send({ type: 'compose-document-region', packet: encodeDocumentComposite(job()).buffer })).type, 'error')
  } finally { await harness.close() }
})

test('adapter libera todas as alocações após falha e recria views após memory.grow', async () => {
  const instantiate = WebAssembly.instantiate
  for (const mode of ['failed-allocation', 'kernel-failure', 'kernel-memory-limit', 'grow'] as const) {
    const base = await instantiate(wasm, {})
    const exports = base.instance.exports
    const alloc = exports.axia_poc_alloc as (n: number) => number
    const free = exports.axia_poc_free as (p: number, n: number) => void
    const apply = exports.axia_poc_document_region as (p: number, n: number, o: number, l: number) => number
    const live = new Map<number, number>()
    let allocations = 0
    const mocked = { ...exports,
      axia_poc_alloc(length: number) {
        allocations++
        if (allocations === 2 && mode === 'failed-allocation') return 0
        const pointer = alloc(length); live.set(pointer, length)
        if (allocations === 2 && mode === 'grow') (exports.memory as WebAssembly.Memory).grow(1)
        return pointer
      },
      axia_poc_free(pointer: number, length: number) {
        assert.equal(live.get(pointer), length)
        live.delete(pointer); free(pointer, length)
      },
      axia_poc_document_region(p: number, n: number, o: number, l: number) {
        if (mode === 'kernel-failure') throw new Error('injected kernel trap')
        if (mode === 'kernel-memory-limit') return 6
        return apply(p, n, o, l)
      }
    }
    let runtime: Awaited<ReturnType<typeof createRustPixelPocRuntime>>
    try {
      WebAssembly.instantiate = (async () => ({ module: base.module, instance: { exports: mocked } })) as unknown as typeof WebAssembly.instantiate
      runtime = await createRustPixelPocRuntime(wasm)
    } finally { WebAssembly.instantiate = instantiate }
    try {
      if (mode === 'grow') assert.deepEqual(runtime.composeDocumentRegion(job()).rgba, new Uint8Array([40, 80, 120, 255]))
      else if (mode === 'kernel-failure') assert.throws(() => runtime.composeDocumentRegion(job()), /injected kernel trap/)
      else invalid(() => runtime.composeDocumentRegion(job()), mode === 'kernel-memory-limit' ? 'memory-limit' : 'wasm-failure')
      assert.equal(live.size, 0)
    } finally { runtime.dispose() }
  }
})

test('budget inclui fonte staged antes de alocar WASM para a pilha', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    runtime.stageSource(new Uint8Array(1024 * 1024), 512, 512, 1)
    const source = { ...layer(new Uint8Array(1024 * 1024)), width: 512, height: 512 }
    const request = { ...job(Array(62).fill(source)), region: { x: 0, y: 0, width: 4096, height: 2112 } }
    const packet = encodeDocumentComposite(request)
    assert.ok(documentCompositePacketLayout(packet).workingBytes < 96 * 1024 * 1024)
    invalid(() => runtime.composeDocumentPacket(packet), 'memory-limit')
    assert.deepEqual([...runtime.composeDocumentRegion(job()).rgba], [40, 80, 120, 255])
  } finally { runtime.dispose() }
})

test('ausência do export documental não impede estilos antigos e retorna erro só na pilha', async () => {
  const instantiate = WebAssembly.instantiate, base = await instantiate(wasm, {})
  const { axia_poc_document_region: _document, ...legacyExports } = base.instance.exports
  let runtime: Awaited<ReturnType<typeof createRustPixelPocRuntime>>
  try {
    WebAssembly.instantiate = (async () => ({ module: base.module, instance: { exports: legacyExports } })) as unknown as typeof WebAssembly.instantiate
    runtime = await createRustPixelPocRuntime(wasm)
  } finally { WebAssembly.instantiate = instantiate }
  try {
    assert.deepEqual(runtime.render(new Uint8Array([1, 2, 3, 255]), 50).rgba, new Uint8Array([1, 2, 3, 128]))
    invalid(() => runtime.composeDocumentRegion(job()), 'wasm-unavailable')
  } finally { runtime.dispose() }
})

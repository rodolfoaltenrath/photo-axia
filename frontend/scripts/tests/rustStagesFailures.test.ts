import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeStyleStages, prepareRustStyleStages } from '../../src/editor/rustPixelPocStages.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const light = { angle: 0, altitude: 30 }
const plan = prepareRustStyleStages(normalizeLayerStyleConfig({ fillOpacity: 73.5, effects: [
  { type: 'drop-shadow', id: 'shadow', distance: 0, size: 1, layerKnocksOutShadow: false },
  { type: 'color-overlay', id: 'color', color: '#33669980' }
] }), light, 1)

test('Adapter STG1 rejeita WASM antigo antes de reservar fonte', async context => {
  const real = await WebAssembly.instantiate(wasm, {}), mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({
    module: real.module, instance: { exports: { ...real.instance.exports, axia_poc_style_stages_region: () => 0 } }
  } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  try { await assert.rejects(createRustPixelPocRuntime(wasm), (e: unknown) => e instanceof RustPixelPocError && e.code === 'wasm-unavailable') }
  finally { mocked.mock.restore() }
})

test('Executor faz duas alocações externas por job, recupera falhas e não reenvia fonte', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  const raw = real.instance.exports as unknown as { axia_poc_alloc(length: number): number; axia_poc_free(pointer: number, length: number): void;
    axia_poc_style_stages_region(...args: number[]): number }
  let calls = 0, failAt = 0, failKernel = false
  const live = new Map<number, number>(), kernel = (...args: number[]) => failKernel ? 6 : raw.axia_poc_style_stages_region(...args)
  Object.defineProperty(kernel, 'length', { value: 12 })
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module, instance: { exports: {
    ...real.instance.exports, axia_poc_style_stages_region: kernel,
    axia_poc_alloc(length: number) {
      if (++calls === failAt) return 0
      const pointer = raw.axia_poc_alloc(length); if (pointer) live.set(pointer, length); return pointer
    },
    axia_poc_free(pointer: number, length: number) {
      assert.equal(live.get(pointer), length); live.delete(pointer); raw.axia_poc_free(pointer, length)
    }
  } } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(new Uint8Array([20, 40, 60, 101]), 1, 1, 1), region = { x: 0, y: 0, width: 1, height: 1 }
    for (const allocation of [1, 2]) {
      calls = 0; failAt = allocation
      assert.throws(() => runtime.styleStagesStagedRegion(staged.sourceId, region, plan), (e: unknown) => e instanceof RustPixelPocError && e.code === 'wasm-failure')
      assert.equal(live.size, 1)
    }
    failAt = 0; failKernel = true
    assert.throws(() => runtime.styleStagesStagedRegion(staged.sourceId, region, plan), (e: unknown) => e instanceof RustPixelPocError && e.code === 'memory-limit')
    assert.equal(live.size, 1)
    failKernel = false; calls = 0
    const first = runtime.styleStagesStagedRegion(staged.sourceId, region, plan).rgba
    assert.equal(calls, 2); assert.equal(live.size, 1)
    assert.deepEqual(runtime.styleStagesStagedRegion(staged.sourceId, region, plan).rgba, first)
    const before = calls
    assert.throws(() => runtime.styleStagesStagedRegion(staged.sourceId, region, { ...plan, fillOpacity: NaN }))
    assert.equal(calls, before)
  } finally { runtime.dispose(); mocked.mock.restore() }
  assert.equal(live.size, 0)
})

test('ABI STG1 rejeita offsets, estágios, comando final inválido e overlap sem publicação parcial', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const raw = instance.exports as unknown as { memory: WebAssembly.Memory; axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_style_stages_region(...args: number[]): number }
  const region = { x: 0, y: 0, width: 1, height: 1 }, packet = encodeStyleStages(plan, 1, 1, region)
  const lengths = [4, packet.length, 4], pointers = lengths.map(n => raw.axia_poc_alloc(n)), [source, commands, output] = pointers as [number, number, number]
  const args = [source, 4, 1, 1, 0, 0, 1, 1, commands, packet.length, output, 4]
  const overlayStart = new DataView(packet.buffer).getUint32(32 + 16 + 8, true)
  const rejects = (bad: Uint8Array, status: number) => {
    new Uint8Array(raw.memory.buffer, commands, packet.length).set(bad)
    new Uint8Array(raw.memory.buffer, output, 4).fill(99)
    assert.equal(raw.axia_poc_style_stages_region(...args), status)
    assert.deepEqual([...new Uint8Array(raw.memory.buffer, output, 4)], [99, 99, 99, 99])
    assert.deepEqual([...new Uint8Array(raw.memory.buffer, source, 4)], [20, 40, 60, 101])
  }
  try {
    new Uint8Array(raw.memory.buffer, source, 4).set([20, 40, 60, 101])
    for (const [offset, value, status] of [[0, 0, 2], [4, 2, 2], [8, 65, 2], [8, 0xffffffff, 2], [24, 2, 2], [28, 1, 2],
      [32, 9, 2], [36, 1, 2], [40, 0, 1], [44, 0xffffffff, 1], [52, 2, 2], [56, 0, 1],
      [overlayStart, 0, 2], [overlayStart + 8, 2, 2], [overlayStart + 32 + 4, 6, 2]]) {
      const bad = packet.slice(); new DataView(bad.buffer).setUint32(offset!, value!, true); rejects(bad, status!)
    }
    for (const offset of [16, overlayStart + 16, overlayStart + 32 + 8]) {
      const bad = packet.slice(); new DataView(bad.buffer).setFloat64(offset, NaN, true); rejects(bad, 2)
    }
    const reversed = packet.slice(), reversedView = new DataView(reversed.buffer)
    const shadowStart = new DataView(packet.buffer).getUint32(40, true), shadowLength = new DataView(packet.buffer).getUint32(44, true)
    const overlayLength = packet.length - overlayStart
    reversed.set(packet.subarray(overlayStart), shadowStart); reversed.set(packet.subarray(shadowStart, overlayStart), shadowStart + overlayLength)
    for (const [offset, value] of [[32, 6], [36, 3], [40, shadowStart], [44, overlayLength], [48, 1], [52, 0], [56, shadowStart + overlayLength], [60, shadowLength]]) {
      reversedView.setUint32(offset!, value!, true)
    }
    rejects(reversed, 2)
    new Uint8Array(raw.memory.buffer, commands, packet.length).set(packet)
    for (const [index, value, status] of [[0, 0, 3], [1, 3, 1], [4, 1, 1], [9, 31, 1], [11, 8, 1]]) {
      const changed = [...args]; changed[index!] = value!
      assert.equal(raw.axia_poc_style_stages_region(...changed), status)
      assert.deepEqual([...new Uint8Array(raw.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    for (const pointer of [source, commands + 4]) {
      const changed = [...args]; changed[10] = pointer
      const before = new Uint8Array(raw.memory.buffer, pointer, 4).slice()
      assert.equal(raw.axia_poc_style_stages_region(...changed), 5)
      assert.deepEqual(new Uint8Array(raw.memory.buffer, pointer, 4), before)
    }
    assert.equal(raw.axia_poc_style_stages_region(...args), 0)
  } finally { pointers.forEach((pointer, i) => raw.axia_poc_free(pointer, lengths[i]!)) }
})

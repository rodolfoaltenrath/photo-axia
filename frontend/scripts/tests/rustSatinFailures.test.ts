import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeSatin, prepareRustSatin } from '../../src/editor/rustPixelPocSatin.ts'
import { satinEffect, satinReference } from './support/rustSatinFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer

test('Adapter acetinado rejeita assinatura antiga antes de reservar fonte', async context => {
  const real = await WebAssembly.instantiate(wasm, {}), exports = { ...real.instance.exports, axia_poc_satin_region: () => 0 }
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module,
    instance: { exports } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  try { await assert.rejects(createRustPixelPocRuntime(wasm),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable') }
  finally { mocked.mock.restore() }
})

test('Falhas de alocação e kernel do acetinado liberam temporários e mantêm a fonte reutilizável', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  const raw = real.instance.exports as unknown as { axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_satin_region(...args: number[]): number }
  const live = new Map<number, number>()
  let failAt = 0, calls = 0, failKernel = false
  const kernel = (...args: number[]) => failKernel ? 6 : raw.axia_poc_satin_region(...args)
  Object.defineProperty(kernel, 'length', { value: 14 })
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module, instance: { exports: {
    ...real.instance.exports, axia_poc_satin_region: kernel,
    axia_poc_alloc(length: number) {
      if (++calls === failAt) return 0
      const pointer = raw.axia_poc_alloc(length)
      if (pointer) live.set(pointer, length)
      return pointer
    },
    axia_poc_free(pointer: number, length: number) {
      assert.equal(live.get(pointer), length); live.delete(pointer); raw.axia_poc_free(pointer, length)
    }
  } } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const source = new Uint8Array([10, 20, 30, 101]), target = new Uint8Array(4), effect = satinEffect({ distance: 0, size: 0 })
    const satin = prepareRustSatin(effect, 1), staged = runtime.stageSource(source, 1, 1, 1), region = { x: 0, y: 0, width: 1, height: 1 }
    for (const allocation of [1, 2, 3]) {
      failAt = allocation; calls = 0
      assert.throws(() => runtime.satinStagedRegion(staged.sourceId, region, target, satin),
        (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-failure')
      assert.equal(live.size, 1)
    }
    failAt = 0; failKernel = true
    assert.throws(() => runtime.satinStagedRegion(staged.sourceId, region, target, satin),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
    assert.equal(live.size, 1)
    failKernel = false
    assert.deepEqual(runtime.satinStagedRegion(staged.sourceId, region, target, satin).rgba,
      satinReference(source, 1, 1, target, effect))
    for (const bad of [{ ...satin, radius: NaN }, { ...satin, offsetX: 8193 }]) {
      const before = calls
      assert.throws(() => runtime.satinStagedRegion(staged.sourceId, region, target, bad))
      assert.equal(calls, before); assert.equal(live.size, 1)
    }
  } finally { runtime.dispose(); mocked.mock.restore() }
  assert.equal(live.size, 0)
})

test('ABI acetinado rejeita pacote, pontos, overlap e geometria sem escrever parcialmente', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory; axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_satin_region(...args: number[]): number;
    axia_poc_drop_shadow_region(...args: number[]): number }
  const packet = encodeSatin(prepareRustSatin(satinEffect({ contour: { preset: 'custom',
    points: [{ x: 0, y: 0.75 }, { x: 1, y: 0.25 }] } }), 1))
  const lengths = [4, 4, packet.length, 4], pointers = lengths.map(length => exports.axia_poc_alloc(length))
  const [source, target, commands, output] = pointers as [number, number, number, number]
  try {
    new Uint8Array(exports.memory.buffer, source, 4).set([10, 20, 30, 101])
    new Uint8Array(exports.memory.buffer, target, 4).set([77, 88, 99, 0])
    const args = [source, 4, 1, 1, 0, 0, 1, 1, target, 4, commands, packet.length, output, 4]
    for (const [offset, value, status] of [[0, 0x31444853, 2], [4, 2, 2], [8, 4097, 2], [12, 2, 2], [16, 8193, 2],
      [24, 6, 2], [28, 1, 2], [36, 6, 2], [40, 1, 2], [44, 0xffffffff, 1], [56, 1, 2], [60, 1, 2]]) {
      const bad = packet.slice(); new DataView(bad.buffer).setUint32(offset!, value!, true)
      new Uint8Array(exports.memory.buffer, commands, packet.length).set(bad)
      new Uint8Array(exports.memory.buffer, output, 4).fill(99)
      assert.equal(exports.axia_poc_satin_region(...args), status)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, target, 4)], [77, 88, 99, 0])
    }
    for (const offset of [48, 64, 72, 80, 88]) {
      const bad = packet.slice(); new DataView(bad.buffer).setFloat64(offset, NaN, true)
      new Uint8Array(exports.memory.buffer, commands, packet.length).set(bad)
      assert.equal(exports.axia_poc_satin_region(...args), 2)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    new Uint8Array(exports.memory.buffer, commands, packet.length).set(packet)
    assert.equal(exports.axia_poc_drop_shadow_region(...args), 2)
    for (const [index, value, status] of [[0, 0, 3], [1, 3, 1], [4, 1, 1], [9, 8, 1], [11, 63, 1], [13, 8, 1]]) {
      const changed = [...args]; changed[index!] = value!
      assert.equal(exports.axia_poc_satin_region(...changed), status)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    for (const pointer of [source, target, commands + 4]) {
      const changed = [...args]; changed[12] = pointer
      const before = new Uint8Array(exports.memory.buffer, pointer, 4).slice()
      assert.equal(exports.axia_poc_satin_region(...changed), 5)
      assert.deepEqual(new Uint8Array(exports.memory.buffer, pointer, 4), before)
    }
    assert.equal(exports.axia_poc_satin_region(...args), 0)
  } finally { pointers.forEach((pointer, index) => exports.axia_poc_free(pointer, lengths[index]!)) }
})

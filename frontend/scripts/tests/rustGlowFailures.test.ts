import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { prepareRustGlow } from '../../src/editor/rustPixelPocGlow.ts'
import { glowEffect, glowReference } from './support/rustGlowFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer

test('Falhas de alocação e kernel dos brilhos liberam temporários e mantêm a fonte reutilizável', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  const raw = real.instance.exports as unknown as { axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_glow_region(...args: number[]): number }
  const live = new Map<number, number>()
  let failAt = 0, calls = 0, failKernel = false
  const kernel = (...args: number[]) => failKernel ? 6 : raw.axia_poc_glow_region(...args)
  Object.defineProperty(kernel, 'length', { value: 14 })
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module, instance: { exports: {
    ...real.instance.exports, axia_poc_glow_region: kernel,
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
    const source = new Uint8Array([10, 20, 30, 101]), target = new Uint8Array(4), effect = glowEffect('inner-edge', { size: 1 })
    const shadow = prepareRustGlow(effect, 1), staged = runtime.stageSource(source, 1, 1, 1), region = { x: 0, y: 0, width: 1, height: 1 }
    for (const allocation of [1, 2, 3]) {
      failAt = allocation; calls = 0
      assert.throws(() => runtime.glowStagedRegion(staged.sourceId, region, target, shadow),
        (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-failure')
      assert.equal(live.size, 1)
    }
    failAt = 0; failKernel = true
    assert.throws(() => runtime.glowStagedRegion(staged.sourceId, region, target, shadow),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
    assert.equal(live.size, 1)
    failKernel = false
    assert.deepEqual(runtime.glowStagedRegion(staged.sourceId, region, target, shadow).rgba,
      glowReference(source, 1, 1, target, effect))
    for (const bad of [{ ...shadow, jitter: NaN }, { ...shadow, range: 0 }]) {
      const before = calls
      assert.throws(() => runtime.glowStagedRegion(staged.sourceId, region, target, bad))
      assert.equal(calls, before); assert.equal(live.size, 1)
    }
  } finally { runtime.dispose(); mocked.mock.restore() }
  assert.equal(live.size, 0)
})

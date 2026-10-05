import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { alphaMaskReference } from './support/rustAlphaMaskFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer

test('Máscara Rust reproduz referência fixa e usa alfa original, não RGB/fill', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array(36)
  source.set([123, 45, 67, 255], 16)
  const before = source.slice(), region = { x: 0, y: 0, width: 3, height: 3 }
  try {
    const staged = runtime.stageSource(source, 3, 3, 1)
    for (const precise of [false, true]) {
      const result = runtime.alphaMaskStagedRegion(staged.sourceId, region, { spreadRadius: 0, blurRadius: 1, precise })
      assert.deepEqual(result.rgba, Uint8Array.from({ length: 36 }, (_, index) => index % 4 === 3 ? 28 : 0))
      assert.equal(result.generation, 1)
      assert.equal(result.timings.copyInMs, 0)
    }
    assert.deepEqual(source, before)
    assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, region, 100).rgba, source)
  } finally { runtime.dispose() }
})

test('Spread e blur preciso/suave concordam byte a byte para todos os valores de alfa', async () => {
  const width = 256, height = 256
  const source = Uint8Array.from({ length: width * height * 4 }, (_, index) =>
    index % 4 === 3 ? (Math.floor(index / 4) % width + Math.floor(index / 4 / width) * 17) % 256 : index * 13 % 256)
  const before = source.slice(), runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1), region = { x: 0, y: 0, width, height }
    for (const spreadRadius of [0, 1, 3, 10]) for (const blurRadius of [0, 1, 2, 3, 4, 7, 16]) for (const precise of [false, true]) {
      const config = { spreadRadius, blurRadius, precise }
      assert.deepEqual(runtime.alphaMaskStagedRegion(staged.sourceId, region, config).rgba,
        alphaMaskReference(source, width, height, config), JSON.stringify(config))
    }
    assert.deepEqual(source, before)
  } finally { runtime.dispose() }
})

test('Tiles 7×5 com halo remontam exatamente o raster inteiro, inclusive fonte estreita e raios maiores que ela', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const [width, height] of [[37, 29], [1, 17], [19, 1], [1, 1]] as const) {
      const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
      const staged = runtime.stageSource(source, width, height, ++generation)
      for (const spreadRadius of [0, 1, 5, 4096]) for (const blurRadius of [0, 1, 2, 4, 8, 4096]) for (const precise of [false, true]) {
        const config = { spreadRadius, blurRadius, precise }, expected = alphaMaskReference(source, width, height, config)
        const full = runtime.alphaMaskStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, config).rgba
        assert.deepEqual(full, expected)
        for (let y = 0; y < height; y += 5) for (let x = 0; x < width; x += 7) {
          const region = { x, y, width: Math.min(7, width - x), height: Math.min(5, height - y) }
          assert.deepEqual(runtime.alphaMaskStagedRegion(staged.sourceId, region, config).rgba,
            gradientTile(expected, width, region), `${width}x${height} ${JSON.stringify(config)} ${x},${y}`)
        }
      }
    }
  } finally { runtime.dispose() }
})

test('Máscara prepara o mesmo halo da sombra TS sem cor/deslocamento/contorno adicionais', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const size of [0, 1, 2, 7, 16]) for (const spread of [0, 37.5, 100]) {
      const source = { width: 17, height: 9, data: Uint8ClampedArray.from({ length: 17 * 9 * 4 }, (_, index) => index * 29 % 256) }
      const styles = normalizeLayerStyleConfig({ enabled: true, fillOpacity: 0, effects: [{ type: 'drop-shadow',
        id: 'mask-reference', size, spread, distance: 0, useGlobalLight: false, color: '#000000',
        opacity: 100, noise: 0, layerKnocksOutShadow: false }] })
      const expected = composeLayerStyleRaster(source, styles, { angle: 0, altitude: 30 })
      const expanded = new Uint8Array(expected.data.length)
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        expanded[((y - expected.offsetY) * expected.width + x - expected.offsetX) * 4 + 3] = source.data[(y * source.width + x) * 4 + 3]!
      }
      const staged = runtime.stageSource(expanded, expected.width, expected.height, ++generation)
      const spreadRadius = Math.min(size, Math.round(size * spread / 100))
      assert.deepEqual(runtime.alphaMaskStagedRegion(staged.sourceId, { x: 0, y: 0, width: expected.width, height: expected.height },
        { spreadRadius, blurRadius: size - spreadRadius, precise: false }).rgba, new Uint8Array(expected.data), `${size}/${spread}`)
    }
  } finally { runtime.dispose() }
})

test('Máscara preserva cantos, transparência, picos isolados e ruído determinístico por tiles', async () => {
  const width = 23, height = 19, runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0, seed = 0x12345678
  try {
    for (const kind of ['empty', 'opaque', 'corners', 'checker', 'noise']) {
      const source = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const alpha = kind === 'opaque' ? 255 : kind === 'corners' ? (x === 0 || x === width - 1) && (y === 0 || y === height - 1) ? 255 : 0
          : kind === 'checker' ? (x + y) % 2 * 255 : kind === 'noise' ? seed >>> 24 : 0
        source.set([255, 99, 33, alpha], (y * width + x) * 4)
      }
      const staged = runtime.stageSource(source, width, height, ++generation)
      for (const spreadRadius of [0, 2, 5]) for (const blurRadius of [0, 2, 5]) for (const precise of [false, true]) {
        const config = { spreadRadius, blurRadius, precise }, expected = alphaMaskReference(source, width, height, config)
        for (const region of [{ x: 0, y: 0, width, height }, { x: 1, y: 1, width: 7, height: 5 },
          { x: 17, y: 14, width: 6, height: 5 }]) {
          assert.deepEqual(runtime.alphaMaskStagedRegion(staged.sourceId, region, config).rgba,
            gradientTile(expected, width, region), `${kind} ${JSON.stringify(config)} ${JSON.stringify(region)}`)
        }
      }
    }
  } finally { runtime.dispose() }
})

test('Máscara rejeita plano/região inválidos, preserva fonte e respeita invalidação/descarte', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([10, 20, 30, 101]), config = { spreadRadius: 0, blurRadius: 0, precise: false }
  const region = { x: 0, y: 0, width: 1, height: 1 }, staged = runtime.stageSource(source, 1, 1, 1)
  try {
    for (const bad of [{ ...config, spreadRadius: -1 }, { ...config, blurRadius: NaN }, { ...config, blurRadius: 4097 }]) {
      assert.throws(() => runtime.alphaMaskStagedRegion(staged.sourceId, region, bad),
        (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input')
    }
    assert.throws(() => runtime.alphaMaskStagedRegion(staged.sourceId, { ...region, x: 1 }, config))
    assert.deepEqual(runtime.alphaMaskStagedRegion(staged.sourceId, region, config).rgba, new Uint8Array([0, 0, 0, 101]))
    runtime.invalidateSource(2)
    assert.throws(() => runtime.alphaMaskStagedRegion(staged.sourceId, region, config))
    const fresh = runtime.stageSource(source, 1, 1, 2)
    assert.equal(runtime.alphaMaskStagedRegion(fresh.sourceId, region, config).generation, 2)
  } finally { runtime.dispose() }
  assert.throws(() => runtime.alphaMaskStagedRegion(staged.sourceId, region, config),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
})

test('Máscara libera saída em falha de alocação/kernel e recupera sem perder a fonte', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  const raw = real.instance.exports as unknown as { axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_alpha_mask_region(...args: number[]): number }
  const live = new Map<number, number>()
  let failAllocation = false, failKernel = false
  const mask = (...args: number[]) => failKernel ? 6 : raw.axia_poc_alpha_mask_region(...args)
  Object.defineProperty(mask, 'length', { value: 13 })
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module, instance: { exports: {
    ...real.instance.exports, axia_poc_alpha_mask_region: mask,
    axia_poc_alloc(length: number) {
      if (failAllocation) return 0
      const pointer = raw.axia_poc_alloc(length)
      if (pointer) live.set(pointer, length)
      return pointer
    },
    axia_poc_free(pointer: number, length: number) {
      assert.equal(live.get(pointer), length)
      live.delete(pointer); raw.axia_poc_free(pointer, length)
    }
  } } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  const runtime = await createRustPixelPocRuntime(wasm)
  const config = { spreadRadius: 0, blurRadius: 0, precise: false }, region = { x: 0, y: 0, width: 1, height: 1 }
  try {
    const staged = runtime.stageSource(new Uint8Array([10, 20, 30, 101]), 1, 1, 1)
    failAllocation = true
    assert.throws(() => runtime.alphaMaskStagedRegion(staged.sourceId, region, config),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-failure')
    assert.equal(live.size, 1)
    failAllocation = false; failKernel = true
    assert.throws(() => runtime.alphaMaskStagedRegion(staged.sourceId, region, config),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
    assert.equal(live.size, 1)
    failKernel = false
    assert.deepEqual(runtime.alphaMaskStagedRegion(staged.sourceId, region, config).rgba, new Uint8Array([0, 0, 0, 101]))
    assert.equal(live.size, 1)
  } finally { runtime.dispose(); mocked.mock.restore() }
  assert.equal(live.size, 0)
})

test('Adapter rejeita WASM antigo sem export de máscara antes de preparar fonte', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  const exports = { ...real.instance.exports }
  delete exports.axia_poc_alpha_mask_region
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module,
    instance: { exports } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  try {
    await assert.rejects(createRustPixelPocRuntime(wasm),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
  } finally { mocked.mock.restore() }
})

test('ABI máscara rejeita raios, técnica, comprimento, geometria e overlap sem tocar na saída', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory;
    axia_poc_alloc(length: number): number; axia_poc_free(pointer: number, length: number): void;
    axia_poc_alpha_mask_region(...args: number[]): number }
  const source = exports.axia_poc_alloc(12), output = exports.axia_poc_alloc(4)
  try {
    new Uint8Array(exports.memory.buffer, source, 12).set([1, 2, 3, 255, 0, 0, 0, 0, 0, 0, 0, 0])
    const args = [source, 12, 3, 1, 1, 0, 1, 1, output, 4, 0, 1, 0]
    for (const [index, value, expected] of [[10, 4097, 2], [11, 4097, 2], [12, 2, 2], [9, 8, 1], [4, 3, 1], [0, 0, 3]]) {
      const changed = [...args]; changed[index!] = value!
      new Uint8Array(exports.memory.buffer, output, 4).fill(99)
      assert.equal(exports.axia_poc_alpha_mask_region(...changed), expected)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    const changed = [...args]; changed[8] = source + 4
    assert.equal(exports.axia_poc_alpha_mask_region(...changed), 5)
    assert.deepEqual([...new Uint8Array(exports.memory.buffer, source, 12)], [1, 2, 3, 255, 0, 0, 0, 0, 0, 0, 0, 0])
    assert.equal(exports.axia_poc_alpha_mask_region(...args), 0)
    assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [0, 0, 0, 28])
  } finally { exports.axia_poc_free(source, 12); exports.axia_poc_free(output, 4) }
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeInnerShadow, prepareRustInnerShadow } from '../../src/editor/rustPixelPocInnerShadow.ts'
import { encodeDropShadow, prepareRustDropShadow } from '../../src/editor/rustPixelPocDropShadow.ts'
import { innerShadowEffect, innerShadowLight, innerShadowReference } from './support/rustInnerShadowFixture.ts'
import { shadowEffect, shadowReference } from './support/rustDropShadowFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import type { LayerBlendMode, LayerStyleContour } from '../../src/types/editor.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const custom: LayerStyleContour = { preset: 'custom', points: [{ x: 0.25, y: 0.75 }, { x: 0.25, y: 0 }, { x: 0.75, y: 1 }] }

test('Sombra interna Rust reproduz golden existente sem regenerar a expectativa', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((item: { id: string }) => item.id === 'inner-shadow-edge')
  const config = normalizeLayerStyleConfig(fixture.styles), effect = config.effects[0]!
  assert.ok(effect.type === 'inner-shadow')
  const source = new Uint8Array(fixture.source.rgba), { width, height } = fixture.source
  const target = source.slice()
  for (let index = 3; index < target.length; index += 4) target[index] = Math.round(target[index]! * config.fillOpacity / 100)
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    assert.deepEqual([...runtime.innerShadowStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target,
      prepareRustInnerShadow(effect, fixture.globalLight, fixture.resolutionScale)).rgba], fixture.expected.rgba)
  } finally { runtime.dispose() }
})

for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as LayerBlendMode[]) {
  test(`Sombra interna ${blendMode}: todos os alfas, contornos, choke e ruído concordam byte a byte`, async () => {
    const width = 256, height = 256, source = new Uint8Array(width * height * 4), target = new Uint8Array(source.length)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      source.set([x, y, x ^ y, y], index); target.set([x, 255 - y, x ^ y, x], index)
    }
    const runtime = await createRustPixelPocRuntime(wasm), region = { x: 0, y: 0, width, height }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      for (const preset of ['linear', 'cone', 'inverted-cone', 'gaussian', 'ring', 'custom'] as const) {
        for (const noise of [0, 37.5, 100]) for (const choke of [0, 37.5, 100]) {
          const effect = innerShadowEffect({ blendMode, size: 2, distance: 0.5, angle: 0, noise, choke,
            contour: preset === 'custom' ? custom : { preset, points: [] } })
          assert.deepEqual(runtime.innerShadowStagedRegion(staged.sourceId, region, target,
            prepareRustInnerShadow(effect, innerShadowLight, 1)).rgba,
          innerShadowReference(source, width, height, target, effect), `${preset}/${noise}/${choke}`)
        }
      }
    } finally { runtime.dispose() }
  })
}

test('Sombra interna em tiles preserva halos, transparência, deslocamento e índice global do ruído', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const [width, height] of [[37, 29], [1, 17], [19, 1], [1, 1]] as const) {
      const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
      const target = Uint8Array.from(source, (value, index) => index % 4 === 3 ? 101 : 255 - value)
      const staged = runtime.stageSource(source, width, height, ++generation)
      for (const size of [0, 2, 7]) for (const choke of [0, 99, 100]) for (const angle of [-180, -77.75, 0, 33.333]) {
        const effect = innerShadowEffect({ size, choke, angle, contour: custom })
        const shadow = prepareRustInnerShadow(effect, innerShadowLight, 1), expected = innerShadowReference(source, width, height, target, effect)
        assert.deepEqual(runtime.innerShadowStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, shadow).rgba, expected)
        for (let y = 0; y < height; y += 5) for (let x = 0; x < width; x += 7) {
          const region = { x, y, width: Math.min(7, width - x), height: Math.min(5, height - y) }
          assert.deepEqual(runtime.innerShadowStagedRegion(staged.sourceId, region, gradientTile(target, width, region), shadow).rgba,
            gradientTile(expected, width, region), `${width}x${height} ${size}/${choke}/${angle} ${x},${y}`)
        }
      }
    }
  } finally { runtime.dispose() }
})

test('Sombra interna resolve luz global, meio pixel e escalas/raios máximos sem inverter depois de arredondar', async () => {
  const source = Uint8Array.from({ length: 11 * 13 * 4 }, (_, index) => index * 29 % 256)
  const target = Uint8Array.from(source, (_, index) => index * 19 % 256), runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, 11, 13, 1)
    for (const scale of [0.125, 1.375, 8]) for (const angle of [-180, -90, 0, 33.333, 90]) for (const useGlobalLight of [false, true]) {
      const light = { angle, altitude: 30 }, effect = innerShadowEffect({ size: 5.25, distance: 0.5, angle, useGlobalLight })
      const shadow = prepareRustInnerShadow(effect, light, scale), expected = innerShadowReference(source, 11, 13, target, effect, light, scale)
      for (const region of [{ x: 0, y: 0, width: 11, height: 13 }, { x: 2, y: 3, width: 7, height: 5 }]) {
        assert.deepEqual(runtime.innerShadowStagedRegion(staged.sourceId, region, gradientTile(target, 11, region), shadow).rgba,
          gradientTile(expected, 11, region), `${scale}/${angle}/${useGlobalLight}`)
      }
    }
    const maximum = innerShadowEffect({ size: 250, distance: 1000, useGlobalLight: false, angle: 0 })
    assert.deepEqual(runtime.innerShadowStagedRegion(staged.sourceId, { x: 0, y: 0, width: 11, height: 13 }, target,
      prepareRustInnerShadow(maximum, innerShadowLight, 8)).rgba, innerShadowReference(source, 11, 13, target, maximum, innerShadowLight, 8))
  } finally { runtime.dispose() }
})

test('Sombra interna preserva RGB oculto, alfa de cor e contornos customizados estreitos/duplicados', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), width = 256, source = new Uint8Array(width * 4), target = new Uint8Array(width * 4)
  for (let alpha = 0; alpha < width; alpha++) {
    source.set([77, 88, 99, alpha], alpha * 4); target.set([200, 120, 40, alpha], alpha * 4)
  }
  try {
    const staged = runtime.stageSource(source, width, 1, 1)
    const narrow: LayerStyleContour = { preset: 'custom', points: Array.from({ length: 32 }, (_, index) => ({
      x: 0.5 + index * 1e-14, y: index % 2 })) }
    for (const color of ['#33669900', '#336699ff', '#ffffff']) for (const contour of [custom, narrow]) for (const choke of [0, 37.5, 99, 100]) {
      const effect = innerShadowEffect({ color, contour, choke, distance: 2, size: 0, opacity: 100, noise: 100 })
      assert.deepEqual(runtime.innerShadowStagedRegion(staged.sourceId, { x: 0, y: 0, width, height: 1 }, target,
        prepareRustInnerShadow(effect, innerShadowLight, 1)).rgba, innerShadowReference(source, width, 1, target, effect))
    }
    for (const alpha of [0, 255]) {
      const uniform = source.slice()
      for (let offset = 3; offset < uniform.length; offset += 4) uniform[offset] = alpha
      const updated = runtime.stageSource(uniform, width, 1, alpha + 2), effect = innerShadowEffect({ distance: 0, size: 0, contour: custom })
      assert.deepEqual(runtime.innerShadowStagedRegion(updated.sourceId, { x: 0, y: 0, width, height: 1 }, target,
        prepareRustInnerShadow(effect, innerShadowLight, 1)).rgba, target)
    }
  } finally { runtime.dispose() }
})

test('Sombra interna usa a máscara original depois da externa e antes do overlay com Fill zero', async () => {
  const width = 19, height = 17, source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
  const external = shadowEffect({ size: 0, distance: 0, layerKnocksOutShadow: false }), inner = innerShadowEffect()
  const overlay = { type: 'color-overlay' as const, id: 'overlay', enabled: true, color: '#ee772280', opacity: 37.5, blendMode: 'screen' as const }
  const runtime = await createRustPixelPocRuntime(wasm), region = { x: 0, y: 0, width, height }
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    const shadowed = runtime.dropShadowStagedRegion(staged.sourceId, region, new Uint8Array(source.length), prepareRustDropShadow(external, innerShadowLight, 1))
    assert.deepEqual(shadowed.rgba, shadowReference(source, width, height, new Uint8Array(source.length), external, innerShadowLight))
    const innerResult = runtime.innerShadowStagedRegion(staged.sourceId, region, shadowed.rgba, prepareRustInnerShadow(inner, innerShadowLight, 1))
    assert.deepEqual(innerResult.rgba, innerShadowReference(source, width, height, shadowed.rgba, inner, innerShadowLight))
    const result = runtime.colorOverlayStagedRegion(staged.sourceId, region, innerResult.rgba,
      { color: [238, 119, 34, 128], opacity: 37.5, blendMode: 'screen' })
    const reference = composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) },
      normalizeLayerStyleConfig({ fillOpacity: 0, effects: [external, overlay, inner] }), innerShadowLight)
    assert.equal(reference.width, width); assert.equal(reference.height, height)
    assert.deepEqual(result.rgba, new Uint8Array(reference.data))
    assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, region, 100).rgba, source)
  } finally { runtime.dispose() }
})

test('Adapter interno rejeita assinatura antiga antes de reservar fonte', async context => {
  const real = await WebAssembly.instantiate(wasm, {}), exports = { ...real.instance.exports, axia_poc_inner_shadow_region: () => 0 }
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module,
    instance: { exports } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  try { await assert.rejects(createRustPixelPocRuntime(wasm),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable') }
  finally { mocked.mock.restore() }
})

test('Falhas de alocação e kernel interno liberam temporários e mantêm a fonte reutilizável', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  const raw = real.instance.exports as unknown as { axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_inner_shadow_region(...args: number[]): number }
  const live = new Map<number, number>()
  let failAt = 0, calls = 0, failKernel = false
  const kernel = (...args: number[]) => failKernel ? 6 : raw.axia_poc_inner_shadow_region(...args)
  Object.defineProperty(kernel, 'length', { value: 14 })
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module, instance: { exports: {
    ...real.instance.exports, axia_poc_inner_shadow_region: kernel,
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
    const source = new Uint8Array([10, 20, 30, 101]), target = new Uint8Array(4), effect = innerShadowEffect({ distance: 1, size: 0 })
    const shadow = prepareRustInnerShadow(effect, innerShadowLight, 1), staged = runtime.stageSource(source, 1, 1, 1), region = { x: 0, y: 0, width: 1, height: 1 }
    for (const allocation of [1, 2, 3]) {
      failAt = allocation; calls = 0
      assert.throws(() => runtime.innerShadowStagedRegion(staged.sourceId, region, target, shadow),
        (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-failure')
      assert.equal(live.size, 1)
    }
    failAt = 0; failKernel = true
    assert.throws(() => runtime.innerShadowStagedRegion(staged.sourceId, region, target, shadow),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
    assert.equal(live.size, 1)
    failKernel = false
    assert.deepEqual(runtime.innerShadowStagedRegion(staged.sourceId, region, target, shadow).rgba,
      innerShadowReference(source, 1, 1, target, effect))
    for (const bad of [{ ...shadow, choke: NaN }, { ...shadow, offsetX: 8193 }]) {
      const before = calls
      assert.throws(() => runtime.innerShadowStagedRegion(staged.sourceId, region, target, bad))
      assert.equal(calls, before); assert.equal(live.size, 1)
    }
  } finally { runtime.dispose(); mocked.mock.restore() }
  assert.equal(live.size, 0)
})

test('ABI interna rejeita pacote externo, choke, pontos, overlap e geometria sem escrever parcialmente', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory; axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_inner_shadow_region(...args: number[]): number;
    axia_poc_drop_shadow_region(...args: number[]): number }
  const packet = encodeInnerShadow(prepareRustInnerShadow(innerShadowEffect({ contour: custom }), innerShadowLight, 1))
  const lengths = [4, 4, packet.length, 4], pointers = lengths.map(length => exports.axia_poc_alloc(length))
  const [source, target, commands, output] = pointers as [number, number, number, number]
  try {
    new Uint8Array(exports.memory.buffer, source, 4).set([10, 20, 30, 101])
    const args = [source, 4, 1, 1, 0, 0, 1, 1, target, 4, commands, packet.length, output, 4]
    for (const [offset, value, status] of [[0, 0x31444853, 2], [4, 2, 2], [8, 1, 2], [12, 4097, 2], [16, 8193, 2],
      [24, 6, 2], [28, 1, 2], [36, 6, 2], [44, 0xffffffff, 1]]) {
      const bad = packet.slice(); new DataView(bad.buffer).setUint32(offset!, value!, true)
      new Uint8Array(exports.memory.buffer, commands, packet.length).set(bad)
      new Uint8Array(exports.memory.buffer, output, 4).fill(99)
      assert.equal(exports.axia_poc_inner_shadow_region(...args), status)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    for (const offset of [48, 56, 64, 72, 80]) {
      const bad = packet.slice(); new DataView(bad.buffer).setFloat64(offset, NaN, true)
      new Uint8Array(exports.memory.buffer, commands, packet.length).set(bad)
      assert.equal(exports.axia_poc_inner_shadow_region(...args), 2)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    new Uint8Array(exports.memory.buffer, commands, packet.length).set(packet)
    assert.equal(exports.axia_poc_drop_shadow_region(...args), 2)
    for (const [index, value, status] of [[0, 0, 3], [1, 3, 1], [4, 1, 1], [9, 8, 1], [11, 71, 1], [13, 8, 1]]) {
      const changed = [...args]; changed[index!] = value!
      assert.equal(exports.axia_poc_inner_shadow_region(...changed), status)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    for (const pointer of [source, target, commands + 4]) {
      const changed = [...args]; changed[12] = pointer
      const before = new Uint8Array(exports.memory.buffer, pointer, 4).slice()
      assert.equal(exports.axia_poc_inner_shadow_region(...changed), 5)
      assert.deepEqual(new Uint8Array(exports.memory.buffer, pointer, 4), before)
    }
    assert.equal(exports.axia_poc_inner_shadow_region(...args), 0)
    const external = encodeDropShadow(prepareRustDropShadow(shadowEffect(), innerShadowLight, 1))
    new Uint8Array(exports.memory.buffer, commands, packet.length).set(external)
    const changed = [...args]; changed[11] = external.length
    assert.equal(exports.axia_poc_inner_shadow_region(...changed), 1)
  } finally { pointers.forEach((pointer, index) => exports.axia_poc_free(pointer, lengths[index]!)) }
})

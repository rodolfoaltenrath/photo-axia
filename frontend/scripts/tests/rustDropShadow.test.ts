import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeDropShadow, prepareRustDropShadow } from '../../src/editor/rustPixelPocDropShadow.ts'
import { shadowEffect, shadowLight, shadowReference, paddedShadowSource } from './support/rustDropShadowFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { applyLayerStyleBlendIfUnderlying, composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import type { LayerBlendMode, LayerStyleContour } from '../../src/types/editor.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const custom: LayerStyleContour = { preset: 'custom', points: [{ x: 0.25, y: 0.75 }, { x: 0.25, y: 0 }, { x: 0.75, y: 1 }] }

test('Sombra Rust reproduz golden direcional com halo sem regenerar expectativa', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((item: { id: string }) => item.id === 'directional-shadow-with-halo')
  const effect = normalizeLayerStyleConfig(fixture.styles).effects[0]!
  assert.ok(effect.type === 'drop-shadow')
  const padded = paddedShadowSource(new Uint8Array(fixture.source.rgba),
    fixture.source.width, fixture.source.height, [effect], fixture.globalLight, fixture.resolutionScale)
  assert.equal(padded.width, fixture.expected.width); assert.equal(padded.height, fixture.expected.height)
  assert.equal(padded.offsetX, fixture.expected.offsetX); assert.equal(padded.offsetY, fixture.expected.offsetY)
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(padded.rgba, padded.width, padded.height, 1)
    const result = runtime.dropShadowStagedRegion(staged.sourceId, { x: 0, y: 0, width: padded.width, height: padded.height },
      new Uint8Array(padded.rgba.length), prepareRustDropShadow(effect, fixture.globalLight, fixture.resolutionScale))
    assert.deepEqual([...result.rgba], fixture.expected.rgba)
  } finally { runtime.dispose() }
})

for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as LayerBlendMode[]) {
  test(`Sombra ${blendMode}: alfas, seis contornos e ruído assinado concordam byte a byte`, async () => {
    const width = 256, height = 256, source = new Uint8Array(width * height * 4), target = new Uint8Array(source.length)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      source.set([x, y, x ^ y, y], index); target.set([x, 255 - y, x ^ y, x], index)
    }
    const runtime = await createRustPixelPocRuntime(wasm), region = { x: 0, y: 0, width, height }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      for (const preset of ['linear', 'cone', 'inverted-cone', 'gaussian', 'ring', 'custom'] as const) {
        for (const noise of [0, 37.5, 100]) {
          const effect = shadowEffect({ blendMode, size: 0, distance: 0, color: '#33669980', noise,
            layerKnocksOutShadow: false, contour: preset === 'custom' ? custom : { preset, points: [] } })
          assert.deepEqual(runtime.dropShadowStagedRegion(staged.sourceId, region, target, prepareRustDropShadow(effect, shadowLight, 1)).rgba,
            shadowReference(source, width, height, target, effect), `${preset}/${noise}`)
        }
      }
    } finally { runtime.dispose() }
  })
}

test('Sombra por tiles mantém offset, halo, knockout, seed e índice global em geometrias ímpares', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const [width, height] of [[37, 29], [1, 17], [19, 1], [1, 1]] as const) {
      const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
      const target = Uint8Array.from(source, (value, index) => index % 4 === 3 ? 101 : 255 - value)
      const staged = runtime.stageSource(source, width, height, ++generation)
      for (const size of [0, 2, 7]) for (const spread of [0, 37.5, 100]) for (const angle of [-180, -77.75, 0, 33.333]) for (const knockout of [false, true]) {
        const effect = shadowEffect({ size, spread, angle, layerKnocksOutShadow: knockout, contour: custom })
        const shadow = prepareRustDropShadow(effect, shadowLight, 1), expected = shadowReference(source, width, height, target, effect)
        assert.deepEqual(runtime.dropShadowStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, shadow).rgba, expected)
        for (let y = 0; y < height; y += 5) for (let x = 0; x < width; x += 7) {
          const region = { x, y, width: Math.min(7, width - x), height: Math.min(5, height - y) }
          assert.deepEqual(runtime.dropShadowStagedRegion(staged.sourceId, region, gradientTile(target, width, region), shadow).rgba,
            gradientTile(expected, width, region), `${width}x${height} ${size}/${spread}/${angle}/${knockout} ${x},${y}`)
        }
      }
    }
  } finally { runtime.dispose() }
})

test('Sombra preserva alfa de cor zero/pleno e ruído acima de 255 antes da mesclagem', async () => {
  const source = new Uint8Array(256 * 4), target = new Uint8Array(source.length), runtime = await createRustPixelPocRuntime(wasm)
  for (let alpha = 0; alpha < 256; alpha++) {
    source.set([77, 88, 99, alpha], alpha * 4); target.set([200, 120, 40, alpha], alpha * 4)
  }
  try {
    const staged = runtime.stageSource(source, 256, 1, 1), region = { x: 0, y: 0, width: 256, height: 1 }
    for (const color of ['#33669900', '#336699ff', '#ffffff']) for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as LayerBlendMode[]) {
      const effect = shadowEffect({ id: 'saturated-noise', color, blendMode, distance: 0, size: 0, opacity: 100, noise: 100, layerKnocksOutShadow: false })
      assert.deepEqual(runtime.dropShadowStagedRegion(staged.sourceId, region, target, prepareRustDropShadow(effect, shadowLight, 1)).rgba,
        shadowReference(source, 256, 1, target, effect), `${color}/${blendMode}`)
    }
    assert.deepEqual(target.slice(0, 4), runtime.dropShadowStagedRegion(staged.sourceId, { x: 0, y: 0, width: 1, height: 1 }, target.slice(0, 4),
      prepareRustDropShadow(shadowEffect({ size: 0, distance: 0 }), shadowLight, 1)).rgba)
  } finally { runtime.dispose() }
})

test('Sombra resolve luz global e escala fracionária/limite sem depender do tamanho do tile', async () => {
  const source = Uint8Array.from({ length: 11 * 13 * 4 }, (_, index) => index * 29 % 256)
  const target = Uint8Array.from(source, (_, index) => index * 19 % 256), runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, 11, 13, 1)
    for (const scale of [0.125, 1.375, 8]) for (const angle of [-180, -90, 33.333, 90]) for (const useGlobalLight of [false, true]) {
      const light = { angle, altitude: 30 }, effect = shadowEffect({ size: 5.25, distance: 7.5, useGlobalLight })
      const shadow = prepareRustDropShadow(effect, light, scale), expected = shadowReference(source, 11, 13, target, effect, light, scale)
      for (const region of [{ x: 0, y: 0, width: 11, height: 13 }, { x: 2, y: 3, width: 7, height: 5 }]) {
        assert.deepEqual(runtime.dropShadowStagedRegion(staged.sourceId, region, gradientTile(target, 11, region), shadow).rgba,
          gradientTile(expected, 11, region), `${scale}/${angle}/${useGlobalLight}`)
      }
    }
    const maximum = shadowEffect({ size: 250, distance: 1000, useGlobalLight: false, angle: 0 })
    assert.deepEqual(runtime.dropShadowStagedRegion(staged.sourceId, { x: 0, y: 0, width: 11, height: 13 }, target,
      prepareRustDropShadow(maximum, shadowLight, 8)).rgba, shadowReference(source, 11, 13, target, maximum, shadowLight, 8))
  } finally { runtime.dispose() }
})

test('Contornos ring/custom com knockout e pontos estreitos mantêm precisão e cauda legada', async () => {
  const source = Uint8Array.from({ length: 23 * 19 * 4 }, (_, index) => index * 29 % 256)
  const target = Uint8Array.from(source, (_, index) => index * 19 % 256), runtime = await createRustPixelPocRuntime(wasm)
  const points = Array.from({ length: 32 }, (_, index) => ({ x: 0.5 + index * 1e-14, y: index % 2 }))
  try {
    const staged = runtime.stageSource(source, 23, 19, 1), region = { x: 0, y: 0, width: 23, height: 19 }
    for (const contour of [{ preset: 'ring' as const, points: [] }, { preset: 'custom' as const, points }, custom]) {
      for (const size of [0, 1, 4, 16]) for (const layerKnocksOutShadow of [false, true]) {
        const effect = shadowEffect({ contour, size, layerKnocksOutShadow, color: '#ffffff', opacity: 100, noise: 100 })
        assert.deepEqual(runtime.dropShadowStagedRegion(staged.sourceId, region, target, prepareRustDropShadow(effect, shadowLight, 1)).rgba,
          shadowReference(source, 23, 19, target, effect))
      }
    }
  } finally { runtime.dispose() }
})

test('Duas sombras → overlay com fill zero → dois Mesclar se conserva ordem e máscara original', async () => {
  const source = Uint8Array.from({ length: 17 * 9 * 4 }, (_, index) => index * 29 % 256)
  const shadows = [shadowEffect(), shadowEffect({ id: 'second', useGlobalLight: true, blendMode: 'screen', contour: custom })]
  const padded = paddedShadowSource(source, 17, 9, shadows), runtime = await createRustPixelPocRuntime(wasm)
  const region = { x: 0, y: 0, width: padded.width, height: padded.height }, before = padded.rgba.slice()
  try {
    const staged = runtime.stageSource(padded.rgba, padded.width, padded.height, 1)
    let target: Uint8Array = new Uint8Array(padded.rgba.length), expected: Uint8Array = target.slice()
    for (const effect of shadows) {
      target = runtime.dropShadowStagedRegion(staged.sourceId, region, target, prepareRustDropShadow(effect, shadowLight, 1)).rgba
      expected = shadowReference(padded.rgba, padded.width, padded.height, expected, effect)
      assert.deepEqual(target, expected)
    }
    const styles = normalizeLayerStyleConfig({ fillOpacity: 0, effects: shadows })
    assert.deepEqual(target, new Uint8Array(composeLayerStyleRaster({ width: 17, height: 9, data: new Uint8ClampedArray(source) }, styles, shadowLight).data))
    const colored = runtime.colorOverlayStagedRegion(staged.sourceId, region, target,
      { color: [200, 120, 40, 255], opacity: 37.5, blendMode: 'normal' }).rgba
    assert.deepEqual(padded.rgba, before)
    const config = { channel: 'red' as const, shadows: [50, 100] as [number, number], highlights: [200, 250] as [number, number] }
    const fullStyles = normalizeLayerStyleConfig({ fillOpacity: 0,
      effects: [...shadows, { type: 'color-overlay', id: 'color', color: '#c87828', opacity: 37.5, blendMode: 'normal' }],
      blendIf: { channel: config.channel, thisLayer: config, underlyingLayer: config } })
    const reference = composeLayerStyleRaster({ width: 17, height: 9, data: new Uint8ClampedArray(source) }, fullStyles, shadowLight).data
    const backdrop = Uint8Array.from(colored, (_, index) => index * 31 % 256)
    applyLayerStyleBlendIfUnderlying(reference, new Uint8ClampedArray(backdrop), fullStyles)
    const styled = runtime.stageSource(colored, padded.width, padded.height, 2)
    const filtered = runtime.blendIfThisLayerStagedRegion(styled.sourceId, region, config).rgba
    const final = runtime.stageSource(filtered, padded.width, padded.height, 3)
    assert.deepEqual(runtime.blendIfStagedRegion(final.sourceId, region, backdrop, config).rgba, new Uint8Array(reference))
  } finally { runtime.dispose() }
})

test('Adapter sombra rejeita pacote/target inválidos e recupera fonte após falha', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), source = new Uint8Array([10, 20, 30, 101])
  const region = { x: 0, y: 0, width: 1, height: 1 }, shadow = prepareRustDropShadow(shadowEffect(), shadowLight, 1)
  try {
    const staged = runtime.stageSource(source, 1, 1, 1)
    for (const bad of [{ ...shadow, opacity: NaN }, { ...shadow, offsetX: 8193 }, { ...shadow, contour: { preset: 'custom', points: new Array(2) } }]) {
      assert.throws(() => runtime.dropShadowStagedRegion(staged.sourceId, region, new Uint8Array(4), bad as typeof shadow),
        (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input')
    }
    assert.throws(() => runtime.dropShadowStagedRegion(staged.sourceId, region, new Uint8Array(8), shadow))
    assert.equal(runtime.dropShadowStagedRegion(staged.sourceId, region, new Uint8Array(4), shadow).generation, 1)
    runtime.invalidateSource(2)
    assert.throws(() => runtime.dropShadowStagedRegion(staged.sourceId, region, new Uint8Array(4), shadow))
  } finally { runtime.dispose() }
})

test('Falhas nas três alocações e no kernel da sombra liberam temporários e permitem recuperação', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  const raw = real.instance.exports as unknown as { axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_drop_shadow_region(...args: number[]): number }
  const live = new Map<number, number>()
  let failAt = 0, calls = 0, failKernel = false
  const shadowKernel = (...args: number[]) => failKernel ? 6 : raw.axia_poc_drop_shadow_region(...args)
  Object.defineProperty(shadowKernel, 'length', { value: 14 })
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module, instance: { exports: {
    ...real.instance.exports, axia_poc_drop_shadow_region: shadowKernel,
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
    const source = new Uint8Array([10, 20, 30, 101]), target = new Uint8Array(4), effect = shadowEffect({ distance: 0, size: 0, layerKnocksOutShadow: false })
    const shadow = prepareRustDropShadow(effect, shadowLight, 1), staged = runtime.stageSource(source, 1, 1, 1), region = { x: 0, y: 0, width: 1, height: 1 }
    for (const allocation of [1, 2, 3]) {
      failAt = allocation; calls = 0
      assert.throws(() => runtime.dropShadowStagedRegion(staged.sourceId, region, target, shadow),
        (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-failure')
      assert.equal(live.size, 1)
    }
    failAt = 0; failKernel = true
    assert.throws(() => runtime.dropShadowStagedRegion(staged.sourceId, region, target, shadow),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
    assert.equal(live.size, 1)
    failKernel = false
    assert.deepEqual(runtime.dropShadowStagedRegion(staged.sourceId, region, target, shadow).rgba,
      shadowReference(source, 1, 1, target, effect))
  } finally { runtime.dispose(); mocked.mock.restore() }
  assert.equal(live.size, 0)
})

test('Adapter rejeita assinatura de sombra antiga antes de preparar fonte', async context => {
  const real = await WebAssembly.instantiate(wasm, {}), exports = { ...real.instance.exports, axia_poc_drop_shadow_region: () => 0 }
  const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module,
    instance: { exports } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  try { await assert.rejects(createRustPixelPocRuntime(wasm),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable') }
  finally { mocked.mock.restore() }
})

test('ABI sombra rejeita metadados, pontos e overlap antes de publicar a saída', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory; axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_drop_shadow_region(...args: number[]): number }
  const packet = encodeDropShadow(prepareRustDropShadow(shadowEffect({ contour: custom }), shadowLight, 1))
  const lengths = [4, 4, packet.length, 4], pointers = lengths.map(length => exports.axia_poc_alloc(length))
  const [source, target, commands, output] = pointers as [number, number, number, number]
  try {
    new Uint8Array(exports.memory.buffer, source, 4).set([10, 20, 30, 101])
    const args = [source, 4, 1, 1, 0, 0, 1, 1, target, 4, commands, packet.length, output, 4]
    for (const [offset, value, status] of [[0, 0, 2], [4, 2, 2], [8, 4097, 2], [16, 8193, 2], [24, 6, 2], [28, 2, 2],
      [36, 6, 2], [44, 0xffffffff, 1]]) {
      const bad = packet.slice(); new DataView(bad.buffer).setUint32(offset!, value!, true)
      new Uint8Array(exports.memory.buffer, commands, packet.length).set(bad)
      new Uint8Array(exports.memory.buffer, output, 4).fill(99)
      assert.equal(exports.axia_poc_drop_shadow_region(...args), status)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    for (const offset of [48, 56, 64, 72]) {
      const bad = packet.slice(); new DataView(bad.buffer).setFloat64(offset, NaN, true)
      new Uint8Array(exports.memory.buffer, commands, packet.length).set(bad)
      assert.equal(exports.axia_poc_drop_shadow_region(...args), 2)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    new Uint8Array(exports.memory.buffer, commands, packet.length).set(packet)
    for (const [index, value, status] of [[0, 0, 3], [1, 3, 1], [4, 1, 1], [9, 8, 1], [11, 63, 1], [13, 8, 1]]) {
      const changed = [...args]; changed[index!] = value!
      assert.equal(exports.axia_poc_drop_shadow_region(...changed), status)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    for (const pointer of [source, target, commands + 4]) {
      const changed = [...args]; changed[12] = pointer
      const before = new Uint8Array(exports.memory.buffer, pointer, 4).slice()
      assert.equal(exports.axia_poc_drop_shadow_region(...changed), 5)
      assert.deepEqual(new Uint8Array(exports.memory.buffer, pointer, 4), before)
    }
    assert.equal(exports.axia_poc_drop_shadow_region(...args), 0)
  } finally { pointers.forEach((pointer, index) => exports.axia_poc_free(pointer, lengths[index]!)) }
})

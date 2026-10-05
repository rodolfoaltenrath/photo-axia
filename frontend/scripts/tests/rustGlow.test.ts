import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeGlow, prepareRustGlow } from '../../src/editor/rustPixelPocGlow.ts'
import { glowEffect, glowGradient, glowReference, paddedGlowSource } from './support/rustGlowFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import type { LayerBlendMode, LayerStyleContour } from '../../src/types/editor.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const kinds = ['outer', 'inner-edge', 'inner-center'] as const
const custom: LayerStyleContour = { preset: 'custom', points: [{ x: 0.25, y: 0.75 }, { x: 0.25, y: 0 }, { x: 0.75, y: 1 }] }
function raster(width: number, height: number) {
  return Uint8Array.from({ length: width * height * 4 }, (_, index) => index % 4 === 3 ? (index >>> 2) % 256 : index * 29 % 256)
}

test('Brilhos Rust reproduzem os dois goldens existentes, inclusive halo com Fill zero', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const id of ['outer-glow-halo', 'inner-glow-edge']) {
      const fixture = corpus.rasterCases.find((item: { id: string }) => item.id === id)
      const config = normalizeLayerStyleConfig(fixture.styles), effect = config.effects[0]!
      assert.ok(effect.type === 'outer-glow' || effect.type === 'inner-glow')
      assert.equal(config.fillOpacity, 0)
      const padded = paddedGlowSource(new Uint8Array(fixture.source.rgba), fixture.source.width, fixture.source.height, [effect], fixture.resolutionScale)
      assert.equal(padded.width, fixture.expected.width); assert.equal(padded.height, fixture.expected.height)
      assert.equal(padded.offsetX, fixture.expected.offsetX); assert.equal(padded.offsetY, fixture.expected.offsetY)
      const staged = runtime.stageSource(padded.rgba, padded.width, padded.height, ++generation)
      assert.deepEqual([...runtime.glowStagedRegion(staged.sourceId, { x: 0, y: 0, width: padded.width, height: padded.height },
        new Uint8Array(padded.rgba.length), prepareRustGlow(effect, fixture.resolutionScale)).rgba], fixture.expected.rgba)
    }
  } finally { runtime.dispose() }
})

for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as LayerBlendMode[]) {
  test(`Brilho ${blendMode}: tipos, paint, técnicas, contornos e ruído/jitter concordam byte a byte`, async () => {
    const width = 64, height = 64, source = raster(width, height), target = Uint8Array.from(source, (v, i) => i % 4 === 3 ? (i >>> 2) * 17 % 256 : 255 - v)
    const runtime = await createRustPixelPocRuntime(wasm), region = { x: 0, y: 0, width, height }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      for (const kind of kinds) for (const technique of ['softer', 'precise']) for (const preset of ['linear', 'cone', 'inverted-cone', 'gaussian', 'ring', 'custom'] as const) {
        for (const paint of [{ type: 'color', color: '#33669980' }, glowGradient]) for (const value of [0, 37.5, 100]) {
          const effect = glowEffect(kind, { blendMode, technique, paint, noise: value, jitter: value,
            contour: preset === 'custom' ? custom : { preset, points: [] } })
          assert.deepEqual(runtime.glowStagedRegion(staged.sourceId, region, target, prepareRustGlow(effect, 1)).rgba,
            glowReference(source, width, height, target, effect), `${kind}/${technique}/${preset}/${paint.type}/${value}`)
        }
      }
    } finally { runtime.dispose() }
  })
}

test('Brilhos mantêm todos os pares alfa de máscara/target e cores zero/plenas', async () => {
  const width = 256, height = 256, source = new Uint8Array(width * height * 4), target = new Uint8Array(source.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4
    source.set([77, 88, 99, y], index); target.set([x, 255 - y, x ^ y, x], index)
  }
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const kind of kinds) for (const color of ['#33669900', '#336699ff', '#ffffff']) {
      const effect = glowEffect(kind, { paint: { type: 'color', color }, size: 2, opacity: 100, noise: 100, jitter: 0 })
      assert.deepEqual(runtime.glowStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, prepareRustGlow(effect, 1)).rgba,
        glowReference(source, width, height, target, effect), `${kind}/${color}`)
    }
  } finally { runtime.dispose() }
})

test('Brilhos por tiles preservam halo, spread/choke, técnicas e índice global em quatro geometrias', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const [width, height] of [[37, 29], [1, 17], [19, 1], [1, 1]] as const) {
      const source = raster(width, height), target = Uint8Array.from(source, (v, i) => i % 4 === 3 ? (i >>> 2) * 17 % 256 : 255 - v)
      const staged = runtime.stageSource(source, width, height, ++generation)
      for (const kind of kinds) for (const technique of ['softer', 'precise']) for (const size of [0, 2, 7]) for (const strength of [0, 37.5, 100]) {
        const effect = glowEffect(kind, { technique, size, spread: strength, choke: strength, paint: glowGradient, contour: custom })
        const glow = prepareRustGlow(effect, 1), expected = glowReference(source, width, height, target, effect)
        assert.deepEqual(runtime.glowStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, glow).rgba, expected)
        for (let y = 0; y < height; y += 5) for (let x = 0; x < width; x += 7) {
          const region = { x, y, width: Math.min(7, width - x), height: Math.min(5, height - y) }
          assert.deepEqual(runtime.glowStagedRegion(staged.sourceId, region, gradientTile(target, width, region), glow).rgba,
            gradientTile(expected, width, region), `${kind}/${technique}/${size}/${strength} ${width}x${height} ${x},${y}`)
        }
      }
    }
  } finally { runtime.dispose() }
})

test('Brilho trata raio arredondado zero, raw zero, transparência e escalas/raios máximos', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), width = 11, height = 13, source = raster(width, height), target = Uint8Array.from(source, v => 255 - v)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    const positive: LayerStyleContour = { preset: 'custom', points: [{ x: 0, y: 1 }, { x: 1, y: 1 }] }
    for (const kind of kinds) for (const scale of [0.125, 1.375, 8]) for (const size of [0, 0.125, 5.25, 250]) {
      const effect = glowEffect(kind, { size, contour: positive, paint: glowGradient, range: 1, choke: 100, spread: 100 })
      assert.deepEqual(runtime.glowStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, prepareRustGlow(effect, scale)).rgba,
        glowReference(source, width, height, target, effect, scale), `${kind}/${scale}/${size}`)
      if (Math.round(size * scale) === 0) assert.deepEqual(runtime.glowStagedRegion(staged.sourceId,
        { x: 0, y: 0, width, height }, target, prepareRustGlow(effect, scale)).rgba, target)
    }
    const transparent = source.slice()
    for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0
    const updated = runtime.stageSource(transparent, width, height, 2)
    for (const kind of kinds) assert.deepEqual(runtime.glowStagedRegion(updated.sourceId, { x: 0, y: 0, width, height }, target,
      prepareRustGlow(glowEffect(kind, { contour: positive }), 1)).rgba, target)
  } finally { runtime.dispose() }
})

test('Brilho gradiente preserva reverse, cauda legada e 32 paradas estreitas por payload', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), width = 37, height = 29, source = raster(width, height), target = Uint8Array.from(source, v => 255 - v)
  const contour: LayerStyleContour = { preset: 'custom', points: Array.from({ length: 32 }, (_, i) => ({ x: 0.5 + i * 1e-14, y: i % 2 })) }
  const paint = structuredClone(glowGradient)
  paint.gradient.colorStops = Array.from({ length: 32 }, (_, i) => ({ position: 0.5 + i * 1e-14, color: i % 2 ? '#ffffff00' : '#336699ff' }))
  paint.gradient.opacityStops = Array.from({ length: 32 }, (_, i) => ({ position: 0.5 + i * 1e-14, opacity: i % 2 ? 100 : 0 }))
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const kind of kinds) for (const reverse of [false, true]) for (const range of [1, 17.5, 100]) {
      const effect = glowEffect(kind, { contour, paint: { ...paint, reverse }, range, noise: 100, jitter: 100 })
      const glow = prepareRustGlow(effect, 1)
      assert.equal(encodeGlow(glow).length, 1632)
      assert.deepEqual(runtime.glowStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, glow).rgba,
        glowReference(source, width, height, target, effect))
    }
  } finally { runtime.dispose() }
})

test('Cadeia de brilhos externos/internos e overlay respeita estágios e máscara original com Fill zero', async () => {
  const width = 17, height = 9, source = raster(width, height), outer = glowEffect('outer', { id: 'outer', paint: glowGradient })
  const inner = glowEffect('inner-center', { id: 'center', technique: 'precise' }), second = glowEffect('inner-edge', { id: 'edge', size: 2, jitter: 100 })
  const padded = paddedGlowSource(source, width, height, [outer, inner, second])
  const runtime = await createRustPixelPocRuntime(wasm), region = { x: 0, y: 0, width: padded.width, height: padded.height }
  try {
    const staged = runtime.stageSource(padded.rgba, padded.width, padded.height, 1)
    let target: Uint8Array = new Uint8Array(padded.rgba.length), expected = target.slice()
    for (const effect of [outer, inner, second]) {
      target = runtime.glowStagedRegion(staged.sourceId, region, target, prepareRustGlow(effect, 1)).rgba
      expected = glowReference(padded.rgba, padded.width, padded.height, expected, effect)
      assert.deepEqual(target, expected)
    }
    const overlay = { type: 'color-overlay', id: 'overlay', color: '#ee772280', opacity: 37.5, blendMode: 'screen' }
    const result = runtime.colorOverlayStagedRegion(staged.sourceId, region, target,
      { color: [238, 119, 34, 128], opacity: 37.5, blendMode: 'screen' })
    const reference = composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) },
      normalizeLayerStyleConfig({ fillOpacity: 0, effects: [inner, overlay, outer, second] }), { angle: 0, altitude: 30 })
    assert.equal(reference.width, padded.width); assert.equal(reference.height, padded.height)
    assert.deepEqual(result.rgba, new Uint8Array(reference.data))
    const displayedSource = padded.rgba.slice()
    for (let i = 0; i < displayedSource.length; i += 4) if (displayedSource[i + 3] === 0) displayedSource.fill(0, i, i + 4)
    assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, region, 100).rgba, displayedSource)
    const mask = runtime.alphaMaskStagedRegion(staged.sourceId, region, { spreadRadius: 0, blurRadius: 0, precise: false }).rgba
    for (let i = 3; i < mask.length; i += 4) assert.equal(mask[i], padded.rgba[i])
  } finally { runtime.dispose() }
})

test('Adapter brilho rejeita assinatura ausente/antiga antes de preparar fonte', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  for (const old of [undefined, () => 0]) {
    const mocked = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module,
      instance: { exports: { ...real.instance.exports, axia_poc_glow_region: old } } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
    try { await assert.rejects(createRustPixelPocRuntime(wasm),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable') }
    finally { mocked.mock.restore() }
  }
})

test('ABI brilho rejeita counts/paint/pontos/NaN/reservas/overlap sem publicar pixels parciais', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory; axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_glow_region(...args: number[]): number }
  const packet = encodeGlow(prepareRustGlow(glowEffect('outer', { paint: glowGradient, contour: custom }), 1))
  const lengths = [4, 4, packet.length, 4], pointers = lengths.map(len => exports.axia_poc_alloc(len))
  const [source, target, commands, output] = pointers as [number, number, number, number]
  try {
    new Uint8Array(exports.memory.buffer, source, 4).set([10, 20, 30, 101])
    const args = [source, 4, 1, 1, 0, 0, 1, 1, target, 4, commands, packet.length, output, 4]
    for (const [offset, value, status] of [[0, 0, 2], [4, 2, 2], [8, 3, 2], [12, 4097, 2], [16, 4097, 2],
      [20, 2, 2], [24, 6, 2], [28, 3, 2], [32, 1, 2], [36, 6, 2], [44, 0xffffffff, 1], [48, 0xffffffff, 1], [52, 0xffffffff, 1],
      [156, 1, 2]]) {
      const bad = packet.slice(); new DataView(bad.buffer).setUint32(offset!, value!, true)
      new Uint8Array(exports.memory.buffer, commands, packet.length).set(bad)
      new Uint8Array(exports.memory.buffer, output, 4).fill(99)
      assert.equal(exports.axia_poc_glow_region(...args), status, `offset ${offset}`)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    for (const [offset, value] of [[56, NaN], [64, Infinity], [72, 0], [80, 101], [88, 1], [96, NaN], [104, NaN],
      [144, NaN], [192, NaN], [200, 101]]) {
      const bad = packet.slice(); new DataView(bad.buffer).setFloat64(offset!, value!, true)
      new Uint8Array(exports.memory.buffer, commands, packet.length).set(bad)
      assert.equal(exports.axia_poc_glow_region(...args), 2, `f64 ${offset}`)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    new Uint8Array(exports.memory.buffer, commands, packet.length).set(packet)
    for (const [index, value, status] of [[0, 0, 3], [1, 3, 1], [4, 1, 1], [9, 8, 1], [11, 95, 1], [13, 8, 1]]) {
      const changed = [...args]; changed[index!] = value!
      assert.equal(exports.axia_poc_glow_region(...changed), status)
      assert.deepEqual([...new Uint8Array(exports.memory.buffer, output, 4)], [99, 99, 99, 99])
    }
    for (const pointer of [source, target, commands + 4]) {
      const changed = [...args]; changed[12] = pointer
      const before = new Uint8Array(exports.memory.buffer, pointer, 4).slice()
      assert.equal(exports.axia_poc_glow_region(...changed), 5)
      assert.deepEqual(new Uint8Array(exports.memory.buffer, pointer, 4), before)
    }
    assert.equal(exports.axia_poc_glow_region(...args), 0)
  } finally { pointers.forEach((ptr, i) => exports.axia_poc_free(ptr, lengths[i]!)) }
})

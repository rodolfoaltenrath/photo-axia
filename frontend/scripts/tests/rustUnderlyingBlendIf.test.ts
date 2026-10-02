import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError,
  type RustPixelPocUnderlyingBlendIf, type RustPixelPocRegion } from '../../src/editor/rustPixelPocRuntime.ts'
import { applyLayerStyleBlendIfUnderlying, composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const channels = ['gray', 'red', 'green', 'blue'] as const
const defaultRange = { shadows: [0, 0], highlights: [255, 255] } as const

function styles(config: RustPixelPocUnderlyingBlendIf) {
  return normalizeLayerStyleConfig({ enabled: true, effects: [], blendIf: {
    channel: config.channel, underlyingLayer: config
  } })
}

function tile(source: Uint8Array, width: number, region: RustPixelPocRegion) {
  const result = new Uint8Array(region.width * region.height * 4)
  for (let row = 0; row < region.height; row++) {
    const index = ((region.y + row) * width + region.x) * 4
    result.set(source.subarray(index, index + region.width * 4), row * region.width * 4)
  }
  return result
}

test('Blend If Rust/WASM reproduz os goldens existentes e preserva RGB oculto', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  try {
    for (const [index, fixture] of corpus.underlyingCases.entries()) {
      const normalized = normalizeLayerStyleConfig(fixture.styles).blendIf
      const source = runtime.stageSource(new Uint8Array(fixture.rgba), fixture.rgba.length / 4, 1, index + 1)
      const { rgba } = runtime.blendIfStagedRegion(source.sourceId,
        { x: 0, y: 0, width: fixture.rgba.length / 4, height: 1 },
        new Uint8Array(fixture.backdrop), { channel: normalized.channel, ...normalized.underlyingLayer })
      assert.deepEqual([...rgba], fixture.expected.rgba, fixture.id)
    }
  } finally { runtime.dispose() }
})

for (const channel of channels) {
  test(`Blend If ${channel}: todos os alfas e valores do backdrop concordam com TS`, async () => {
    const runtime = await createRustPixelPocRuntime(wasm)
    const width = 256
    const height = 256
    const source = new Uint8Array(width * height * 4)
    const backdrop = new Uint8Array(source.length)
    for (let alpha = 0; alpha <= 255; alpha++) {
      for (let value = 0; value <= 255; value++) {
        const index = (alpha * width + value) * 4
        source.set([value, alpha, (value * 17 + alpha) % 256, alpha], index)
        const color = [value, (value * 31 + alpha) % 256, (value * 47 + 13) % 256]
        if (channel !== 'gray') color[channels.indexOf(channel) - 1] = value
        backdrop.set([...color, (alpha + value) % 256], index)
      }
    }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      const ranges = [[0, 0, 255, 255], [50, 100, 200, 250], [127, 127, 128, 128],
        [0, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 0], [255, 255, 255, 255], [64, 128, 128, 192]]
      for (const [s0, s1, h0, h1] of ranges) {
        const config: RustPixelPocUnderlyingBlendIf = {
          channel, shadows: [s0!, s1!], highlights: [h0!, h1!]
        }
        const expected = new Uint8ClampedArray(source)
        applyLayerStyleBlendIfUnderlying(expected, new Uint8ClampedArray(backdrop), styles(config))
        const result = runtime.blendIfStagedRegion(staged.sourceId,
          { x: 0, y: 0, width, height }, backdrop, config)
        assert.deepEqual(result.rgba, new Uint8Array(expected), `${channel}: ${[s0, s1, h0, h1]}`)
        assert.equal(result.generation, staged.generation)
      }
      const original = runtime.blendIfStagedRegion(staged.sourceId,
        { x: 0, y: 0, width, height }, backdrop,
        { channel, shadows: [...defaultRange.shadows], highlights: [...defaultRange.highlights] })
      assert.deepEqual(original.rgba, source, 'os passes não modificam a fonte preparada')
    } finally { runtime.dispose() }
  })
}

test('Blend If por tiles de borda equivale ao passe TS inteiro, em todos os canais', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const width = 7
  const height = 5
  const source = new Uint8Array(width * height * 4)
  const backdrop = new Uint8Array(source.length)
  for (let index = 0; index < source.length; index++) {
    source[index] = index * 19 % 256
    backdrop[index] = (index * 47 + 50) % 256
  }
  const backdropBefore = backdrop.slice()
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const channel of channels) {
      const config: RustPixelPocUnderlyingBlendIf = { channel, shadows: [30, 100], highlights: [160, 230] }
      const expected = new Uint8ClampedArray(source)
      applyLayerStyleBlendIfUnderlying(expected, new Uint8ClampedArray(backdrop), styles(config))
      const assembled = new Uint8Array(source.length)
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 3) {
          const region = { x, y, width: Math.min(3, width - x), height: Math.min(2, height - y) }
          const result = runtime.blendIfStagedRegion(staged.sourceId, region, tile(backdrop, width, region), config)
          for (let row = 0; row < region.height; row++) {
            assembled.set(result.rgba.subarray(row * region.width * 4, (row + 1) * region.width * 4),
              ((y + row) * width + x) * 4)
          }
        }
      }
      assert.deepEqual(assembled, new Uint8Array(expected), channel)
    }
    assert.deepEqual(backdrop, backdropBefore, 'backdrop permanece somente leitura')
  } finally { runtime.dispose() }
})

test('opacidade de preenchimento seguida de Blend If mantém os dois arredondamentos', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8ClampedArray([10, 20, 30, 101, 90, 80, 70, 255])
  const fillStyles = normalizeLayerStyleConfig({ enabled: true, effects: [], fillOpacity: 50 })
  const config: RustPixelPocUnderlyingBlendIf = { channel: 'red', shadows: [50, 100], highlights: [255, 255] }
  const backdrop = new Uint8Array([75, 0, 0, 255, 75, 0, 0, 0])
  try {
    const expected = composeLayerStyleRaster({ width: 2, height: 1, data: source }, fillStyles,
      { angle: 0, altitude: 30 }).data
    applyLayerStyleBlendIfUnderlying(expected, new Uint8ClampedArray(backdrop), styles(config))
    const filled = runtime.render(new Uint8Array(source), 50).rgba
    const staged = runtime.stageSource(filled, 2, 1, 1)
    const result = runtime.blendIfStagedRegion(staged.sourceId,
      { x: 0, y: 0, width: 2, height: 1 }, backdrop, config)
    assert.deepEqual(result.rgba, new Uint8Array(expected))
    assert.deepEqual([...result.rgba], [10, 20, 30, 26, 90, 80, 70, 64])
  } finally { runtime.dispose() }
})

test('adapter rejeita limites inválidos e continua reutilizando a fonte após erro', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const staged = runtime.stageSource(new Uint8Array([7, 8, 9, 255]), 1, 1, 1)
  const config: RustPixelPocUnderlyingBlendIf = { channel: 'red', shadows: [50, 100], highlights: [255, 255] }
  const region = { x: 0, y: 0, width: 1, height: 1 }
  const backdrop = new Uint8Array([75, 0, 0, 255])
  try {
    const invalid = (operation: () => unknown) => assert.throws(operation,
      (error) => error instanceof RustPixelPocError && error.code === 'invalid-input')
    invalid(() => runtime.blendIfStagedRegion(staged.sourceId, region, new Uint8Array(3), config))
    invalid(() => runtime.blendIfStagedRegion(staged.sourceId, { ...region, x: 1 }, backdrop, config))
    invalid(() => runtime.blendIfStagedRegion(staged.sourceId, region, backdrop,
      { ...config, channel: 'invalid' } as unknown as RustPixelPocUnderlyingBlendIf))
    invalid(() => runtime.blendIfStagedRegion(staged.sourceId, region, backdrop,
      { ...config, shadows: [50] } as unknown as RustPixelPocUnderlyingBlendIf))
    for (const shadows of [[100, 50], [-1, 50], [1.5, 50], [NaN, 50], [0, 256], [254, 255]]) {
      invalid(() => runtime.blendIfStagedRegion(staged.sourceId, region, backdrop,
        { ...config, shadows: shadows as [number, number], highlights: [200, 255] }))
    }
    assert.deepEqual([...runtime.blendIfStagedRegion(staged.sourceId, region, backdrop, config).rgba],
      [7, 8, 9, 128])
    runtime.invalidateSource(2)
    invalid(() => runtime.blendIfStagedRegion(staged.sourceId, region, backdrop, config))
    runtime.dispose()
    assert.throws(() => runtime.blendIfStagedRegion(staged.sourceId, region, backdrop, config),
      (error) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
  } finally { runtime.dispose() }
})

test('ABI WASM recusa overlap, canal e comprimentos inválidos antes de escrever', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const memory = instance.exports.memory as WebAssembly.Memory
  const alloc = instance.exports.axia_poc_alloc as (length: number) => number
  const free = instance.exports.axia_poc_free as (pointer: number, length: number) => void
  const apply = instance.exports.axia_poc_blend_if_underlying_region as (...values: number[]) => number
  const source = alloc(4), backdrop = alloc(4), output = alloc(4)
  assert.ok(source > 0 && backdrop > 0 && output > 0)
  try {
    new Uint8Array(memory.buffer, source, 4).set([7, 8, 9, 255])
    new Uint8Array(memory.buffer, backdrop, 4).set([75, 0, 0, 255])
    new Uint8Array(memory.buffer, output, 4).fill(99)
    const invoke = (destination: number, channel: number, length = 4, x = 0, threshold = 100) =>
      apply(source, 4, 1, 1, x, 0, 1, 1, backdrop, length, destination, 4, channel, 50, threshold, 255, 255)
    assert.equal(invoke(source, 1), 5)
    assert.equal(invoke(backdrop, 1), 5)
    assert.equal(invoke(output, 4), 2)
    assert.equal(invoke(output, 1, 3), 1)
    assert.equal(invoke(output, 1, 4, 1), 1)
    assert.equal(invoke(output, 1, 4, 0, 256), 2)
    assert.deepEqual([...new Uint8Array(memory.buffer, output, 4)], [99, 99, 99, 99])
    assert.equal(invoke(output, 1), 0)
    assert.deepEqual([...new Uint8Array(memory.buffer, output, 4)], [7, 8, 9, 128])
  } finally { free(output, 4); free(backdrop, 4); free(source, 4) }
})

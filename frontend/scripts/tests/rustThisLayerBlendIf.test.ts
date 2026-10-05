import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError, type RustPixelPocBlendIf,
  type RustPixelPocRegion } from '../../src/editor/rustPixelPocRuntime.ts'
import { applyLayerStyleBlendIfUnderlying, composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { layerStyleBlendIfOpacity, normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const channels = ['gray', 'red', 'green', 'blue'] as const
const light = { angle: 0, altitude: 30 }
const defaultRange = { shadows: [0, 0], highlights: [255, 255] } as const
function styles(config: RustPixelPocBlendIf) {
  return normalizeLayerStyleConfig({ enabled: true, effects: [], blendIf: { channel: config.channel, thisLayer: config } })
}
function reference(source: Uint8Array, config: RustPixelPocBlendIf) {
  const result = new Uint8ClampedArray(source)
  const blendIf = styles(config).blendIf
  // Mirror the private alpha-only pass using the real TS opacity helper.
  for (let offset = 0; offset < result.length; offset += 4) {
    if (result[offset + 3] === 0) continue
    result[offset + 3] = Math.round(result[offset + 3]! * layerStyleBlendIfOpacity(blendIf,
      { red: result[offset]!, green: result[offset + 1]!, blue: result[offset + 2]! }))
  }
  return new Uint8Array(result)
}
function tile(source: Uint8Array, width: number, region: RustPixelPocRegion) {
  const result = new Uint8Array(region.width * region.height * 4)
  for (let row = 0; row < region.height; row++) {
    const offset = ((region.y + row) * width + region.x) * 4
    result.set(source.subarray(offset, offset + region.width * 4), row * region.width * 4)
  }
  return result
}

test('Mesclar se Esta camada Rust reproduz o golden fixo, sem modificar a fonte', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((entry: { id: string }) => entry.id === 'blend-if-this-layer-red-channel')
  assert.ok(fixture)
  const source = new Uint8Array(fixture.source.rgba)
  const before = source.slice()
  const blendIf = normalizeLayerStyleConfig(fixture.styles).blendIf
  try {
    const staged = runtime.stageSource(source, 3, 1, 1)
    const region = { x: 0, y: 0, width: 3, height: 1 }
    const config = { channel: blendIf.channel, ...blendIf.thisLayer }
    const result = runtime.blendIfThisLayerStagedRegion(staged.sourceId, region, config)
    assert.deepEqual([...result.rgba], fixture.expected.rgba)
    assert.equal(result.generation, staged.generation)
    assert.equal(result.timings.copyInMs, 0, 'o passe não precisa de backdrop nem de reupload')
    assert.deepEqual(source, before)
    assert.deepEqual(reference(source, config), result.rgba)
    assert.deepEqual(runtime.blendIfThisLayerStagedRegion(staged.sourceId, region,
      { channel: 'red', shadows: [0, 0], highlights: [255, 255] }).rgba, before)
  } finally { runtime.dispose() }
})

for (const channel of channels) {
  test(`Esta camada ${channel}: todos os alfas/valores e oito faixas concordam byte a byte com TS`, async () => {
    const runtime = await createRustPixelPocRuntime(wasm)
    const width = 256, height = 256
    const source = new Uint8Array(width * height * 4)
    for (let alpha = 0; alpha <= 255; alpha++) {
      for (let value = 0; value <= 255; value++) {
        const color = [value, (value * 31 + alpha) % 256, (value * 47 + 13) % 256]
        if (channel !== 'gray') color[channels.indexOf(channel) - 1] = value
        source.set([...color, alpha], (alpha * width + value) * 4)
      }
    }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      for (const [s0, s1, h0, h1] of [[0, 0, 255, 255], [50, 100, 200, 250], [127, 127, 128, 128],
        [0, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 0], [255, 255, 255, 255], [64, 128, 128, 192]]) {
        const config: RustPixelPocBlendIf = { channel, shadows: [s0!, s1!], highlights: [h0!, h1!] }
        const result = runtime.blendIfThisLayerStagedRegion(staged.sourceId,
          { x: 0, y: 0, width, height }, config)
        assert.deepEqual(result.rgba, reference(source, config), `${channel}: ${s0}/${s1}/${h0}/${h1}`)
      }
      assert.deepEqual(runtime.blendIfThisLayerStagedRegion(staged.sourceId,
        { x: 0, y: 0, width, height }, { channel, shadows: [...defaultRange.shadows],
          highlights: [...defaultRange.highlights] }).rgba, source)
    } finally { runtime.dispose() }
  })
}

test('Esta camada por tiles de borda 7×5 equivale ao passe inteiro nos quatro canais', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const width = 7, height = 5
  const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 19 % 256)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const channel of channels) {
      const config: RustPixelPocBlendIf = { channel, shadows: [30, 100], highlights: [160, 230] }
      const assembled = new Uint8Array(source.length)
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 3) {
          const region = { x, y, width: Math.min(3, width - x), height: Math.min(2, height - y) }
          const result = runtime.blendIfThisLayerStagedRegion(staged.sourceId, region, config)
          assert.deepEqual(result.rgba, reference(tile(source, width, region), config))
          for (let row = 0; row < region.height; row++) {
            assembled.set(result.rgba.subarray(row * region.width * 4, (row + 1) * region.width * 4),
              ((y + row) * width + x) * 4)
          }
        }
      }
      assert.deepEqual(assembled, reference(source, config), channel)
    }
  } finally { runtime.dispose() }
})

test('Cor → padrão → Esta camada → Camada abaixo mantém ordem e lê cores já estilizadas', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([20, 40, 60, 255, 30, 50, 70, 91, 77, 88, 99, 0])
  const backdrop = new Uint8Array([75, 125, 175, 255, 110, 170, 220, 0, 75, 125, 175, 255])
  const pattern = { width: 1, height: 1, rgba: new Uint8Array([80, 90, 100, 128]) }
  const color = { color: [230, 220, 210, 255] as [number, number, number, number], opacity: 60, blendMode: 'normal' as const }
  const patternEffect = { angle: 0, scale: 100, opacity: 75, blendMode: 'screen' as const }
  const effects = [{ type: 'color-overlay', id: 'color', color: '#e6dcd2', opacity: 60 },
    { type: 'pattern-overlay', id: 'pattern', ...patternEffect, pattern: { id: 'p', name: 'Pattern',
      width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'fixture:pattern' } }]
  const patterns = new Map([['p', { width: 1, height: 1, data: new Uint8ClampedArray(pattern.rgba) }]])
  try {
    let generation = 0
    const region = { x: 0, y: 0, width: 3, height: 1 }
    for (const channel of channels) {
      const config: RustPixelPocBlendIf = { channel, shadows: [50, 100], highlights: [200, 250] }
      const style = normalizeLayerStyleConfig({ enabled: true, fillOpacity: 0, effects,
        blendIf: { channel, thisLayer: config, underlyingLayer: config } })
      const expected = composeLayerStyleRaster({ width: 3, height: 1, data: new Uint8ClampedArray(source) }, style, light, 1, patterns).data
      assert.ok(expected[3]! > 0, 'efeitos claros devem contribuir mesmo sobre RGB original escuro')
      applyLayerStyleBlendIfUnderlying(expected, new Uint8ClampedArray(backdrop), style)
      const original = runtime.stageSource(source, 3, 1, ++generation)
      const filled = runtime.renderStagedRegion(original.sourceId, region, 0).rgba
      const colored = runtime.colorOverlayStagedRegion(original.sourceId, region, filled, color).rgba
      const patterned = runtime.patternOverlayStagedRegion(original.sourceId, region, colored, pattern, patternEffect).rgba
      const styled = runtime.stageSource(patterned, 3, 1, ++generation)
      const filtered = runtime.blendIfThisLayerStagedRegion(styled.sourceId, region, config).rgba
      const final = runtime.stageSource(filtered, 3, 1, ++generation)
      const actual = runtime.blendIfStagedRegion(final.sourceId, region, backdrop, config).rgba
      assert.deepEqual(actual, new Uint8Array(expected), channel)
    }
  } finally { runtime.dispose() }
})

test('Esta camada também filtra o halo externo já composto, não só pixels da máscara original', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }
  const effect = { type: 'drop-shadow', id: 'shadow', size: 1, distance: 1, angle: 0,
    useGlobalLight: false, color: '#ff0000', opacity: 75 }
  const baseStyles = normalizeLayerStyleConfig({ enabled: true, fillOpacity: 0, effects: [effect] })
  const base = composeLayerStyleRaster(source, baseStyles, light)
  const config: RustPixelPocBlendIf = { channel: 'red', shadows: [50, 100], highlights: [255, 255] }
  const expected = composeLayerStyleRaster(source, normalizeLayerStyleConfig({ ...baseStyles,
    blendIf: { channel: config.channel, thisLayer: config } }), light)
  assert.ok(base.offsetX < 0 && base.offsetY < 0 && base.data[3]! > 0)
  try {
    const staged = runtime.stageSource(new Uint8Array(base.data), base.width, base.height, 1)
    const actual = runtime.blendIfThisLayerStagedRegion(staged.sourceId,
      { x: 0, y: 0, width: base.width, height: base.height }, config)
    assert.deepEqual(actual.rgba, new Uint8Array(expected.data))
    assert.deepEqual(actual.rgba, new Uint8Array(base.data), 'sombra vermelha passa, embora RGB original seja preto')
  } finally { runtime.dispose() }
})

test('Os dois Mesclar se mantêm arredondamentos separados para todos os alfas', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const width = 256
  const source = new Uint8Array(width * 4), backdrop = new Uint8Array(width * 4)
  for (let alpha = 0; alpha < width; alpha++) {
    source.set([75, 20, 30, alpha], alpha * 4)
    backdrop.set([75, 0, 0, 255], alpha * 4)
  }
  const config: RustPixelPocBlendIf = { channel: 'red', shadows: [50, 100], highlights: [255, 255] }
  try {
    const region = { x: 0, y: 0, width, height: 1 }
    const staged = runtime.stageSource(source, width, 1, 1)
    const thisLayer = runtime.blendIfThisLayerStagedRegion(staged.sourceId, region, config).rgba
    const restaged = runtime.stageSource(thisLayer, width, 1, 2)
    const actual = runtime.blendIfStagedRegion(restaged.sourceId, region, backdrop, config).rgba
    const expected = new Uint8ClampedArray(reference(source, config))
    applyLayerStyleBlendIfUnderlying(expected, new Uint8ClampedArray(backdrop), normalizeLayerStyleConfig({
      enabled: true, blendIf: { channel: config.channel, underlyingLayer: config } }))
    assert.deepEqual(actual, new Uint8Array(expected))
    assert.equal(actual[7], 1)
    assert.equal(Math.round(1 * 0.5 * 0.5), 0, 'fundir multiplicações mudaria o alfa 1')
  } finally { runtime.dispose() }
})

test('Esta camada preserva RGB oculto, inclusive quando elimina a contribuição do pixel', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([77, 88, 99, 0, 20, 40, 60, 255])
  try {
    const staged = runtime.stageSource(source, 2, 1, 1)
    const actual = runtime.blendIfThisLayerStagedRegion(staged.sourceId,
      { x: 0, y: 0, width: 2, height: 1 }, { channel: 'red', shadows: [50, 100], highlights: [255, 255] }).rgba
    assert.deepEqual([...actual], [77, 88, 99, 0, 20, 40, 60, 0])
  } finally { runtime.dispose() }
})

test('Adapter Esta camada rejeita faixas/região inválidas e reusa a fonte após erro', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const staged = runtime.stageSource(new Uint8Array([75, 20, 30, 101]), 1, 1, 1)
  const region = { x: 0, y: 0, width: 1, height: 1 }
  const config: RustPixelPocBlendIf = { channel: 'red', shadows: [50, 100], highlights: [255, 255] }
  const invalid = (operation: () => unknown) => assert.throws(operation,
    error => error instanceof RustPixelPocError && error.code === 'invalid-input')
  try {
    for (const overrides of [{ channel: 'invalid' }, { shadows: [50] }, { shadows: new Array(2) },
      { shadows: [100, 50] }, { shadows: [-1, 50] }, { shadows: [1.5, 50] }, { shadows: [NaN, 50] },
      { highlights: [100, Infinity] }, { highlights: [99, 255] }, { highlights: [200, 256] }]) {
      invalid(() => runtime.blendIfThisLayerStagedRegion(staged.sourceId, region,
        { ...config, ...overrides } as unknown as RustPixelPocBlendIf))
    }
    invalid(() => runtime.blendIfThisLayerStagedRegion(staged.sourceId, { ...region, x: 1 }, config))
    invalid(() => runtime.blendIfThisLayerStagedRegion(staged.sourceId, { ...region, width: 0 }, config))
    assert.deepEqual([...runtime.blendIfThisLayerStagedRegion(staged.sourceId, region, config).rgba], [75, 20, 30, 51])
    runtime.invalidateSource(2)
    invalid(() => runtime.blendIfThisLayerStagedRegion(staged.sourceId, region, config))
    runtime.dispose()
    assert.throws(() => runtime.blendIfThisLayerStagedRegion(staged.sourceId, region, config),
      error => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
  } finally { runtime.dispose() }
})

test('ABI Esta camada rejeita overlap parcial, canal/faixas e dimensões inválidos antes de escrever', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const memory = instance.exports.memory as WebAssembly.Memory
  const alloc = instance.exports.axia_poc_alloc as (length: number) => number
  const free = instance.exports.axia_poc_free as (pointer: number, length: number) => void
  const apply = instance.exports.axia_poc_blend_if_this_layer_region as (...values: number[]) => number
  const source = alloc(8), output = alloc(4)
  assert.ok(source > 0 && output > 0)
  try {
    new Uint8Array(memory.buffer, source, 8).set([50, 20, 30, 255, 75, 20, 30, 101])
    new Uint8Array(memory.buffer, output, 4).fill(99)
    const invoke = (destination: number, channel = 1, length = 4, x = 1, shadowEnd = 100) =>
      apply(source, 8, 2, 1, x, 0, 1, 1, destination, length, channel, 50, shadowEnd, 255, 255)
    assert.equal(invoke(source), 5)
    assert.equal(invoke(source + 4), 5)
    assert.equal(invoke(0), 3)
    assert.equal(invoke(output, 4), 2)
    assert.equal(invoke(output, 1, 3), 1)
    assert.equal(invoke(output, 1, 4, 2), 1)
    assert.equal(invoke(output, 1, 4, 1, 256), 2)
    assert.equal(invoke(output, 1, 4, 1, 49), 2)
    assert.deepEqual([...new Uint8Array(memory.buffer, output, 4)], [99, 99, 99, 99])
    assert.equal(invoke(output), 0)
    assert.deepEqual([...new Uint8Array(memory.buffer, output, 4)], [75, 20, 30, 51])
  } finally { free(output, 4); free(source, 8) }
})

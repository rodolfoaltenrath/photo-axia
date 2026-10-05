import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError, type RustPixelPocGradientOverlay } from '../../src/editor/rustPixelPocRuntime.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { applyLayerStyleBlendIfUnderlying, composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import type { LayerBlendMode } from '../../src/types/editor.ts'
import { gradientEffect, gradientReference, gradientStyle, gradientTile } from './support/rustGradientFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const modes: LayerBlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']
const types: RustPixelPocGradientOverlay['gradient']['type'][] = ['linear', 'reflected', 'diamond']
const invalid = (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input'

for (const fixtureId of ['gradient-fractional-sampling', 'gradient-reflected-centered', 'gradient-diamond-corners']) {
  test(`Gradiente Rust reproduz golden ${fixtureId} sem modificar as entradas`, async () => {
    const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
    const fixture = corpus.rasterCases.find((entry: { id: string }) => entry.id === fixtureId)
    const styles = normalizeLayerStyleConfig(fixture.styles)
    const original = styles.effects[0]!
    assert.equal(original.type, 'gradient-overlay')
    assert.ok(original.gradient.type === 'linear' || original.gradient.type === 'reflected' || original.gradient.type === 'diamond')
    const effect: RustPixelPocGradientOverlay = { ...gradientEffect,
      angle: original.angle, scale: original.scale, opacity: original.opacity, reverse: original.reverse,
      gradient: { type: original.gradient.type, colorStops: [{ position: 0, color: [255, 0, 0, 255] }, { position: 1, color: [0, 0, 255, 255] }],
        opacityStops: original.gradient.opacityStops }, blendMode: original.blendMode }
    const source = new Uint8Array(fixture.source.rgba)
    const { width, height } = fixture.source
    const target = new Uint8Array(gradientReference(source, width, height, fixture.styles.fillOpacity).data)
    const before = structuredClone({ source, target, effect })
    const runtime = await createRustPixelPocRuntime(wasm)
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      const region = { x: 0, y: 0, width, height }
      const actual = runtime.gradientOverlayStagedRegion(staged.sourceId, region, target, effect)
      assert.deepEqual([...actual.rgba], fixture.expected.rgba)
      assert.equal(actual.generation, staged.generation)
      assert.deepEqual({ source, target, effect }, before)
      assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, region, fixture.styles.fillOpacity).rgba, target)
    } finally { runtime.dispose() }
  })
}

for (const type of types) {
  for (const blendMode of modes) {
    test(`Gradiente ${type}/${blendMode}: todos os alfas e quatro configurações concordam byte a byte`, async () => {
      const width = 256, height = 256
      const source = new Uint8Array(width * height * 4)
      for (let alpha = 0; alpha <= 255; alpha++) for (let value = 0; value <= 255; value++) {
        source.set([value, (value * 31 + alpha) % 256, (value * 47 + 13) % 256, alpha], (alpha * width + value) * 4)
      }
      const runtime = await createRustPixelPocRuntime(wasm)
      try {
        const staged = runtime.stageSource(source, width, height, 1)
        for (const [fillOpacity, opacity, reverse, tails] of [
          [0, 100, false, false], [37.5, 37.5, true, false],
          [100, 0.5, false, false], [100, 100, true, true]
        ] as const) {
          const effect: RustPixelPocGradientOverlay = { ...structuredClone(gradientEffect), opacity, reverse, blendMode }
          effect.gradient.type = type
          if (tails) {
            effect.scale = 33.333
            effect.angle = -77.75
            effect.gradient.colorStops = [
              { position: 0.1, color: [0, 255, 30, 0] }, { position: 0.5, color: [128, 2, 17, 127] },
              { position: 0.5, color: [255, 0, 10, 128] }, { position: 0.8, color: [255, 0, 10, 255] }
            ]
            effect.gradient.opacityStops = [{ position: 0.2, opacity: 0 }, { position: 0.8, opacity: 100 }]
          }
          const target = new Uint8Array(gradientReference(source, width, height, fillOpacity).data)
          const expected = gradientReference(source, width, height, fillOpacity, [gradientStyle(effect)])
          assert.deepEqual(runtime.gradientOverlayStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, effect).rgba,
            new Uint8Array(expected.data), `${type}/${blendMode}/${fillOpacity}/${opacity}/${tails}`)
        }
      } finally { runtime.dispose() }
    })
  }
}

test('Tiles ímpares e paradas coincidentes preservam âncora global nos três gradientes', async () => {
  const width = 7, height = 5
  const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 19 % 256)
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const type of types) for (const angle of [-180, -33.333, 0, 90, 179.999]) for (const scale of [1, 73.5, 1000]) {
      const effect = { ...structuredClone(gradientEffect), angle, scale, reverse: true }
      effect.angle = ((effect.angle + 180) % 360 + 360) % 360 - 180
      effect.gradient.type = type
      effect.gradient.colorStops.splice(1, 0, { position: 0.5, color: [0, 255, 0, 255] })
      const target = new Uint8Array(gradientReference(source, width, height, 0).data)
      const expected = new Uint8Array(gradientReference(source, width, height, 0, [gradientStyle(effect)]).data)
      const assembled = new Uint8Array(source.length)
      for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 3) {
        const region = { x, y, width: Math.min(3, width - x), height: Math.min(2, height - y) }
        const tile = runtime.gradientOverlayStagedRegion(staged.sourceId, region, gradientTile(target, width, region), effect).rgba
        assert.deepEqual(tile, gradientTile(expected, width, region), `${type}/${angle}/${scale}/${x}/${y}`)
        for (let row = 0; row < region.height; row++) assembled.set(tile.subarray(row * region.width * 4, (row + 1) * region.width * 4), ((y + row) * width + x) * 4)
      }
      assert.deepEqual(assembled, expected)
    }
  } finally { runtime.dispose() }
})

test('Gradiente conserva máscara original após efeito interno e raster expandido por sombra', async () => {
  const width = 3, height = 1
  const source = new Uint8Array([40, 60, 80, 255, 40, 60, 80, 101, 4, 5, 6, 0])
  const effects = [{ type: 'drop-shadow', id: 'shadow', size: 1, distance: 1, angle: 0, useGlobalLight: false },
    { type: 'inner-shadow', id: 'inner', size: 1, distance: 1, angle: 0, useGlobalLight: false, color: '#00ff00' }]
  const target = gradientReference(source, width, height, 0, effects)
  const mask = new Uint8Array(target.data.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mask.set(source.subarray((y * width + x) * 4, (y * width + x + 1) * 4), ((y - target.offsetY) * target.width + x - target.offsetX) * 4)
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(mask, target.width, target.height, 1)
    for (const type of types) {
      const effect = structuredClone(gradientEffect)
      effect.gradient.type = type
      const expected = gradientReference(source, width, height, 0, [...effects, gradientStyle(effect)])
      assert.equal(expected.offsetX, target.offsetX)
      assert.equal(expected.offsetY, target.offsetY)
      assert.deepEqual(runtime.gradientOverlayStagedRegion(staged.sourceId,
        { x: 0, y: 0, width: target.width, height: target.height }, new Uint8Array(target.data), effect).rgba, new Uint8Array(expected.data))
    }
  } finally { runtime.dispose() }
})

test('Adapter rejeita paradas/regiões/tipos inválidos e recupera sem trocar a fonte', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([75, 20, 30, 101])
  const region = { x: 0, y: 0, width: 1, height: 1 }
  try {
    const staged = runtime.stageSource(source, 1, 1, 1)
    const invalidEffects: unknown[] = [null, { ...gradientEffect, angle: 180 }, { ...gradientEffect, reverse: 1 },
      { ...gradientEffect, scale: 0 }, { ...gradientEffect, opacity: NaN }, { ...gradientEffect, blendMode: 'constructor' }]
    for (const type of ['radial', 'angle', 'constructor']) invalidEffects.push({ ...gradientEffect, gradient: { ...gradientEffect.gradient, type } })
    for (const colorStops of [[], new Array(2), Array.from({ length: 33 }, () => ({ position: 0, color: [0, 0, 0, 255] })),
      [{ position: -1, color: [0, 0, 0, 255] }, { position: 1, color: [0, 0, 0, 255] }],
      [{ position: 1, color: [0, 0, 0, 255] }, { position: 0, color: [0, 0, 0, 255] }],
      [{ position: NaN, color: [0, 0, 0, 255] }, { position: 1, color: [0, 0, 0, 255] }],
      [{ position: 0, color: new Array(4) }, { position: 1, color: [0, 0, 0, 255] }]]) {
      invalidEffects.push({ ...gradientEffect, gradient: { ...gradientEffect.gradient, colorStops } })
    }
    for (const opacityStops of [new Array(2), [{ position: 0, opacity: Infinity }, { position: 1, opacity: 100 }]]) {
      invalidEffects.push({ ...gradientEffect, gradient: { ...gradientEffect.gradient, opacityStops } })
    }
    for (const effect of invalidEffects) assert.throws(() => runtime.gradientOverlayStagedRegion(staged.sourceId, region, source, effect as RustPixelPocGradientOverlay), invalid)
    assert.throws(() => runtime.gradientOverlayStagedRegion(staged.sourceId, { ...region, x: 1 }, source, gradientEffect), invalid)
    assert.throws(() => runtime.gradientOverlayStagedRegion(staged.sourceId, region, new Uint8Array(0), gradientEffect), invalid)
    const valid = runtime.gradientOverlayStagedRegion(staged.sourceId, region, source, gradientEffect)
    assert.equal(valid.generation, 1)
    const thirtyTwo = structuredClone(gradientEffect)
    thirtyTwo.gradient.colorStops = Array.from({ length: 32 }, (_, index) => ({ position: index / 31, color: [index * 8, 31 - index, 100, 255] }))
    thirtyTwo.gradient.opacityStops = Array.from({ length: 32 }, (_, index) => ({ position: index / 31, opacity: index / 31 * 100 }))
    assert.deepEqual(runtime.gradientOverlayStagedRegion(staged.sourceId, region, new Uint8Array(4), thirtyTwo).rgba,
      new Uint8Array(gradientReference(source, 1, 1, 0, [gradientStyle(thirtyTwo)]).data))
    runtime.dispose()
    assert.throws(() => runtime.gradientOverlayStagedRegion(staged.sourceId, region, source, gradientEffect),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
  } finally { runtime.dispose() }
})

test('Gradiente mantém RGB oculto e paradas subnormais seguem a semântica TS', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const region = { x: 0, y: 0, width: 1, height: 1 }
    const hidden = new Uint8Array([77, 88, 99, 0])
    const transparent = runtime.stageSource(new Uint8Array([1, 2, 3, 0]), 1, 1, 1)
    assert.deepEqual(runtime.gradientOverlayStagedRegion(transparent.sourceId, region, hidden, gradientEffect).rgba, hidden)
    const source = new Uint8Array([40, 60, 80, 101])
    const staged = runtime.stageSource(source, 1, 1, 2)
    const extreme = structuredClone(gradientEffect)
    extreme.gradient.colorStops = [{ position: 0, color: [0, 0, 0, 0] }, { position: Number.MIN_VALUE, color: [255, 255, 255, 255] }]
    for (const opacity of [0, 100]) {
      const effect = { ...extreme, opacity }
      assert.deepEqual(runtime.gradientOverlayStagedRegion(staged.sourceId, region, source, effect).rgba,
        new Uint8Array(gradientReference(source, 1, 1, 100, [gradientStyle(effect)]).data))
    }
    assert.deepEqual(runtime.gradientOverlayStagedRegion(staged.sourceId, region, hidden, { ...extreme, opacity: 0 }).rgba, hidden)
  } finally { runtime.dispose() }
})

test('Cor → gradiente → padrão → filtros mantém máscara e ordem dos estágios', async () => {
  const width = 7, height = 5
  const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 19 % 256)
  const pattern = { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) }
  const color = { color: [31, 63, 95, 255] as [number, number, number, number], opacity: 73, blendMode: 'normal' as const }
  const colorStyle = { type: 'color-overlay', id: 'color', color: '#1f3f5fff', opacity: 73 }
  const patternEffect = { angle: -33.333, scale: 175.5, opacity: 37.5, blendMode: 'overlay' as const }
  const patternStyle = { type: 'pattern-overlay', id: 'pattern-effect', ...patternEffect,
    pattern: { id: 'pattern', name: 'Pattern', width: 2, height: 1, sourceUrl: 'fixture:pattern', mimeType: 'image/png' } }
  const styles = normalizeLayerStyleConfig({ fillOpacity: 0, effects: [colorStyle, gradientStyle(gradientEffect), patternStyle],
    blendIf: { channel: 'red', thisLayer: { shadows: [0, 50], highlights: [200, 255] },
      underlyingLayer: { shadows: [20, 70], highlights: [250, 255] } } })
  const expected = composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) }, styles,
    { angle: 30, altitude: 30 }, 1, new Map([['pattern', { width: 2, height: 1, data: new Uint8ClampedArray(pattern.rgba) }]]))
  const region = { x: 0, y: 0, width, height }
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    const base = runtime.renderStagedRegion(staged.sourceId, region, 0).rgba
    const colored = runtime.colorOverlayStagedRegion(staged.sourceId, region, base, color).rgba
    const gradient = runtime.gradientOverlayStagedRegion(staged.sourceId, region, colored, gradientEffect).rgba
    const patterned = runtime.patternOverlayStagedRegion(staged.sourceId, region, gradient, pattern, patternEffect).rgba
    const styled = runtime.stageSource(patterned, width, height, 2)
    const filtered = runtime.blendIfThisLayerStagedRegion(styled.sourceId, region,
      { channel: 'red', ...styles.blendIf.thisLayer }).rgba
    assert.deepEqual(filtered, new Uint8Array(expected.data))
    const ready = runtime.stageSource(filtered, width, height, 3)
    const backdrop = Uint8Array.from({ length: source.length }, (_, index) => index * 31 % 256)
    applyLayerStyleBlendIfUnderlying(expected.data, new Uint8ClampedArray(backdrop), styles)
    assert.deepEqual(runtime.blendIfStagedRegion(ready.sourceId, region, backdrop,
      { channel: 'red', ...styles.blendIf.underlyingLayer }).rgba,
      new Uint8Array(expected.data))
  } finally { runtime.dispose() }
})

test('ABI do gradiente rejeita buffers, paradas e overlap sem escrever', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory;
    axia_poc_alloc(length: number): number; axia_poc_free(pointer: number, length: number): void;
    axia_poc_gradient_overlay_region(...args: number[]): number }
  const lengths = [4, 4, 4, 32, 32]
  const pointers = lengths.map(length => exports.axia_poc_alloc(length))
  const [source, target, output, colors, opacities] = pointers as [number, number, number, number, number]
  const bytes = new Uint8Array(exports.memory.buffer)
  const doubles = new DataView(exports.memory.buffer)
  doubles.setFloat64(colors + 16, 1, true)
  bytes.set([255, 0, 0, 255], colors + 8)
  bytes.set([0, 0, 255, 255], colors + 24)
  doubles.setFloat64(opacities + 8, 100, true)
  doubles.setFloat64(opacities + 16, 1, true)
  doubles.setFloat64(opacities + 24, 100, true)
  const args = [source, 4, 1, 1, 0, 0, 1, 1, target, 4, output, 4, colors, 32, opacities, 32, 0, 1, 0, 100, 0, 100, 0]
  const sentinel = () => bytes.fill(99, output, output + 4)
  const check = (parameters: number[], status: number) => {
    sentinel()
    assert.equal(exports.axia_poc_gradient_overlay_region(...parameters), status)
    assert.deepEqual([...bytes.slice(output, output + 4)], [99, 99, 99, 99])
  }
  try {
    for (const [index, value, status] of [[0, 0, 3], [13, 16, 1], [15, 528, 1], [2, 2, 1], [4, 1, 1],
      [16, 3, 2], [17, NaN, 2], [18, Infinity, 2], [19, 0, 2], [20, 2, 2], [21, 101, 2], [22, 6, 2]]) {
      const changed = [...args]; changed[index!] = value!; check(changed, status!)
    }
    for (const pointer of [source, target, colors + 8, opacities + 8]) {
      const changed = [...args]; changed[10] = pointer
      const before = bytes.slice(pointer, pointer + 4)
      assert.equal(exports.axia_poc_gradient_overlay_region(...changed), 5)
      assert.deepEqual(bytes.slice(pointer, pointer + 4), before)
    }
    for (const [pointer, value] of [[colors, -1], [colors, NaN], [colors, 2], [opacities + 8, 101], [opacities + 8, Infinity]]) {
      const old = doubles.getFloat64(pointer!, true)
      doubles.setFloat64(pointer!, value!, true)
      check(args, 2)
      doubles.setFloat64(pointer!, old, true)
    }
    bytes[colors + 12] = 1; check(args, 2); bytes[colors + 12] = 0
    bytes.set([40, 60, 80, 101], source)
    assert.equal(exports.axia_poc_gradient_overlay_region(...args), 0)
    assert.deepEqual([...bytes.slice(output, output + 4)], [128, 0, 128, 101])
  } finally { pointers.forEach((pointer, index) => exports.axia_poc_free(pointer, lengths[index]!)) }
})

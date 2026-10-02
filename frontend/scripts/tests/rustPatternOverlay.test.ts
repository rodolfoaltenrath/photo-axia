import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError, type RustPixelPocPatternOverlay,
  type RustPixelPocPatternRaster, type RustPixelPocRegion } from '../../src/editor/rustPixelPocRuntime.ts'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import type { LayerBlendMode } from '../../src/types/editor.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const modes = Object.keys({ normal: true, multiply: true, screen: true, overlay: true,
  darken: true, lighten: true } satisfies Record<LayerBlendMode, boolean>) as LayerBlendMode[]
const light = { angle: 0, altitude: 30 }
const baseEffect: RustPixelPocPatternOverlay = { angle: 0, scale: 100, opacity: 100, blendMode: 'normal' }
function overlay(pattern: RustPixelPocPatternRaster, effect: RustPixelPocPatternOverlay, id = 'overlay') {
  return { type: 'pattern-overlay', id, ...effect, pattern: { id: 'pattern', name: 'Pattern',
    mimeType: 'image/png', sourceUrl: 'fixture:pattern', width: pattern.width, height: pattern.height } }
}
function normalized(pattern: RustPixelPocPatternRaster, effect: RustPixelPocPatternOverlay) {
  const entry = normalizeLayerStyleConfig({ effects: [overlay(pattern, effect)] }).effects[0]!
  assert.equal(entry.type, 'pattern-overlay')
  return { angle: entry.angle, scale: entry.scale, opacity: entry.opacity, blendMode: entry.blendMode }
}
function compose(source: Uint8Array, width: number, height: number, fillOpacity: number,
  pattern: RustPixelPocPatternRaster, effects: unknown[] = []) {
  return composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) },
    normalizeLayerStyleConfig({ enabled: true, fillOpacity, effects }), light, 1,
    new Map([['pattern', { width: pattern.width, height: pattern.height, data: new Uint8ClampedArray(pattern.rgba) }]]))
}
function tile(source: Uint8Array, width: number, region: RustPixelPocRegion) {
  const result = new Uint8Array(region.width * region.height * 4)
  for (let row = 0; row < region.height; row++) {
    const offset = ((region.y + row) * width + region.x) * 4
    result.set(source.subarray(offset, offset + region.width * 4), row * region.width * 4)
  }
  return result
}

test('Padrão Rust reproduz o golden existente e preserva fonte, target e textura', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((entry: { id: string }) => entry.id === 'pattern-overlay-tiling')
  assert.ok(fixture)
  const source = new Uint8Array(fixture.source.rgba)
  const sourceBefore = source.slice()
  const pattern = { width: 2, height: 1, rgba: new Uint8Array(fixture.patterns[0].rgba) }
  const patternBefore = pattern.rgba.slice()
  try {
    const staged = runtime.stageSource(source, 3, 1, 1)
    const region = { x: 0, y: 0, width: 3, height: 1 }
    const target = runtime.renderStagedRegion(staged.sourceId, region, 0).rgba
    const targetBefore = target.slice()
    const result = runtime.patternOverlayStagedRegion(staged.sourceId, region, target, pattern, baseEffect)
    assert.deepEqual([...result.rgba], fixture.expected.rgba)
    assert.equal(result.generation, staged.generation)
    assert.deepEqual(target, targetBefore)
    assert.deepEqual(source, sourceBefore)
    assert.deepEqual(pattern.rgba, patternBefore)
    assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, region, 0).rgba, targetBefore)
  } finally { runtime.dispose() }
})

for (const blendMode of modes) {
  test(`Padrão ${blendMode}: todos os alfas da máscara/textura e rotação/escala concordam com TS`, async () => {
    const runtime = await createRustPixelPocRuntime(wasm)
    const width = 256, height = 256
    const source = new Uint8Array(width * height * 4)
    const pattern: RustPixelPocPatternRaster = { width: 256, height: 1, rgba: new Uint8Array(256 * 4) }
    for (let alpha = 0; alpha <= 255; alpha++) {
      for (let value = 0; value <= 255; value++) {
        source.set([value, (value * 31 + alpha) % 256, (value * 47 + 13) % 256, alpha],
          (alpha * width + value) * 4)
      }
      pattern.rgba.set([(alpha * 7) % 256, (alpha * 19) % 256, 255 - alpha, alpha], alpha * 4)
    }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      for (const [fillOpacity, opacity, angle, scale] of [
        [0, 100, 0, 100], [37.5, 73.5, -45, 37.5], [60, 50, 90, 101.25],
        [100, 100, 179.999, 1000], [1, 0.5, -180, 1], [100, 37.5, 0, 99.9999]
      ]) {
        const effect = normalized(pattern, { opacity: opacity!, angle: angle!, scale: scale!, blendMode })
        const target = new Uint8Array(compose(source, width, height, fillOpacity!, pattern).data)
        const expected = compose(source, width, height, fillOpacity!, pattern, [overlay(pattern, effect)])
        const actual = runtime.patternOverlayStagedRegion(staged.sourceId,
          { x: 0, y: 0, width, height }, target, pattern, effect)
        assert.deepEqual(actual.rgba, new Uint8Array(expected.data),
          `${blendMode}: ${fillOpacity}/${opacity}/${angle}/${scale}`)
      }
    } finally { runtime.dispose() }
  })
}

test('Tiles de padrão não reiniciam a textura: dimensões ímpares, rotações e escalas fracionárias', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const width = 17, height = 11
  const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 19 % 256)
  const pattern = { width: 3, height: 2,
    rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0,
      200, 120, 40, 1, 40, 200, 120, 64, 120, 40, 200, 254]) }
  const target = new Uint8Array(compose(source, width, height, 60, pattern).data)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const angle of [0, 45, -45, 90, -90, -180, 179.999, 0.1]) {
      for (const scale of [1, 33.333, 99.999, 100, 175.5, 1000]) {
        const effect = normalized(pattern, { ...baseEffect, angle, scale, opacity: 73.5, blendMode: 'overlay' })
        const expected = compose(source, width, height, 60, pattern, [overlay(pattern, effect)])
        const assembled = new Uint8Array(source.length)
        for (let y = 0; y < height; y += 4) {
          for (let x = 0; x < width; x += 5) {
            const region = { x, y, width: Math.min(5, width - x), height: Math.min(4, height - y) }
            const actual = runtime.patternOverlayStagedRegion(staged.sourceId, region, tile(target, width, region), pattern, effect)
            for (let row = 0; row < region.height; row++) {
              assembled.set(actual.rgba.subarray(row * region.width * 4, (row + 1) * region.width * 4),
                ((y + row) * width + x) * 4)
            }
          }
        }
        assert.deepEqual(assembled, new Uint8Array(expected.data), `angle=${angle}, scale=${scale}`)
      }
    }
  } finally { runtime.dispose() }
})

test('Padrão preserva a origem de amostragem do raster expandido por sombra anterior', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const width = 3, height = 3
  const source = new Uint8Array([40, 60, 80, 255, 90, 110, 130, 128, 170, 150, 120, 64,
    40, 60, 80, 255, 90, 110, 130, 128, 0, 0, 0, 0, 40, 60, 80, 255, 77, 88, 99, 0, 170, 150, 120, 64])
  const pattern = { width: 3, height: 2, rgba: Uint8Array.from({ length: 24 }, (_, index) => index * 37 % 256) }
  const previous = [{ type: 'drop-shadow', id: 'shadow', size: 1, distance: 1, angle: 0,
    useGlobalLight: false, opacity: 75, color: '#336699' },
  { type: 'color-overlay', id: 'color', color: '#ff8000', opacity: 25 }]
  const base = compose(source, width, height, 0, pattern, previous)
  assert.ok(base.offsetX < 0 && base.offsetY < 0)
  const expandedMask = new Uint8Array(base.width * base.height * 4)
  for (let row = 0; row < height; row++) {
    expandedMask.set(source.subarray(row * width * 4, (row + 1) * width * 4),
      ((row - base.offsetY) * base.width - base.offsetX) * 4)
  }
  try {
    const staged = runtime.stageSource(expandedMask, base.width, base.height, 1)
    for (const blendMode of modes) {
      const effect = normalized(pattern, { ...baseEffect, angle: -33.333, scale: 37.5, opacity: 73.5, blendMode })
      const expected = compose(source, width, height, 0, pattern, [...previous, overlay(pattern, effect)])
      assert.deepEqual([expected.width, expected.height, expected.offsetX, expected.offsetY],
        [base.width, base.height, base.offsetX, base.offsetY])
      const actual = runtime.patternOverlayStagedRegion(staged.sourceId,
        { x: 0, y: 0, width: base.width, height: base.height }, new Uint8Array(base.data), pattern, effect)
      assert.deepEqual(actual.rgba, new Uint8Array(expected.data), blendMode)
    }
  } finally { runtime.dispose() }
})

test('Cor seguida de dois padrões usa a máscara original, não o alfa do target', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([20, 40, 60, 255, 30, 50, 70, 91, 77, 88, 99, 0])
  const pattern = { width: 2, height: 1, rgba: new Uint8Array([203, 71, 149, 255, 20, 200, 90, 128]) }
  const color = { color: [255, 128, 0, 255] as [number, number, number, number], opacity: 25, blendMode: 'normal' as const }
  const first = { ...baseEffect, opacity: 75, blendMode: 'screen' as const }
  const second = { ...baseEffect, opacity: 90.5, blendMode: 'multiply' as const, angle: -90 }
  try {
    const staged = runtime.stageSource(source, 3, 1, 1)
    const region = { x: 0, y: 0, width: 3, height: 1 }
    const filled = runtime.renderStagedRegion(staged.sourceId, region, 0).rgba
    const colored = runtime.colorOverlayStagedRegion(staged.sourceId, region, filled, color).rgba
    const pass1 = runtime.patternOverlayStagedRegion(staged.sourceId, region, colored, pattern, first).rgba
    const pass2 = runtime.patternOverlayStagedRegion(staged.sourceId, region, pass1, pattern, second).rgba
    const expected = compose(source, 3, 1, 0, pattern, [
      { type: 'color-overlay', id: 'color', color: '#ff8000', opacity: 25 },
      overlay(pattern, first, 'a'), overlay(pattern, second, 'b')])
    assert.deepEqual(pass2, new Uint8Array(expected.data))
  } finally { runtime.dispose() }
})

test('Padrão sem contribuição conserva RGB oculto e pixels fora da máscara', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0])
  const target = new Uint8Array([77, 88, 99, 0, 120, 130, 140, 64])
  try {
    const staged = runtime.stageSource(source, 2, 1, 1)
    const region = { x: 0, y: 0, width: 2, height: 1 }
    for (const [opacity, alpha] of [[0, 255], [100, 0]]) {
      const pattern = { width: 1, height: 1, rgba: new Uint8Array([255, 0, 0, alpha!]) }
      assert.deepEqual(runtime.patternOverlayStagedRegion(staged.sourceId, region, target, pattern,
        { ...baseEffect, opacity: opacity! }).rgba, target)
    }
    assert.deepEqual([...runtime.patternOverlayStagedRegion(staged.sourceId, region, target,
      { width: 1, height: 1, rgba: new Uint8Array([255, 0, 0, 255]) }, baseEffect).rgba],
    [255, 0, 0, 255, 120, 130, 140, 64])
  } finally { runtime.dispose() }
})

test('Adapter do padrão rejeita textura/efeito/região inválidos e recupera a fonte', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const staged = runtime.stageSource(new Uint8Array([1, 2, 3, 255]), 1, 1, 1)
  const region = { x: 0, y: 0, width: 1, height: 1 }
  const target = new Uint8Array(4)
  const pattern = { width: 1, height: 1, rgba: new Uint8Array([200, 120, 40, 255]) }
  const invalid = (operation: () => unknown) => assert.throws(operation,
    error => error instanceof RustPixelPocError && error.code === 'invalid-input')
  try {
    for (const effect of [{ ...baseEffect, angle: NaN }, { ...baseEffect, angle: 180 },
      { ...baseEffect, angle: -180.1 }, { ...baseEffect, scale: 0 }, { ...baseEffect, scale: 1001 },
      { ...baseEffect, scale: Infinity }, { ...baseEffect, opacity: -1 }, { ...baseEffect, opacity: 101 },
      { ...baseEffect, opacity: NaN }, { ...baseEffect, blendMode: 'invalid' }]) {
      invalid(() => runtime.patternOverlayStagedRegion(staged.sourceId, region, target, pattern,
        effect as RustPixelPocPatternOverlay))
    }
    for (const texture of [{ ...pattern, rgba: new Uint8Array(3) }, { ...pattern, width: 0 },
      { ...pattern, height: 1.5 }, { ...pattern, width: 8193 }, { ...pattern, width: 2 }, undefined]) {
      invalid(() => runtime.patternOverlayStagedRegion(staged.sourceId, region, target,
        texture as unknown as RustPixelPocPatternRaster, baseEffect))
    }
    invalid(() => runtime.patternOverlayStagedRegion(staged.sourceId, region, new Uint8Array(3), pattern, baseEffect))
    invalid(() => runtime.patternOverlayStagedRegion(staged.sourceId, { ...region, x: 1 }, target, pattern, baseEffect))
    assert.deepEqual([...runtime.patternOverlayStagedRegion(staged.sourceId, region, target, pattern, baseEffect).rgba],
      [200, 120, 40, 255])
    runtime.releaseSource(staged.sourceId)
    invalid(() => runtime.patternOverlayStagedRegion(staged.sourceId, region, target, pattern, baseEffect))
    runtime.dispose()
    assert.throws(() => runtime.patternOverlayStagedRegion(staged.sourceId, region, target, pattern, baseEffect),
      error => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
  } finally { runtime.dispose() }
})

test('ABI do padrão rejeita overlap parcial, textura e parâmetros inválidos antes de escrever', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const memory = instance.exports.memory as WebAssembly.Memory
  const alloc = instance.exports.axia_poc_alloc as (length: number) => number
  const free = instance.exports.axia_poc_free as (pointer: number, length: number) => void
  const apply = instance.exports.axia_poc_pattern_overlay_region as (...values: number[]) => number
  const source = alloc(8), target = alloc(4), output = alloc(4), pattern = alloc(8)
  assert.ok(source > 0 && target > 0 && output > 0 && pattern > 0)
  try {
    new Uint8Array(memory.buffer, source, 8).set([1, 2, 3, 255, 1, 2, 3, 255])
    new Uint8Array(memory.buffer, pattern, 8).set([200, 120, 40, 255, 255, 0, 0, 255])
    new Uint8Array(memory.buffer, output, 4).fill(99)
    const invoke = (destination: number, overrides: Partial<{ cosine: number; sine: number; scale: number;
      opacity: number; mode: number; texture: number; length: number; width: number; x: number }> = {}) => {
      const args = { cosine: 1, sine: 0, scale: 1, opacity: 50, mode: 0,
        texture: pattern, length: 8, width: 2, x: 0, ...overrides }
      return apply(source, 8, 2, 1, args.x, 0, 1, 1, target, 4, destination, 4,
        args.texture, args.length, args.width, 1, args.cosine, args.sine, args.scale, args.opacity, args.mode)
    }
    assert.equal(invoke(source), 5)
    assert.equal(invoke(source + 4), 5)
    assert.equal(invoke(target), 5)
    assert.equal(invoke(pattern + 4), 5)
    assert.equal(invoke(0), 3)
    assert.equal(invoke(output, { texture: 0 }), 3)
    assert.equal(invoke(output, { mode: 6 }), 2)
    assert.equal(invoke(output, { opacity: NaN }), 2)
    assert.equal(invoke(output, { cosine: 0 }), 2)
    assert.equal(invoke(output, { sine: Infinity }), 2)
    assert.equal(invoke(output, { scale: 0 }), 2)
    assert.equal(invoke(output, { length: 3 }), 1)
    assert.equal(invoke(output, { width: 0 }), 1)
    assert.equal(invoke(output, { width: 1 }), 1)
    assert.equal(invoke(output, { x: 2 }), 1)
    assert.deepEqual([...new Uint8Array(memory.buffer, output, 4)], [99, 99, 99, 99])
    assert.equal(invoke(output), 0)
    assert.deepEqual([...new Uint8Array(memory.buffer, output, 4)], [200, 120, 40, 128])
  } finally { free(pattern, 8); free(output, 4); free(target, 4); free(source, 8) }
})

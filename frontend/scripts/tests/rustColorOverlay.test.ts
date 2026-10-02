import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError,
  type RustPixelPocColorOverlay, type RustPixelPocRegion } from '../../src/editor/rustPixelPocRuntime.ts'
import { applyLayerStyleBlendIfUnderlying, composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import type { LayerBlendMode } from '../../src/types/editor.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const modes = Object.keys({ normal: true, multiply: true, screen: true, overlay: true,
  darken: true, lighten: true } satisfies Record<LayerBlendMode, boolean>) as LayerBlendMode[]
const light = { angle: 0, altitude: 30 }
function overlay(effect: RustPixelPocColorOverlay, id = 'overlay') {
  return { type: 'color-overlay', id, opacity: effect.opacity, blendMode: effect.blendMode,
    color: `#${effect.color.map(value => value.toString(16).padStart(2, '0')).join('')}` }
}
function compose(source: Uint8Array, width: number, height: number, fillOpacity: number,
  effects: unknown[] = []) {
  return new Uint8Array(composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) },
    normalizeLayerStyleConfig({ enabled: true, fillOpacity, effects }), light).data)
}
function tile(source: Uint8Array, width: number, region: RustPixelPocRegion) {
  const result = new Uint8Array(region.width * region.height * 4)
  for (let row = 0; row < region.height; row++) {
    const offset = ((region.y + row) * width + region.x) * 4
    result.set(source.subarray(offset, offset + region.width * 4), row * region.width * 4)
  }
  return result
}

test('Sobreposição Rust reproduz o golden congelado e não modifica fonte/target', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((entry: { id: string }) => entry.id === 'color-overlay-partial-fill')
  assert.ok(fixture)
  const source = new Uint8Array(fixture.source.rgba)
  const before = source.slice()
  try {
    const staged = runtime.stageSource(source, 4, 1, 1)
    const region = { x: 0, y: 0, width: 4, height: 1 }
    const target = runtime.renderStagedRegion(staged.sourceId, region, 60).rgba
    const targetBefore = target.slice()
    const result = runtime.colorOverlayStagedRegion(staged.sourceId, region, target,
      { color: [255, 128, 0, 255], opacity: 75, blendMode: 'normal' })
    assert.deepEqual([...result.rgba], fixture.expected.rgba)
    assert.equal(result.generation, staged.generation)
    assert.deepEqual(target, targetBefore)
    assert.deepEqual(source, before)
    assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, region, 60).rgba, targetBefore)
  } finally { runtime.dispose() }
})

for (const blendMode of modes) {
  test(`Sobreposição ${blendMode}: todos os alfas/RGB, fill e opacidade fracionária concordam com TS`, async () => {
    const runtime = await createRustPixelPocRuntime(wasm)
    const width = 256, height = 256
    const source = new Uint8Array(width * height * 4)
    for (let alpha = 0; alpha <= 255; alpha++) {
      for (let value = 0; value <= 255; value++) {
        source.set([value, (value * 31 + alpha) % 256, (value * 47 + 13) % 256, alpha],
          (alpha * width + value) * 4)
      }
    }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      for (const [fillOpacity, opacity, colorAlpha] of [
        [0, 100, 255], [1, 0.5, 255], [37.5, 37.5, 128],
        [60, 75, 255], [100, 100, 1], [100, 100, 255]
      ]) {
        const effect: RustPixelPocColorOverlay = {
          color: [203, 71, 149, colorAlpha!], opacity: opacity!, blendMode
        }
        const target = compose(source, width, height, fillOpacity!)
        const expected = compose(source, width, height, fillOpacity!, [overlay(effect)])
        const actual = runtime.colorOverlayStagedRegion(staged.sourceId,
          { x: 0, y: 0, width, height }, target, effect)
        assert.deepEqual(actual.rgba, expected, `${blendMode}: ${fillOpacity}/${opacity}/${colorAlpha}`)
      }
    } finally { runtime.dispose() }
  })
}

test('Sobreposição recomposta por tiles 7×5 preserva a máscara original após um efeito interno', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const width = 7, height = 5
  const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 19 % 256)
  const inner = { type: 'inner-shadow', id: 'inner', size: 1, distance: 1, angle: 0,
    useGlobalLight: false, color: '#30a080', opacity: 83 }
  const target = compose(source, width, height, 0, [inner])
  assert.ok(target.some(value => value !== 0), 'efeito interno visível com fill zero')
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const blendMode of modes) {
      const effect: RustPixelPocColorOverlay = { color: [255, 128, 0, 143], opacity: 73.5, blendMode }
      const expected = compose(source, width, height, 0, [inner, overlay(effect)])
      const assembled = new Uint8Array(source.length)
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 3) {
          const region = { x, y, width: Math.min(3, width - x), height: Math.min(2, height - y) }
          const actual = runtime.colorOverlayStagedRegion(staged.sourceId, region, tile(target, width, region), effect)
          for (let row = 0; row < region.height; row++) {
            assembled.set(actual.rgba.subarray(row * region.width * 4, (row + 1) * region.width * 4),
              ((y + row) * width + x) * 4)
          }
        }
      }
      assert.deepEqual(assembled, expected, blendMode)
    }
  } finally { runtime.dispose() }
})

test('Duas sobreposições usam a mesma máscara original e passam o target entre estágios', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([20, 40, 60, 255, 30, 50, 70, 91, 77, 88, 99, 0])
  const first: RustPixelPocColorOverlay = { color: [203, 71, 149, 255], opacity: 25, blendMode: 'normal' }
  const second: RustPixelPocColorOverlay = { color: [20, 200, 90, 128], opacity: 90.5, blendMode: 'screen' }
  try {
    const staged = runtime.stageSource(source, 3, 1, 1)
    const region = { x: 0, y: 0, width: 3, height: 1 }
    const target = runtime.renderStagedRegion(staged.sourceId, region, 0).rgba
    const pass1 = runtime.colorOverlayStagedRegion(staged.sourceId, region, target, first)
    const pass2 = runtime.colorOverlayStagedRegion(staged.sourceId, region, pass1.rgba, second)
    assert.deepEqual(pass2.rgba, compose(source, 3, 1, 0, [overlay(first, 'a'), overlay(second, 'b')]))
  } finally { runtime.dispose() }
})

test('Fill → sobreposição → Mesclar se conserva ordem e arredondamento entre passes', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([10, 20, 30, 101, 90, 80, 70, 255])
  const backdrop = new Uint8Array([75, 0, 0, 255, 75, 0, 0, 0])
  const effect: RustPixelPocColorOverlay = { color: [255, 128, 0, 143], opacity: 73.5, blendMode: 'overlay' }
  const config = { channel: 'red' as const, shadows: [50, 100] as [number, number],
    highlights: [255, 255] as [number, number] }
  try {
    const region = { x: 0, y: 0, width: 2, height: 1 }
    const original = runtime.stageSource(source, 2, 1, 1)
    const filled = runtime.renderStagedRegion(original.sourceId, region, 50).rgba
    const styled = runtime.colorOverlayStagedRegion(original.sourceId, region, filled, effect).rgba
    // Underlying Blend If consumes styled pixels, not the original alpha mask.
    const staged = runtime.stageSource(styled, 2, 1, 2)
    const actual = runtime.blendIfStagedRegion(staged.sourceId, region, backdrop, config)
    const expected = new Uint8ClampedArray(compose(source, 2, 1, 50, [overlay(effect)]))
    applyLayerStyleBlendIfUnderlying(expected, new Uint8ClampedArray(backdrop),
      normalizeLayerStyleConfig({ enabled: true, blendIf: { channel: 'red', underlyingLayer: config } }))
    assert.deepEqual(actual.rgba, new Uint8Array(expected))
  } finally { runtime.dispose() }
})

test('Efeito sem contribuição mantém RGBA oculto do target', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const source = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0])
  const target = new Uint8Array([77, 88, 99, 0, 120, 130, 140, 64])
  try {
    const staged = runtime.stageSource(source, 2, 1, 1)
    const region = { x: 0, y: 0, width: 2, height: 1 }
    for (const [opacity, alpha] of [[0, 255], [100, 0]]) {
      assert.deepEqual(runtime.colorOverlayStagedRegion(staged.sourceId, region, target,
        { color: [255, 0, 0, alpha!], opacity: opacity!, blendMode: 'normal' }).rgba, target)
    }
    const actual = runtime.colorOverlayStagedRegion(staged.sourceId, region, target,
      { color: [255, 0, 0, 255], opacity: 100, blendMode: 'normal' }).rgba
    assert.deepEqual([...actual], [255, 0, 0, 255, 120, 130, 140, 64])
  } finally { runtime.dispose() }
})

test('Adapter da sobreposição rejeita efeito/região inválidos e recupera sem perder a fonte', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const staged = runtime.stageSource(new Uint8Array([1, 2, 3, 255]), 1, 1, 1)
  const region = { x: 0, y: 0, width: 1, height: 1 }
  const target = new Uint8Array(4)
  const effect: RustPixelPocColorOverlay = { color: [200, 120, 40, 255], opacity: 50, blendMode: 'normal' }
  const invalid = (operation: () => unknown) => assert.throws(operation,
    error => error instanceof RustPixelPocError && error.code === 'invalid-input')
  try {
    for (const opacity of [-1, 101, NaN, Infinity]) {
      invalid(() => runtime.colorOverlayStagedRegion(staged.sourceId, region, target, { ...effect, opacity }))
    }
    for (const color of [[255, 0, 0], [256, 0, 0, 255], [0.5, 0, 0, 255], [NaN, 0, 0, 255], new Array(4)]) {
      invalid(() => runtime.colorOverlayStagedRegion(staged.sourceId, region, target,
        { ...effect, color } as unknown as RustPixelPocColorOverlay))
    }
    invalid(() => runtime.colorOverlayStagedRegion(staged.sourceId, region, target,
      { ...effect, blendMode: 'invalid' } as unknown as RustPixelPocColorOverlay))
    invalid(() => runtime.colorOverlayStagedRegion(staged.sourceId, region, new Uint8Array(3), effect))
    invalid(() => runtime.colorOverlayStagedRegion(staged.sourceId, { ...region, x: 1 }, target, effect))
    assert.deepEqual([...runtime.colorOverlayStagedRegion(staged.sourceId, region, target, effect).rgba],
      [200, 120, 40, 128])
    runtime.invalidateSource(2)
    invalid(() => runtime.colorOverlayStagedRegion(staged.sourceId, region, target, effect))
    runtime.dispose()
    assert.throws(() => runtime.colorOverlayStagedRegion(staged.sourceId, region, target, effect),
      error => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
  } finally { runtime.dispose() }
})

test('ABI da sobreposição recusa overlap, efeito e comprimentos inválidos sem escrever', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const memory = instance.exports.memory as WebAssembly.Memory
  const alloc = instance.exports.axia_poc_alloc as (length: number) => number
  const free = instance.exports.axia_poc_free as (pointer: number, length: number) => void
  const apply = instance.exports.axia_poc_color_overlay_region as (...values: number[]) => number
  const source = alloc(4), target = alloc(4), output = alloc(4)
  assert.ok(source > 0 && target > 0 && output > 0)
  try {
    new Uint8Array(memory.buffer, source, 4).set([1, 2, 3, 255])
    new Uint8Array(memory.buffer, target, 4).fill(0)
    new Uint8Array(memory.buffer, output, 4).fill(99)
    const invoke = (destination: number, mode = 0, opacity = 50, red = 200, length = 4, x = 0) =>
      apply(source, 4, 1, 1, x, 0, 1, 1, target, length, destination, 4, red, 120, 40, 255, opacity, mode)
    assert.equal(invoke(source), 5)
    assert.equal(invoke(target), 5)
    assert.equal(invoke(0), 3)
    assert.equal(invoke(output, 6), 2)
    assert.equal(invoke(output, 0, NaN), 2)
    assert.equal(invoke(output, 0, 101), 2)
    assert.equal(invoke(output, 0, 50, 256), 2)
    assert.equal(invoke(output, 0, 50, 200, 3), 1)
    assert.equal(invoke(output, 0, 50, 200, 4, 1), 1)
    assert.deepEqual([...new Uint8Array(memory.buffer, output, 4)], [99, 99, 99, 99])
    assert.equal(invoke(output), 0)
    assert.deepEqual([...new Uint8Array(memory.buffer, output, 4)], [200, 120, 40, 128])
  } finally { free(output, 4); free(target, 4); free(source, 4) }
})

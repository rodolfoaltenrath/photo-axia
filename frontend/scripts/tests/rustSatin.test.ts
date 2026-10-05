import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeSatin, prepareRustSatin, satinLayout } from '../../src/editor/rustPixelPocSatin.ts'
import { satinEffect, satinReference } from './support/rustSatinFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import type { LayerBlendMode, LayerStyleContour } from '../../src/types/editor.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const custom: LayerStyleContour = { preset: 'custom', points: [{ x: 0.25, y: 0.75 }, { x: 0.25, y: 0 }, { x: 0.75, y: 1 }] }

test('Acetinado Rust reproduz golden existente sem regenerar a expectativa', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((item: { id: string }) => item.id === 'satin-inverted')
  const config = normalizeLayerStyleConfig(fixture.styles), effect = config.effects[0]!
  assert.ok(effect.type === 'satin')
  const source = new Uint8Array(fixture.source.rgba), { width, height } = fixture.source
  const target = source.slice()
  for (let index = 3; index < target.length; index += 4) {
    target[index] = Math.round(target[index]! * config.fillOpacity / 100)
    if (!target[index]) target.fill(0, index - 3, index + 1)
  }
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    assert.deepEqual([...runtime.satinStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target,
      prepareRustSatin(effect, fixture.resolutionScale)).rgba], fixture.expected.rgba)
  } finally { runtime.dispose() }
})

for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as LayerBlendMode[]) {
  test(`Acetinado ${blendMode}: todos os alfas, contornos e inversão concordam byte a byte`, async () => {
    const width = 256, height = 256, source = new Uint8Array(width * height * 4), target = new Uint8Array(source.length)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      source.set([x, y, x ^ y, x ^ y], index); target.set([x, 255 - y, x ^ y, x], index)
    }
    const runtime = await createRustPixelPocRuntime(wasm), region = { x: 0, y: 0, width, height }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      for (const preset of ['linear', 'cone', 'inverted-cone', 'gaussian', 'ring', 'custom'] as const) {
        for (const invert of [false, true]) for (const distance of [0, 0.5, 3.75]) {
          const effect = satinEffect({ blendMode, size: 2, distance, angle: 0, invert,
            contour: preset === 'custom' ? custom : { preset, points: [] } })
          assert.deepEqual(runtime.satinStagedRegion(staged.sourceId, region, target,
            prepareRustSatin(effect, 1)).rgba, satinReference(source, width, height, target, effect), `${preset}/${invert}/${distance}`)
        }
      }
    } finally { runtime.dispose() }
  })
}

test('Acetinado em tiles preserva halos, transparência e deslocamentos espelhados', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const [width, height] of [[37, 29], [1, 17], [19, 1], [1, 1]] as const) {
      const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
      const target = Uint8Array.from(source, (value, index) => index % 4 === 3 ? 101 : 255 - value)
      const staged = runtime.stageSource(source, width, height, ++generation)
      for (const size of [0, 2, 7]) for (const invert of [false, true]) for (const angle of [-180, -77.75, 0, 33.333]) {
        const effect = satinEffect({ size, invert, angle, contour: custom })
        const satin = prepareRustSatin(effect, 1), expected = satinReference(source, width, height, target, effect)
        assert.deepEqual(runtime.satinStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, satin).rgba, expected)
        for (let y = 0; y < height; y += 5) for (let x = 0; x < width; x += 7) {
          const region = { x, y, width: Math.min(7, width - x), height: Math.min(5, height - y) }
          assert.deepEqual(runtime.satinStagedRegion(staged.sourceId, region, gradientTile(target, width, region), satin).rgba,
            gradientTile(expected, width, region), `${width}x${height} ${size}/${invert}/${angle} ${x},${y}`)
        }
      }
    }
  } finally { runtime.dispose() }
})

test('Acetinado resolve meio pixel antes de espelhar e suporta escalas/raios máximos', async () => {
  const source = Uint8Array.from({ length: 11 * 13 * 4 }, (_, index) => index * 29 % 256)
  const target = Uint8Array.from(source, (_, index) => index * 19 % 256), runtime = await createRustPixelPocRuntime(wasm)
  assert.equal(prepareRustSatin(satinEffect({ distance: 0.5, angle: 0 }), 1).offsetX, 1)
  assert.equal(prepareRustSatin(satinEffect({ distance: 0.5, angle: -180 }), 1).offsetX, -0)
  try {
    const staged = runtime.stageSource(source, 11, 13, 1)
    for (const scale of [0.125, 1.375, 8]) for (const angle of [-180, -90, 0, 33.333, 90]) {
      const effect = satinEffect({ size: 5.25, distance: 0.5, angle })
      const satin = prepareRustSatin(effect, scale), expected = satinReference(source, 11, 13, target, effect, scale)
      for (const region of [{ x: 0, y: 0, width: 11, height: 13 }, { x: 2, y: 3, width: 7, height: 5 }]) {
        assert.deepEqual(runtime.satinStagedRegion(staged.sourceId, region, gradientTile(target, 11, region), satin).rgba,
          gradientTile(expected, 11, region), `${scale}/${angle}`)
      }
    }
    const maximum = satinEffect({ size: 250, distance: 1000, angle: 0 })
    assert.deepEqual(runtime.satinStagedRegion(staged.sourceId, { x: 0, y: 0, width: 11, height: 13 }, target,
      prepareRustSatin(maximum, 8)).rgba, satinReference(source, 11, 13, target, maximum, 8))
  } finally { runtime.dispose() }
})

test('Acetinado não descarta diferença zero: contorno continua usando os dois fatores de alfa', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), width = 256, source = new Uint8Array(width * 4), target = new Uint8Array(width * 4)
  for (let alpha = 0; alpha < width; alpha++) source.set([77, 88, 99, alpha], alpha * 4)
  try {
    const staged = runtime.stageSource(source, width, 1, 1)
    const narrow: LayerStyleContour = { preset: 'custom', points: Array.from({ length: 32 }, (_, index) => ({
      x: 0.5 + index * 1e-14, y: index % 2 })) }
    for (const color of ['#33669900', '#336699ff', '#ffffff']) for (const contour of [custom, narrow]) {
      const effect = satinEffect({ color, contour, distance: 0, size: 0, opacity: 100 })
      assert.deepEqual(runtime.satinStagedRegion(staged.sourceId, { x: 0, y: 0, width, height: 1 }, target,
        prepareRustSatin(effect, 1)).rgba, satinReference(source, width, 1, target, effect))
    }
    const effect = satinEffect({ color: '#336699', contour: { preset: 'custom', points: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
      distance: 0, size: 0, opacity: 100 })
    const result = runtime.satinStagedRegion(staged.sourceId, { x: 0, y: 0, width, height: 1 }, target, prepareRustSatin(effect, 1))
    assert.deepEqual([...result.rgba.subarray(101 * 4, 102 * 4)], [51, 102, 153, 40])
    const hidden = Uint8Array.from(target, (_, i) => i % 4 === 3 ? 0 : 123)
    const unchanged = runtime.satinStagedRegion(staged.sourceId, { x: 0, y: 0, width, height: 1 }, hidden,
      prepareRustSatin(satinEffect({ color: '#33669900' }), 1))
    assert.deepEqual(unchanged.rgba, hidden)
  } finally { runtime.dispose() }
})

test('Acetinado compõe antes do overlay com Fill zero sem alterar a máscara original', async () => {
  const width = 19, height = 17, source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
  const satin = satinEffect(), overlay = { type: 'color-overlay' as const, id: 'overlay', enabled: true,
    color: '#ee772280', opacity: 37.5, blendMode: 'screen' as const }
  const runtime = await createRustPixelPocRuntime(wasm), region = { x: 0, y: 0, width, height }
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    const internal = runtime.satinStagedRegion(staged.sourceId, region, new Uint8Array(source.length), prepareRustSatin(satin, 1))
    const result = runtime.colorOverlayStagedRegion(staged.sourceId, region, internal.rgba,
      { color: [238, 119, 34, 128], opacity: 37.5, blendMode: 'screen' })
    const reference = composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) },
      normalizeLayerStyleConfig({ fillOpacity: 0, effects: [overlay, satin] }), { angle: 33.333, altitude: 30 })
    assert.equal(reference.width, width); assert.equal(reference.height, height)
    assert.deepEqual(result.rgba, new Uint8Array(reference.data))
    const displayed = source.slice()
    for (let i = 0; i < displayed.length; i += 4) if (!displayed[i + 3]) displayed.fill(0, i, i + 4)
    assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, region, 100).rgba, displayed)
  } finally { runtime.dispose() }
})

test('Orçamento do acetinado inclui terceira máscara retida e rejeita antes da alocação', () => {
  const satin = prepareRustSatin(satinEffect(), 1)
  assert.throws(() => satinLayout(4096, 4096, { x: 1024, y: 1024, width: 1024, height: 1024 }, { ...satin, radius: 1024 }, 64),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
  const layout = satinLayout(37, 29, { x: 9, y: 12, width: 7, height: 5 }, satin, encodeSatin(satin).length)
  assert.deepEqual(layout.context, { x: 5, y: 8, width: 15, height: 13 })
  assert.equal(layout.workingBytes, 37 * 29 * 4 + 7 * 5 * 8 + 3 * 15 * 13 + 64 + 512)
})

test('Adapter acetinado rejeita parâmetros não normalizados sem modificar o efeito', () => {
  const effect = satinEffect(), before = structuredClone(effect), satin = prepareRustSatin(effect, 1)
  assert.deepEqual(effect, before)
  for (const scale of [0, NaN, Infinity, 8.001]) assert.throws(() => prepareRustSatin(effect, scale))
  for (const bad of [{ ...effect, size: 251 }, { ...effect, distance: -1 }, { ...effect, angle: 180 },
    { ...effect, color: 'red' }, { ...effect, id: '' }]) assert.throws(() => prepareRustSatin(bad, 1))
  for (const bad of [{ ...satin, radius: 4097 }, { ...satin, invert: undefined }, { ...satin, offsetX: 8193 },
    { ...satin, opacity: NaN }, { ...satin, contour: { preset: 'custom' as const, points: [] } }]) {
    assert.throws(() => encodeSatin(bad as typeof satin))
  }
})

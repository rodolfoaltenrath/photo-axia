import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { prepareRustStroke, encodeStroke, strokeLayout, strokePacketLength } from '../../src/editor/rustPixelPocStroke.ts'
import { strokeEffect, strokeReference, strokeGradient, strokePattern, strokePatternAsset, paddedStrokeSource, patternRasters } from './support/rustStrokeFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { composeLayerStyleRaster, renderStroke, LayerStylePatternMissingError } from '../../src/editor/layerStyleRaster.ts'
import type { LayerBlendMode } from '../../src/types/editor.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer

test('Traçado externo Rust reproduz golden existente com padding sem regenerar expectativa', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((item: { id: string }) => item.id === 'overlay-before-outer-stroke')
  const config = normalizeLayerStyleConfig(fixture.styles), effect = config.effects.find(effect => effect.type === 'stroke')!
  assert.ok(effect.type === 'stroke')
  const source = new Uint8Array(fixture.source.rgba), padded = paddedStrokeSource(source, fixture.source.width, fixture.source.height, effect, fixture.resolutionScale)
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(padded.rgba, padded.width, padded.height, 1), region = { x: 0, y: 0, width: padded.width, height: padded.height }
    const filled = runtime.renderStagedRegion(staged.sourceId, region, config.fillOpacity).rgba
    const overlay = config.effects.find(effect => effect.type === 'color-overlay')!
    assert.ok(overlay.type === 'color-overlay')
    const target = runtime.colorOverlayStagedRegion(staged.sourceId, region, filled,
      { color: [255, 128, 0, 255], opacity: overlay.opacity, blendMode: overlay.blendMode }).rgba
    const result = runtime.strokeStagedRegion(staged.sourceId, region, target, prepareRustStroke(effect, fixture.resolutionScale))
    assert.deepEqual([...result.rgba], fixture.expected.rgba)
    assert.equal(padded.width, fixture.expected.width); assert.equal(padded.height, fixture.expected.height)
    assert.equal(padded.offsetX, fixture.expected.offsetX); assert.equal(padded.offsetY, fixture.expected.offsetY)
  } finally { runtime.dispose() }
})

for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as LayerBlendMode[]) {
  test(`Traçado ${blendMode}: posições, cor/degradê/padrão e pares de alfa concordam byte a byte`, async () => {
    const width = 256, height = 256, source = new Uint8Array(width * height * 4), target = new Uint8Array(source.length)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      source.set([x, y, x ^ y, x ^ y], (y * width + x) * 4); target.set([x, 255 - y, x ^ y, x], (y * width + x) * 4)
    }
    const runtime = await createRustPixelPocRuntime(wasm), region = { x: 0, y: 0, width, height }
    try {
      const staged = runtime.stageSource(source, width, height, 1)
      for (const position of ['inside', 'center', 'outside']) for (const size of [1, 4, 7]) {
        const paints = [{ type: 'color', color: '#33669980' }, strokeGradient, { type: 'pattern', pattern: strokePatternAsset, angle: -77.75, scale: 137.5 }]
        for (const paint of paints) {
          const effect = strokeEffect({ blendMode, position, size, paint })
          assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, region, target, prepareRustStroke(effect, 1, strokePattern)).rgba,
            strokeReference(source, width, height, target, effect), `${position}/${size}/${paint.type}`)
        }
      }
    } finally { runtime.dispose() }
  })
}

test('Tiles de traçado preservam disco, erosão, pinturas globais e limites finos', async () => {
  const runtime = await createRustPixelPocRuntime(wasm); let generation = 0
  try {
    for (const [width, height] of [[37, 29], [1, 17], [19, 1], [1, 1]] as const) {
      const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
      const target = Uint8Array.from(source, (_, index) => index * 19 % 256)
      const staged = runtime.stageSource(source, width, height, ++generation)
      for (const position of ['inside', 'center', 'outside']) for (const size of [1, 4, 7]) {
        for (const paint of [strokeGradient, { type: 'pattern', pattern: strokePatternAsset, angle: -180, scale: 1 }]) {
          const effect = strokeEffect({ position, size, paint }), stroke = prepareRustStroke(effect, 1, strokePattern)
          const expected = strokeReference(source, width, height, target, effect)
          assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, stroke).rgba, expected)
          for (let y = 0; y < height; y += 5) for (let x = 0; x < width; x += 7) {
            const region = { x, y, width: Math.min(7, width - x), height: Math.min(5, height - y) }
            assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, region, gradientTile(target, width, region), stroke).rgba,
              gradientTile(expected, width, region), `${width}x${height}/${position}/${size}/${paint.type}/${x},${y}`)
          }
        }
      }
    }
  } finally { runtime.dispose() }
})

test('Traçado preserva círculo em alfa mínimo, pinturas espaciais e escalas extremas', async () => {
  const runtime = await createRustPixelPocRuntime(wasm), width = 13, height = 11, source = new Uint8Array(width * height * 4), target = new Uint8Array(source.length)
  source[(5 * width + 6) * 4 + 3] = 1
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const scale of [0.125, 1.375, 8]) for (const position of ['inside', 'center', 'outside']) for (const type of ['linear', 'reflected', 'diamond', 'radial', 'angle'] as const) {
      const effect = strokeEffect({ position, size: 1, paint: { ...strokeGradient, gradient: { ...strokeGradient.gradient, type } } })
      assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, prepareRustStroke(effect, scale)).rgba,
        strokeReference(source, width, height, target, effect, scale))
    }
    const solid = strokeEffect({ size: 1, opacity: 100, paint: { type: 'color', color: '#336699' } })
    const disk = runtime.strokeStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, prepareRustStroke(solid, 1)).rgba
    assert.equal(disk[(4 * width + 5) * 4 + 3], 0); assert.equal(disk[(4 * width + 6) * 4 + 3], 255)
    for (const position of ['inside', 'center', 'outside']) {
      const maximum = strokeEffect({ position, size: 250 })
      assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, prepareRustStroke(maximum, 8)).rgba,
        strokeReference(source, width, height, target, maximum, 8))
    }
    const empty = new Uint8Array(source.length), update = runtime.stageSource(empty, width, height, 2), maximum = strokeEffect({ size: 250 })
    assert.deepEqual(runtime.strokeStagedRegion(update.sourceId, { x: 0, y: 0, width, height }, target, prepareRustStroke(maximum, 8)).rgba,
      strokeReference(empty, width, height, target, maximum, 8))
  } finally { runtime.dispose() }
})

test('Traçado superior compõe após overlay com Fill zero, mantendo padding e origem de gradiente/padrão', async () => {
  const original = Uint8Array.from({ length: 7 * 11 * 4 }, (_, i) => i * 29 % 256), runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const paint of [strokeGradient, { type: 'pattern', pattern: strokePatternAsset, angle: 33.333, scale: 175.5 }]) {
      const effect = strokeEffect({ paint }), padded = paddedStrokeSource(original, 7, 11, effect)
      const staged = runtime.stageSource(padded.rgba, padded.width, padded.height, ++generation), region = { x: 0, y: 0, width: padded.width, height: padded.height }
      const overlay = { type: 'color-overlay', id: 'overlay', color: '#ee772280', opacity: 37.5, blendMode: 'screen' }
      const base = runtime.colorOverlayStagedRegion(staged.sourceId, region, new Uint8Array(padded.rgba.length), { color: [238, 119, 34, 128], opacity: 37.5, blendMode: 'screen' })
      const result = runtime.strokeStagedRegion(staged.sourceId, region, base.rgba, prepareRustStroke(effect, 1, strokePattern))
      const expected = composeLayerStyleRaster({ width: 7, height: 11, data: new Uint8ClampedArray(original) },
        normalizeLayerStyleConfig({ fillOpacity: 0, effects: [effect, overlay] }), { angle: 0, altitude: 30 }, 1, patternRasters())
      assert.deepEqual(result.rgba, new Uint8Array(expected.data)); assert.equal(padded.offsetX, expected.offsetX)
    }
  } finally { runtime.dispose() }
})

test('Padrão ausente mantém no-op, mas asset não decodificado é rejeitado; alfa zero preserva RGB oculto', async () => {
  const source = new Uint8Array([11, 22, 33, 101]), target = new Uint8Array([77, 88, 99, 0]), effect = strokeEffect({ paint: { type: 'pattern' } })
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, 1, 1, 1), region = { x: 0, y: 0, width: 1, height: 1 }
    assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, region, target, prepareRustStroke(effect, 1)).rgba, target)
    const unresolved = strokeEffect({ paint: { type: 'pattern', pattern: strokePatternAsset } })
    assert.throws(() => prepareRustStroke(unresolved, 1), RustPixelPocError)
    assert.throws(() => renderStroke(new Uint8ClampedArray(target), new Uint8ClampedArray([101]), 1, 1, unresolved, 1, undefined), LayerStylePatternMissingError)
    const transparent = strokeEffect({ paint: { type: 'color', color: '#33669900' } })
    assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, region, target, prepareRustStroke(transparent, 1)).rgba, target)
  } finally { runtime.dispose() }
})

test('Adapter traçado valida entradas e contabiliza máscaras, EDT, fila e textura antes de criar o pacote', () => {
  const effect = strokeEffect({ position: 'center', size: 16 }), before = structuredClone(effect), stroke = prepareRustStroke(effect, 1)
  assert.deepEqual(effect, before)
  const layout = strokeLayout(1024, 1024, { x: 0, y: 0, width: 1024, height: 1024 }, stroke, strokePacketLength(stroke))
  assert.equal(layout.workingBytes, 19 * 1024 * 1024 + 24 * 1024 + 64 + 8 + 96 + 2048)
  assert.throws(() => strokeLayout(4096, 4096, { x: 0, y: 0, width: 1024, height: 1024 }, { ...stroke, outsideRadius: 1024 }, 96),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
  assert.throws(() => strokeLayout(46341, 1, { x: 0, y: 0, width: 1, height: 1 }, stroke, 96), RustPixelPocError)
  for (const bad of [{ ...stroke, outsideRadius: -1 }, { ...stroke, insideRadius: 4097 }, { ...stroke, opacity: NaN },
    { ...stroke, paint: { type: 'pattern', pattern: strokePattern, angle: 180, scale: 100 } }]) assert.throws(() => encodeStroke(bad as typeof stroke))
  for (const scale of [0, NaN, Infinity, 8.001]) assert.throws(() => prepareRustStroke(effect, scale))
})

test('Traçado em tiles aleatórios preserva buracos, ilhas, máscaras vazias e disco distante das bordas', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let seed = 0x12345678
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  try {
    for (let generation = 1; generation <= 128; generation++) {
      const width = next() % 97 + 1, height = next() % 63 + 1, source = new Uint8Array(width * height * 4)
      for (let offset = 0; offset < source.length; offset += 4) {
        source.set([next() % 256, next() % 256, next() % 256, generation % 13 === 0 || next() % 5 > 0 ? 0 : next() % 255 + 1], offset)
      }
      const target = Uint8Array.from(source, (_, index) => index * 19 % 256)
      const x = next() % width, y = next() % height, region = { x, y, width: next() % (width - x) + 1, height: next() % (height - y) + 1 }
      const position = ['inside', 'center', 'outside'][generation % 3], scale = [0.125, 1.375, 8][generation % 3]!
      const effect = strokeEffect({ position, size: next() % 12 + 1, paint: generation % 2 ? strokeGradient
        : { type: 'pattern', pattern: strokePatternAsset, angle: 33.333, scale: 175.5 } })
      const staged = runtime.stageSource(source, width, height, generation), stroke = prepareRustStroke(effect, scale, strokePattern)
      assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, region, gradientTile(target, width, region), stroke).rgba,
        gradientTile(strokeReference(source, width, height, target, effect, scale), width, region), `job ${generation}`)
    }
  } finally { runtime.dispose() }
})

test('Traçado espacial preserva 32 paradas estreitas/duplicadas, alfa e reverse nos cinco tipos', async () => {
  const width = 13, height = 11, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? (i % 7 ? 101 : 0) : i * 29 % 256)
  const target = Uint8Array.from(source, (_, i) => i * 19 % 256), runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const type of ['linear', 'reflected', 'diamond', 'radial', 'angle'] as const) for (const reverse of [false, true]) {
      const effect = strokeEffect({ paint: { ...strokeGradient, reverse, gradient: { type,
        colorStops: Array.from({ length: 32 }, (_, i) => ({ position: 0.5 + Math.floor(i / 2) * 1e-14, color: i % 2 ? '#ee772200' : '#33669980' })),
        opacityStops: Array.from({ length: 32 }, (_, i) => ({ position: 0.5 + Math.floor(i / 2) * 1e-14, opacity: i % 2 ? 100 : 17.5 })) } } })
      const stroke = prepareRustStroke(effect, 1), expected = strokeReference(source, width, height, target, effect)
      for (const region of [{ x: 0, y: 0, width, height }, { x: 2, y: 3, width: 7, height: 5 }]) {
        assert.deepEqual(runtime.strokeStagedRegion(staged.sourceId, region, gradientTile(target, width, region), stroke).rgba,
          gradientTile(expected, width, region), `${type}/${reverse}`)
      }
    }
  } finally { runtime.dispose() }
})

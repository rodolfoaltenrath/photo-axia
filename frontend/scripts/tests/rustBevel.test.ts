import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeBevel, prepareRustBevel, bevelLayout } from '../../src/editor/rustPixelPocBevel.ts'
import { bevelEffect, bevelReference, bevelLight } from './support/rustBevelFixture.ts'
import { strokePattern, strokePatternAsset } from './support/rustStrokeFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import type { LayerBlendMode, LayerStyleContour } from '../../src/types/editor.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { layerStyleInsets } from '../../src/editor/layerStyleCompositor.ts'
import { prepareRustSatin } from '../../src/editor/rustPixelPocSatin.ts'
import { satinEffect } from './support/rustSatinFixture.ts'
import { prepareRustStroke } from '../../src/editor/rustPixelPocStroke.ts'
import { strokeEffect } from './support/rustStrokeFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const custom: LayerStyleContour = { preset: 'custom', points: [{ x: 0.25, y: 0.75 }, { x: 0.25, y: 0 }, { x: 0.75, y: 1 }] }
const techniques = ['smooth', 'chisel-hard', 'chisel-soft'] as const
const styles = ['inner-bevel', 'outer-bevel', 'emboss', 'pillow-emboss'] as const

test('Bisel Rust reproduz golden existente sem regenerar a expectativa', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((item: { id: string }) => item.id === 'bevel-edge')
  const config = normalizeLayerStyleConfig(fixture.styles), effect = config.effects[0]!
  assert.ok(effect.type === 'bevel-emboss')
  const source = new Uint8Array(fixture.source.rgba), { width, height } = fixture.source, runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    const target = runtime.renderStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, config.fillOpacity).rgba
    assert.deepEqual([...runtime.bevelStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target,
      prepareRustBevel(effect, fixture.globalLight, fixture.resolutionScale)).rgba], fixture.expected.rgba)
  } finally { runtime.dispose() }
})

test('Bisel preserva padding e ordem acetinado → overlay → bisel → traçado com Fill zero', async () => {
  const width = 7, height = 5, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 29 % 256)
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const style of styles) for (const scale of [0.5, 1, 1.375]) {
      const satin = satinEffect({ size: 2, distance: 1.5 }), bevel = bevelEffect({ style, size: 2, soften: 1 })
      const stroke = strokeEffect({ size: 1 }), overlay = { type: 'color-overlay', id: 'overlay', color: '#7799ee80', opacity: 73.5, blendMode: 'overlay' }
      const config = normalizeLayerStyleConfig({ fillOpacity: 0, effects: [satin, overlay, bevel, stroke] })
      const insets = layerStyleInsets(config, bevelLight, scale), fullWidth = width + insets.left + insets.right, fullHeight = height + insets.top + insets.bottom
      const padded = new Uint8Array(fullWidth * fullHeight * 4)
      for (let y = 0; y < height; y++) padded.set(source.subarray(y * width * 4, (y + 1) * width * 4), ((y + insets.top) * fullWidth + insets.left) * 4)
      const staged = runtime.stageSource(padded, fullWidth, fullHeight, ++generation), region = { x: 0, y: 0, width: fullWidth, height: fullHeight }
      let target = runtime.renderStagedRegion(staged.sourceId, region, 0).rgba
      target = runtime.satinStagedRegion(staged.sourceId, region, target, prepareRustSatin(satin, scale)).rgba
      target = runtime.colorOverlayStagedRegion(staged.sourceId, region, target, { color: [119, 153, 238, 128], opacity: 73.5, blendMode: 'overlay' }).rgba
      target = runtime.bevelStagedRegion(staged.sourceId, region, target, prepareRustBevel(bevel, bevelLight, scale)).rgba
      target = runtime.strokeStagedRegion(staged.sourceId, region, target, prepareRustStroke(stroke, scale)).rgba
      const expected = composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) }, config, bevelLight, scale)
      assert.equal(expected.width, fullWidth); assert.equal(expected.height, fullHeight)
      assert.equal(expected.offsetX, insets.left ? -insets.left : 0); assert.equal(expected.offsetY, insets.top ? -insets.top : 0)
      assert.deepEqual(target, new Uint8Array(expected.data), `${style}/${scale}`)
    }
  } finally { runtime.dispose() }
})

for (const mode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as LayerBlendMode[]) {
  test(`Bisel ${mode}: técnicas, estilos, direção e contornos concordam byte a byte`, async () => {
    const width = 64, height = 64, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 29 % 256)
    const target = Uint8Array.from(source, (_, i) => i * 19 % 256), runtime = await createRustPixelPocRuntime(wasm)
    try {
      const staged = runtime.stageSource(source, width, height, 1), region = { x: 0, y: 0, width, height }
      for (const technique of techniques) for (const style of styles) for (const direction of ['up', 'down'] as const) {
        for (const preset of ['linear', 'cone', 'inverted-cone', 'gaussian', 'ring', 'custom'] as const) {
          for (const contourEnabled of [false, true]) {
            const effect = bevelEffect({ highlightMode: mode, shadowMode: mode, technique, style, direction,
              glossContour: preset === 'custom' ? custom : { preset, points: [] }, contourEnabled, contour: custom, contourRange: 73.5 })
            assert.deepEqual(runtime.bevelStagedRegion(staged.sourceId, region, target, prepareRustBevel(effect, bevelLight, 1)).rgba,
              bevelReference(source, width, height, target, effect), `${technique}/${style}/${direction}/${preset}/${contourEnabled}`)
          }
        }
      }
    } finally { runtime.dispose() }
  })
}

test('Bisel em tiles preserva o halo da derivada e a origem global da textura', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const [width, height] of [[37, 29], [1, 17], [19, 1], [1, 1]] as const) {
      const source = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 29 % 256)
      const target = Uint8Array.from(source, (_, i) => i * 19 % 256), staged = runtime.stageSource(source, width, height, ++generation)
      for (const technique of techniques) for (const style of styles) for (const [size, soften] of [[0, 0], [1, 3], [4, 2]]) {
        for (const textureEnabled of [false, true]) {
          const effect = bevelEffect({ technique, style, size, soften, glossContour: custom, textureEnabled,
            texture: strokePatternAsset, textureScale: 137.5, textureDepth: 17.5, textureInvert: true })
          const bevel = prepareRustBevel(effect, bevelLight, 1, strokePattern)
          const expected = bevelReference(source, width, height, target, effect, bevelLight, 1, strokePattern)
          assert.deepEqual(runtime.bevelStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, target, bevel).rgba, expected)
          for (let y = 0; y < height; y += 5) for (let x = 0; x < width; x += 7) {
            const region = { x, y, width: Math.min(7, width - x), height: Math.min(5, height - y) }
            assert.deepEqual(runtime.bevelStagedRegion(staged.sourceId, region, gradientTile(target, width, region), bevel).rgba,
              gradientTile(expected, width, region), `${width}x${height}/${technique}/${style}/${size}/${soften}/${textureEnabled}/${x},${y}`)
          }
        }
      }
    }
  } finally { runtime.dispose() }
})

test('Bisel cobre todos os pares de alfa e tamanhos/escala extremos', async () => {
  const width = 256, height = 256, source = new Uint8Array(width * height * 4), target = new Uint8Array(source.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    source.set([x, y, x ^ y, x], i); target.set([255 - y, x, x ^ y, y], i)
  }
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1), region = { x: 0, y: 0, width, height }
    for (const technique of techniques) for (const style of styles) {
      const effect = bevelEffect({ technique, style, altitude: 0, angle: -180, useGlobalLight: false, size: 1, soften: 0,
        depth: 1000, highlightMode: 'overlay', shadowMode: 'screen' })
      assert.deepEqual(runtime.bevelStagedRegion(staged.sourceId, region, target, prepareRustBevel(effect, bevelLight, 1)).rgba,
        bevelReference(source, width, height, target, effect))
    }
    const smallSource = source.slice(0, 11 * 13 * 4), smallTarget = target.slice(0, smallSource.length)
    const small = runtime.stageSource(smallSource, 11, 13, 2), area = { x: 2, y: 3, width: 7, height: 5 }
    for (const scale of [0.125, 1.375, 8]) for (const technique of techniques) for (const size of [0, 5.25, 250]) {
      const effect = bevelEffect({ technique, size, soften: size, depth: 1, altitude: 90 })
      assert.deepEqual(runtime.bevelStagedRegion(small.sourceId, area, gradientTile(smallTarget, 11, area),
        prepareRustBevel(effect, bevelLight, scale)).rgba,
        gradientTile(bevelReference(smallSource, 11, 13, smallTarget, effect, bevelLight, scale), 11, area))
    }
  } finally { runtime.dispose() }
})

test('Textura modula RGB mesmo com alfa zero, respeitando profundidade e inversão', async () => {
  const source = Uint8Array.from({ length: 11 * 13 * 4 }, (_, i) => i * 29 % 256), target = source.slice()
  const transparent = { ...strokePattern, rgba: strokePattern.rgba.map((v, i) => i % 4 === 3 ? 0 : v) }
  const opaque = { ...strokePattern, rgba: strokePattern.rgba.map((v, i) => i % 4 === 3 ? 255 : v) }
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, 11, 13, 1), region = { x: 0, y: 0, width: 11, height: 13 }
    for (const textureDepth of [-1000, -17.5, 0, 17.5, 1000]) for (const textureScale of [1, 137.5, 1000]) for (const textureInvert of [false, true]) {
      const effect = bevelEffect({ textureEnabled: true, texture: strokePatternAsset, textureDepth, textureScale, textureInvert })
      const result = runtime.bevelStagedRegion(staged.sourceId, region, target, prepareRustBevel(effect, bevelLight, 1, transparent)).rgba
      assert.deepEqual(result, bevelReference(source, 11, 13, target, effect, bevelLight, 1, transparent))
      assert.deepEqual(result, runtime.bevelStagedRegion(staged.sourceId, region, target, prepareRustBevel(effect, bevelLight, 1, opaque)).rgba)
    }
    const onePixel = { rgba: new Uint8Array([255, 128, 0, 0]), width: 1, height: 1 }
    const effect = bevelEffect({ textureEnabled: true, texture: strokePatternAsset, textureDepth: 17.5 })
    const bevel = prepareRustBevel(effect, bevelLight, 1, onePixel)
    assert.equal(encodeBevel(bevel).length, 164)
    assert.deepEqual(runtime.bevelStagedRegion(staged.sourceId, region, target, bevel).rgba,
      bevelReference(source, 11, 13, target, effect, bevelLight, 1, onePixel))
  } finally { runtime.dispose() }
  assert.throws(() => prepareRustBevel(bevelEffect({ textureEnabled: true, texture: strokePatternAsset }), bevelLight, 1),
    (e: unknown) => e instanceof RustPixelPocError && e.code === 'invalid-input')
  for (const effect of [bevelEffect({ textureEnabled: true }), bevelEffect({ textureEnabled: false, texture: strokePatternAsset })]) {
    assert.equal(prepareRustBevel(effect, bevelLight, 1).texture, undefined)
  }
})

test('Luz global altera só ângulo; altitude, dot zero e RGB oculto seguem o renderizador atual', async () => {
  const effect = bevelEffect({ useGlobalLight: true })
  assert.deepEqual(prepareRustBevel(effect, { angle: 17, altitude: 0 }, 1), prepareRustBevel(effect, { angle: 17, altitude: 90 }, 1))
  assert.notDeepEqual(prepareRustBevel(effect, { angle: 17, altitude: 0 }, 1).light, prepareRustBevel(effect, { angle: 18, altitude: 0 }, 1).light)
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(new Uint8Array([0, 0, 0, 101]), 1, 1, 1), target = new Uint8Array([77, 88, 99, 0])
    const flat = bevelEffect({ altitude: 0, useGlobalLight: false, angle: 0, glossContour: { preset: 'custom', points: [{ x: 0, y: 1 }, { x: 1, y: 1 }] } })
    assert.deepEqual(runtime.bevelStagedRegion(staged.sourceId, { x: 0, y: 0, width: 1, height: 1 }, target, prepareRustBevel(flat, bevelLight, 1)).rgba, target)
  } finally { runtime.dispose() }
})

test('BEV1 aceita dois contornos máximos e rejeita dados inválidos antes de alocar', () => {
  const contour: LayerStyleContour = { preset: 'custom', points: Array.from({ length: 32 }, (_, i) => ({ x: i / 31, y: i % 2 })) }
  const bevel = prepareRustBevel(bevelEffect({ glossContour: contour, contour, contourEnabled: true }), bevelLight, 1)
  assert.equal(encodeBevel(bevel).length, 160 + 64 * 16)
  assert.equal(bevelLayout(37, 29, { x: 9, y: 12, width: 7, height: 5 }, bevel, 1184).halo, 7)
  for (const bad of [{ ...bevel, light: [1, 1, 1] }, { ...bevel, radius: 0 }, { ...bevel, softenRadius: 4097 },
    { ...bevel, strength: NaN }, { ...bevel, contourRange: 0 }, { ...bevel, glossContour: { preset: 'custom', points: [] } }]) {
    assert.throws(() => encodeBevel(bad as typeof bevel), (e: unknown) => e instanceof RustPixelPocError && e.code === 'invalid-input')
  }
  assert.throws(() => bevelLayout(4096, 4096, { x: 0, y: 0, width: 4096, height: 4096 }, bevel, 1184),
    (e: unknown) => e instanceof RustPixelPocError && e.code === 'memory-limit')
})

test('Bisel em máscaras esparsas e contornos estreitos não cria costuras nos tiles', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let seed = 0x13579bdf
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  const narrow: LayerStyleContour = { preset: 'custom', points: Array.from({ length: 32 }, (_, i) => ({
    x: 0.25 + Math.floor(i / 2) * 1e-12, y: i % 2 ? 0.75 : 0.25 })) }
  try {
    for (let job = 1; job <= 64; job++) {
      const width = 7 + next() % 47, height = 5 + next() % 31, source = new Uint8Array(width * height * 4)
      const target = Uint8Array.from({ length: source.length }, () => next() % 256)
      for (let i = 0; i < width * height; i++) if (job % 8 && next() % 5 === 0) source.set([73, 17, 99, next() % 256], i * 4)
      const effect = bevelEffect({ style: styles[job % 4]!, technique: techniques[job % 3]!, size: job % 7, soften: job % 4,
        direction: job % 2 ? 'up' : 'down', altitude: job % 3 ? 0 : 90, depth: job % 2 ? 1 : 1000,
        glossContour: narrow, contour: narrow, contourEnabled: true, contourRange: job % 2 ? 1 : 100,
        textureEnabled: job % 2 === 0, texture: strokePatternAsset, textureDepth: 17.5, textureScale: 137.5 })
      const scale = [0.125, 1.375, 8][job % 3]!, bevel = prepareRustBevel(effect, bevelLight, scale, strokePattern)
      const expected = bevelReference(source, width, height, target, effect, bevelLight, scale, strokePattern)
      const staged = runtime.stageSource(source, width, height, job), x = next() % width, y = next() % height
      const region = { x, y, width: 1 + next() % (width - x), height: 1 + next() % (height - y) }
      assert.deepEqual(runtime.bevelStagedRegion(staged.sourceId, region, gradientTile(target, width, region), bevel).rgba,
        gradientTile(expected, width, region), `job ${job}`)
    }
  } finally { runtime.dispose() }
})

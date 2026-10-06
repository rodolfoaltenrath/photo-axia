import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { RustPixelPocError } from '../../src/editor/rustPixelPocError.ts'
import { describeRustStyleSource, padRustStyleSource, prepareRustStyleJob, prepareRustStyleSourceLayout } from '../../src/editor/rustPixelPocStylePreparation.ts'
import { combinedStages, stagesFixture } from './support/rustStagesFixture.ts'
import { strokePattern, strokePatternAsset } from './support/rustStrokeFixture.ts'

const light = { angle: 123.5, altitude: 48 }
const patterns = new Map([[strokePatternAsset.id, strokePattern]])
const base = { sourceIdentity: 'image:revision-1', sourceWidth: 17, sourceHeight: 13, styles: combinedStages(), globalLight: light, patterns }
const code = (expected: RustPixelPocError['code']) => (e: unknown) => e instanceof RustPixelPocError && e.code === expected

test('Preparação usa normalização/insets reais, preserva RGB oculto e não empresta buffer do editor', () => {
  const data = Uint8ClampedArray.from({ length: 17 * 13 * 4 }, (_, i) => i * 29 % 256), original = data.slice()
  for (const scale of [0.5, 1, 1.375, 8, NaN, 0, -2, 10]) {
    const job = prepareRustStyleJob({ ...base, resolutionScale: scale })
    const padded = padRustStyleSource({ width: 17, height: 13, data }, job)
    const oracle = stagesFixture(new Uint8Array(data), 17, 13, base.styles, light, job.scale, patterns)
    assert.deepEqual(padded, oracle.rgba)
    assert.equal(job.width, oracle.width); assert.equal(job.height, oracle.height)
    assert.equal(job.offsetX, oracle.expected.offsetX); assert.equal(job.offsetY, oracle.expected.offsetY)
    assert.notEqual(padded.buffer, data.buffer)
    assert.equal(job.preparationBytes, data.byteLength + 2 * padded.byteLength)
    const transferred = structuredClone(padded, { transfer: [padded.buffer] })
    assert.equal(padded.byteLength, 0); assert.ok(transferred.byteLength > 0)
    assert.deepEqual(data, original)
  }
  const disabled = prepareRustStyleJob({ ...base, styles: normalizeLayerStyleConfig({ ...base.styles, enabled: false }) })
  assert.deepEqual(disabled.insets, { top: 0, right: 0, bottom: 0, left: 0 })
})

test('Chave exata reusa máscara por aparência e muda por conteúdo, qualidade, escala e geometria', () => {
  const key = prepareRustStyleJob(base).sourceKey
  const recolored = normalizeLayerStyleConfig({ ...base.styles, fillOpacity: 0,
    effects: base.styles.effects.map(effect => effect.type === 'color-overlay' ? { ...effect, color: '#abcdef' } : effect) })
  assert.equal(prepareRustStyleJob({ ...base, styles: recolored }).sourceKey, key)
  const otherPixels = new Map([[strokePatternAsset.id, { ...strokePattern, rgba: strokePattern.rgba.slice().fill(17) }]])
  assert.equal(prepareRustStyleJob({ ...base, patterns: otherPixels }).sourceKey, key)
  for (const change of [{ sourceIdentity: 'image:revision-2' }, { quality: 'interactive' as const },
    { sourceWidth: 18 }, { sourceHeight: 14 }, { resolutionScale: 1.00001 },
    { globalLight: { angle: 0, altitude: 48 } }]) assert.notEqual(prepareRustStyleJob({ ...base, ...change }).sourceKey, key)
  assert.notEqual(prepareRustStyleJob({ ...base, sourceIdentity: 'a|b' }).sourceKey,
    prepareRustStyleJob({ ...base, sourceIdentity: 'a', quality: 'interactive' }).sourceKey)
})

test('Preflight rejeita dimensões, região, assets e orçamento antes do padding', () => {
  for (const change of [{ sourceIdentity: '' }, { sourceWidth: 0 }, { sourceHeight: 1.5 },
    { region: { x: -1, y: 0, width: 1, height: 1 } }, { region: { x: 0, y: 0, width: 999, height: 1 } }]) {
    assert.throws(() => prepareRustStyleJob({ ...base, ...change }), code('invalid-input'))
  }
  assert.throws(() => prepareRustStyleJob({ ...base, patterns: new Map() }), code('invalid-input'))
  assert.throws(() => prepareRustStyleJob({ ...base, sourceWidth: Number.MAX_SAFE_INTEGER }), code('memory-limit'))
  const plain = { ...base, styles: normalizeLayerStyleConfig({}), sourceWidth: 3000, sourceHeight: 3000,
    region: { x: 0, y: 0, width: 1, height: 1 } }
  assert.throws(() => prepareRustStyleJob(plain), code('memory-limit'))
  const job = prepareRustStyleJob(base)
  for (const source of [{ width: 16, height: 13, data: new Uint8ClampedArray(16 * 13 * 4) },
    { width: 17, height: 13, data: new Uint8ClampedArray(1) }]) assert.throws(() => padRustStyleSource(source, job), code('invalid-input'))
  const tiled = prepareRustStyleJob({ ...base, region: { x: 1, y: 2, width: 3, height: 4 } })
  assert.deepEqual(tiled.region, { x: 1, y: 2, width: 3, height: 4 })
  assert.ok(tiled.workingBytes < job.workingBytes)
})

test('Descrição enviada ao Worker preserva margens sem copiar texturas, degradês ou URLs de assets', () => {
  const asset = { ...strokePatternAsset, sourceUrl: `data:image/png;base64,${'A'.repeat(20_000)}` }
  const styles = normalizeLayerStyleConfig({ ...base.styles, effects: base.styles.effects.map(effect => {
    if (effect.type === 'bevel-emboss') return { ...effect, texture: asset, style: 'outer' }
    if (effect.type === 'stroke') return { ...effect, position: 'outside', paint: { type: 'pattern', pattern: asset, scale: 100, angle: 0 } }
    if (effect.type === 'pattern-overlay') return { ...effect, pattern: asset }
    return effect
  }) })
  for (const scale of [0.5, 1, 1.375, 8]) for (const enabled of [true, false]) {
    const job = prepareRustStyleJob({ ...base, styles: { ...styles, enabled }, resolutionScale: scale })
    const description = describeRustStyleSource(job), prepared = prepareRustStyleSourceLayout(description)
    assert.equal(prepared.sourceKey, job.sourceKey); assert.deepEqual(prepared.insets, job.insets)
    assert.equal(JSON.stringify(description).includes('data:image'), false)
    assert.equal(description.styles.effects.some(effect => effect.type === 'pattern-overlay' || effect.type === 'gradient-overlay'), false)
    for (const effect of description.styles.effects) {
      if (effect.type === 'bevel-emboss') assert.equal(effect.texture, undefined)
      if (effect.type === 'stroke') assert.equal(effect.paint.type, 'color')
    }
  }
})

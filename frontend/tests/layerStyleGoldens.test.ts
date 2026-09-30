import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { applyLayerStyleBlendIfUnderlying, composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import type { LayerEffectType, LayerStyleGlobalLight } from '../src/types/editor.ts'

interface PatternGolden { id: string; width: number; height: number; rgba: number[] }

interface RasterGolden {
  id: string
  source: { width: number; height: number; rgba: number[] }
  styles: unknown
  globalLight: LayerStyleGlobalLight
  resolutionScale: number
  patterns?: PatternGolden[]
  expected: { width: number; height: number; offsetX: number; offsetY: number; rgba: number[] }
}

interface UnderlyingGolden {
  id: string
  rgba: number[]
  backdrop: number[]
  styles: unknown
  expected: { rgba: number[] }
}

const goldens = JSON.parse(readFileSync(
  new URL('./fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'
)) as { schemaVersion: number; rasterCases: RasterGolden[]; underlyingCases: UnderlyingGolden[] }

test('golden RGBA tem versão de contrato conhecida e dimensões válidas', () => {
  assert.equal(goldens.schemaVersion, 1)
  assert.ok(goldens.rasterCases.length > 0)
  const ids = new Set<string>()
  for (const item of goldens.rasterCases) {
    assert.equal(ids.has(item.id), false, `id duplicado: ${item.id}`)
    ids.add(item.id)
    assert.ok(item.source.width > 0 && item.source.height > 0, item.id)
    assert.ok(item.expected.width > 0 && item.expected.height > 0, item.id)
    assert.equal(item.source.rgba.length, item.source.width * item.source.height * 4, item.id)
    assert.equal(item.expected.rgba.length, item.expected.width * item.expected.height * 4, item.id)
    for (const byte of [...item.source.rgba, ...item.expected.rgba]) {
      assert.ok(Number.isInteger(byte) && byte >= 0 && byte <= 255, item.id)
    }
    for (const pattern of item.patterns ?? []) {
      assert.ok(pattern.width > 0 && pattern.height > 0, `${item.id}:${pattern.id}`)
      assert.equal(pattern.rgba.length, pattern.width * pattern.height * 4, `${item.id}:${pattern.id}`)
    }
  }
  for (const item of goldens.underlyingCases) {
    assert.equal(ids.has(item.id), false, `id duplicado: ${item.id}`)
    ids.add(item.id)
    assert.equal(item.rgba.length, item.backdrop.length, item.id)
    assert.equal(item.rgba.length, item.expected.rgba.length, item.id)
  }
})

test('golden RGBA cobre todos os tipos atuais de efeito', () => {
  const types = new Set(goldens.rasterCases.flatMap((item) =>
    normalizeLayerStyleConfig(item.styles).effects.map((effect) => effect.type)
  ))
  const required = {
    'drop-shadow': true, 'inner-shadow': true, 'outer-glow': true, 'inner-glow': true,
    stroke: true, 'color-overlay': true, 'gradient-overlay': true,
    'pattern-overlay': true, satin: true, 'bevel-emboss': true
  } satisfies Record<LayerEffectType, true>
  assert.deepEqual([...types].sort(), Object.keys(required).sort())
})

for (const item of goldens.rasterCases) {
  test(`golden RGBA: ${item.id}`, () => {
    const source = {
      width: item.source.width,
      height: item.source.height,
      data: new Uint8ClampedArray(item.source.rgba)
    }
    const result = composeLayerStyleRaster(
      source, normalizeLayerStyleConfig(item.styles), item.globalLight, item.resolutionScale,
      new Map((item.patterns ?? []).map((pattern) => [pattern.id, {
        width: pattern.width, height: pattern.height, data: new Uint8ClampedArray(pattern.rgba)
      }]))
    )
    assert.deepEqual({
      width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY,
      rgba: [...result.data]
    }, item.expected)
    assert.deepEqual([...source.data], item.source.rgba, 'composição não modifica a fonte')
  })
}

for (const item of goldens.underlyingCases) {
  test(`golden RGBA: ${item.id}`, () => {
    const data = new Uint8ClampedArray(item.rgba)
    const backdrop = new Uint8ClampedArray(item.backdrop)
    applyLayerStyleBlendIfUnderlying(data, backdrop, normalizeLayerStyleConfig(item.styles))
    assert.deepEqual([...data], item.expected.rgba)
    assert.deepEqual([...backdrop], item.backdrop, 'Blend If não modifica o backdrop')
  })
}

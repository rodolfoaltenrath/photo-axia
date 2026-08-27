import assert from 'node:assert/strict'
import test from 'node:test'
import { createGradientInterpolator } from '../src/editor/gradient.ts'
import {
  createGradientToolConfig,
  syncSimpleGradientColors
} from '../src/editor/gradientToolState.ts'
import { threeStopTransparentGradientFixture } from './gradientStops.fixtures.mjs'

test('preset simples nasce equivalente ao contrato antigo de duas cores', () => {
  const canonical = createGradientToolConfig('#123456', '#abcdef', 'radial')
  const legacy = {
    type: 'radial',
    foregroundColor: '#123456',
    backgroundColor: '#abcdef',
    reversed: false
  }
  const canonicalPixels = [0, 0.25, 0.5, 0.75, 1].map(createGradientInterpolator(canonical))
  const legacyPixels = [0, 0.25, 0.5, 0.75, 1].map(createGradientInterpolator(legacy))
  assert.deepEqual(canonicalPixels, legacyPixels)
})

test('cores globais atualizam somente o preset simples e preservam tipo e inversão', () => {
  const original = { ...createGradientToolConfig('#000000', '#ffffff'), type: 'radial', reversed: true }
  const synced = syncSimpleGradientColors(original, '#112233', '#aabbcc')
  assert.deepEqual(synced.colorStops.map((stop) => stop.color), ['#112233', '#aabbcc'])
  assert.equal(synced.type, 'radial')
  assert.equal(synced.reversed, true)
})

test('composição personalizada não é sobrescrita pelas cores globais', () => {
  const synced = syncSimpleGradientColors(threeStopTransparentGradientFixture, '#111111', '#eeeeee')
  assert.equal(synced, threeStopTransparentGradientFixture)
})

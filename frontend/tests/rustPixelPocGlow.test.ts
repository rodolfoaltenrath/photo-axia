import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeGlow, prepareRustGlow, glowLayout } from '../src/editor/rustPixelPocGlow.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'
import { normalizeLayerEffect } from '../src/editor/layerStyles.ts'

function effect(type: 'inner-glow' | 'outer-glow' = 'outer-glow') {
  const effect = normalizeLayerEffect({ type, id: 'glow-😀-中文', size: 5.25, spread: 37.5, choke: 73.5,
    technique: 'precise', paint: { type: 'color', color: '#33669980' }, opacity: 73.5, range: 17.5 })
  assert.ok(effect?.type === type && (effect.type === 'outer-glow' || effect.type === 'inner-glow'))
  return effect
}

test('Brilho resolve escala, expansão/contração e seed UTF-16 sem mutar o efeito', () => {
  const original = effect(), before = structuredClone(original), glow = prepareRustGlow(original, 2)
  assert.equal(glow.kind, 'outer'); assert.equal(glow.spreadRadius, 4); assert.equal(glow.blurRadius, 7)
  assert.equal(glow.choke, 0); assert.equal(glow.precise, true)
  assert.deepEqual(glow.paint, { type: 'color', color: [51, 102, 153, 128] })
  let seed = 0x811c9dc5
  for (let i = 0; i < original.id.length; i++) seed = Math.imul(seed ^ original.id.charCodeAt(i), 0x01000193)
  assert.equal(glow.seed, seed >>> 0); assert.deepEqual(original, before)
  const inner = effect('inner-glow'); assert.ok(inner.type === 'inner-glow')
  const center = prepareRustGlow({ ...inner, source: 'center' }, 2)
  assert.equal(center.kind, 'inner-center'); assert.equal(center.spreadRadius, 0)
  assert.equal(center.blurRadius, 11); assert.equal(center.choke, 73.5)
})

test('GLW1 fixa campos f64, contorno e paint sólido sem payload de gradiente', () => {
  const glow = prepareRustGlow(effect(), 1)
  glow.contour = { preset: 'custom', points: [{ x: 0.25, y: 0.5 }, { x: 0.25, y: 1 }, { x: 0.75, y: 0 }] }
  const packet = encodeGlow(glow), view = new DataView(packet.buffer)
  assert.equal(packet.length, 144); assert.equal(view.getUint32(0, true), 0x31574c47)
  assert.equal(view.getUint32(44, true), 3); assert.equal(view.getUint32(48, true), 0)
  assert.equal(view.getFloat64(56, true), 73.5); assert.equal(view.getFloat64(72, true), 17.5)
  assert.equal(view.getFloat64(96, true), 0.25); assert.equal(view.getFloat64(120, true), 1)
})

test('Brilho rejeita kind, reservas, booleanos, limites e gradientes inválidos', () => {
  const glow = prepareRustGlow(effect(), 1)
  for (const bad of [{ ...glow, kind: 'other' }, { ...glow, choke: 1 }, { ...glow, range: 0 },
    { ...glow, jitter: NaN }, { ...glow, precise: 1 }, { ...glow, spreadRadius: 4096, blurRadius: 1 },
    { ...glow, kind: 'inner-edge', spreadRadius: 1 }, { ...glow, paint: { type: 'pattern' } },
    { ...glow, paint: { type: 'gradient', reverse: false, gradient: { type: 'linear', colorStops: [], opacityStops: [] } } }]) {
    assert.throws(() => encodeGlow(bad as typeof glow),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input')
  }
  for (const scale of [0, NaN, 8.01]) assert.throws(() => prepareRustGlow(effect(), scale))
})

test('Brilho limita orçamento incluindo metadados, pacote, target e fila de spread', () => {
  const glow = prepareRustGlow(effect(), 1)
  assert.equal(glowLayout(10, 10, { x: 0, y: 0, width: 10, height: 10 }, glow, 96).workingBytes,
    400 + 400 + 400 + 200 + 40 + 96 + 2048)
  assert.throws(() => glowLayout(4096, 4096, { x: 0, y: 0, width: 1024, height: 4096 },
    { ...glow, spreadRadius: 0, blurRadius: 0 }, 96),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
})

test('Degradê do brilho serializa reverse e paradas; não é um gradiente espacial', () => {
  const value = effect(); value.paint = { type: 'gradient', angle: 77.75, scale: 137.5, reverse: true, alignWithLayer: true,
    gradient: { type: 'radial', interpolation: 'srgb', colorStops: [{ position: 0.25, color: '#33669980' }, { position: 0.75, color: '#ee7722ff' }],
      opacityStops: [{ position: 0.125, opacity: 73.5 }, { position: 0.625, opacity: 17.5 }] } }
  const glow = prepareRustGlow(value, 1), packet = encodeGlow(glow), view = new DataView(packet.buffer)
  assert.equal(packet.length, 160); assert.equal(view.getUint32(28, true), 2)
  assert.equal(view.getUint32(48, true), 2); assert.equal(view.getUint32(52, true), 2)
  assert.equal(view.getFloat64(96, true), 0.25); assert.deepEqual([...packet.subarray(104, 108)], [51, 102, 153, 128])
  const edited = structuredClone(value); assert.ok(edited.paint.type === 'gradient')
  edited.paint.angle = -120; edited.paint.scale = 500; edited.paint.gradient.type = 'diamond'; edited.paint.alignWithLayer = false
  assert.deepEqual(encodeGlow(prepareRustGlow(edited, 1)), packet)
})

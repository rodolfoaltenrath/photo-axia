import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeInnerShadow, prepareRustInnerShadow, innerShadowLayout } from '../src/editor/rustPixelPocInnerShadow.ts'
import { prepareRustDropShadow } from '../src/editor/rustPixelPocDropShadow.ts'
import { normalizeLayerEffect } from '../src/editor/layerStyles.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'

function effect() {
  const effect = normalizeLayerEffect({ type: 'inner-shadow', id: 'inner-😀-中文', size: 5.25,
    distance: 0.5, angle: 0, useGlobalLight: false, choke: 37.5, color: '#33669980', opacity: 73.5, noise: 37.5 })
  assert.ok(effect?.type === 'inner-shadow')
  return effect
}

test('Sombra interna resolve direção antes do arredondamento, luz e hash UTF-16', () => {
  const source = effect(), before = structuredClone(source), light = { angle: -90, altitude: 30 }
  const shadow = prepareRustInnerShadow(source, light, 1)
  assert.equal(shadow.blurRadius, 5); assert.equal(shadow.offsetX, 1); assert.equal(Math.abs(shadow.offsetY), 0)
  const external = normalizeLayerEffect({ ...source, type: 'drop-shadow', spread: 0, layerKnocksOutShadow: false })
  assert.ok(external?.type === 'drop-shadow')
  // Math.round(-0.5) is not -Math.round(0.5).
  assert.equal(Math.abs(prepareRustDropShadow(external, light, 1).offsetX), 0)
  const global = prepareRustInnerShadow({ ...source, useGlobalLight: true }, light, 2)
  assert.equal(global.offsetY, 1); assert.equal(global.blurRadius, 11)
  assert.deepEqual(shadow.color, [51, 102, 153, 128]); assert.equal(shadow.choke, 37.5)
  let seed = 0x811c9dc5
  for (let index = 0; index < source.id.length; index++) seed = Math.imul(seed ^ source.id.charCodeAt(index), 0x01000193)
  assert.equal(shadow.seed, seed >>> 0); assert.deepEqual(source, before)
})

test('Pacote interno distingue SHI1, guarda choke f64 e desloca pontos para byte 72', () => {
  const shadow = prepareRustInnerShadow(effect(), { angle: 0, altitude: 30 }, 1)
  shadow.contour = { preset: 'custom', points: [{ x: 0.25, y: 0.5 }, { x: 0.25, y: 1 }, { x: 0.75, y: 0 }] }
  const packet = encodeInnerShadow(shadow), view = new DataView(packet.buffer)
  assert.equal(packet.length, 120); assert.equal(view.getUint32(0, true), 0x31494853)
  assert.equal(view.getUint32(8, true), 0); assert.equal(view.getUint32(28, true), 0)
  assert.equal(view.getFloat64(64, true), 37.5); assert.equal(view.getFloat64(72, true), 0.25)
  assert.equal(view.getFloat64(96, true), 1)
})

test('Sombra interna rejeita choke inválido, limites e pontos sem normalização silenciosa', () => {
  const shadow = prepareRustInnerShadow(effect(), { angle: 0, altitude: 30 }, 1)
  for (const bad of [{ ...shadow, choke: NaN }, { ...shadow, choke: -1 }, { ...shadow, choke: 100.01 },
    { ...shadow, blurRadius: 4097 }, { ...shadow, offsetY: -8193 }, { ...shadow, noise: Infinity },
    { ...shadow, contour: { preset: 'custom', points: new Array(2) } }]) {
    assert.throws(() => encodeInnerShadow(bad as typeof shadow),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input')
  }
  for (const scale of [0, NaN, 8.01]) assert.throws(() => prepareRustInnerShadow(effect(), { angle: 0, altitude: 30 }, scale))
})

test('Orçamento interno inclui target, pacote e duas máscaras, sem fila de expansão', () => {
  const shadow = prepareRustInnerShadow(effect(), { angle: 0, altitude: 30 }, 1)
  assert.equal(innerShadowLayout(10, 10, { x: 0, y: 0, width: 10, height: 10 }, shadow, 72).workingBytes,
    400 + 400 + 400 + 200 + 72 + 512)
  assert.throws(() => innerShadowLayout(4096, 4096, { x: 0, y: 0, width: 1024, height: 4096 },
    { ...shadow, blurRadius: 0 }, 72), (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
  assert.throws(() => innerShadowLayout(10, 10, { x: 0, y: 0, width: 1, height: 1 }, shadow, 64))
})

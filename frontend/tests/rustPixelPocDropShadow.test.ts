import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeDropShadow, prepareRustDropShadow, dropShadowLayout } from '../src/editor/rustPixelPocDropShadow.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'
import { normalizeLayerEffect } from '../src/editor/layerStyles.ts'

function effect() {
  const value = normalizeLayerEffect({ type: 'drop-shadow', id: 'shadow-😀-中文', size: 5.25,
    spread: 37.5, distance: 10, angle: 0, useGlobalLight: false, color: '#33669980', opacity: 73.5, noise: 37.5 })
  assert.ok(value?.type === 'drop-shadow')
  return value
}

test('Sombra resolve luz/escala, arredondamento e hash UTF-16 sem alterar efeito', () => {
  const source = effect(), before = structuredClone(source), shadow = prepareRustDropShadow(source, { angle: 90, altitude: 30 }, 2)
  assert.equal(shadow.spreadRadius, 4); assert.equal(shadow.blurRadius, 7)
  assert.equal(shadow.offsetX, -20); assert.equal(shadow.offsetY, 0)
  assert.deepEqual(shadow.color, [51, 102, 153, 128])
  let seed = 0x811c9dc5
  for (let index = 0; index < source.id.length; index++) seed = Math.imul(seed ^ source.id.charCodeAt(index), 0x01000193)
  assert.equal(shadow.seed, seed >>> 0)
  const global = prepareRustDropShadow({ ...source, useGlobalLight: true }, { angle: 90, altitude: 30 }, 2)
  assert.equal(Math.abs(global.offsetX), 0); assert.equal(global.offsetY, 20)
  assert.deepEqual(source, before)
})

test('Pacote sombra fixa campos e pontos personalizados com precisão f64', () => {
  const shadow = prepareRustDropShadow(effect(), { angle: 0, altitude: 30 }, 1)
  shadow.contour = { preset: 'custom', points: [{ x: 0.25, y: 0.5 }, { x: 0.25, y: 1 }, { x: 0.75, y: 0 }] }
  const packet = encodeDropShadow(shadow), view = new DataView(packet.buffer)
  assert.equal(packet.length, 112); assert.equal(view.getUint32(0, true), 0x31444853); assert.equal(view.getUint32(4, true), 1)
  assert.equal(view.getInt32(16, true), -10); assert.equal(view.getUint32(36, true), 5); assert.equal(view.getUint32(44, true), 3)
  assert.equal(view.getFloat64(48, true), 73.5); assert.equal(view.getFloat64(56, true), 37.5)
  assert.equal(view.getFloat64(80, true), 0.25); assert.equal(view.getFloat64(88, true), 1)
})

test('Sombra rejeita parâmetros e contornos inválidos sem normalização silenciosa', () => {
  const shadow = prepareRustDropShadow(effect(), { angle: 0, altitude: 30 }, 1)
  for (const bad of [{ ...shadow, noise: NaN }, { ...shadow, opacity: 101 }, { ...shadow, offsetX: 8193 },
    { ...shadow, seed: -1 }, { ...shadow, spreadRadius: 0.5 }, { ...shadow, spreadRadius: 4096, blurRadius: 1 },
    { ...shadow, knockout: 1 }, { ...shadow, contour: { preset: 'custom', points: new Array(2) } },
    { ...shadow, contour: { preset: 'custom', points: [{ x: 1, y: 0 }, { x: 0, y: 1 }] } }]) {
    assert.throws(() => encodeDropShadow(bad as typeof shadow),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input')
  }
  for (const scale of [0, 8.01, NaN]) assert.throws(() => prepareRustDropShadow(effect(), { angle: 0, altitude: 30 }, scale))
})

test('Orçamento da sombra soma target, pacote e reserva de contorno aos buffers do contexto', () => {
  const shadow = prepareRustDropShadow(effect(), { angle: 0, altitude: 30 }, 1), packet = encodeDropShadow(shadow)
  const layout = dropShadowLayout(10, 10, { x: 0, y: 0, width: 10, height: 10 }, shadow, packet.length)
  assert.equal(layout.workingBytes, 400 + 400 + 400 + 200 + 40 + 64 + 512)
  assert.throws(() => dropShadowLayout(4096, 4096, { x: 0, y: 0, width: 1024, height: 4096 },
    { ...shadow, spreadRadius: 0, blurRadius: 0 }, 64),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
})

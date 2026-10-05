import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeLocalBatch, type RustPixelPocBatchPlan } from '../src/editor/rustPixelPocBatch.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'

test('Pacote de lote fixa versão, cabeçalho, fill fracionário e filtro terminal', () => {
  const plan: RustPixelPocBatchPlan = { fillOpacity: 37.5, effects: [],
    thisLayerBlendIf: { channel: 'blue', shadows: [10, 70], highlights: [180, 240] } }
  const packet = encodeLocalBatch(plan, 4, 4), view = new DataView(packet.buffer)
  assert.equal(packet.length, 32)
  assert.equal(view.getUint32(0, true), 0x31425841)
  assert.equal(view.getUint32(4, true), 1)
  assert.equal(view.getUint32(8, true), 0)
  assert.deepEqual([...packet.slice(12, 16)], [10, 70, 180, 240])
  assert.equal(view.getFloat64(16, true), 37.5)
  assert.equal(view.getUint32(24, true), 1)
  assert.equal(view.getUint32(28, true), 3)
})

test('Pacote preserva ordem de overlays e alinha payload do padrão sem ponteiros internos', () => {
  const plan: RustPixelPocBatchPlan = { fillOpacity: 0, effects: [
    { type: 'pattern-overlay', effect: { angle: 0, scale: 100, opacity: 50, blendMode: 'normal' },
      pattern: { width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 4]) } },
    { type: 'color-overlay', effect: { color: [10, 20, 30, 40], opacity: 73.5, blendMode: 'screen' } }
  ] }
  const before = structuredClone(plan), packet = encodeLocalBatch(plan, 4, 4), view = new DataView(packet.buffer)
  assert.equal(view.getUint32(32, true), 3)
  assert.equal(view.getUint32(128, true), 1)
  assert.equal(view.getUint32(132, true), 2)
  assert.deepEqual([...packet.slice(180, 184)], [10, 20, 30, 40])
  assert.equal(view.getUint32(88, true), 224)
  assert.equal(view.getUint32(92, true), 4)
  assert.deepEqual([...packet.slice(224)], [1, 2, 3, 4, 0, 0, 0, 0])
  assert.deepEqual(plan, before)
})

test('Pacote recusa efeitos desconhecidos, listas esparsas e filtro fora de ordem', () => {
  for (const plan of [{ fillOpacity: 100, effects: new Array(2) },
    { fillOpacity: 100, effects: [{ type: 'constructor', effect: { opacity: 100, blendMode: 'normal' } }] },
    { fillOpacity: 100, effects: [], thisLayerBlendIf: { channel: 'red', shadows: [50, 0], highlights: [255, 255] } }]) {
    assert.throws(() => encodeLocalBatch(plan as RustPixelPocBatchPlan, 4, 4),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input')
  }
})

test('Orçamento do lote inclui fonte, saída, scratch e metadados antes do pacote', () => {
  const plan: RustPixelPocBatchPlan = { fillOpacity: 100, effects: [],
    thisLayerBlendIf: { channel: 'gray', shadows: [0, 0], highlights: [255, 255] } }
  assert.equal(encodeLocalBatch(plan, 64 * 1024 * 1024, 10 * 1024 * 1024).byteLength, 32)
  assert.throws(() => encodeLocalBatch(plan, 64 * 1024 * 1024, 11 * 1024 * 1024),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
})

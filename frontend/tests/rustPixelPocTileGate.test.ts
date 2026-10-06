import assert from 'node:assert/strict'
import test from 'node:test'
import { RustPixelPocTileGate } from '../src/editor/rustPixelPocTileGate.ts'
import type { RustPixelPocResponse } from '../src/editor/rustPixelPocProtocol.ts'

const timings = { allocationMs: 0, copyInMs: 0, kernelMs: 0, copyOutMs: 0, releaseMs: 0 }

test('gate exige formato pedido e aplica a mesma invalidação a PNG e RGBA', () => {
  const gate = new RustPixelPocTileGate()
  gate.beginSourceChange(); assert.equal(gate.adoptSource(staged(1, 7, 1)), true)
  const png: RustPixelPocResponse = { type: 'encoded-staged-region', id: 2, sourceId: 7, generation: 1,
    width: 1, height: 1, blob: new Blob(['fixture'], { type: 'image/png' }), timings,
    encoding: { canvasUploadMs: 0, pngEncodeMs: 0 } }
  const raw = gate.captureTile('style', 2)
  assert.ok(raw); assert.equal(raw.isCurrent(png), false)
  const encoded = gate.captureTile('style', 2, 'encoded-staged-region')
  assert.ok(encoded); assert.equal(encoded.isCurrent(png), true)
  assert.equal(encoded.isCurrent(tile(2, 7, 1)), false)
  assert.equal(raw.isCurrent(tile(2, 7, 1)), false)
  gate.beginViewChange(); assert.equal(encoded.isCurrent(png), false)
  const current = gate.captureTile('style', 2, 'encoded-staged-region')
  assert.ok(current); assert.equal(current.isCurrent(png), true)
  gate.beginSourceChange(); assert.equal(current.isCurrent(png), false)
})
function staged(id: number, sourceId: number, generation: number):
  Extract<RustPixelPocResponse, { type: 'source-staged' }> {
  return { type: 'source-staged', id, sourceId, generation, stagingMs: 0 }
}
function tile(id: number, sourceId: number, generation: number): RustPixelPocResponse {
  return { type: 'rendered-staged-region', id, sourceId, generation,
    rgba: new ArrayBuffer(4), width: 1, height: 1, timings }
}

test('aceita apenas tiles da fonte e geração atuais', () => {
  const gate = new RustPixelPocTileGate()
  assert.equal(gate.captureTile('0,0', 3), null)
  assert.equal(gate.beginSourceChange(), 1)
  assert.equal(gate.adoptSource(staged(1, 10, 0)), false)
  assert.equal(gate.adoptSource(staged(2, 10, 1)), true)
  const current = gate.captureTile('0,0', 3)
  assert.ok(current)
  assert.equal(current.isCurrent(tile(3, 10, 1)), true)
  assert.equal(current.isCurrent(tile(99, 10, 1)), false)
  assert.equal(current.isCurrent(tile(4, 11, 1)), false)
  assert.equal(current.isCurrent(tile(5, 10, 2)), false)
  assert.equal(current.isCurrent({ type: 'cancelled', id: 6 }), false)
})

test('pedido mais novo vence no mesmo tile, sem invalidar outro tile', () => {
  const gate = new RustPixelPocTileGate()
  gate.beginSourceChange()
  assert.equal(gate.adoptSource(staged(1, 7, 1)), true)
  const first = gate.captureTile('0,0', 2)
  const other = gate.captureTile('1,0', 4)
  const second = gate.captureTile('0,0', 3)
  assert.ok(first && other && second)
  assert.equal(first.isCurrent(tile(2, 7, 1)), false)
  assert.equal(second.isCurrent(tile(3, 7, 1)), true)
  assert.equal(other.isCurrent(tile(4, 7, 1)), true)
})

test('mudanças visuais e de fonte bloqueiam respostas concluídas mas obsoletas', () => {
  const gate = new RustPixelPocTileGate()
  gate.beginSourceChange()
  assert.equal(gate.adoptSource(staged(1, 7, 1)), true)
  const oldView = gate.captureTile('0,0', 2)
  assert.ok(oldView)
  gate.beginViewChange()
  assert.equal(oldView.isCurrent(tile(2, 7, 1)), false)
  const oldSource = gate.captureTile('0,0', 3)
  assert.ok(oldSource)
  assert.equal(gate.beginSourceChange(), 2)
  assert.equal(oldSource.isCurrent(tile(3, 7, 1)), false)
  assert.equal(gate.adoptSource(staged(4, 8, 1)), false)
  assert.equal(gate.captureTile('0,0', 6), null)
  assert.equal(gate.adoptSource(staged(5, 9, 2)), true)
  assert.equal(gate.adoptSource(staged(6, 10, 2)), false)
  const current = gate.captureTile('0,0', 7)
  assert.ok(current)
  assert.equal(current.isCurrent(tile(7, 9, 2)), true)
})

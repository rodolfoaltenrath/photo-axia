import assert from 'node:assert/strict'
import test from 'node:test'
import { pngWithResolution } from '../src/services/pngMetadata.ts'

function chunk(type, data) {
  const result = new Uint8Array(12 + data.length)
  new DataView(result.buffer).setUint32(0, data.length)
  result.set([...type].map((character) => character.charCodeAt(0)), 4)
  result.set(data, 8)
  return result
}

function minimalPng(existingPhys) {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = chunk('IHDR', new Uint8Array(13))
  const iend = chunk('IEND', new Uint8Array())
  const parts = existingPhys ? [signature, ihdr, chunk('pHYs', new Uint8Array(9)), iend] : [signature, ihdr, iend]
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function physChunks(bytes) {
  const result = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'pHYs') result.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  return result
}

test('insere pHYs após IHDR sem recomprimir pixels', () => {
  const output = pngWithResolution(minimalPng(false), 150)
  const [phys] = physChunks(output)
  const view = new DataView(phys.buffer, phys.byteOffset, phys.byteLength)
  assert.equal(view.getUint32(0), 5906)
  assert.equal(view.getUint32(4), 5906)
  assert.equal(view.getUint8(8), 1)
})

test('substitui pHYs existente e rejeita conteúdo inválido', () => {
  assert.equal(physChunks(pngWithResolution(minimalPng(true), 300)).length, 1)
  assert.throws(() => pngWithResolution(new Uint8Array(32), 150), /PNG válido/)
})

import { pngPixelsPerMeter } from '../editor/exportSettings.ts'

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PHYS_TYPE = new Uint8Array([0x70, 0x48, 0x59, 0x73])

function uint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0)
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngSignatureIsValid(bytes: Uint8Array) {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)
}

function physicalResolutionChunk(dpiX: number, dpiY: number) {
  const chunk = new Uint8Array(21)
  writeUint32(chunk, 0, 9)
  chunk.set(PHYS_TYPE, 4)
  writeUint32(chunk, 8, pngPixelsPerMeter(dpiX))
  writeUint32(chunk, 12, pngPixelsPerMeter(dpiY))
  chunk[16] = 1
  writeUint32(chunk, 17, crc32(chunk.subarray(4, 17)))
  return chunk
}

/** Replaces/inserts pHYs without decoding or recompressing the PNG pixels. */
export function pngWithResolution(bytes: Uint8Array, dpiX: number, dpiY = dpiX) {
  if (!pngSignatureIsValid(bytes)) throw new Error('O conteúdo exportado não é um PNG válido.')
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)]
  let offset = 8
  let foundHeader = false
  let inserted = false
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset)
    const end = offset + 12 + length
    if (end < offset || end > bytes.length) throw new Error('O PNG exportado está truncado.')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'IHDR') {
      if (foundHeader || length !== 13) throw new Error('O cabeçalho PNG exportado é inválido.')
      foundHeader = true
      chunks.push(bytes.subarray(offset, end), physicalResolutionChunk(dpiX, dpiY))
      inserted = true
    } else if (type !== 'pHYs') {
      chunks.push(bytes.subarray(offset, end))
    }
    offset = end
    if (type === 'IEND') break
  }
  if (!foundHeader || !inserted || offset !== bytes.length) throw new Error('A estrutura do PNG exportado é inválida.')
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const result = new Uint8Array(size)
  let resultOffset = 0
  for (const chunk of chunks) {
    result.set(chunk, resultOffset)
    resultOffset += chunk.length
  }
  return result
}

export async function pngBlobWithResolution(blob: Blob, dpiX: number, dpiY = dpiX) {
  const bytes = pngWithResolution(new Uint8Array(await blob.arrayBuffer()), dpiX, dpiY)
  return new Blob([bytes], { type: 'image/png' })
}

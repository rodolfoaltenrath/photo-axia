import { RustPixelPocError } from './rustPixelPocError.ts'

export const RUST_STYLE_IMAGE_HEADER_BYTES = 256 * 1024
const MAX_IMAGE_SIDE = 16_384
const MAX_IMAGE_BYTES = 64 * 1024 * 1024
const FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

export function rustStyleImageDimensions(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  let width = 0, height = 0
  if (view.byteLength >= 33 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new RustPixelPocError('invalid-input')
    width = view.getUint32(16); height = view.getUint32(20)
  } else if (view.byteLength >= 13 && view.getUint32(0) === 0x47494638 &&
      (view.getUint16(4) === 0x3761 || view.getUint16(4) === 0x3961)) {
    width = view.getUint16(6, true); height = view.getUint16(8, true)
  } else if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    let offset = 2
    while (offset < view.byteLength) {
      if (view.getUint8(offset++) !== 0xff) throw new RustPixelPocError('invalid-input')
      while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++
      if (offset >= view.byteLength) break
      const marker = view.getUint8(offset++)
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      if (marker === 0xda || marker === 0xd9 || marker === 0x00 || marker === 0xd8 || offset + 2 > view.byteLength) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > view.byteLength) break
      if (FRAME_MARKERS.has(marker)) {
        if (length < 11 || length !== 8 + 3 * view.getUint8(offset + 7)) break
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5)
        break
      }
      offset += length
    }
  }
  const bytes = width * height * 4
  if (!width || !height) throw new RustPixelPocError('invalid-input')
  if (!Number.isSafeInteger(bytes) || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || bytes > MAX_IMAGE_BYTES) {
    throw new RustPixelPocError('memory-limit')
  }
  return { width, height, bytes }
}

export async function readRustStyleImageDimensions(blob: Blob, ensureCurrent: () => void) {
  ensureCurrent()
  const header = await blob.slice(0, RUST_STYLE_IMAGE_HEADER_BYTES).arrayBuffer()
  ensureCurrent()
  // Unknown/truncated headers fall back without invoking the decoder.
  return rustStyleImageDimensions(header)
}

import { RustPixelPocError } from './rustPixelPocError.ts'

export function rustStylePngLayout(width: number, height: number, retainedBytes = 0) {
  const rgbaBytes = width * height * 4
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(retainedBytes) || retainedBytes < 0) throw new RustPixelPocError('invalid-input')
  // RGBA output + Canvas + encoder allowance; no extra ImageData pixel copy.
  const workingBytes = retainedBytes + rgbaBytes * 3
  if (!Number.isSafeInteger(rgbaBytes) || rgbaBytes > 64 * 1024 * 1024 || workingBytes > 96 * 1024 * 1024) {
    throw new RustPixelPocError('memory-limit')
  }
  return { rgbaBytes, workingBytes }
}

export async function encodeRustStylePng(rgba: Uint8Array, width: number, height: number,
  ensureCurrent: () => void, retainedBytes = 0) {
  ensureCurrent()
  const layout = rustStylePngLayout(width, height, retainedBytes)
  if (!(rgba instanceof Uint8Array) || !(rgba.buffer instanceof ArrayBuffer) || rgba.byteLength !== layout.rgbaBytes) {
    throw new RustPixelPocError('invalid-input')
  }
  if (typeof OffscreenCanvas !== 'function' || typeof ImageData !== 'function') throw new RustPixelPocError('wasm-unavailable')
  let canvas: OffscreenCanvas | undefined
  try {
    const started = performance.now()
    canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new RustPixelPocError('wasm-unavailable')
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0)
    const uploaded = performance.now()
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const encoded = performance.now()
    ensureCurrent()
    if (!(blob instanceof Blob) || blob.type !== 'image/png' || !blob.size) throw new RustPixelPocError('wasm-failure')
    if (blob.size > 64 * 1024 * 1024 || layout.workingBytes + blob.size > 96 * 1024 * 1024) {
      throw new RustPixelPocError('memory-limit')
    }
    return { blob, encoding: { canvasUploadMs: uploaded - started, pngEncodeMs: encoded - uploaded } }
  } catch (error) {
    if (error instanceof RustPixelPocError) throw error
    throw new RustPixelPocError('wasm-failure')
  } finally {
    if (canvas) { canvas.width = 1; canvas.height = 1 }
  }
}

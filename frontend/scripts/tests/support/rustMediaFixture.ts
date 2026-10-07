export interface RustMediaFixture {
  width: number
  height: number
  rgba: number[]
  delayMs?: number
  failRead?: boolean
}

export function rustMediaBlob(fixture: Partial<RustMediaFixture> = {}) {
  const media = { width: 1, height: 1, rgba: [40, 60, 80, 255], ...fixture }
  const header = new Uint8Array(33), view = new DataView(header.buffer)
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13); view.setUint32(12, 0x49484452)
  view.setUint32(16, media.width); view.setUint32(20, media.height)
  header[24] = 8; header[25] = 6
  // Header plus JSON is a decoder fixture, not a valid PNG.
  return new Blob([header, JSON.stringify(media)], { type: 'image/png' })
}

/** Canvas/decoder doubles only; real PNG coverage lives in the WebView smoke. */
export function installRustMediaFixtures(options: { encodeDelayMs?: number; failEncodeCount?: number } = {}) {
  const originals = { OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap, ImageData: globalThis.ImageData }
  const state = { decodes: 0, closes: 0, reads: 0, textDraws: 0,
    encodes: 0, uploads: 0, failedEncodes: options.failEncodeCount ?? 0, badMime: false, emptyBlob: false,
    onEncode: null as (() => void) | null, encodeBlock: null as Promise<void> | null,
    options: [] as (ImageBitmapOptions | undefined)[], canvases: [] as Canvas[], block: null as Promise<void> | null }
  class Canvas {
    width: number
    height: number
    pixels: number[] = [0, 0, 0, 0]
    failRead = false
    constructor(width: number, height: number) { this.width = width; this.height = height; state.canvases.push(this) }
    async convertToBlob() {
      state.encodes++
      const fixture = { width: this.width, height: this.height, rgba: this.pixels }
      state.onEncode?.()
      if (state.encodeBlock) await state.encodeBlock
      if (options.encodeDelayMs) await new Promise(resolve => setTimeout(resolve, options.encodeDelayMs))
      if (state.failedEncodes > 0) { state.failedEncodes--; throw new Error('encode-failed') }
      return new Blob(state.emptyBlob ? [] : [JSON.stringify(fixture)], { type: state.badMime ? 'image/jpeg' : 'image/png' })
    }
    getContext() {
      const canvas = this
      return {
        save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, fillRect() {},
        measureText(content: string) { return { width: content.length * 8 } },
        fillText() { state.textDraws++; canvas.pixels = [0, 0, 0, 255] },
        putImageData(pixels: ImageData) { state.uploads++; canvas.pixels = [...pixels.data] },
        drawImage(bitmap: RustMediaFixture) { canvas.pixels = bitmap.rgba; canvas.failRead = !!bitmap.failRead },
        getImageData(_x: number, _y: number, width: number, height: number) {
          state.reads++
          if (canvas.failRead) throw new Error('readback-failed')
          const data = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => canvas.pixels[i % canvas.pixels.length]!)
          return { width, height, data }
        }
      }
    }
  }
  class Pixels {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height }
  }
  globalThis.ImageData = Pixels as unknown as typeof ImageData
  globalThis.OffscreenCanvas = Canvas as unknown as typeof OffscreenCanvas
  globalThis.createImageBitmap = (async (blob: Blob, options?: ImageBitmapOptions) => {
    state.decodes++; state.options.push(options)
    const fixture: RustMediaFixture = JSON.parse(await blob.slice(33).text())
    if (state.block) await state.block
    if (fixture.delayMs) await new Promise(resolve => setTimeout(resolve, fixture.delayMs))
    return { ...fixture, width: options?.resizeWidth ?? fixture.width, height: options?.resizeHeight ?? fixture.height,
      close() { state.closes++ } }
  }) as unknown as typeof createImageBitmap
  return { state, restore() {
    globalThis.OffscreenCanvas = originals.OffscreenCanvas
    globalThis.createImageBitmap = originals.createImageBitmap
    globalThis.ImageData = originals.ImageData
  } }
}

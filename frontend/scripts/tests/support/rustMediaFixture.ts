export interface RustMediaFixture {
  width: number
  height: number
  rgba: number[]
  delayMs?: number
  failRead?: boolean
}

export function rustMediaBlob(fixture: Partial<RustMediaFixture> = {}) {
  return new Blob([JSON.stringify({ width: 1, height: 1, rgba: [40, 60, 80, 255], ...fixture })], { type: 'application/json' })
}

/** Canvas/decoder doubles only; real PNG coverage lives in the WebView smoke. */
export function installRustMediaFixtures() {
  const originals = { OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap }
  const state = { decodes: 0, closes: 0, reads: 0, textDraws: 0,
    options: [] as (ImageBitmapOptions | undefined)[], canvases: [] as Canvas[], block: null as Promise<void> | null }
  class Canvas {
    width: number
    height: number
    pixels: number[] = [0, 0, 0, 0]
    failRead = false
    constructor(width: number, height: number) { this.width = width; this.height = height; state.canvases.push(this) }
    getContext() {
      const canvas = this
      return {
        save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, fillRect() {},
        measureText(content: string) { return { width: content.length * 8 } },
        fillText() { state.textDraws++; canvas.pixels = [0, 0, 0, 255] },
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
  globalThis.OffscreenCanvas = Canvas as unknown as typeof OffscreenCanvas
  globalThis.createImageBitmap = (async (blob: Blob, options?: ImageBitmapOptions) => {
    state.decodes++; state.options.push(options)
    const fixture: RustMediaFixture = JSON.parse(await blob.text())
    if (state.block) await state.block
    if (fixture.delayMs) await new Promise(resolve => setTimeout(resolve, fixture.delayMs))
    return { ...fixture, width: options?.resizeWidth ?? fixture.width, height: options?.resizeHeight ?? fixture.height,
      close() { state.closes++ } }
  }) as unknown as typeof createImageBitmap
  return { state, restore() {
    globalThis.OffscreenCanvas = originals.OffscreenCanvas
    globalThis.createImageBitmap = originals.createImageBitmap
  } }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearPreparedImageCache,
  editorPreviewSize,
  imageDimensionsFromHeader,
  prepareImageSource,
  releasePreparedImage
} from '../src/services/imageImport.ts'

const asset4k = { width: 3840, height: 2160 }

test('dimensiona a prévia pelos pixels realmente visíveis no viewport', () => {
  assert.deepEqual(editorPreviewSize(asset4k, 1920, 1080, 0.5, 1), {
    width: 960,
    height: 576
  })
})

test('quantiza dimensões para reaproveitar previews durante pequenos ajustes', () => {
  const first = editorPreviewSize(asset4k, 1000, 690, 1, 1)
  const second = editorPreviewSize(asset4k, 1010, 695, 1, 1)
  assert.deepEqual(first, second)
})

test('limita a memória raster mesmo em telas de alta densidade', () => {
  const preview = editorPreviewSize(asset4k, 3840, 2160, 1, 2)
  assert.ok(preview.width * preview.height <= 4_194_304)
  assert.ok(preview.width <= asset4k.width)
  assert.ok(preview.height <= asset4k.height)
})

test('aceita orçamento menor para documentos com muitas camadas', () => {
  const preview = editorPreviewSize(asset4k, 1920, 1080, 1, 2, 524_288)
  assert.ok(preview.width * preview.height <= 524_288)
})

test('lê dimensões PNG, GIF e JPEG sem decodificar o raster', () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  new DataView(png.buffer).setUint32(16, 3840)
  new DataView(png.buffer).setUint32(20, 2160)

  const gif = new Uint8Array(10)
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  new DataView(gif.buffer).setUint16(6, 800, true)
  new DataView(gif.buffer).setUint16(8, 600, true)

  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x08, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03
  ])

  assert.deepEqual(imageDimensionsFromHeader(png.buffer, 'image/png'), { width: 3840, height: 2160 })
  assert.deepEqual(imageDimensionsFromHeader(gif.buffer, 'image/gif'), { width: 800, height: 600 })
  assert.deepEqual(imageDimensionsFromHeader(jpeg.buffer, 'image/jpeg'), { width: 1920, height: 1080 })
})

test('reutiliza imagens decodificadas e descarta entradas liberadas ou acima do orçamento', async () => {
  const NativeImage = globalThis.Image
  let instances = 0
  let imageWidth = 100
  let imageHeight = 80
  class FakeImage {
    complete = true
    naturalWidth = imageWidth
    naturalHeight = imageHeight
    decoding = 'auto'
    onerror = null
    onload = null

    constructor() {
      instances++
    }

    decode() {
      return Promise.resolve()
    }

    set src(_source) {
      queueMicrotask(() => this.onload?.())
    }
  }

  globalThis.Image = FakeImage
  clearPreparedImageCache()
  try {
    const [first, second] = await Promise.all([
      prepareImageSource('blob:shared-image'),
      prepareImageSource('blob:shared-image')
    ])
    assert.equal(first, second)
    assert.equal(instances, 1)

    releasePreparedImage('blob:shared-image')
    await prepareImageSource('blob:shared-image')
    assert.equal(instances, 2)

    clearPreparedImageCache()
    imageWidth = 8192
    imageHeight = 8192
    await prepareImageSource('blob:oversized-image')
    await prepareImageSource('blob:oversized-image')
    assert.equal(instances, 4)

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      prepareImageSource('blob:cancelled-image', controller.signal),
      (error) => error instanceof DOMException && error.name === 'AbortError'
    )
    assert.equal(instances, 4)
  } finally {
    clearPreparedImageCache()
    globalThis.Image = NativeImage
  }
})

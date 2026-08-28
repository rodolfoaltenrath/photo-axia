import assert from 'node:assert/strict'
import test from 'node:test'
import { colorRegionSpans, colorRegionSpansCooperatively } from '../src/editor/colorRegion.ts'
import { magicWandSpans } from '../src/editor/selection.ts'

function pixels(colors) {
  return new Uint8ClampedArray(colors.flat())
}

test('o contrato neutro mantém o resultado legado da varinha', () => {
  const image = pixels([
    [10, 10, 10, 255], [10, 10, 10, 255], [200, 200, 200, 255],
    [10, 10, 10, 255], [200, 200, 200, 255], [10, 10, 10, 255]
  ])
  const options = { startX: 0, startY: 0, tolerance: 0, contiguous: true }
  assert.deepEqual(
    colorRegionSpans(image, 3, 2, options),
    magicWandSpans(image, 3, 2, 0, 0, 0, true)
  )
})

test('modo global reúne regiões separadas e contabiliza os spans', () => {
  const image = pixels([
    [1, 2, 3, 255], [90, 90, 90, 255], [1, 2, 3, 255]
  ])
  const result = colorRegionSpans(image, 3, 1, {
    startX: 0,
    startY: 0,
    tolerance: 0,
    contiguous: false
  })
  assert.equal(result.pixelCount, 2)
  assert.deepEqual(result.spans, [{ y: 0, x0: 0, x1: 1 }, { y: 0, x0: 2, x1: 3 }])
})

test('pixels totalmente transparentes ignoram RGB oculto, mas preservam a diferença de alfa', () => {
  const image = pixels([
    [255, 0, 0, 0], [0, 255, 0, 0], [0, 255, 0, 1]
  ])
  const result = colorRegionSpans(image, 3, 1, {
    startX: 0,
    startY: 0,
    tolerance: 0,
    contiguous: true
  })
  assert.equal(result.pixelCount, 2)
})

test('normaliza tolerâncias nos limites 0 e 255', () => {
  const image = pixels([
    [0, 0, 0, 0], [32, 32, 32, 32], [255, 255, 255, 255]
  ])
  assert.equal(colorRegionSpans(image, 3, 1, {
    startX: 0, startY: 0, tolerance: -10, contiguous: false
  }).pixelCount, 1)
  assert.equal(colorRegionSpans(image, 3, 1, {
    startX: 0, startY: 0, tolerance: 32, contiguous: false
  }).pixelCount, 2)
  assert.equal(colorRegionSpans(image, 3, 1, {
    startX: 0, startY: 0, tolerance: 999, contiguous: false
  }).pixelCount, 3)
})

test('compacta automaticamente seleções globais muito fragmentadas', () => {
  const width = 40_002
  const image = new Uint8ClampedArray(width * 4)
  for (let x = 0; x < width; x++) {
    const offset = x * 4
    image[offset] = image[offset + 1] = image[offset + 2] = x % 2 ? 255 : 0
    image[offset + 3] = 255
  }
  const result = colorRegionSpans(image, width, 1, {
    startX: 0, startY: 0, tolerance: 0, contiguous: false
  })
  assert.equal(result.spans.kind, 'packed-spans')
  assert.equal(result.spans.length, 20_001)
  assert.equal(result.spans.data.byteLength, 20_001 * 3 * Int32Array.BYTES_PER_ELEMENT)
  assert.deepEqual([...result.spans.data.slice(0, 6)], [0, 0, 1, 0, 2, 3])
})

test('fallback cooperativo da Varinha preserva exatamente os spans do núcleo síncrono', async () => {
  const image = new Uint8ClampedArray([
    10, 20, 30, 255, 10, 20, 30, 255, 90, 80, 70, 255,
    10, 20, 30, 255, 90, 80, 70, 255, 10, 20, 30, 255
  ])
  const options = { startX: 0, startY: 0, tolerance: 0, contiguous: false }
  const expected = colorRegionSpans(image, 3, 2, options)
  const actual = await colorRegionSpansCooperatively(image, 3, 2, options, {
    spansPerChunk: 1,
    yieldControl: async () => {}
  })
  assert.deepEqual(actual, expected)
})

test('fallback contíguo ordena os spans como o Worker mesmo com semente central', async () => {
  const image = new Uint8ClampedArray(3 * 5 * 4)
  const options = { startX: 1, startY: 2, tolerance: 0, contiguous: true }
  const expected = colorRegionSpans(image, 3, 5, options)
  const actual = await colorRegionSpansCooperatively(image, 3, 5, options, {
    spansPerChunk: 1,
    yieldControl: async () => {}
  })
  assert.deepEqual(actual, expected)
  assert.deepEqual(actual.spans.map((span) => span.y), [0, 1, 2, 3, 4])
})

test('fallback global observa cancelamento por linhas mesmo quando quase não encontra spans', async () => {
  const image = new Uint8ClampedArray(300 * 4)
  for (let row = 0; row < 300; row++) image[row * 4 + 3] = 255
  image[0] = 255
  let cancelled = false
  let yields = 0
  await assert.rejects(
    colorRegionSpansCooperatively(
      image,
      1,
      300,
      { startX: 0, startY: 0, tolerance: 0, contiguous: false },
      {
        spansPerChunk: 4,
        throwIfCancelled: () => {
          if (cancelled) throw new DOMException('Seleção cancelada.', 'AbortError')
        },
        yieldControl: async () => {
          yields += 1
          cancelled = true
        }
      }
    ),
    { name: 'AbortError' }
  )
  assert.equal(yields, 1)
})

test('fallback e núcleo síncrono permanecem idênticos em cores, tolerâncias e conectividade variadas', async () => {
  let state = 0x5a17
  const randomByte = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state & 0xff
  }
  const image = new Uint8ClampedArray(9 * 7 * 4)
  for (let index = 0; index < image.length; index += 4) {
    image[index] = randomByte()
    image[index + 1] = randomByte()
    image[index + 2] = randomByte()
    image[index + 3] = index % 20 === 0 ? 0 : randomByte()
  }
  for (const contiguous of [false, true]) {
    for (const tolerance of [0, 17, 64, 255]) {
      for (const [startX, startY] of [[0, 0], [4, 3], [8, 6]]) {
        const options = { startX, startY, tolerance, contiguous }
        const expected = colorRegionSpans(image, 9, 7, options)
        const actual = await colorRegionSpansCooperatively(image, 9, 7, options, {
          spansPerChunk: 2,
          yieldControl: async () => {}
        })
        assert.deepEqual(actual, expected, JSON.stringify(options))
      }
    }
  }
})

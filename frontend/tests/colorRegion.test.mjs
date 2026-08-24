import assert from 'node:assert/strict'
import test from 'node:test'
import { colorRegionSpans } from '../src/editor/colorRegion.ts'
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { quickSelectionSpans } from '../src/editor/quickSelection.ts'
import { selectionMaskFromSpans, selectionQualityMetrics } from '../src/editor/selectionMetrics.ts'

function rgba(width, height, pixelAt) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels.set(pixelAt(x, y), (y * width + x) * 4)
  }
  return pixels
}

function expectedMask(width, height, includes) {
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (includes(x, y)) mask[y * width + x] = 1
  }
  return mask
}

function assertFixture(name, width, height, pixels, options, expected, minimumIou = 1) {
  const actual = quickSelectionSpans(pixels, width, height, options)
  const metrics = selectionQualityMetrics(selectionMaskFromSpans(actual.spans, width, height), expected)
  assert.ok(metrics.iou >= minimumIou, `${name}: IoU ${metrics.iou.toFixed(3)}, extras ${metrics.extraPixels}, ausentes ${metrics.missingPixels}`)
  return metrics
}

test('fixtures de qualidade mantêm borda, cor próxima, transparência e regiões separadas', () => {
  const blue = [25, 90, 205, 255]
  const white = [238, 238, 238, 255]
  assertFixture(
    'borda forte', 8, 4,
    rgba(8, 4, (x) => x < 4 ? blue : white),
    { positiveSeeds: [{ x: 1, y: 1 }], colorTolerance: 255, edgeTolerance: 40 },
    expectedMask(8, 4, (x) => x < 4)
  )
  assertFixture(
    'cores próximas', 8, 2,
    rgba(8, 2, (x) => x < 4 ? [70, 115, 155, 255] : [104, 145, 180, 255]),
    { positiveSeeds: [{ x: 1, y: 0 }], colorTolerance: 24, edgeTolerance: 50 },
    expectedMask(8, 2, (x) => x < 4)
  )
  assertFixture(
    'antialias e transparência', 6, 1,
    rgba(6, 1, (x) => x < 2 ? blue : x === 2 ? [110, 150, 230, 150] : [245, 245, 245, 0]),
    { positiveSeeds: [{ x: 0, y: 0 }], colorTolerance: 110, edgeTolerance: 110 },
    expectedMask(6, 1, (x) => x < 3)
  )
  assertFixture(
    'regiões semelhantes separadas', 9, 1,
    rgba(9, 1, (x) => x < 3 || x > 5 ? blue : white),
    { positiveSeeds: [{ x: 1, y: 0 }], colorTolerance: 10, edgeTolerance: 20 },
    expectedMask(9, 1, (x) => x < 3)
  )
})

test('fixture com detalhes finos e ruído determinístico preserva o objeto', () => {
  const width = 12
  const height = 9
  const objectPixel = (x, y) => x >= 2 && x <= 7 && y >= 2 && y <= 6 ||
    (x === 8 && y >= 1 && y <= 3) || (x === 9 && y === 1)
  const noise = (x, y) => ((x * 73 + y * 31 + 17) % 17) - 8
  const pixels = rgba(width, height, (x, y) => {
    const n = noise(x, y)
    return objectPixel(x, y) ? [35 + n, 105 + n, 195 + n, 255] : [170 + n, 90 + n, 55 + n, 255]
  })
  const metrics = assertFixture(
    'detalhes e ruído', width, height, pixels,
    { positiveSeeds: [{ x: 4, y: 4 }], colorTolerance: 30, edgeTolerance: 40 },
    expectedMask(width, height, objectPixel)
  )
  assert.equal(metrics.extraPixels, 0)
  assert.equal(metrics.missingPixels, 0)
})

test('métricas expõem extras e ausências de forma objetiva', () => {
  const metrics = selectionQualityMetrics(Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([1, 0, 1, 0]))
  assert.deepEqual(metrics, {
    expectedPixels: 2, actualPixels: 2, intersectionPixels: 1, unionPixels: 3,
    extraPixels: 1, missingPixels: 1, iou: 1 / 3, precision: 1 / 2, recall: 1 / 2
  })
})

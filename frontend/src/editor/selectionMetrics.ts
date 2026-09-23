import { forEachPixelSpan, type PixelSpans } from './selection.ts'

export interface SelectionQualityMetrics {
  expectedPixels: number
  actualPixels: number
  intersectionPixels: number
  unionPixels: number
  extraPixels: number
  missingPixels: number
  iou: number
  precision: number
  recall: number
}

export function selectionMaskFromSpans(spans: PixelSpans, width: number, height: number) {
  const mask = new Uint8Array(Math.max(0, width * height))
  forEachPixelSpan(spans, (span) => {
    if (span.y < 0 || span.y >= height) return
    const x0 = Math.max(0, Math.min(width, Math.floor(span.x0)))
    const x1 = Math.max(x0, Math.min(width, Math.ceil(span.x1)))
    mask.fill(1, span.y * width + x0, span.y * width + x1)
  })
  return mask
}

export function selectionQualityMetrics(actual: Uint8Array, expected: Uint8Array): SelectionQualityMetrics {
  if (actual.length !== expected.length) throw new Error('As máscaras precisam ter as mesmas dimensões.')
  let expectedPixels = 0
  let actualPixels = 0
  let intersectionPixels = 0
  for (let index = 0; index < actual.length; index++) {
    const isActual = actual[index] !== 0
    const isExpected = expected[index] !== 0
    if (isActual) actualPixels++
    if (isExpected) expectedPixels++
    if (isActual && isExpected) intersectionPixels++
  }
  const unionPixels = actualPixels + expectedPixels - intersectionPixels
  const extraPixels = actualPixels - intersectionPixels
  const missingPixels = expectedPixels - intersectionPixels
  return {
    expectedPixels,
    actualPixels,
    intersectionPixels,
    unionPixels,
    extraPixels,
    missingPixels,
    iou: unionPixels ? intersectionPixels / unionPixels : 1,
    precision: actualPixels ? intersectionPixels / actualPixels : expectedPixels ? 0 : 1,
    recall: expectedPixels ? intersectionPixels / expectedPixels : actualPixels ? 0 : 1
  }
}

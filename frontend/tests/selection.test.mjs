import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLassoSelection,
  constrainedSelectionEndpoint,
  dragSelectionBounds,
  invertMatrix,
  layerSourceToDocumentMatrix,
  magicWandSpans,
  pixelSpansOutlinePath,
  transformSelectionPoint
} from '../src/editor/selection.ts'

function pixels(width, rows) {
  const data = new Uint8ClampedArray(width * rows.length * 4)
  rows.flat().forEach((value, index) => {
    const offset = index * 4
    data[offset] = value
    data[offset + 1] = value
    data[offset + 2] = value
    data[offset + 3] = 255
  })
  return data
}

test('Shift cria uma seleção quadrada em qualquer direção', () => {
  assert.deepEqual(dragSelectionBounds({ x: 10, y: 20 }, { x: 34, y: 28 }, true), {
    x: 10,
    y: 20,
    width: 24,
    height: 24
  })
  assert.deepEqual(dragSelectionBounds({ x: 10, y: 20 }, { x: 4, y: 50 }, true), {
    x: -20,
    y: 20,
    width: 30,
    height: 30
  })
})

test('quadrado permanece dentro dos limites do documento', () => {
  assert.deepEqual(constrainedSelectionEndpoint({ x: 90, y: 50 }, { x: 98, y: 95 }, 100, 100), {
    x: 100,
    y: 60
  })
})

test('laço remove pontos redundantes sem perder os extremos', () => {
  const points = Array.from({ length: 100 }, (_, index) => ({ x: index, y: index % 2 ? 0.02 : 0 }))
  const selection = createLassoSelection(points, 0.1)
  assert.deepEqual(selection.points, [points[0], points.at(-1)])
  assert.equal(selection.bounds.width, 99)
})

test('matriz de camada preserva ida e volta com escala e rotação', () => {
  const matrix = layerSourceToDocumentMatrix(
    { x: 120, y: 80, width: 640, height: 360, rotation: 27 },
    1920,
    1080
  )
  const source = { x: 734.25, y: 511.75 }
  const documentPoint = transformSelectionPoint(matrix, source)
  const restored = transformSelectionPoint(invertMatrix(matrix), documentPoint)
  assert.ok(Math.abs(restored.x - source.x) < 1e-8)
  assert.ok(Math.abs(restored.y - source.y) < 1e-8)
})

test('varinha contígua não atravessa uma região de outra cor', () => {
  const image = pixels(5, [
    [10, 10, 90, 10, 10],
    [10, 10, 90, 10, 10],
    [90, 90, 90, 10, 10]
  ])
  const result = magicWandSpans(image, 5, 3, 0, 0, 0, true)
  assert.equal(result.pixelCount, 4)
  assert.deepEqual(result.spans, [
    { y: 0, x0: 0, x1: 2 },
    { y: 1, x0: 0, x1: 2 }
  ])
})

test('varinha global seleciona todas as cores dentro da tolerância', () => {
  const image = pixels(4, [
    [20, 23, 80, 20],
    [90, 20, 24, 90]
  ])
  const result = magicWandSpans(image, 4, 2, 0, 0, 4, false)
  assert.equal(result.pixelCount, 5)
  assert.deepEqual(result.bounds, { x: 0, y: 0, width: 4, height: 2 })
})

test('contorno RLE elimina arestas horizontais internas', () => {
  const outline = pixelSpansOutlinePath([
    { y: 0, x0: 1, x1: 4 },
    { y: 1, x0: 1, x1: 4 }
  ])
  assert.equal(outline.includes('M1 1H4'), false)
  assert.equal(outline.includes('M1 0H4'), true)
  assert.equal(outline.includes('M1 2H4'), true)
})

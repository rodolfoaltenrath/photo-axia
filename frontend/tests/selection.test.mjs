import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampSelectionToBounds,
  createLassoSelection,
  constrainedSelectionEndpoint,
  dragSelectionBounds,
  invertMatrix,
  layerSourceToDocumentMatrix,
  magicWandSpans,
  opaquePixelBounds,
  pixelSpansOutlinePath,
  selectionContainsPoint,
  selectionDocumentBounds,
  selectionMoveGeometry,
  snapShapeSelectionToBounds,
  sourceScaleFactor,
  transformSelectionPoint,
  translateSelection
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

test('sourceScaleFactor converte escala uniforme exatamente', () => {
  const transform = { x: 0, y: 0, width: 400, height: 200 }
  assert.equal(sourceScaleFactor(transform, 200, 100), 2)
})

test('sourceScaleFactor usa a média geométrica para escala não uniforme', () => {
  const transform = { x: 0, y: 0, width: 800, height: 200 }
  assert.equal(sourceScaleFactor(transform, 100, 100), 4)
})

test('sourceScaleFactor não quebra com dimensões de origem inválidas', () => {
  assert.equal(sourceScaleFactor({ x: 0, y: 0, width: 10, height: 10 }, 0, 0), 1)
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

test('clampSelectionToBounds recorta um retângulo que passa da camada', () => {
  const selection = { kind: 'rectangle', bounds: { x: -50, y: -50, width: 200, height: 200 } }
  const layerBounds = { x: 0, y: 0, width: 100, height: 100 }
  assert.deepEqual(clampSelectionToBounds(selection, layerBounds), {
    kind: 'rectangle',
    bounds: { x: 0, y: 0, width: 100, height: 100 }
  })
})

test('clampSelectionToBounds recorta um laço que passa da camada', () => {
  const selection = {
    kind: 'lasso',
    points: [
      { x: -20, y: 10 },
      { x: 50, y: -20 },
      { x: 50, y: 50 }
    ],
    bounds: { x: -20, y: -20, width: 70, height: 70 }
  }
  const layerBounds = { x: 0, y: 0, width: 100, height: 100 }
  const clamped = clampSelectionToBounds(selection, layerBounds)
  assert.deepEqual(clamped.points, [
    { x: 0, y: 10 },
    { x: 50, y: 0 },
    { x: 50, y: 50 }
  ])
})

test('opaquePixelBounds recorta para os pixels não transparentes restantes', () => {
  const width = 4
  const height = 4
  const data = new Uint8ClampedArray(width * height * 4)
  // apenas o pixel (1,1) e (2,2) têm alfa > 0
  const setAlpha = (x, y, alpha) => {
    data[(y * width + x) * 4 + 3] = alpha
  }
  setAlpha(1, 1, 255)
  setAlpha(2, 2, 128)
  assert.deepEqual(opaquePixelBounds(data, width, height), { x: 1, y: 1, width: 2, height: 2 })
})

test('opaquePixelBounds retorna null quando tudo está transparente', () => {
  const data = new Uint8ClampedArray(4 * 4 * 4)
  assert.equal(opaquePixelBounds(data, 4, 4), null)
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

test('seleção retangular encaixa nas bordas próximas sem alterar bordas distantes', () => {
  const snapped = snapShapeSelectionToBounds(
    { kind: 'rectangle', bounds: { x: 12, y: 23, width: 75, height: 54 } },
    { x: 10, y: 20, width: 80, height: 60 },
    3
  )
  assert.deepEqual(snapped, {
    kind: 'rectangle',
    bounds: { x: 10, y: 20, width: 80, height: 60 }
  })

  const unchanged = snapShapeSelectionToBounds(
    { kind: 'ellipse', bounds: { x: 20, y: 30, width: 40, height: 20 } },
    { x: 10, y: 20, width: 80, height: 60 },
    3
  )
  assert.deepEqual(unchanged, {
    kind: 'ellipse',
    bounds: { x: 20, y: 30, width: 40, height: 20 }
  })
})

test('translada seleção vetorial sem alterar suas dimensões', () => {
  assert.deepEqual(
    translateSelection({ kind: 'rectangle', bounds: { x: 10, y: 20, width: 30, height: 40 } }, 7, -3),
    { kind: 'rectangle', bounds: { x: 17, y: 17, width: 30, height: 40 } }
  )
})

test('translada seleção de pixels pela matriz sem alterar os spans', () => {
  const selection = {
    kind: 'pixels',
    layerId: 'layer',
    sourceWidth: 10,
    sourceHeight: 10,
    sourceToDocument: [2, 0, 0, 2, 5, 6],
    spans: [{ y: 2, x0: 1, x1: 4 }],
    bounds: { x: 1, y: 2, width: 3, height: 1 },
    pixelCount: 3
  }
  const moved = translateSelection(selection, 8, 9)
  assert.deepEqual(moved.sourceToDocument, [2, 0, 0, 2, 13, 15])
  assert.equal(moved.spans, selection.spans)
  assert.deepEqual(selectionDocumentBounds(moved), { x: 15, y: 19, width: 6, height: 2 })
})

test('hit-test respeita retângulo, elipse, laço e spans da varinha', () => {
  assert.equal(selectionContainsPoint({ kind: 'rectangle', bounds: { x: 0, y: 0, width: 10, height: 10 } }, { x: 5, y: 5 }), true)
  assert.equal(selectionContainsPoint({ kind: 'ellipse', bounds: { x: 0, y: 0, width: 10, height: 10 } }, { x: 0, y: 0 }), false)
  assert.equal(selectionContainsPoint({ kind: 'lasso', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], bounds: { x: 0, y: 0, width: 10, height: 10 } }, { x: 5, y: 4 }), true)
  assert.equal(selectionContainsPoint({ kind: 'pixels', layerId: 'layer', sourceWidth: 5, sourceHeight: 5, sourceToDocument: [2, 0, 0, 2, 10, 20], spans: [{ y: 1, x0: 1, x1: 3 }], bounds: { x: 1, y: 1, width: 2, height: 1 }, pixelCount: 2 }, { x: 13, y: 23 }), true)
})

test('movimento expande o raster quando os pixels ultrapassam os limites da camada', () => {
  const geometry = selectionMoveGeometry(
    100,
    80,
    { x: 0, y: 0, width: 100, height: 80, rotation: 0 },
    { kind: 'rectangle', bounds: { x: 70, y: 20, width: 20, height: 30 } },
    25,
    -30
  )
  assert.deepEqual(
    { originX: geometry.originX, originY: geometry.originY, width: geometry.width, height: geometry.height },
    { originX: 0, originY: -10, width: 115, height: 90 }
  )
  assert.equal(geometry.hardRectangularMask, true)
})

test('máscara retangular só é rígida quando permanece alinhada ao raster', () => {
  const selection = { kind: 'rectangle', bounds: { x: 10.25, y: 20.75, width: 30.5, height: 15.5 } }
  const aligned = selectionMoveGeometry(
    100,
    80,
    { x: 0, y: 0, width: 100, height: 80, rotation: 0 },
    selection,
    10,
    0
  )
  assert.equal(aligned.hardRectangularMask, true)
  assert.deepEqual(
    {
      x: aligned.selectionOriginX,
      y: aligned.selectionOriginY,
      width: aligned.selectionWidth,
      height: aligned.selectionHeight
    },
    { x: 10, y: 20, width: 31, height: 17 }
  )

  const rotated = selectionMoveGeometry(
    100,
    80,
    { x: 0, y: 0, width: 100, height: 80, rotation: 15 },
    selection,
    10,
    0
  )
  assert.equal(rotated.hardRectangularMask, false)
})

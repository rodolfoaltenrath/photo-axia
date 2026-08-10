import assert from 'node:assert/strict'
import test from 'node:test'
import { appendBrushPoint, brushPointSpacing, brushPreviewSize, brushStrokeGeometry } from '../src/editor/brush.ts'
import { clipContextToSelection } from '../src/editor/selection.ts'

test('filtra amostras redundantes sem perder o ponto final', () => {
  const points = [{ x: 0, y: 0 }]
  assert.equal(appendBrushPoint(points, { x: 0.2, y: 0 }, 0.5), false)
  assert.equal(appendBrushPoint(points, { x: 0.75, y: 0 }, 0.5), true)
  assert.equal(appendBrushPoint(points, { x: 0.8, y: 0 }, 0.5, true), true)
  assert.deepEqual(points, [{ x: 0, y: 0 }, { x: 0.75, y: 0 }, { x: 0.8, y: 0 }])
})

test('ignora pontos inválidos e duplicados', () => {
  const points = [{ x: 10, y: 20 }]
  assert.equal(appendBrushPoint(points, { x: 10, y: 20 }, 0, true), false)
  assert.equal(appendBrushPoint(points, { x: Number.NaN, y: 20 }, 0, true), false)
  assert.equal(points.length, 1)
})

test('a prévia acompanha zoom e densidade sem superar o raster original', () => {
  assert.deepEqual(brushPreviewSize(4000, 3000, 800, 600, 0.5, 2), { width: 800, height: 600 })
  assert.deepEqual(brushPreviewSize(1000, 750, 800, 600, 4, 2), { width: 1000, height: 750 })
})

test('a prévia respeita o orçamento de pixels', () => {
  const result = brushPreviewSize(12000, 8000, 12000, 8000, 1, 2, 1_000_000)
  assert.ok(result.width * result.height <= 1_000_000)
  assert.ok(result.width > result.height)
})

test('o espaçamento se adapta ao pincel e ao zoom', () => {
  assert.ok(brushPointSpacing(100, 1) > brushPointSpacing(10, 1))
  assert.ok(brushPointSpacing(100, 4) < brushPointSpacing(100, 1))
})

test('pincel livre expande o raster até o traço sem ultrapassar o documento', () => {
  assert.deepEqual(
    brushStrokeGeometry(
      100,
      80,
      { x: 100, y: 100, width: 200, height: 160, rotation: 0 },
      [{ x: 40, y: 50 }, { x: 350, y: 280 }],
      20,
      400,
      300,
      true
    ),
    { originX: -36, originY: -31, width: 167, height: 127 }
  )
})

test('pincel com seleção mantém exatamente os limites atuais da camada', () => {
  assert.deepEqual(
    brushStrokeGeometry(
      100,
      80,
      { x: 100, y: 100, width: 200, height: 160, rotation: 0 },
      [{ x: 0, y: 0 }],
      100,
      400,
      300,
      false
    ),
    { originX: 0, originY: 0, width: 100, height: 80 }
  )
})

test('a máscara vetorial é aplicada no mesmo espaço do documento', () => {
  const calls = []
  const context = {
    beginPath: () => calls.push(['beginPath']),
    rect: (...values) => calls.push(['rect', ...values]),
    clip: () => calls.push(['clip']),
    setTransform: (...values) => calls.push(['setTransform', ...values])
  }
  clipContextToSelection(
    context,
    { kind: 'rectangle', bounds: { x: 10, y: 20, width: 30, height: 40 } },
    [2, 0, 0, 2, -4, -6]
  )
  assert.deepEqual(calls, [
    ['setTransform', 2, 0, 0, 2, -4, -6],
    ['beginPath'],
    ['rect', 10, 20, 30, 40],
    ['clip'],
    ['setTransform', 2, 0, 0, 2, -4, -6]
  ])
})

test('a máscara da varinha preserva a transformação da camada selecionada', () => {
  const transforms = []
  const context = {
    beginPath() {},
    rect() {},
    clip() {},
    setTransform: (...values) => transforms.push(values)
  }
  clipContextToSelection(
    context,
    {
      kind: 'pixels',
      layerId: 'origem',
      sourceWidth: 100,
      sourceHeight: 100,
      sourceToDocument: [0.5, 0, 0, 0.5, 10, 20],
      spans: [{ y: 0, x0: 0, x1: 1 }],
      bounds: { x: 10, y: 20, width: 0.5, height: 0.5 },
      pixelCount: 1
    },
    [2, 0, 0, 2, -10, -20]
  )
  assert.deepEqual(transforms, [
    [1, 0, 0, 1, 10, 20],
    [2, 0, 0, 2, -10, -20]
  ])
})

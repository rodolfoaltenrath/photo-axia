import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MARQUEE_SELECTION_MODES,
  createMarqueeSelection,
  isMarqueeSelectionMode,
  nextMarqueeSelectionMode
} from '../src/editor/marqueeSelection.ts'
import { combineSelections } from '../src/editor/selectionCombine.ts'

const documentSize = { width: 8, height: 6 }

test('expõe exatamente as quatro ferramentas Marquee na ordem aprovada', () => {
  assert.deepEqual(MARQUEE_SELECTION_MODES, [
    'rectangle',
    'ellipse',
    'single-row',
    'single-column'
  ])
  assert.equal(isMarqueeSelectionMode('single-row'), true)
  assert.equal(isMarqueeSelectionMode('lasso'), false)
  assert.equal(nextMarqueeSelectionMode('rectangle'), 'ellipse')
  assert.equal(nextMarqueeSelectionMode('single-column'), 'rectangle')
})

test('retângulo e elipse preservam os quatro sentidos de arraste', () => {
  for (const mode of ['rectangle', 'ellipse']) {
    const expected = { kind: mode, bounds: { x: 2, y: 1, width: 4, height: 3 } }
    assert.deepEqual(createMarqueeSelection(mode, { x: 2, y: 1 }, { x: 6, y: 4 }, documentSize), expected)
    assert.deepEqual(createMarqueeSelection(mode, { x: 6, y: 1 }, { x: 2, y: 4 }, documentSize), expected)
    assert.deepEqual(createMarqueeSelection(mode, { x: 2, y: 4 }, { x: 6, y: 1 }, documentSize), expected)
    assert.deepEqual(createMarqueeSelection(mode, { x: 6, y: 4 }, { x: 2, y: 1 }, documentSize), expected)
  }
})

test('Shift mantém quadrado e círculo em arrastes positivos e negativos', () => {
  for (const mode of ['rectangle', 'ellipse']) {
    assert.deepEqual(
      createMarqueeSelection(mode, { x: 1, y: 1 }, { x: 4, y: 3 }, documentSize, true),
      { kind: mode, bounds: { x: 1, y: 1, width: 3, height: 3 } }
    )
    assert.deepEqual(
      createMarqueeSelection(mode, { x: 6, y: 5 }, { x: 4, y: 2 }, documentSize, true),
      { kind: mode, bounds: { x: 3, y: 2, width: 3, height: 3 } }
    )
  }
})

test('Linha Única ocupa toda a largura e exatamente um pixel', () => {
  for (const [coordinate, row] of [[0, 0], [2.9, 2], [5.999, 5]]) {
    assert.deepEqual(
      createMarqueeSelection('single-row', { x: 3.4, y: coordinate }, { x: 7, y: 5 }, documentSize),
      { kind: 'rectangle', bounds: { x: 0, y: row, width: 8, height: 1 } }
    )
  }
})

test('Coluna Única ocupa toda a altura e exatamente um pixel', () => {
  for (const [coordinate, column] of [[0, 0], [3.8, 3], [7.999, 7]]) {
    assert.deepEqual(
      createMarqueeSelection('single-column', { x: coordinate, y: 2.5 }, { x: 7, y: 5 }, documentSize),
      { kind: 'rectangle', bounds: { x: column, y: 0, width: 1, height: 6 } }
    )
  }
})

test('Linha e Coluna ignoram o endpoint e não dependem de zoom ou densidade', () => {
  const firstRow = createMarqueeSelection('single-row', { x: 4, y: 2.2 }, { x: 0, y: 0 }, documentSize)
  const draggedRow = createMarqueeSelection('single-row', { x: 4, y: 2.2 }, { x: 800, y: 600 }, documentSize, true)
  const firstColumn = createMarqueeSelection('single-column', { x: 4.2, y: 2 }, { x: 0, y: 0 }, documentSize)
  const draggedColumn = createMarqueeSelection('single-column', { x: 4.2, y: 2 }, { x: 800, y: 600 }, documentSize, true)
  assert.deepEqual(draggedRow, firstRow)
  assert.deepEqual(draggedColumn, firstColumn)
})

test('cliques fora do documento e documentos inválidos são no-op', () => {
  assert.equal(createMarqueeSelection('single-row', { x: 2, y: -0.1 }, { x: 0, y: 0 }, documentSize), null)
  assert.equal(createMarqueeSelection('single-row', { x: 2, y: 6 }, { x: 0, y: 0 }, documentSize), null)
  assert.equal(createMarqueeSelection('single-column', { x: 8, y: 2 }, { x: 0, y: 0 }, documentSize), null)
  assert.equal(createMarqueeSelection('rectangle', { x: 1, y: 1 }, { x: 3, y: 3 }, { width: 0, height: 6 }), null)
  assert.equal(createMarqueeSelection('ellipse', { x: Number.NaN, y: 1 }, { x: 3, y: 3 }, documentSize), null)
})

test('formas são recortadas aos limites do documento', () => {
  assert.deepEqual(
    createMarqueeSelection('rectangle', { x: -2, y: -1 }, { x: 4, y: 3 }, documentSize),
    { kind: 'rectangle', bounds: { x: 0, y: 0, width: 4, height: 3 } }
  )
  assert.deepEqual(
    createMarqueeSelection('ellipse', { x: 6, y: 4 }, { x: 12, y: 9 }, documentSize),
    { kind: 'ellipse', bounds: { x: 6, y: 4, width: 2, height: 2 } }
  )
})

test('Linha e Coluna combinam de forma exata com seleções vetoriais e por pixels', () => {
  const row = createMarqueeSelection('single-row', { x: 1, y: 2 }, { x: 1, y: 2 }, documentSize)
  const column = createMarqueeSelection('single-column', { x: 3, y: 1 }, { x: 3, y: 1 }, documentSize)
  const lasso = {
    kind: 'lasso',
    points: [{ x: 0, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 4 }, { x: 0, y: 4 }],
    bounds: { x: 0, y: 1, width: 6, height: 3 }
  }
  const pixels = {
    kind: 'pixels',
    sourceWidth: 8,
    sourceHeight: 6,
    sourceToDocument: [1, 0, 0, 1, 0, 0],
    spans: [{ y: 2, x0: 2, x1: 5 }],
    bounds: { x: 2, y: 2, width: 3, height: 1 },
    pixelCount: 3
  }

  assert.deepEqual(combineSelections(row, column, 'intersect', documentSize)?.bounds, {
    x: 3, y: 2, width: 1, height: 1
  })
  assert.equal(combineSelections(row, lasso, 'intersect', documentSize)?.pixelCount, 6)
  assert.equal(combineSelections(column, pixels, 'intersect', documentSize)?.pixelCount, 1)
})

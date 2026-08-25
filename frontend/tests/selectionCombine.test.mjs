import assert from 'node:assert/strict'
import test from 'node:test'
import {
  combineSelections,
  resolveSelectionCombineMode
} from '../src/editor/selectionCombine.ts'
import { forEachPixelSpan } from '../src/editor/selection.ts'

const documentSize = { width: 8, height: 6 }

function spansArray(selection) {
  if (!selection || selection.kind !== 'pixels') return []
  const spans = []
  forEachPixelSpan(selection.spans, (span) => spans.push(span))
  return spans
}

test('modificadores temporários têm precedência sobre o modo configurado', () => {
  assert.equal(resolveSelectionCombineMode('replace', { shiftKey: false, altKey: false }), 'replace')
  assert.equal(resolveSelectionCombineMode('intersect', { shiftKey: true, altKey: false }), 'add')
  assert.equal(resolveSelectionCombineMode('add', { shiftKey: false, altKey: true }), 'subtract')
  assert.equal(resolveSelectionCombineMode('subtract', { shiftKey: true, altKey: true }), 'intersect')
})

test('substituir preserva a representação e clona seus dados mutáveis', () => {
  const incoming = {
    kind: 'pixels',
    sourceLayerId: 'layer-a',
    sourceWidth: 4,
    sourceHeight: 3,
    sourceToDocument: [1, 0, 0, 1, 2, 1],
    spans: [{ y: 0, x0: 0, x1: 2 }],
    bounds: { x: 0, y: 0, width: 2, height: 1 },
    pixelCount: 2
  }
  const result = combineSelections(null, incoming, 'replace', documentSize)
  assert.deepEqual(result, incoming)
  assert.notEqual(result, incoming)
  assert.notEqual(result.spans, incoming.spans)
  assert.notEqual(result.sourceToDocument, incoming.sourceToDocument)
})

test('união, subtração e interseção combinam retângulos por pixels do documento', () => {
  const first = { kind: 'rectangle', bounds: { x: 0, y: 0, width: 3, height: 2 } }
  const second = { kind: 'rectangle', bounds: { x: 2, y: 0, width: 3, height: 2 } }

  const added = combineSelections(first, second, 'add', documentSize)
  assert.equal(added.pixelCount, 10)
  assert.deepEqual(spansArray(added), [
    { y: 0, x0: 0, x1: 5 },
    { y: 1, x0: 0, x1: 5 }
  ])

  const subtracted = combineSelections(first, second, 'subtract', documentSize)
  assert.equal(subtracted.pixelCount, 4)
  assert.deepEqual(spansArray(subtracted), [
    { y: 0, x0: 0, x1: 2 },
    { y: 1, x0: 0, x1: 2 }
  ])

  const intersected = combineSelections(first, second, 'intersect', documentSize)
  assert.equal(intersected.pixelCount, 2)
  assert.deepEqual(spansArray(intersected), [
    { y: 0, x0: 2, x1: 3 },
    { y: 1, x0: 2, x1: 3 }
  ])
})

test('operações vazias seguem a semântica de seleção sem criar máscara artificial', () => {
  const selection = { kind: 'rectangle', bounds: { x: 1, y: 1, width: 2, height: 2 } }
  assert.deepEqual(combineSelections(null, selection, 'add', documentSize), selection)
  assert.equal(combineSelections(null, selection, 'subtract', documentSize), null)
  assert.equal(combineSelections(null, selection, 'intersect', documentSize), null)
  assert.deepEqual(combineSelections(selection, null, 'subtract', documentSize), selection)
  assert.equal(combineSelections(selection, null, 'intersect', documentSize), null)
})

test('combina seleção vetorial com pixels transformados em espaço do documento', () => {
  const transformedPixels = {
    kind: 'pixels',
    sourceLayerId: 'layer-scaled',
    sourceWidth: 2,
    sourceHeight: 1,
    sourceToDocument: [2, 0, 0, 2, 1, 1],
    spans: [{ y: 0, x0: 0, x1: 2 }],
    bounds: { x: 0, y: 0, width: 2, height: 1 },
    pixelCount: 2
  }
  const rectangle = { kind: 'rectangle', bounds: { x: 2, y: 1, width: 2, height: 2 } }
  const result = combineSelections(transformedPixels, rectangle, 'intersect', { width: 8, height: 5 })

  assert.equal(result.sourceLayerId, undefined)
  assert.deepEqual(result.sourceToDocument, [1, 0, 0, 1, 0, 0])
  assert.deepEqual(result.bounds, { x: 2, y: 1, width: 2, height: 2 })
  assert.deepEqual(spansArray(result), [
    { y: 1, x0: 2, x1: 4 },
    { y: 2, x0: 2, x1: 4 }
  ])
})

test('combina seleção por pixels rotacionada sem depender da camada de origem', () => {
  const rotatedPixels = {
    kind: 'pixels',
    sourceLayerId: 'layer-rotated',
    sourceWidth: 2,
    sourceHeight: 1,
    sourceToDocument: [0, 1, -1, 0, 4, 1],
    spans: [{ y: 0, x0: 0, x1: 2 }],
    bounds: { x: 0, y: 0, width: 2, height: 1 },
    pixelCount: 2
  }
  const column = { kind: 'rectangle', bounds: { x: 3, y: 1, width: 1, height: 2 } }
  const result = combineSelections(rotatedPixels, column, 'intersect', documentSize)
  assert.deepEqual(spansArray(result), [
    { y: 1, x0: 3, x1: 4 },
    { y: 2, x0: 3, x1: 4 }
  ])
})

test('combinação respeita elipse e laço em vez de usar apenas seus bounds', () => {
  const ellipse = { kind: 'ellipse', bounds: { x: 0, y: 0, width: 4, height: 4 } }
  const lasso = {
    kind: 'lasso',
    points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }],
    bounds: { x: 0, y: 0, width: 4, height: 4 }
  }
  const result = combineSelections(ellipse, lasso, 'intersect', documentSize)
  assert.deepEqual(spansArray(result), [
    { y: 0, x0: 1, x1: 3 },
    { y: 1, x0: 0, x1: 2 },
    { y: 2, x0: 0, x1: 1 }
  ])
})

test('todos os pares de representações convergem para a mesma máscara', () => {
  const representations = [
    { kind: 'rectangle', bounds: { x: 1, y: 1, width: 2, height: 2 } },
    { kind: 'ellipse', bounds: { x: 1, y: 1, width: 2, height: 2 } },
    {
      kind: 'lasso',
      points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
      bounds: { x: 1, y: 1, width: 2, height: 2 }
    },
    {
      kind: 'pixels',
      sourceWidth: 8,
      sourceHeight: 6,
      sourceToDocument: [1, 0, 0, 1, 0, 0],
      spans: [{ y: 1, x0: 1, x1: 3 }, { y: 2, x0: 1, x1: 3 }],
      bounds: { x: 1, y: 1, width: 2, height: 2 },
      pixelCount: 4
    }
  ]
  for (const first of representations) {
    for (const second of representations) {
      const result = combineSelections(first, second, 'intersect', documentSize)
      assert.equal(result.pixelCount, 4, `${first.kind}/${second.kind}`)
      assert.deepEqual(spansArray(result), [
        { y: 1, x0: 1, x1: 3 },
        { y: 2, x0: 1, x1: 3 }
      ])
    }
  }
})

test('resultado fragmentado migra para spans compactos sem alterar os pixels', () => {
  const spanCount = 20_001
  const fragmented = {
    kind: 'pixels',
    sourceWidth: spanCount * 2,
    sourceHeight: 1,
    sourceToDocument: [1, 0, 0, 1, 0, 0],
    spans: Array.from({ length: spanCount }, (_, index) => ({ y: 0, x0: index * 2, x1: index * 2 + 1 })),
    bounds: { x: 0, y: 0, width: spanCount * 2 - 1, height: 1 },
    pixelCount: spanCount
  }
  const fullRow = { kind: 'rectangle', bounds: { x: 0, y: 0, width: spanCount * 2, height: 1 } }
  const result = combineSelections(fragmented, fullRow, 'intersect', { width: spanCount * 2, height: 1 })

  assert.equal(result.pixelCount, spanCount)
  assert.equal(result.spans.kind, 'packed-spans')
  assert.equal(result.spans.length, spanCount)
  assert.deepEqual(Array.from(result.spans.data.slice(0, 6)), [0, 0, 1, 0, 2, 3])
  assert.deepEqual(Array.from(result.spans.data.slice(-3)), [0, spanCount * 2 - 2, spanCount * 2 - 1])
})

test('documento enorme processa somente os bounds envolvidos', () => {
  const first = { kind: 'rectangle', bounds: { x: 999_990, y: 999_990, width: 5, height: 5 } }
  const second = { kind: 'rectangle', bounds: { x: 999_992, y: 999_992, width: 5, height: 5 } }
  const result = combineSelections(first, second, 'intersect', { width: 1_000_000, height: 1_000_000 })
  assert.equal(result.pixelCount, 9)
  assert.deepEqual(result.bounds, { x: 999_992, y: 999_992, width: 3, height: 3 })
})

test('combina retângulos em documento 4K por intervalos sem rasterizar pixel a pixel', () => {
  const document = { width: 3840, height: 2160 }
  const full = { kind: 'rectangle', bounds: { x: 0, y: 0, width: 3840, height: 2160 } }
  const cut = { kind: 'rectangle', bounds: { x: 100, y: 100, width: 400, height: 300 } }
  const result = combineSelections(full, cut, 'subtract', document)
  assert.equal(result.pixelCount, 3840 * 2160 - 400 * 300)
  assert.equal(result.spans.length, 2460)
})

test('caminho por intervalos preserva a amostragem pelo centro em bounds fracionários', () => {
  const first = { kind: 'rectangle', bounds: { x: 0.8, y: 0.8, width: 2, height: 2 } }
  const second = { kind: 'rectangle', bounds: { x: 1.2, y: 1.2, width: 2, height: 2 } }
  const result = combineSelections(first, second, 'intersect', { width: 5, height: 5 })
  assert.equal(result.pixelCount, 4)
  assert.deepEqual(spansArray(result), [
    { y: 1, x0: 1, x1: 3 },
    { y: 2, x0: 1, x1: 3 }
  ])
})

test('caminho analítico da elipse preserva a máscara baseada no centro do pixel', () => {
  const ellipse = { kind: 'ellipse', bounds: { x: 0.3, y: 0.7, width: 6.2, height: 4.4 } }
  const full = { kind: 'rectangle', bounds: { x: 0, y: 0, width: 8, height: 6 } }
  const result = combineSelections(ellipse, full, 'intersect', { width: 8, height: 6 })
  const expected = []
  for (let y = 0; y < 6; y++) {
    let start = -1
    for (let x = 0; x <= 8; x++) {
      const inside = x < 8 && ((x + 0.5 - 3.4) / 3.1) ** 2 + ((y + 0.5 - 2.9) / 2.2) ** 2 <= 1 &&
        x + 0.5 >= 0.3 && x + 0.5 < 6.5 && y + 0.5 >= 0.7 && y + 0.5 < 5.1
      if (inside && start < 0) start = x
      if (!inside && start >= 0) { expected.push({ y, x0: start, x1: x }); start = -1 }
    }
  }
  assert.deepEqual(spansArray(result), expected)
})

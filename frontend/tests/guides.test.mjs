import assert from 'node:assert/strict'
import test from 'node:test'
import {
  documentPositionFromScreen,
  formatGuideValue,
  niceRulerStep,
  pixelsPerRulerUnit,
  rulerTicks,
  screenPositionForDocument,
  snapBoundsTranslation,
  snapDocumentPoint,
  snapGuidePositionToTicks,
  snapLayerTranslation
} from '../src/editor/guides.ts'

test('converte unidades usando a resolução do documento', () => {
  assert.equal(pixelsPerRulerUnit('px', 300), 1)
  assert.equal(pixelsPerRulerUnit('in', 300), 300)
  assert.ok(Math.abs(pixelsPerRulerUnit('cm', 254) - 100) < 1e-9)
  assert.ok(Math.abs(pixelsPerRulerUnit('mm', 254) - 10) < 1e-9)
})

test('converte documento e tela sem introduzir erro em zoom fracionário', () => {
  for (const scale of [0.125, 0.4906, 1, 2, 8]) {
    const screen = screenPositionForDocument(731.25, -183.75, scale)
    assert.ok(Math.abs(documentPositionFromScreen(screen, -183.75, scale) - 731.25) < 1e-9)
  }
})

test('a posição exibida da guia respeita unidade e origem da régua', () => {
  const vertical = { orientation: 'vertical', position: 354 }
  const horizontal = { orientation: 'horizontal', position: 254 }
  const origin = { x: 100, y: 0 }

  assert.equal(formatGuideValue(vertical, 'px', 254, origin), '254 px')
  assert.equal(formatGuideValue(vertical, 'px', 254, { x: 100.25, y: 0 }), '253,75 px')
  assert.equal(formatGuideValue(vertical, 'cm', 254, origin), '2,54 cm')
  assert.equal(formatGuideValue(horizontal, 'mm', 254, origin), '25,4 mm')
})

test('escolhe passos legíveis na sequência 1, 2 e 5', () => {
  assert.equal(niceRulerStep(0.7), 1)
  assert.equal(niceRulerStep(12), 20)
  assert.equal(niceRulerStep(220), 500)
})

test('as marcações preservam a origem configurada', () => {
  const layout = rulerTicks(0, 300, 1, 'px', 72, 100)
  const zero = layout.ticks.find((tick) => tick.major && tick.value === 0)
  assert.equal(zero?.position, 100)
  assert.equal(zero?.label, '0')
})

test('Shift encaixa a guia na subdivisão visível da régua', () => {
  assert.equal(snapGuidePositionToTicks(123, 1, 'px', 72, 0), 120)
  assert.equal(snapGuidePositionToTicks(123, 2, 'px', 72, 0), 125)
})

test('snapping de camada mantém tolerância constante em pixels de tela', () => {
  const guides = [{ id: 'v', orientation: 'vertical', position: 100 }]
  const near = snapLayerTranslation({ x: 42, y: 0, width: 50, height: 50 }, guides, 1)
  assert.equal(near.value.x, 50)
  assert.equal(near.snappedX, 100)
  const farAtHighZoom = snapLayerTranslation({ x: 42, y: 0, width: 50, height: 50 }, guides, 2)
  assert.equal(farAtHighZoom.value.x, 42)
})

test('snapping reconhece ponto e limites de uma seleção', () => {
  const guides = [
    { id: 'v', orientation: 'vertical', position: 100 },
    { id: 'h', orientation: 'horizontal', position: 80 }
  ]
  assert.deepEqual(snapDocumentPoint({ x: 96, y: 75 }, guides, 1).value, { x: 100, y: 80 })
  const moved = snapBoundsTranslation({ x: 10, y: 10, width: 40, height: 20 }, 47, 49, guides, 1)
  assert.equal(moved.deltaX, 50)
  assert.equal(moved.deltaY, 50)
})

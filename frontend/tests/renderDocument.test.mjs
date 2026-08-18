import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boundsIntersect,
  layerIntersectsBounds,
  layerIntersectsDocument,
  layerStyledDocumentBounds,
  styledLayerIntersectsBounds
} from '../src/editor/renderBounds.ts'
import { createDefaultLayerEffect, createLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { layerRasterDrawRect } from '../src/services/renderDocument.ts'

const document = { width: 1000, height: 800 }
const layer = (transform) => ({ transform })

test('miniatura ignora camadas completamente fora do documento', () => {
  assert.equal(layerIntersectsDocument(layer({ x: 10, y: 20, width: 100, height: 80 }), document), true)
  assert.equal(layerIntersectsDocument(layer({ x: 1100, y: 20, width: 100, height: 80 }), document), false)
  assert.equal(layerIntersectsDocument(layer({ x: -200, y: 20, width: 100, height: 80 }), document), false)
})

test('interseção considera a caixa visual de uma camada rotacionada', () => {
  assert.equal(layerIntersectsDocument(layer({ x: -60, y: 100, width: 40, height: 160, rotation: 90 }), document), true)
})

test('render parcial considera somente camadas que alcançam a viewport solicitada', () => {
  const viewport = { x: 400, y: 300, width: 1, height: 1 }
  assert.equal(layerIntersectsBounds(layer({ x: 350, y: 250, width: 100, height: 100 }), viewport), true)
  assert.equal(layerIntersectsBounds(layer({ x: 0, y: 0, width: 100, height: 100 }), viewport), false)
  assert.equal(layerIntersectsBounds(layer({ x: 401, y: 300, width: 10, height: 10 }), viewport), false)
})

test('bounds que apenas encostam não produzem pixels na mesma viewport', () => {
  assert.equal(boundsIntersect(
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 10, y: 0, width: 1, height: 1 }
  ), false)
  assert.equal(boundsIntersect(
    { x: 0, y: 0, width: 10.1, height: 10 },
    { x: 10, y: 0, width: 1, height: 1 }
  ), true)
})

test('geometria do raster composto preserva escala e offsets do conteúdo original', () => {
  assert.deepEqual(layerRasterDrawRect(
    { x: 30, y: 40, width: 200, height: 100, rotation: 15 },
    {
      sourceWidth: 100,
      sourceHeight: 50,
      renderedWidth: 120,
      renderedHeight: 70,
      offsetX: -10,
      offsetY: -5
    }
  ), { x: -120, y: -60, width: 240, height: 140 })
})

test('bounds estilizados incluem o brilho que alcança uma viewport externa à camada', () => {
  const glow = createDefaultLayerEffect('outer-glow', 'bounds-glow')
  glow.size = 20
  const styledLayer = {
    transform: { x: 100, y: 100, width: 50, height: 40, rotation: 0 },
    styles: { ...createLayerStyleConfig(), effects: [glow] }
  }
  const light = { angle: 120, altitude: 30 }
  assert.deepEqual(layerStyledDocumentBounds(styledLayer, light), { x: 80, y: 80, width: 90, height: 80 })
  assert.equal(layerIntersectsBounds(styledLayer, { x: 75, y: 100, width: 10, height: 10 }), false)
  assert.equal(styledLayerIntersectsBounds(styledLayer, { x: 75, y: 100, width: 10, height: 10 }, light), true)
})

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
import { layerAppearanceRenderPlan, layerRasterDrawRect } from '../src/services/renderDocument.ts'

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

test('aparência local força visibilidade e isola opacidade e mesclagem externas', () => {
  const source = {
    id: 'layer-appearance',
    name: 'Camada',
    visible: false,
    opacity: 37,
    blendMode: 'multiply',
    kind: 'image',
    styles: createLayerStyleConfig(),
    image: { width: 20, height: 10, mimeType: 'image/png', sourceUrl: 'blob:source' },
    transform: { x: -3.4, y: 7.2, width: 20, height: 10, rotation: 0 }
  }
  const plan = layerAppearanceRenderPlan({ ...document, background: 'transparent', layerStyleGlobalLight: { angle: 120, altitude: 30 } }, source, 'local')
  assert.deepEqual(plan?.viewport, { x: -4, y: 7, width: 21, height: 11 })
  assert.equal(plan?.layer.visible, true)
  assert.equal(plan?.layer.opacity, 100)
  assert.equal(plan?.layer.blendMode, 'normal')
  assert.equal(source.visible, false)
  assert.equal(source.opacity, 37)
  assert.equal(source.blendMode, 'multiply')
})

test('exportação isolada incorpora opacidade mas nunca o blend externo', () => {
  const source = {
    id: 'layer-export',
    name: 'Camada',
    visible: true,
    opacity: 42,
    blendMode: 'screen',
    kind: 'text',
    styles: createLayerStyleConfig(),
    text: { content: 'Axia', fontFamily: 'Arial', fontSize: 20, fontWeight: 400, color: '#fff', alignment: 'left', lineHeight: 1.2, baseWidth: 50, baseHeight: 24 },
    transform: { x: 10, y: 20, width: 50, height: 24, rotation: 0 }
  }
  const plan = layerAppearanceRenderPlan({ ...document, background: 'transparent', layerStyleGlobalLight: { angle: 120, altitude: 30 } }, source, 'isolated-export')
  assert.equal(plan?.layer.opacity, 42)
  assert.equal(plan?.layer.blendMode, 'normal')
})

test('aparência isolada recusa camada vazia e materializa fundo sintético', () => {
  const spec = { ...document, background: 'white', layerStyleGlobalLight: { angle: 120, altitude: 30 } }
  assert.equal(layerAppearanceRenderPlan(spec, {
    id: 'empty', name: 'Vazia', visible: true, opacity: 100, blendMode: 'normal', kind: 'pixel', styles: createLayerStyleConfig()
  }, 'local'), null)
  assert.deepEqual(layerAppearanceRenderPlan(spec, {
    id: 'legacy-background', name: 'Fundo', visible: false, opacity: 75, blendMode: 'multiply', kind: 'background', styles: createLayerStyleConfig()
  }, 'local')?.viewport, { x: 0, y: 0, width: 1000, height: 800 })
})

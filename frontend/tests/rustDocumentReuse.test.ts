import assert from 'node:assert/strict'
import test from 'node:test'
import { rustDocumentReusable, sameRustDocumentPreparation } from '../src/editor/rustDocumentReuse.ts'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import type { RustEditorialPlan } from '../src/editor/rustDocumentEditorial.ts'
import { planRustDocumentShape } from '../src/editor/rustDocumentShape.ts'
import { DEFAULT_SHAPE_CONFIG } from '../src/editor/shape.ts'

function plan(): RustEditorialPlan {
  return { documentWidth: 2, documentHeight: 1, width: 2, height: 1,
    grid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layers: [{
      source: { type: 'raster', url: 'blob:fixture' },
      input: { sourceIdentity: 'image:1', sourceWidth: 1, sourceHeight: 1,
        styles: normalizeLayerStyleConfig({}), globalLight: { angle: 120, altitude: 30 } },
      matrix: [1, 0, 0, 1, 0, 0], opacity: 100, blendMode: 'normal' }] }
}

test('identidade da preparação ignora somente dimensões/região de saída, não a seleção de camadas', () => {
  const a = plan(), b = structuredClone(a)
  b.width = 1; b.grid.originX = 1
  assert.ok(sameRustDocumentPreparation(a, b))
  b.layers = []; assert.equal(sameRustDocumentPreparation(a, b), false)
})

test('alterações de conteúdo, estilo, transformação, luz, documento e ordem invalidam a preparação', () => {
  const a = plan()
  for (const mutate of [
    (p: RustEditorialPlan) => { p.documentWidth++ },
    (p: RustEditorialPlan) => { p.documentHeight++ },
    (p: RustEditorialPlan) => { p.layers[0]!.source = { type: 'raster', url: 'blob:changed' } },
    (p: RustEditorialPlan) => { p.layers[0]!.input.sourceIdentity += ':edited' },
    (p: RustEditorialPlan) => { p.layers[0]!.input.styles.fillOpacity = 50 },
    (p: RustEditorialPlan) => { p.layers[0]!.input.globalLight = { angle: 30, altitude: 45 } },
    (p: RustEditorialPlan) => { p.layers[0]!.input.resolutionScale = 2 },
    (p: RustEditorialPlan) => { p.layers[0]!.matrix = [1, 0, 0, 1, 1, 0] },
    (p: RustEditorialPlan) => { p.layers[0]!.opacity = 50 },
    (p: RustEditorialPlan) => { p.layers[0]!.blendMode = 'multiply' }
  ]) {
    const b = structuredClone(a); mutate(b)
    assert.equal(sameRustDocumentPreparation(a, b), false)
  }
  const bottom = structuredClone(a.layers[0]!); bottom.opacity = 50
  a.layers.push(bottom)
  const b = structuredClone(a); b.layers.reverse()
  assert.equal(sameRustDocumentPreparation(a, b), false)
})

test('equivalência compara campos exatamente, sem hash ou colisões da serialização JSON', () => {
  const a = plan(), b = structuredClone(a), item = b.layers[0]!
  item.input = { styles: item.input.styles, sourceWidth: 1, sourceHeight: 1,
    sourceIdentity: 'image:1', globalLight: { altitude: 30, angle: 120 } }
  assert.ok(sameRustDocumentPreparation(a, b))
  item.matrix = [1, -0, 0, 1, 0, 0]
  assert.equal(sameRustDocumentPreparation(a, b), false)
  item.matrix = a.layers[0]!.matrix
  item.input.resolutionScale = undefined
  assert.equal(sameRustDocumentPreparation(a, b), false)
})

test('cor, geometria e alfa de formas/fundo participam da identidade', () => {
  const a = plan(), source = planRustDocumentShape({ ...DEFAULT_SHAPE_CONFIG, baseWidth: 2, baseHeight: 1 },
    { x: 0, y: 0, width: 2, height: 1 }, 2, 1, 1)!
  a.layers[0]!.source = source
  for (const field of ['alpha', 'width', 'originX'] as const) {
    const b = structuredClone(a)
    if (b.layers[0]!.source.type === 'shape') b.layers[0]!.source[field] += 0.25
    assert.equal(sameRustDocumentPreparation(a, b), false)
  }
  const b = structuredClone(a)
  if (b.layers[0]!.source.type === 'shape') b.layers[0]!.source.shape.color = '#ff0000'
  assert.equal(sameRustDocumentPreparation(a, b), false)
  a.layers[0]!.source = { type: 'solid', color: [0, 0, 0, 255] }
  b.layers[0]!.source = { type: 'solid', color: [255, 0, 0, 255] }
  assert.equal(sameRustDocumentPreparation(a, b), false)
})

test('somente mídias imutáveis admitem reuso; padrões também precisam ser Blob/data', () => {
  const p = plan()
  for (const url of ['blob:immutable', 'data:image/png;base64,abc']) {
    p.layers[0]!.source = { type: 'raster', url }; assert.ok(rustDocumentReusable(p))
  }
  for (const url of ['https://example.test/image.png', '/assets/image.png', 'file:///image.png']) {
    p.layers[0]!.source = { type: 'raster', url }; assert.equal(rustDocumentReusable(p), false)
  }
  p.layers[0]!.source = { type: 'solid', color: [0, 0, 0, 255] }
  p.layers[0]!.input.styles = normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern: {
    id: 'pattern', name: 'pattern', width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'https://example.test/pattern.png'
  } }] })
  assert.equal(rustDocumentReusable(p), false)
  const effect = p.layers[0]!.input.styles.effects[0]!
  if (effect.type === 'pattern-overlay') effect.pattern!.sourceUrl = 'blob:pattern'
  assert.ok(rustDocumentReusable(p))
})

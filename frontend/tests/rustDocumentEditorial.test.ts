import assert from 'node:assert/strict'
import test from 'node:test'
import { planRustEditorialDocument, rustDocumentSourceMatrix, RustDocumentUnsupported, rustDocumentEnabled } from '../src/editor/rustDocumentEditorial.ts'
import { rustStylePreviewEnabled } from '../src/editor/rustStylePreviewProtocol.ts'
import { layer, image, transform, styles } from './editorTestFixtures.ts'
import type { DocumentSpec } from '../src/types/editor.ts'
import { DEFAULT_SHAPE_CONFIG } from '../src/editor/shape.ts'
import { planRustDocumentShape, validateRustDocumentShape } from '../src/editor/rustDocumentShape.ts'
import { layerAppearanceRenderPlan } from '../src/services/renderDocument.ts'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'

const document: DocumentSpec = { id: 'doc', name: 'doc', width: 8, height: 6, unit: 'px',
  physicalWidth: 8, physicalHeight: 6, resolutionDpi: 72, colorSpace: 'srgb', background: 'transparent',
  createdAt: '', layerStyleGlobalLight: { angle: 120, altitude: 30 } }
const viewport = { x: 0, y: 0, width: 8, height: 6 }
const picture = () => layer({ image: image({ width: 2, height: 2 }), transform: transform({ width: 2, height: 2 }) })

test('adapter documental preserva ordem, fundo sintético e snapshot sem mutar camadas', () => {
  const top = { ...picture(), id: 'top' }, bottom = { ...picture(), id: 'bottom' }
  const background = layer({ id: 'background', kind: 'background', opacity: 80, styles: styles({ fillOpacity: 50 }) })
  const plan = planRustEditorialDocument({ ...document, background: 'white' }, [top, bottom, background], 8, 6, viewport)
  assert.deepEqual(plan.layers.map(item => item.input.sourceIdentity.split(':')[0]), ['document-background', 'bottom', 'top'])
  assert.equal(plan.layers[0]!.opacity, 40)
  top.styles.fillOpacity = 0; top.transform!.x = 100
  assert.equal(plan.layers[2]!.input.styles.fillOpacity, 100); assert.equal(plan.layers[2]!.matrix[4], 0)
})

test('matriz editorial aplica rotação no centro e deslocamento de padding na base transformada', () => {
  const matrix = rustDocumentSourceMatrix(transform({ x: 10, y: 20, width: 4, height: 2, rotation: 90 }), 2, 1, -1, -2)
  for (const [actual, expected] of matrix.map((v, i) => [v, [0, 2, -2, 0, 17, 17][i]!])) assert.ok(Math.abs(actual! - expected!) < 1e-10)
  assert.throws(() => rustDocumentSourceMatrix(transform({ width: 0 }), 2, 1))
})

test('conta-gotas usa origem documental sem recentralizar ou recortar fontes/halos', () => {
  const pictureLayer = picture(); pictureLayer.transform!.x = 3; pictureLayer.transform!.y = 2
  const plan = planRustEditorialDocument(document, [pictureLayer], 1, 1, { x: 3, y: 2, width: 1, height: 1 })
  assert.deepEqual(plan.grid, { scaleX: 1, scaleY: 1, originX: 3, originY: 2 })
  assert.equal(plan.layers[0]!.input.sourceWidth, 2); assert.equal(plan.layers[0]!.matrix[4], 3)
})

test('camada de texto sem conteúdo e escala de saída ficam no fallback', () => {
  assert.throws(() => planRustEditorialDocument(document, [layer({ kind: 'text', transform: transform() })], 8, 6, viewport), RustDocumentUnsupported)
  assert.throws(() => planRustEditorialDocument(document, [picture()], 4, 3, viewport), /output-scale-or-size/)
  assert.equal(planRustEditorialDocument(document, [layer({ kind: 'text', visible: false, transform: transform() })], 8, 6, viewport).layers.length, 0)
})

test('formas são traçadas em pixels documentais, inclusive ao reduzir suas dimensões vetoriais', () => {
  for (const kind of ['rectangle', 'ellipse', 'triangle', 'star'] as const) {
    const item = layer({ kind: 'shape', shape: { ...DEFAULT_SHAPE_CONFIG, kind, baseWidth: 1000, baseHeight: 500 },
      transform: transform({ x: 1, y: 2, width: 4, height: 2 }), opacity: 63.7, styles: styles({ fillOpacity: 37 }) })
    const plan = planRustEditorialDocument(document, [item], 8, 6, viewport), entry = plan.layers[0]!
    assert.equal(entry.source.type, 'shape'); assert.equal(entry.opacity, 100)
    assert.equal(entry.input.styles.fillOpacity, 100); assert.deepEqual(entry.matrix, [1, 0, 0, 1, 1, 2])
    if (entry.source.type !== 'shape') throw new Error('fonte ausente')
    assert.equal(entry.source.width, 4); assert.equal(entry.source.height, 2)
    assert.equal(entry.source.alpha, (63.7 / 100) * 0.37)
    item.shape!.color = '#ff0000'; assert.equal(entry.source.shape.color, '#000000')
  }
})

test('forma fracionária/rotacionada não passa por segunda amostragem afim', () => {
  const item = layer({ kind: 'shape', shape: { ...DEFAULT_SHAPE_CONFIG, baseWidth: 4, baseHeight: 2 },
    transform: transform({ x: 1.25, y: 1.125, width: 4.5, height: 2.75, rotation: 37 }) })
  const entry = planRustEditorialDocument(document, [item], 8, 6, viewport).layers[0]!
  assert.equal(entry.source.type, 'shape')
  if (entry.source.type !== 'shape') throw new Error('fonte ausente')
  assert.deepEqual(entry.matrix, [1, 0, 0, 1, entry.source.originX, entry.source.originY])
  assert.ok(Number.isInteger(entry.source.originX) && Number.isInteger(entry.source.originY))
  assert.equal(entry.source.transform.rotation, 37)
})

test('bounds de forma são inteiros e recortados no documento, não no tile do conta-gotas', () => {
  const shape = { ...DEFAULT_SHAPE_CONFIG, baseWidth: 4, baseHeight: 4 }
  const clipped = planRustDocumentShape(shape, transform({ x: -1.25, y: -1.5, width: 4, height: 4 }), 8, 6, 1)!
  assert.deepEqual([clipped.originX, clipped.originY, clipped.width, clipped.height], [0, 0, 3, 3])
  validateRustDocumentShape(clipped, 8, 6)
  assert.throws(() => validateRustDocumentShape({ ...clipped, originX: 1 }, 8, 6), /invalid-input/)
  assert.equal(planRustDocumentShape(shape, transform({ x: 100, y: 100, width: 4, height: 4 }), 8, 6, 1), null)
  const item = layer({ kind: 'shape', shape, transform: transform({ x: 1, y: 1, width: 4, height: 4 }) })
  const source = planRustEditorialDocument(document, [item], 1, 1, { x: 2, y: 2, width: 1, height: 1 }).layers[0]!.source
  assert.equal(source.type, 'shape'); if (source.type === 'shape') assert.deepEqual([source.width, source.height], [4, 4])
})

test('efeitos/Blend If de forma permanecem explícitos no fallback; dimensão/cor inválidas não alocam', () => {
  const shape = { ...DEFAULT_SHAPE_CONFIG, baseWidth: 4, baseHeight: 4 }
  const item = layer({ kind: 'shape', shape, transform: transform({ width: 4, height: 4 }) })
  item.styles.blendIf.thisLayer.shadows = [0, 128]
  assert.throws(() => planRustEditorialDocument(document, [item], 8, 6, viewport), /shape-style/)
  item.styles = styles({ fillOpacity: 37 }); item.opacity = 125
  assert.throws(() => planRustEditorialDocument(document, [item], 8, 6, viewport), /invalid-input/)
  assert.throws(() => planRustDocumentShape({ ...shape, color: 'red' }, item.transform!, 8, 6, 1), /invalid-input/)
  assert.throws(() => planRustDocumentShape({ ...shape, baseWidth: 0 }, item.transform!, 8, 6, 1), /invalid-input/)
  assert.throws(() => planRustDocumentShape(shape, transform({ width: 4096, height: 2048 }), 4096, 2048, 1), /memory-limit/)
})

test('preflight editorial limita fonte e metadata antes do clone/fetch/decode', () => {
  const large = picture(); large.image!.width = 4096; large.image!.height = 2048
  large.transform!.width = 4096; large.transform!.height = 2048
  assert.throws(() => planRustEditorialDocument(document, [large], 8, 6, viewport), /memory-limit/)
  const metadata = picture(); metadata.image!.sourceUrl = 'x'.repeat(300_000)
  assert.throws(() => planRustEditorialDocument(document, [metadata], 8, 6, viewport), /memory-limit/)
})

test('aparência isolada normaliza origem negativa sem cortar conteúdo fora do documento', () => {
  const item = picture(); item.transform!.x = -3; item.transform!.y = -2
  item.visible = false; item.opacity = 37; item.blendMode = 'multiply'
  const appearance = layerAppearanceRenderPlan(document, item, 'local')!
  const result = planRustEditorialDocument(document, [appearance.layer], 2, 2, appearance.viewport, 'appearance')
  assert.equal(result.documentWidth, 2); assert.equal(result.documentHeight, 2)
  assert.deepEqual(result.grid, { scaleX: 1, scaleY: 1, originX: 0, originY: 0 })
  assert.deepEqual(result.layers[0]!.matrix, [1, 0, -0, 1, 0, 0])
  assert.equal(result.layers[0]!.opacity, 100); assert.equal(result.layers[0]!.blendMode, 'normal')
  assert.equal(item.transform!.x, -3); assert.equal(item.visible, false); assert.equal(item.opacity, 37)
})

test('normalizar bounds de aparência não altera base afim, escala de estilos nem luz', () => {
  const item = picture(); item.transform = transform({ x: -4, y: -2, width: 2, height: 2, rotation: 90 })
  item.styles = normalizeLayerStyleConfig({ effects: [{ type: 'drop-shadow', size: 1, distance: 2, angle: 0, useGlobalLight: false }] })
  const appearance = layerAppearanceRenderPlan(document, item, 'isolated-export')!
  const { viewport: bounds } = appearance
  const result = planRustEditorialDocument(document, [appearance.layer], bounds.width, bounds.height, bounds, 'appearance')
  const expected = rustDocumentSourceMatrix(item.transform, 2, 2), actual = result.layers[0]!.matrix
  assert.deepEqual(actual.slice(0, 4), expected.slice(0, 4))
  assert.equal(actual[4], expected[4] - bounds.x); assert.equal(actual[5], expected[5] - bounds.y)
  assert.equal(result.layers[0]!.input.resolutionScale, 1)
  assert.deepEqual(result.layers[0]!.input.globalLight, document.layerStyleGlobalLight)
})

test('formas externas usam bounds da aparência e mantêm o clipping documental nos demais consumidores', () => {
  for (const kind of ['rectangle', 'ellipse', 'triangle', 'star'] as const) {
    const item = layer({ kind: 'shape', shape: { ...DEFAULT_SHAPE_CONFIG, kind, baseWidth: 100, baseHeight: 50 },
      transform: transform({ x: -4, y: -3, width: 4, height: 2 }), opacity: 50 })
    const bounds = { x: -4, y: -3, width: 4, height: 2 }
    const result = planRustEditorialDocument(document, [item], 4, 2, bounds, 'appearance'), source = result.layers[0]!.source
    assert.equal(source.type, 'shape')
    if (source.type === 'shape') {
      assert.deepEqual([source.width, source.height, source.transform.x, source.transform.y, source.alpha], [4, 2, 0, 0, 0.5])
      validateRustDocumentShape(source, 4, 2)
    }
    assert.equal(planRustEditorialDocument(document, [item], 4, 2, bounds).layers.length, 0)
  }
})

test('fundo sintético preserva o retângulo original, sem preencher toda a viewport externa', () => {
  const background = layer({ kind: 'background', opacity: 50, styles: styles({ fillOpacity: 50 }) })
  const result = planRustEditorialDocument({ ...document, background: 'white' }, [background], 12, 9,
    { x: -2, y: -1, width: 12, height: 9 }, 'appearance')
  assert.deepEqual(result.layers[0]!.matrix, [8, 0, 0, 6, 2, 1]); assert.equal(result.layers[0]!.opacity, 25)
  assert.equal(result.documentWidth, 12); assert.equal(result.documentHeight, 9)
})

test('aparência não libera texto sem conteúdo nem origens não inteiras ou extremas', () => {
  for (const x of [0.5, 0x1_0000_0000, Infinity]) {
    assert.throws(() => planRustEditorialDocument(document, [], 2, 2, { x, y: 0, width: 2, height: 2 }, 'appearance'), /invalid-input/)
  }
  const item = picture(); item.transform!.width = 1
  assert.equal(planRustEditorialDocument(document, [item], 2, 2, { x: 0, y: 0, width: 2, height: 2 }, 'appearance').layers[0]!.sampling,
    'raster-bilinear')
  assert.throws(() => planRustEditorialDocument(document, [layer({ kind: 'text', transform: transform() })],
    2, 2, { x: 0, y: 0, width: 2, height: 2 }, 'appearance'), /non-image-layer/)
})

test('adapter editorial admite bilinear raster axial, mas não rotação arbitrária/grade fracionária', () => {
  assert.throws(() => planRustEditorialDocument(document, [picture()], 1, 1,
    { x: 0.25, y: 0, width: 1, height: 1 }), /output-grid-quality/)
  for (const boundsPolicy of ['document', 'appearance'] as const) {
    for (const patch of [{ rotation: 37 }, { rotation: 0.001 }]) {
      const item = picture(); Object.assign(item.transform!, patch)
      assert.throws(() => planRustEditorialDocument(document, [item], 8, 6, viewport, boundsPolicy), /source-transform-quality/)
    }
    for (const patch of [{ x: 0.25 }, { y: 0.5 }, { width: 4 }, { height: 4 }, { width: 3, height: 3, x: 0.25, y: 0.5 }]) {
      const item = picture(); Object.assign(item.transform!, patch)
      const result = planRustEditorialDocument(document, [item], 8, 6, viewport, boundsPolicy)
      assert.equal(result.layers[0]!.sampling, 'raster-bilinear')
    }
    for (const rotation of [0, 90, -90, 180, 270, 360]) {
      const item = picture(); item.transform!.rotation = rotation
      assert.equal(planRustEditorialDocument(document, [item], 8, 6, viewport, boundsPolicy).layers.length, 1)
    }
  }
})

test('reamostragem com dependência de Blend If inferior exige gate documental, não apenas da camada atual', () => {
  const lower = picture(), upper = picture()
  lower.transform!.x = 0.25
  upper.styles.blendIf.underlyingLayer.shadows = [128, 128]
  assert.throws(() => planRustEditorialDocument(document, [upper, lower], 8, 6, viewport), /source-transform-blend-if/)
  lower.transform!.x = 0
  assert.equal(planRustEditorialDocument(document, [upper, lower], 8, 6, viewport).layers.length, 2)
})

test('precisão raster é explícita por caminho de desenho e participa do snapshot', () => {
  for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const) {
    const item = picture(); item.transform!.x = 0.25; item.blendMode = blendMode
    const entry = planRustEditorialDocument(document, [item], 8, 6, viewport).layers[0]!
    assert.equal(entry.sampling, blendMode === 'normal' ? 'raster-bilinear' : 'raster-bilinear-precise')
    item.transform!.rotation = 90
    assert.equal(planRustEditorialDocument(document, [item], 8, 6, viewport).layers[0]!.sampling, 'raster-bilinear-precise')
  }
})

test('flag documental é explícito e tem precedência sobre estilos Rust separados', () => {
  assert.equal(rustDocumentEnabled('?axiaRustDocument=1'), true)
  assert.equal(rustDocumentEnabled('?axiaRustDocument=true'), false)
  assert.equal(rustStylePreviewEnabled('?axiaRustStyles=1'), true)
  assert.equal(rustStylePreviewEnabled('?axiaRustDocument=1&axiaRustStyles=1'), false)
})

test('redução escolhe bilinear até 0,5, média de área abaixo e recusa o que nenhum modo representa', () => {
  const sized = (width: number, height: number, rotation = 0) => {
    const item = picture(); Object.assign(item.transform!, { width, height, rotation }); return item
  }
  const sampling = (item: ReturnType<typeof picture>) => planRustEditorialDocument(document, [item], 8, 6, viewport).layers[0]!.sampling
  assert.equal(sampling(sized(1, 1.5)), 'raster-bilinear') // 0,5 × 0,75
  assert.equal(sampling({ ...sized(1, 1.5), blendMode: 'multiply' }), 'raster-bilinear-precise')
  assert.equal(sampling(sized(0.5, 1.5)), 'raster-area') // 0,25 × 0,75
  assert.equal(sampling(sized(0.6, 0.6, 90)), 'raster-area')
  assert.equal(sampling(sized(0.6, 0.6, 180)), 'raster-area')
  // Redução forte num eixo com ampliação no outro, e rotação arbitrária na redução.
  assert.throws(() => planRustEditorialDocument(document, [sized(0.5, 8)], 8, 6, viewport), /source-transform-quality/)
  assert.throws(() => planRustEditorialDocument(document, [sized(0.6, 0.6, 30)], 8, 6, viewport), /source-transform-quality/)
})

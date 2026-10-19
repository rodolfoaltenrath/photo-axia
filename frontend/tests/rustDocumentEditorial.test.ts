import assert from 'node:assert/strict'
import test from 'node:test'
import { planRustEditorialDocument, rustDocumentSourceMatrix, RustDocumentUnsupported, rustDocumentEnabled } from '../src/editor/rustDocumentEditorial.ts'
import { rustStylePreviewEnabled } from '../src/editor/rustStylePreviewProtocol.ts'
import { layer, image, transform, styles } from './editorTestFixtures.ts'
import type { DocumentSpec } from '../src/types/editor.ts'

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

test('texto/formas, redução de fonte e escala de saída ficam explicitamente no fallback', () => {
  assert.throws(() => planRustEditorialDocument(document, [layer({ kind: 'text', transform: transform() })], 8, 6, viewport), RustDocumentUnsupported)
  const smaller = picture(); smaller.transform!.width = 1
  assert.throws(() => planRustEditorialDocument(document, [smaller], 8, 6, viewport), /source-minification/)
  assert.throws(() => planRustEditorialDocument(document, [picture()], 4, 3, viewport), /output-scale-or-size/)
  assert.equal(planRustEditorialDocument(document, [layer({ kind: 'text', visible: false, transform: transform() })], 8, 6, viewport).layers.length, 0)
})

test('preflight editorial limita fonte e metadata antes do clone/fetch/decode', () => {
  const large = picture(); large.image!.width = 4096; large.image!.height = 2048
  large.transform!.width = 4096; large.transform!.height = 2048
  assert.throws(() => planRustEditorialDocument(document, [large], 8, 6, viewport), /memory-limit/)
  const metadata = picture(); metadata.image!.sourceUrl = 'x'.repeat(300_000)
  assert.throws(() => planRustEditorialDocument(document, [metadata], 8, 6, viewport), /memory-limit/)
})

test('flag documental é explícito e tem precedência sobre estilos Rust separados', () => {
  assert.equal(rustDocumentEnabled('?axiaRustDocument=1'), true)
  assert.equal(rustDocumentEnabled('?axiaRustDocument=true'), false)
  assert.equal(rustStylePreviewEnabled('?axiaRustStyles=1'), true)
  assert.equal(rustStylePreviewEnabled('?axiaRustDocument=1&axiaRustStyles=1'), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAlignmentTargets,
  snapTransformToAlignmentTargets
} from '../src/editor/smartGuides.ts'

const document = { width: 1000, height: 800 }
const layer = (id, transform, visible = true) => ({
  id,
  name: id,
  visible,
  opacity: 100,
  kind: 'image',
  transform
})

test('encaixa o centro do objeto no centro do documento e produz linhas inteligentes', () => {
  const targets = createAlignmentTargets({ document })
  const result = snapTransformToAlignmentTargets(
    { x: 446, y: 347, width: 100, height: 100, rotation: 0 },
    targets,
    1
  )
  assert.equal(result.value.x, 450)
  assert.equal(result.value.y, 350)
  assert.deepEqual(result.lines.map((line) => [line.orientation, line.position, line.source]), [
    ['vertical', 500, 'document'],
    ['horizontal', 400, 'document']
  ])
})

test('encaixa bordas e centros de outras camadas visíveis', () => {
  const targets = createAlignmentTargets({
    document,
    layers: [layer('reference', { x: 200, y: 150, width: 120, height: 80, rotation: 0 })]
  })
  const result = snapTransformToAlignmentTargets(
    { x: 317, y: 227, width: 50, height: 30, rotation: 0 },
    targets,
    1
  )
  assert.equal(result.value.x, 320)
  assert.equal(result.value.y, 230)
  assert.ok(result.lines.every((line) => line.source === 'layer'))
})

test('ignora as camadas pertencentes ao grupo que está sendo movido', () => {
  const targets = createAlignmentTargets({
    document,
    excludedLayerIds: ['selected'],
    layers: [
      layer('selected', { x: 200, y: 150, width: 120, height: 80, rotation: 0 }),
      layer('hidden', { x: 300, y: 200, width: 100, height: 100, rotation: 0 }, false)
    ]
  })
  assert.equal(targets.some((target) => target.source === 'layer'), false)
})

test('guia manual tem prioridade sobre documento e camada dentro da tolerância', () => {
  const targets = createAlignmentTargets({
    document,
    guides: [{ id: 'manual', orientation: 'vertical', position: 496 }],
    layers: [layer('reference', { x: 500, y: 0, width: 50, height: 50, rotation: 0 })]
  })
  const result = snapTransformToAlignmentTargets(
    { x: 491, y: 300, width: 10, height: 10, rotation: 0 },
    targets,
    1
  )
  assert.equal(result.snappedX, 496)
  assert.equal(result.lines.some((line) => line.orientation === 'vertical'), false)
})

test('mantém tolerância curta na tela e limita saltos em zoom baixo', () => {
  const targets = createAlignmentTargets({ document })
  const near = { x: 443, y: 100, width: 100, height: 100, rotation: 0 }
  const far = { x: 437, y: 100, width: 100, height: 100, rotation: 0 }
  assert.equal(snapTransformToAlignmentTargets(near, targets, 1).value.x, 443)
  assert.equal(snapTransformToAlignmentTargets(near, targets, 0.5).value.x, 450)
  assert.equal(snapTransformToAlignmentTargets(far, targets, 0.25).value.x, 437)
})

test('não encaixa o centro de um objeto na borda de outro objeto', () => {
  const targets = createAlignmentTargets({
    document: { width: 2000, height: 1600 },
    layers: [layer('reference', { x: 400, y: 400, width: 200, height: 100, rotation: 0 })]
  })
  const result = snapTransformToAlignmentTargets(
    { x: 348, y: 700, width: 100, height: 50, rotation: 0 },
    targets,
    1
  )
  assert.equal(result.value.x, 348)
})

test('a caixa externa de um grupo pode ser alinhada como uma unidade', () => {
  const targets = createAlignmentTargets({ document })
  const groupBounds = { x: 297, y: 297, width: 400, height: 200, rotation: 0 }
  const result = snapTransformToAlignmentTargets(groupBounds, targets, 1)
  assert.equal(result.value.x, 300)
  assert.equal(result.value.y, 300)
})

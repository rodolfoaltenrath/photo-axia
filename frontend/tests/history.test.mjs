import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyEditorHistoryDelta,
  estimateEditorHistoryBytes,
  historyDeltaObjectUrls,
  isEditorHistoryDeltaNoop,
  mergeEditorHistoryDelta
} from '../src/editor/editorHistory.ts'
import { useHistory } from '../src/editor/history.ts'

const deltaOptions = {
  estimateBytes: (delta) => JSON.stringify(delta).length * 2,
  merge: (previous, next) => ({ before: previous.before, after: next.after })
}

test('mantém assets raster do antes e depois disponíveis para desfazer', () => {
  const delta = {
    type: 'layer:patch',
    layerId: 'image',
    before: { image: { width: 10, height: 10, mimeType: 'image/png', sourceUrl: 'blob:before', byteSize: 120 } },
    after: {
      image: {
        width: 10,
        height: 10,
        mimeType: 'image/png',
        sourceUrl: 'blob:after',
        previewUrl: 'blob:preview',
        byteSize: 140
      }
    }
  }
  assert.deepEqual(historyDeltaObjectUrls(delta).sort(), ['blob:after', 'blob:before', 'blob:preview'])
  assert.ok(estimateEditorHistoryBytes(delta) >= 260)
})

test('desfaz e refaz usando somente o delta da ação', () => {
  const history = useHistory(deltaOptions)
  history.record('Mover camada', { before: 0, after: 24 })

  const undo = history.undo()
  assert.deepEqual(undo?.steps, [{ delta: { before: 0, after: 24 }, direction: 'undo' }])
  assert.equal(history.canRedo.value, true)
  assert.equal(history.redo()?.steps[0]?.direction, 'redo')
  assert.equal(history.canUndo.value, true)
})

test('agrupa alterações contínuas preservando o primeiro e o último valor', () => {
  const history = useHistory(deltaOptions)
  history.record('Editar texto', { before: '', after: 'A' }, { mergeKey: 'text:1' })
  history.record('Editar texto', { before: 'A', after: 'Axia' }, { mergeKey: 'text:1' })

  assert.equal(history.currentPosition.value, 1)
  assert.deepEqual(history.undo()?.steps[0]?.delta, { before: '', after: 'Axia' })
})

test('descarta ações futuras ao criar uma nova ramificação', () => {
  const history = useHistory(deltaOptions)
  history.record('A', { before: 0, after: 1 })
  history.record('B', { before: 1, after: 2 })
  history.undo()
  history.record('C', { before: 1, after: 3 })

  assert.equal(history.canRedo.value, false)
  assert.deepEqual(history.timeline.value.map((item) => item.label), ['Documento criado', 'A', 'C'])
})

test('salta pela linha do tempo retornando deltas em ordem de aplicação', () => {
  const history = useHistory(deltaOptions)
  history.record('A', { before: 0, after: 1 })
  history.record('B', { before: 1, after: 2 })
  history.record('C', { before: 2, after: 3 })

  assert.deepEqual(history.jump(0)?.steps.map((step) => step.direction), ['undo', 'undo', 'undo'])
  assert.deepEqual(history.jump(2)?.steps.map((step) => step.direction), ['redo', 'redo'])
  assert.equal(history.currentPosition.value, 2)
})

test('limita o histórico pelo orçamento de memória estimado', () => {
  const history = useHistory({ maxBytes: 300, maxEntries: 100, estimateBytes: () => 150 })
  history.record('A', 1)
  history.record('B', 2)
  history.record('C', 3)

  assert.equal(history.sizeBytes.value, 300)
  assert.deepEqual(history.timeline.value.map((item) => item.label), ['A', 'B', 'C'])
})

test('funde patches sem perder o estado anterior ao início da transação', () => {
  const first = {
    type: 'layer:patch',
    layerId: 'layer-1',
    before: { opacity: 100 },
    after: { opacity: 80 }
  }
  const second = {
    type: 'layer:patch',
    layerId: 'layer-1',
    before: { opacity: 80 },
    after: { opacity: 35 }
  }
  const merged = mergeEditorHistoryDelta(first, second)

  assert.deepEqual(merged.before, { opacity: 100 })
  assert.deepEqual(merged.after, { opacity: 35 })
  assert.ok(estimateEditorHistoryBytes(merged) < 512)
})

test('remove uma transação agrupada quando ela retorna ao estado inicial', () => {
  const history = useHistory({
    ...deltaOptions,
    isNoop: (delta) => delta.before === delta.after
  })
  history.record('Opacidade', { before: 100, after: 60 }, { mergeKey: 'opacity:1' })
  history.record('Opacidade', { before: 60, after: 100 }, { mergeKey: 'opacity:1' })

  assert.equal(history.canUndo.value, false)
  assert.equal(history.sizeBytes.value, 0)
})

test('um delta de transformação permanece pequeno em documentos com muitas camadas', () => {
  const delta = {
    type: 'layer:patch',
    layerId: 'layer-999',
    before: { transform: { x: 0, y: 0, width: 3840, height: 2160, rotation: 0 } },
    after: { transform: { x: 20, y: 12, width: 1920, height: 1080, rotation: 15 } }
  }
  const simulatedSnapshot = {
    layers: Array.from({ length: 1000 }, (_, index) => ({
      id: `layer-${index}`,
      name: `Camada ${index}`,
      visible: true,
      opacity: 100,
      transform: { x: index, y: index, width: 1920, height: 1080, rotation: 0 }
    }))
  }
  const deltaBytes = estimateEditorHistoryBytes(delta)
  const oldSnapshotBytes = JSON.stringify(simulatedSnapshot).length * 4

  assert.equal(isEditorHistoryDeltaNoop(delta), false)
  assert.ok(deltaBytes < 512)
  assert.ok(oldSnapshotBytes / deltaBytes > 1000)
})

test('aplica inserção, patch, reordenação e remoção de forma reversível', () => {
  const background = { id: 'background', name: 'Fundo', visible: true, opacity: 100, kind: 'background' }
  const image = {
    id: 'image',
    name: 'Imagem',
    visible: true,
    opacity: 100,
    kind: 'image',
    image: {
      width: 3840,
      height: 2160,
      mimeType: 'image/jpeg',
      sourceUrl: '/__axia_asset/image'
    },
    transform: { x: 0, y: 0, width: 100, height: 100 }
  }
  const layers = [background]
  const add = {
    type: 'layers:add',
    items: [{ index: 0, layer: image }],
    activeBefore: 'background',
    activeAfter: 'image'
  }
  let result = applyEditorHistoryDelta(layers, 'background', add, 'redo')
  assert.deepEqual(layers.map((layer) => layer.id), ['image', 'background'])
  assert.equal(result.activeLayerId, 'image')

  const patch = {
    type: 'layer:patch',
    layerId: 'image',
    before: { opacity: 100 },
    after: { opacity: 35 }
  }
  applyEditorHistoryDelta(layers, 'image', patch, 'redo')
  assert.equal(layers[0].opacity, 35)
  assert.equal(layers[0].image.sourceUrl, '/__axia_asset/image')
  applyEditorHistoryDelta(layers, 'image', patch, 'undo')
  assert.equal(layers[0].opacity, 100)
  assert.equal(layers[0].image.sourceUrl, '/__axia_asset/image')

  const reorder = { type: 'layer:reorder', layerId: 'image', beforeIndex: 0, afterIndex: 1 }
  applyEditorHistoryDelta(layers, 'image', reorder, 'redo')
  assert.deepEqual(layers.map((layer) => layer.id), ['background', 'image'])
  applyEditorHistoryDelta(layers, 'image', reorder, 'undo')
  assert.deepEqual(layers.map((layer) => layer.id), ['image', 'background'])

  result = applyEditorHistoryDelta(layers, 'image', add, 'undo')
  assert.deepEqual(layers.map((layer) => layer.id), ['background'])
  assert.equal(result.activeLayerId, 'background')
})

test('desfazer uma transformação preserva o asset visual da camada', () => {
  const layers = [{
    id: 'image',
    name: 'Imagem 4K',
    visible: true,
    opacity: 100,
    kind: 'image',
    image: {
      width: 3840,
      height: 2160,
      mimeType: 'image/jpeg',
      sourceUrl: '/__axia_asset/image-4k',
      previewUrl: '/__axia_asset/image-4k?previewWidth=1920&previewHeight=1080',
      previewWidth: 1920,
      previewHeight: 1080
    },
    transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 }
  }]
  const transform = {
    type: 'layer:patch',
    layerId: 'image',
    before: { transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 } },
    after: { transform: { x: 120, y: 80, width: 960, height: 540, rotation: 15 } }
  }

  applyEditorHistoryDelta(layers, 'image', transform, 'redo')
  applyEditorHistoryDelta(layers, 'image', transform, 'undo')

  assert.equal(layers[0].image.sourceUrl, '/__axia_asset/image-4k')
  assert.equal(layers[0].image.previewWidth, 1920)
  assert.deepEqual(layers[0].transform, transform.before.transform)
})

test('mantém dez mil ações dentro dos limites configurados', () => {
  const history = useHistory({
    maxBytes: 8 * 1024 * 1024,
    maxEntries: 200,
    estimateBytes: estimateEditorHistoryBytes
  })
  for (let index = 0; index < 10_000; index++) {
    history.record('Mover camada', {
      type: 'layer:patch',
      layerId: `layer-${index % 1000}`,
      before: { transform: { x: index, y: 0, width: 100, height: 100 } },
      after: { transform: { x: index + 1, y: 0, width: 100, height: 100 } }
    })
  }

  assert.equal(history.currentPosition.value, 200)
  assert.equal(history.timeline.value.length, 201)
  assert.ok(history.sizeBytes.value < 8 * 1024 * 1024)
})

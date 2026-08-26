import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyEditorHistoryDelta,
  cloneLayerHistoryState,
  cloneLayerState,
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

test('renova a revisão ao alterar uma transação agrupada depois de salvar', () => {
  const history = useHistory(deltaOptions)
  history.record('Editar texto', { before: '', after: 'A' }, { mergeKey: 'text:1' })
  const savedRevision = history.currentRevision.value
  history.record('Editar texto', { before: 'A', after: 'Axia' }, { mergeKey: 'text:1' })

  assert.notEqual(history.currentRevision.value, savedRevision)
  assert.equal(history.currentPosition.value, 1)
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

test('isola e restaura uma linha do tempo temporária', () => {
  const history = useHistory(deltaOptions)
  history.record('A', { before: 0, after: 1 })
  history.record('B', { before: 1, after: 2 })
  history.undo()
  const parent = history.snapshot()

  history.clear('Conteúdo inteligente aberto')
  history.record('Editar conteúdo', { before: 10, after: 20 })
  assert.deepEqual(history.timeline.value.map((item) => item.label), ['Conteúdo inteligente aberto', 'Editar conteúdo'])

  history.restore(parent)
  assert.deepEqual(history.timeline.value.map((item) => item.label), ['Documento criado', 'A', 'B'])
  assert.equal(history.currentPosition.value, 1)
  assert.equal(history.canRedo.value, true)
  history.record('C', { before: 1, after: 3 })
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

test('agrupa movimentos de guia preservando a posição original', () => {
  const first = {
    type: 'guides:change',
    before: [{ id: 'guide-1', orientation: 'vertical', position: 100 }],
    after: [{ id: 'guide-1', orientation: 'vertical', position: 120 }]
  }
  const second = {
    type: 'guides:change',
    before: [{ id: 'guide-1', orientation: 'vertical', position: 120 }],
    after: [{ id: 'guide-1', orientation: 'horizontal', position: 240 }]
  }
  const merged = mergeEditorHistoryDelta(first, second)

  assert.deepEqual(merged.before, first.before)
  assert.deepEqual(merged.after, second.after)
  assert.equal(isEditorHistoryDeltaNoop(merged), false)
  assert.equal(isEditorHistoryDeltaNoop({ ...merged, after: merged.before }), true)
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

test('desfaz e refaz a movimentação de várias camadas como uma ação atômica', () => {
  const first = { x: 10, y: 20, width: 100, height: 80, rotation: 0 }
  const second = { x: 220, y: 40, width: 60, height: 90, rotation: 15 }
  const layers = [
    { id: 'first', name: 'Primeira', visible: true, opacity: 100, kind: 'image', transform: { ...first } },
    { id: 'second', name: 'Segunda', visible: true, opacity: 100, kind: 'text', transform: { ...second } }
  ]
  const delta = {
    type: 'layers:transform',
    items: [
      { layerId: 'first', before: first, after: { ...first, x: 35, y: 5 } },
      { layerId: 'second', before: second, after: { ...second, x: 245, y: 25 } }
    ]
  }

  const history = useHistory({
    estimateBytes: estimateEditorHistoryBytes,
    isNoop: isEditorHistoryDeltaNoop,
    merge: mergeEditorHistoryDelta
  })
  history.record('Mover camadas', delta)
  applyEditorHistoryDelta(layers, 'second', delta, 'redo', ['first', 'second'])
  assert.deepEqual(layers.map((layer) => layer.transform), delta.items.map((item) => item.after))

  const transition = history.undo()
  assert.equal(transition.steps.length, 1)
  assert.equal(transition.steps[0].delta.items.length, 2)
  applyEditorHistoryDelta(layers, 'second', transition.steps[0].delta, transition.steps[0].direction, ['first', 'second'])
  assert.deepEqual(layers.map((layer) => layer.transform), [first, second])
  assert.equal(isEditorHistoryDeltaNoop(delta), false)
})

test('desfaz e refaz o modo de mesclagem sem tocar no raster', () => {
  const image = { width: 10, height: 10, mimeType: 'image/png', sourceUrl: 'blob:blend' }
  const layers = [{
    id: 'blend', name: 'Mesclagem', visible: true, opacity: 100, blendMode: 'multiply', kind: 'image', image
  }]
  const delta = {
    type: 'layer:patch',
    layerId: 'blend',
    before: { blendMode: 'normal' },
    after: { blendMode: 'multiply' }
  }

  applyEditorHistoryDelta(layers, 'blend', delta, 'undo')
  assert.equal(layers[0].blendMode, 'normal')
  assert.equal(layers[0].image, image)
  applyEditorHistoryDelta(layers, 'blend', delta, 'redo')
  assert.equal(layers[0].blendMode, 'multiply')
  assert.equal(layers[0].image, image)
})

test('agrupa e reverte alterações da luz global do documento', () => {
  const first = {
    type: 'document:global-light',
    before: { angle: 120, altitude: 30 },
    after: { angle: 100, altitude: 30 }
  }
  const second = {
    type: 'document:global-light',
    before: { angle: 100, altitude: 30 },
    after: { angle: 80, altitude: 45 }
  }
  const merged = mergeEditorHistoryDelta(first, second)
  assert.deepEqual(merged.before, first.before)
  assert.deepEqual(merged.after, second.after)
  assert.equal(isEditorHistoryDeltaNoop(merged), false)
  assert.equal(isEditorHistoryDeltaNoop({ ...merged, after: merged.before }), true)
})

test('clona estilos no histórico e retém URLs de padrões sem compartilhar estado', () => {
  const layer = {
    id: 'styled', name: 'Com estilo', visible: true, opacity: 100, blendMode: 'normal', kind: 'pixel',
    styles: {
      enabled: true,
      fillOpacity: 75,
      effects: [{
        type: 'pattern-overlay', id: 'pattern-effect', enabled: true, opacity: 100, blendMode: 'normal',
        pattern: {
          id: 'pattern-1', name: 'Grade', width: 16, height: 16,
          mimeType: 'image/png', sourceUrl: 'blob:pattern', byteSize: 256
        },
        angle: 0, scale: 100, linkWithLayer: true
      }]
    }
  }
  const cloned = cloneLayerState(layer)
  cloned.styles.effects[0].pattern.name = 'Alterado'
  assert.equal(layer.styles.effects[0].pattern.name, 'Grade')

  const delta = { type: 'layers:add', items: [{ index: 0, layer }] }
  assert.deepEqual(historyDeltaObjectUrls(delta), ['blob:pattern'])
  assert.ok(estimateEditorHistoryBytes(delta) >= 256)
})

test('desfaz e refaz estilos sem compartilhar o patch e solicita atualização visual', () => {
  const initialStyles = { enabled: true, fillOpacity: 100, effects: [] }
  const styled = {
    enabled: true,
    fillOpacity: 45,
    effects: [{
      type: 'color-overlay', id: 'color-1', enabled: true, opacity: 80,
      blendMode: 'normal', color: '#112233'
    }]
  }
  const layers = [{
    id: 'image', name: 'Imagem', visible: true, opacity: 100, blendMode: 'normal', kind: 'image',
    image: { width: 10, height: 10, mimeType: 'image/png', sourceUrl: 'blob:image' },
    transform: { x: 0, y: 0, width: 10, height: 10 },
    styles: initialStyles
  }]
  const delta = {
    type: 'layer:patch', layerId: 'image',
    before: { styles: initialStyles }, after: { styles: styled }
  }

  let result = applyEditorHistoryDelta(layers, 'image', delta, 'redo')
  assert.equal(layers[0].styles.fillOpacity, 45)
  assert.deepEqual(result.refreshLayerIds, ['image'])
  layers[0].styles.effects[0].color = '#abcdef'
  assert.equal(delta.after.styles.effects[0].color, '#112233')

  result = applyEditorHistoryDelta(layers, 'image', delta, 'undo')
  assert.deepEqual(layers[0].styles, initialStyles)
  assert.deepEqual(result.refreshLayerIds, ['image'])
})

test('desfaz e refaz a rasterização restaurando conteúdo e efeitos da camada', () => {
  const text = { content: 'Axia', fontFamily: 'Inter', fontSize: 48, color: '#ffffff' }
  const styles = {
    enabled: true,
    fillOpacity: 80,
    effects: [{
      type: 'color-overlay', id: 'color-1', enabled: true, opacity: 75,
      blendMode: 'normal', color: '#ff0000'
    }]
  }
  const originalTransform = { x: 20, y: 30, width: 180, height: 60, rotation: 12 }
  const rasterTransform = { x: 8, y: 14, width: 204, height: 94, rotation: 0 }
  const rasterImage = {
    width: 204, height: 94, mimeType: 'image/png', sourceUrl: 'blob:rasterized', byteSize: 4096
  }
  const layers = [{
    id: 'text', name: 'Axia', visible: true, opacity: 65, blendMode: 'multiply', kind: 'text',
    text, transform: originalTransform, styles
  }]
  const delta = {
    type: 'layer:patch',
    layerId: 'text',
    before: { kind: 'text', image: undefined, text, transform: originalTransform, styles },
    after: {
      kind: 'pixel', image: rasterImage, text: undefined, transform: rasterTransform,
      styles: { enabled: true, fillOpacity: 100, effects: [] }
    }
  }

  let result = applyEditorHistoryDelta(layers, 'text', delta, 'redo')
  assert.equal(layers[0].kind, 'pixel')
  assert.equal(layers[0].image.sourceUrl, 'blob:rasterized')
  assert.equal(layers[0].text, undefined)
  assert.equal(layers[0].opacity, 65)
  assert.equal(layers[0].blendMode, 'multiply')
  assert.deepEqual(result.refreshLayerIds, ['text'])

  result = applyEditorHistoryDelta(layers, 'text', delta, 'undo')
  assert.equal(layers[0].kind, 'text')
  assert.deepEqual(layers[0].text, text)
  assert.equal(layers[0].image, undefined)
  assert.deepEqual(layers[0].styles, styles)
  assert.deepEqual(layers[0].transform, originalTransform)
  assert.deepEqual(result.refreshLayerIds, [])
})

test('desfaz e refaz a substituição de várias camadas por uma mesclagem', () => {
  const base = { id: 'base', name: 'Base', visible: true, opacity: 100, blendMode: 'normal', kind: 'background' }
  const first = { id: 'first', name: 'Primeira', visible: true, opacity: 100, blendMode: 'normal', kind: 'image' }
  const second = { id: 'second', name: 'Segunda', visible: true, opacity: 100, blendMode: 'normal', kind: 'image' }
  const merged = { id: 'merged', name: 'Mesclagem', visible: true, opacity: 100, blendMode: 'normal', kind: 'image' }
  const layers = [first, second, base]
  const delta = {
    type: 'layers:replace',
    before: [{ index: 0, layer: first }, { index: 1, layer: second }],
    after: [{ index: 0, layer: merged }],
    activeBefore: 'second',
    activeAfter: 'merged',
    selectedBefore: ['first', 'second'],
    selectedAfter: ['merged']
  }

  let result = applyEditorHistoryDelta(layers, 'second', delta, 'redo', ['first', 'second'])
  assert.deepEqual(layers.map((layer) => layer.id), ['merged', 'base'])
  assert.equal(result.activeLayerId, 'merged')
  assert.deepEqual(result.selectedLayerIds, ['merged'])

  result = applyEditorHistoryDelta(layers, 'merged', delta, 'undo', ['merged'])
  assert.deepEqual(layers.map((layer) => layer.id), ['first', 'second', 'base'])
  assert.equal(result.activeLayerId, 'second')
  assert.deepEqual(result.selectedLayerIds, ['first', 'second'])
})

test('histórico de camada inteligente clona e retém assets internos recursivamente', () => {
  const inner = {
    id: 'inner', name: 'Interna', visible: true, opacity: 100, blendMode: 'normal', kind: 'image',
    styles: { enabled: true, fillOpacity: 100, effects: [] },
    image: { width: 20, height: 20, mimeType: 'image/png', sourceUrl: 'blob:inner', byteSize: 256 },
    transform: { x: 0, y: 0, width: 20, height: 20, rotation: 0 }
  }
  const smart = {
    id: 'smart', name: 'Inteligente', visible: true, opacity: 100, blendMode: 'normal', kind: 'smart',
    styles: { enabled: true, fillOpacity: 100, effects: [] },
    image: { width: 20, height: 20, mimeType: 'image/png', sourceUrl: 'blob:cache', byteSize: 128 },
    transform: { x: 10, y: 10, width: 20, height: 20, rotation: 0 },
    smart: {
      id: 'content-smart', width: 20, height: 20, resolutionDpi: 72, colorSpace: 'sRGB', background: 'transparent',
      layerStyleGlobalLight: { angle: 120, altitude: 30 }, layers: [inner], revision: 1
    }
  }
  const delta = {
    type: 'layers:replace',
    before: [{ index: 0, layer: inner }],
    after: [{ index: 0, layer: cloneLayerHistoryState(smart) }],
    activeBefore: 'inner',
    activeAfter: 'smart'
  }

  assert.deepEqual(new Set(historyDeltaObjectUrls(delta)), new Set(['blob:inner']))
  assert.ok(estimateEditorHistoryBytes(delta) >= 256)
  assert.equal(delta.after[0].layer.image, undefined)
  const cloned = cloneLayerState(smart)
  cloned.smart.layers[0].name = 'Alterada'
  assert.equal(smart.smart.layers[0].name, 'Interna')

  const layers = [inner]
  let result = applyEditorHistoryDelta(layers, 'inner', delta, 'redo')
  assert.equal(layers[0].kind, 'smart')
  assert.equal(layers[0].image, undefined)
  assert.equal(result.activeLayerId, 'smart')
  result = applyEditorHistoryDelta(layers, 'smart', delta, 'undo')
  assert.equal(layers[0].id, 'inner')
  assert.equal(result.activeLayerId, 'inner')
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

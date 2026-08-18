import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEditedSmartLayerContent,
  createSmartLayerEditDocument,
  smartLayerEditHasChanges
} from '../src/editor/smartLayerEditing.ts'
import { createLayerStyleConfig } from '../src/editor/layerStyles.ts'

function smartLayer() {
  return {
    id: 'wrapper',
    name: 'Símbolo',
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind: 'smart',
    styles: createLayerStyleConfig(),
    transform: { x: 40, y: 20, width: 320, height: 180, rotation: 0 },
    smart: {
      id: 'content',
      width: 320,
      height: 180,
      resolutionDpi: 144,
      colorSpace: 'sRGB',
      background: 'transparent',
      layerStyleGlobalLight: { angle: 120, altitude: 30 },
      layers: [{
        id: 'text', name: 'Título', visible: true, opacity: 100, blendMode: 'normal', kind: 'text',
        styles: createLayerStyleConfig(),
        text: {
          content: 'Axia', fontFamily: 'Arial', fontSize: 32, fontWeight: 700,
          color: '#ffffff', alignment: 'left', lineHeight: 1.2, baseWidth: 100, baseHeight: 40
        },
        transform: { x: 10, y: 12, width: 100, height: 40, rotation: 0 }
      }],
      revision: 3
    }
  }
}

test('abre o conteúdo inteligente como documento isolado', () => {
  const layer = smartLayer()
  const document = createSmartLayerEditDocument(layer)
  assert.equal(document.id, 'smart:content')
  assert.equal(document.name, 'Símbolo')
  assert.equal(document.width, 320)
  assert.equal(document.resolutionDpi, 144)
  assert.deepEqual(document.layerStyleGlobalLight, { angle: 120, altitude: 30 })
})

test('confirma uma cópia independente e incrementa a revisão', () => {
  const layer = smartLayer()
  const document = createSmartLayerEditDocument(layer)
  const editedLayers = layer.smart.layers.map((item) => ({
    ...item,
    text: { ...item.text, content: 'Axia Studio' }
  }))
  const edited = createEditedSmartLayerContent(layer.smart, document, editedLayers)

  assert.equal(edited.revision, 4)
  assert.equal(edited.layers[0].text.content, 'Axia Studio')
  assert.equal(smartLayerEditHasChanges(layer.smart, edited), true)
  edited.layers[0].text.content = 'Independente'
  assert.equal(layer.smart.layers[0].text.content, 'Axia')
})

test('ignora a revisão ao detectar uma sessão sem alterações', () => {
  const layer = smartLayer()
  const document = createSmartLayerEditDocument(layer)
  const unchanged = createEditedSmartLayerContent(layer.smart, document, layer.smart.layers)
  assert.equal(unchanged.revision, 4)
  assert.equal(smartLayerEditHasChanges(layer.smart, unchanged), false)
})

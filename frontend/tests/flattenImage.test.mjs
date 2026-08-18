import assert from 'node:assert/strict'
import test from 'node:test'
import { createFlattenedLayer, documentCanFlatten } from '../src/editor/flattenImage.ts'
import { createLayerStyleConfig } from '../src/editor/layerStyles.ts'

const document = { width: 200, height: 100, background: 'transparent' }
const fullPixel = {
  id: 'pixel', name: 'Pixels', visible: true, opacity: 100, blendMode: 'normal', kind: 'pixel',
  styles: createLayerStyleConfig(),
  image: { width: 200, height: 100, mimeType: 'image/png', sourceUrl: 'blob:pixel' },
  transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0 }
}

test('evita achatar novamente uma única camada de pixels já normalizada', () => {
  assert.equal(documentCanFlatten(document, [fullPixel]), false)
  assert.equal(documentCanFlatten(document, [{ ...fullPixel, opacity: 50 }]), true)
  assert.equal(documentCanFlatten(document, [fullPixel, { ...fullPixel, id: 'hidden', visible: false }]), true)
})

test('exige ao menos uma camada visível com aparência', () => {
  assert.equal(documentCanFlatten(document, [{ ...fullPixel, visible: false }]), false)
  assert.equal(documentCanFlatten(document, [{ ...fullPixel, kind: 'adjustment' }]), false)
  assert.equal(documentCanFlatten({ ...document, background: 'white' }, [{
    id: 'background', name: 'Fundo', visible: true, opacity: 100, blendMode: 'normal', kind: 'background',
    styles: createLayerStyleConfig()
  }]), true)
})

test('cria uma camada pixel no tamanho integral do documento', () => {
  const image = { width: 200, height: 100, mimeType: 'image/png', sourceUrl: 'blob:flat', byteSize: 300 }
  const layer = createFlattenedLayer(document, image, 'flat')
  assert.equal(layer.kind, 'pixel')
  assert.equal(layer.opacity, 100)
  assert.equal(layer.blendMode, 'normal')
  assert.deepEqual(layer.transform, { x: 0, y: 0, width: 200, height: 100, rotation: 0 })
  assert.notEqual(layer.image, image)
})

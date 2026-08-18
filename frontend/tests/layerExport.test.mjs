import assert from 'node:assert/strict'
import test from 'node:test'
import { layerCanExportPNG, quickLayerExportName } from '../src/editor/layerExport.ts'
import { createLayerStyleConfig } from '../src/editor/layerStyles.ts'

const base = {
  id: 'layer', name: 'Camada', visible: false, opacity: 50, blendMode: 'multiply',
  styles: createLayerStyleConfig()
}

test('exporta conteúdo visual editável, raster e inteligente mesmo oculto', () => {
  assert.equal(layerCanExportPNG({
    ...base, kind: 'image',
    image: { width: 10, height: 10, mimeType: 'image/png', sourceUrl: 'blob:image' },
    transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }
  }, 'transparent'), true)
  assert.equal(layerCanExportPNG({
    ...base, kind: 'text',
    text: { content: 'A', fontFamily: 'Arial', fontSize: 10, fontWeight: 400, color: '#fff', alignment: 'left', lineHeight: 1, baseWidth: 8, baseHeight: 10 },
    transform: { x: 0, y: 0, width: 8, height: 10, rotation: 0 }
  }, 'transparent'), true)
  assert.equal(layerCanExportPNG({
    ...base, kind: 'smart',
    smart: {
      id: 'content', width: 10, height: 10, resolutionDpi: 72, colorSpace: 'sRGB',
      background: 'transparent', layerStyleGlobalLight: { angle: 120, altitude: 30 },
      layers: [{ ...base, kind: 'pixel' }], revision: 1
    },
    transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }
  }, 'transparent'), true)
})

test('recusa ajuste, camada vazia e fundo transparente sem pixels', () => {
  assert.equal(layerCanExportPNG({ ...base, kind: 'adjustment' }, 'white'), false)
  assert.equal(layerCanExportPNG({ ...base, kind: 'pixel' }, 'transparent'), false)
  assert.equal(layerCanExportPNG({ ...base, kind: 'background' }, 'transparent'), false)
  assert.equal(layerCanExportPNG({ ...base, kind: 'background' }, 'white'), true)
})

test('gera nome curto e válido a partir do documento e da camada', () => {
  assert.equal(quickLayerExportName('Retrato.axia', 'Olhos/Azul:*?'), 'Retrato - Olhos_Azul___')
  assert.equal(quickLayerExportName('CON', '  '), '_CON - camada')
  assert.ok(quickLayerExportName('D'.repeat(100), 'C'.repeat(100)).length <= 120)
})

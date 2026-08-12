import test from 'node:test'
import assert from 'node:assert/strict'
import { createAxiaProjectManifest, restoreAxiaProject } from '../src/services/project.ts'

function projectState() {
  const sourceUrl = '/__axia_asset/image-1'
  return {
    document: {
      id: 'doc-1',
      name: 'Projeto',
      width: 1920,
      height: 1080,
      unit: 'px',
      physicalWidth: 1920,
      physicalHeight: 1080,
      resolutionDpi: 72,
      colorSpace: 'sRGB',
      background: 'transparent',
      createdAt: '2026-01-01T00:00:00Z'
    },
    layers: [
      {
        id: 'image-a', name: 'Imagem A', visible: true, opacity: 80, blendMode: 'multiply', kind: 'image',
        image: {
          width: 800, height: 600, mimeType: 'image/png', sourceUrl,
          previewUrl: '/__axia_asset/image-1?previewWidth=400&previewHeight=300',
          previewWidth: 400, previewHeight: 300, editToken: 'temporary'
        },
        transform: { x: 10, y: 20, width: 800, height: 600, rotation: 15 }
      },
      {
        id: 'image-b', name: 'Imagem B', visible: false, opacity: 100, kind: 'image',
        image: { width: 800, height: 600, mimeType: 'image/png', sourceUrl },
        transform: { x: 100, y: 200, width: 400, height: 300, rotation: 0 }
      },
      {
        id: 'text-a', name: 'Título', visible: true, opacity: 100, kind: 'text',
        text: {
          content: 'Axia', fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700,
          color: '#ffffff', alignment: 'center', lineHeight: 1.2, baseWidth: 180, baseHeight: 58
        },
        transform: { x: 300, y: 100, width: 180, height: 58, rotation: -5 }
      },
      { id: 'background', name: 'Fundo', visible: true, opacity: 100, kind: 'background' }
    ],
    guides: [{ id: 'guide-1', orientation: 'vertical', position: 320 }],
    view: {
      activeLayerId: 'image-a',
      guideSnappingEnabled: true,
      guidesLocked: false,
      guidesVisible: true,
      rulerOrigin: { x: 12, y: 8 },
      rulerUnit: 'px',
      zoom: 68.89
    }
  }
}

test('manifesto .axia deduplica originals e descarta previews derivados', () => {
  const { manifest, assetSources } = createAxiaProjectManifest(projectState())
  assert.equal(manifest.format, 'axia')
  assert.equal(manifest.version, 1)
  assert.equal(manifest.assets.length, 1)
  assert.equal(assetSources.length, 1)
  assert.equal(manifest.layers[0].image.assetId, manifest.layers[1].image.assetId)
  assert.equal(manifest.layers[0].blendMode, 'multiply')
  assert.equal('previewUrl' in manifest.layers[0].image, false)
  assert.equal('editToken' in manifest.layers[0].image, false)
})

test('restaura documento, camadas, guias e visualização usando URLs registradas', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  const restored = restoreAxiaProject(JSON.stringify(manifest), {
    [manifest.assets[0].id]: '/__axia_asset/restored'
  })
  assert.equal(restored.document.name, 'Projeto')
  assert.equal(restored.layers[0].image.sourceUrl, '/__axia_asset/restored')
  assert.equal(restored.layers[0].blendMode, 'multiply')
  assert.equal(restored.layers[0].image.previewUrl, undefined)
  assert.equal(restored.layers[2].text.content, 'Axia')
  assert.equal(restored.layers[2].transform.rotation, -5)
  assert.deepEqual(restored.guides, projectState().guides)
  assert.equal(restored.view.activeLayerId, 'image-a')
  assert.equal(restored.view.zoom, 68.89)
})

test('projetos antigos sem mesclagem são restaurados em modo normal', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  for (const layer of manifest.layers) delete layer.blendMode
  const restored = restoreAxiaProject(JSON.stringify(manifest), {
    [manifest.assets[0].id]: '/__axia_asset/restored'
  })
  assert.ok(restored.layers.every((layer) => layer.blendMode === 'normal'))
})

test('rejeita versão futura e assets ausentes', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  assert.throws(
    () => restoreAxiaProject(JSON.stringify({ ...manifest, version: 99 }), {}),
    /não suportada/
  )
  assert.throws(() => restoreAxiaProject(JSON.stringify(manifest), {}), /Asset ausente/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AXIA_PROJECT_MAX_LAYERS,
  createAxiaProjectManifest,
  restoreAxiaProject
} from '../src/services/project.ts'

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
          byteSize: 90_000, resolutionDpiX: 150.01, resolutionDpiY: 150.01,
          resolutionSource: 'png-phys',
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
  assert.equal(manifest.version, 2)
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
  assert.equal(restored.layers[0].image.byteSize, 90_000)
  assert.equal(restored.layers[0].image.resolutionDpiX, 150.01)
  assert.equal(restored.layers[0].image.resolutionDpiY, 150.01)
  assert.equal(restored.layers[0].image.resolutionSource, 'png-phys')
  assert.equal(restored.layers[2].text.content, 'Axia')
  assert.equal(restored.layers[2].transform.rotation, -5)
  assert.deepEqual(restored.guides, projectState().guides)
  assert.equal(restored.view.activeLayerId, 'image-a')
  assert.equal(restored.view.zoom, 68.89)
})

test('projetos antigos sem mesclagem são restaurados em modo normal', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  manifest.version = 1
  delete manifest.document.layerStyleGlobalLight
  for (const layer of manifest.layers) {
    delete layer.blendMode
    delete layer.styles
  }
  const restored = restoreAxiaProject(JSON.stringify(manifest), {
    [manifest.assets[0].id]: '/__axia_asset/restored'
  })
  assert.ok(restored.layers.every((layer) => layer.blendMode === 'normal'))
  assert.ok(restored.layers.every((layer) => layer.styles.fillOpacity === 100))
  assert.deepEqual(restored.document.layerStyleGlobalLight, { angle: 120, altitude: 30 })
})

test('persiste estilos, luz global e padrões sem gravar URLs transitórias no manifesto', () => {
  const state = projectState()
  state.document.layerStyleGlobalLight = { angle: -45, altitude: 55 }
  state.layers[0].styles = {
    enabled: true,
    fillOpacity: 72,
    effects: [{
      type: 'pattern-overlay', id: 'pattern-effect', enabled: true, opacity: 65, blendMode: 'overlay',
      pattern: {
        id: 'pattern-1', name: 'Grade', width: 24, height: 24,
        mimeType: 'image/png', sourceUrl: 'blob:pattern', byteSize: 384
      },
      angle: 15, scale: 80, linkWithLayer: true
    }]
  }

  const { manifest, assetSources } = createAxiaProjectManifest(state)
  assert.equal(manifest.version, 2)
  assert.equal(manifest.assets.length, 2)
  assert.equal(assetSources.length, 2)
  assert.equal(JSON.stringify(manifest).includes('blob:pattern'), false)
  const patternAsset = manifest.assets.find((asset) => asset.name === 'Grade')
  assert.ok(patternAsset)

  const restored = restoreAxiaProject(JSON.stringify(manifest), Object.fromEntries(
    manifest.assets.map((asset) => [asset.id, `/__axia_asset/${asset.id}`])
  ))
  assert.deepEqual(restored.document.layerStyleGlobalLight, { angle: -45, altitude: 55 })
  assert.equal(restored.layers[0].styles.fillOpacity, 72)
  assert.equal(restored.layers[0].styles.effects[0].pattern.sourceUrl, `/__axia_asset/${patternAsset.id}`)
})

test('normaliza estilos adulterados e rejeita asset de padrão ausente', () => {
  const state = projectState()
  state.layers[0].styles = {
    enabled: true,
    fillOpacity: -50,
    effects: [{
      type: 'drop-shadow', id: 'shadow', enabled: true, opacity: 999,
      blendMode: 'invalid', size: 50_000, distance: -30
    }]
  }
  const { manifest } = createAxiaProjectManifest(state)
  manifest.layers[0].styles.fillOpacity = 1_000
  manifest.layers[0].styles.effects[0].size = 99_999
  const restored = restoreAxiaProject(JSON.stringify(manifest), {
    [manifest.assets[0].id]: '/__axia_asset/restored'
  })
  assert.equal(restored.layers[0].styles.fillOpacity, 100)
  assert.equal(restored.layers[0].styles.effects[0].size, 250)

  manifest.layers[0].styles = {
    enabled: true,
    fillOpacity: 100,
    effects: [{ type: 'pattern-overlay', id: 'pattern', pattern: { assetId: 'missing' } }]
  }
  assert.throws(
    () => restoreAxiaProject(JSON.stringify(manifest), { [manifest.assets[0].id]: '/__axia_asset/restored' }),
    /padrão ausente/
  )
})

test('rejeita versão futura e assets ausentes', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  assert.throws(
    () => restoreAxiaProject(JSON.stringify({ ...manifest, version: 99 }), {}),
    /não suportada/
  )
  assert.throws(() => restoreAxiaProject(JSON.stringify(manifest), {}), /Asset ausente/)
})

test('persiste e restaura conteúdo inteligente aninhado com assets deduplicados', () => {
  const state = projectState()
  const source = state.layers[0]
  state.layers = [{
    id: 'smart', name: 'Objeto inteligente', visible: true, opacity: 90, blendMode: 'screen', kind: 'smart',
    styles: { enabled: true, fillOpacity: 100, effects: [] },
    image: { width: 820, height: 620, mimeType: 'image/png', sourceUrl: 'blob:smart-cache', byteSize: 5000 },
    transform: { x: 4, y: 8, width: 820, height: 620, rotation: 0 },
    smart: {
      id: 'content-smart',
      width: 820,
      height: 620,
      resolutionDpi: 144,
      colorSpace: 'sRGB',
      background: 'transparent',
      layerStyleGlobalLight: { angle: 90, altitude: 40 },
      layers: [{
        ...source,
        id: 'nested-image',
        styles: { enabled: true, fillOpacity: 100, effects: [] },
        transform: { x: 6, y: 12, width: 800, height: 600, rotation: 15 }
      }],
      revision: 3
    }
  }]
  state.view.activeLayerId = 'smart'

  const { manifest, assetSources } = createAxiaProjectManifest(state)
  assert.equal(manifest.version, 2)
  assert.equal(manifest.layers[0].kind, 'smart')
  assert.equal(manifest.layers[0].image, undefined)
  assert.equal(manifest.layers[0].smart.layers[0].image.assetId, 'asset-0001')
  assert.equal(assetSources.length, 1)
  assert.equal(JSON.stringify(manifest).includes('blob:'), false)

  const restored = restoreAxiaProject(JSON.stringify(manifest), Object.fromEntries(
    manifest.assets.map((asset) => [asset.id, `/__axia_asset/${asset.id}`])
  ))
  const smart = restored.layers[0]
  assert.equal(smart.kind, 'smart')
  assert.equal(smart.image, undefined)
  assert.equal(smart.smart.revision, 3)
  assert.equal(smart.smart.id, 'content-smart')
  assert.equal(smart.smart.layers[0].id, 'nested-image')
  assert.equal(smart.smart.layers[0].image.sourceUrl, '/__axia_asset/asset-0001')
  assert.equal(smart.smart.layers[0].transform.x, 6)
})

test('rejeita conteúdo inteligente incompleto e aninhamento acima do limite', () => {
  const state = projectState()
  const { manifest } = createAxiaProjectManifest(state)
  manifest.layers[0].kind = 'smart'
  assert.throws(
    () => restoreAxiaProject(JSON.stringify(manifest), { [manifest.assets[0].id]: '/__axia_asset/restored' }),
    /inteligente inválid/
  )

  const nested = {
    id: 'nested-content', width: 10, height: 10, resolutionDpi: 72, colorSpace: 'sRGB', background: 'transparent',
    layerStyleGlobalLight: { angle: 120, altitude: 30 }, revision: 1
  }
  let layer = {
    id: 'leaf', name: 'Folha', visible: true, opacity: 100, blendMode: 'normal', kind: 'image',
    styles: { enabled: true, fillOpacity: 100, effects: [] }, image: manifest.layers[0].image,
    transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }
  }
  for (let depth = 0; depth < 9; depth++) {
    layer = { ...layer, id: `smart-${depth}`, kind: 'smart', smart: { ...nested, layers: [layer] } }
  }
  manifest.layers = [layer]
  assert.throws(
    () => restoreAxiaProject(JSON.stringify(manifest), { [manifest.assets[0].id]: '/__axia_asset/restored' }),
    /limite de aninhamento/
  )
})

test('rejeita IDs duplicados e ciclos antes de salvar o projeto', () => {
  const duplicateState = projectState()
  duplicateState.layers = [duplicateState.layers[0], { ...duplicateState.layers[1], id: duplicateState.layers[0].id }]
  assert.throws(() => createAxiaProjectManifest(duplicateState), /Camada duplicada/)

  const cyclicState = projectState()
  const cyclicLayer = {
    id: 'smart-cycle', name: 'Ciclo', visible: true, opacity: 100, blendMode: 'normal', kind: 'smart',
    styles: { enabled: true, fillOpacity: 100, effects: [] },
    transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    smart: {
      id: 'content-cycle', width: 10, height: 10, resolutionDpi: 72, colorSpace: 'sRGB',
      background: 'transparent', layerStyleGlobalLight: { angle: 120, altitude: 30 }, layers: [], revision: 1
    }
  }
  cyclicLayer.smart.layers.push(cyclicLayer)
  cyclicState.layers = [cyclicLayer]
  assert.throws(() => createAxiaProjectManifest(cyclicState), /estrutura cíclica/)
})

test('limita a quantidade total de camadas em toda a árvore do projeto', () => {
  const state = projectState()
  const { manifest } = createAxiaProjectManifest(state)
  manifest.layers = Array.from({ length: AXIA_PROJECT_MAX_LAYERS + 1 }, (_, index) => ({
    id: `layer-${index}`,
    name: `Camada ${index}`,
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind: 'background',
    styles: { enabled: true, fillOpacity: 100, effects: [] }
  }))
  assert.throws(() => restoreAxiaProject(JSON.stringify(manifest), {}), /limite total de camadas/)
})

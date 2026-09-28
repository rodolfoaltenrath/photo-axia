import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AXIA_PROJECT_MAX_LAYERS,
  createAxiaProjectManifest,
  restoreAxiaProject,
  type AxiaProjectManifest,
  type AxiaProjectState
} from '../src/services/project.ts'
import { image, layer, styles, text, transform } from './editorTestFixtures.ts'
import type { LayerEffect, LayerEffectType, LayerItem } from '../src/types/editor.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
interface JsonObject { [key: string]: JsonValue }

function object(value: JsonValue | undefined, label: string): JsonObject {
  assert.ok(value && !Array.isArray(value) && typeof value === 'object', `${label} deve ser um objeto JSON`)
  return value
}

function array(value: JsonValue | undefined, label: string): JsonValue[] {
  assert.ok(Array.isArray(value), `${label} deve ser uma lista JSON`)
  return value
}

function entry<Value>(items: readonly Value[], index: number, label: string): Value {
  const value = items[index]
  assert.ok(value !== undefined, `${label}[${index}] deve existir`)
  return value
}

function serializedManifest(manifest: AxiaProjectManifest): JsonObject {
  return object(JSON.parse(JSON.stringify(manifest)) as JsonValue, 'manifesto serializado')
}

function effectOfType<Type extends LayerEffectType>(
  effects: LayerEffect[],
  index: number,
  type: Type
): Extract<LayerEffect, { type: Type }> {
  const effect = entry(effects, index, 'efeitos')
  assert.ok(effect.type === type)
  return effect as Extract<LayerEffect, { type: Type }>
}

function projectState(): AxiaProjectState {
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
      createdAt: '2026-01-01T00:00:00Z',
      layerStyleGlobalLight: { angle: 120, altitude: 30 }
    },
    layers: [
      layer({
        id: 'image-a', name: 'Imagem A', opacity: 80, blendMode: 'multiply', kind: 'pixel',
        image: image({
          width: 800, height: 600, mimeType: 'image/png', sourceUrl,
          byteSize: 90_000, resolutionDpiX: 150.01, resolutionDpiY: 150.01,
          resolutionSource: 'png-phys',
          previewUrl: '/__axia_asset/image-1?previewWidth=400&previewHeight=300',
          previewWidth: 400, previewHeight: 300, editToken: 'temporary'
        }),
        transform: transform({ x: 10, y: 20, width: 800, height: 600, rotation: 15 })
      }),
      layer({
        id: 'image-b', name: 'Imagem B', visible: false,
        image: image({ width: 800, height: 600, sourceUrl }),
        transform: transform({ x: 100, y: 200, width: 400, height: 300 })
      }),
      layer({
        id: 'text-a', name: 'Título', kind: 'text',
        text: text({ content: 'Axia', fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, color: '#ffffff', alignment: 'center', baseWidth: 180, baseHeight: 58 }),
        transform: transform({ x: 300, y: 100, width: 180, height: 58, rotation: -5 })
      }),
      layer({ id: 'background', name: 'Fundo', kind: 'background' })
    ],
    guides: [{ id: 'guide-1', orientation: 'vertical', position: 320 }],
    view: {
      activeLayerId: 'image-a',
      guideSnappingEnabled: true,
      smartGuidesEnabled: true,
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
  assert.equal(manifest.version, 4)
  assert.equal(manifest.assets.length, 1)
  assert.equal(assetSources.length, 1)
  const firstLayer = entry(manifest.layers, 0, 'camadas')
  const secondLayer = entry(manifest.layers, 1, 'camadas')
  assert.equal(firstLayer.image?.assetId, secondLayer.image?.assetId)
  assert.equal(firstLayer.blendMode, 'multiply')
  assert.equal('previewUrl' in (firstLayer.image ?? {}), false)
  assert.equal('editToken' in (firstLayer.image ?? {}), false)
})

test('restaura documento, camadas, guias e visualização usando URLs registradas', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  const restored = restoreAxiaProject(JSON.stringify(manifest), {
    [entry(manifest.assets, 0, 'assets').id]: '/__axia_asset/restored'
  })
  const imageLayer = entry(restored.layers, 0, 'camadas restauradas')
  const textLayer = entry(restored.layers, 2, 'camadas restauradas')
  assert.ok(imageLayer.image)
  assert.ok(textLayer.text)
  assert.ok(textLayer.transform)
  assert.equal(restored.document.name, 'Projeto')
  assert.equal(imageLayer.image.sourceUrl, '/__axia_asset/restored')
  assert.equal(imageLayer.blendMode, 'multiply')
  assert.equal(imageLayer.image.previewUrl, undefined)
  assert.equal(imageLayer.image.byteSize, 90_000)
  assert.equal(imageLayer.image.resolutionDpiX, 150.01)
  assert.equal(imageLayer.image.resolutionDpiY, 150.01)
  assert.equal(imageLayer.image.resolutionSource, 'png-phys')
  assert.equal(textLayer.text.content, 'Axia')
  assert.equal(textLayer.text.layoutMode, 'point')
  assert.equal(textLayer.transform.rotation, -5)
  assert.deepEqual(restored.guides, projectState().guides)
  assert.equal(restored.view.activeLayerId, 'image-a')
  assert.equal(restored.view.smartGuidesEnabled, true)
  assert.equal(restored.view.zoom, 68.89)
})

test('migra image legado para pixel inclusive dentro de Objeto Inteligente', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  const legacy = serializedManifest(manifest)
  const legacyLayers = array(legacy.layers, 'camadas legadas')
  object(entry(legacyLayers, 0, 'camadas legadas'), 'camada legada').kind = 'image'
  const nestedLegacy = structuredClone(object(entry(legacyLayers, 1, 'camadas legadas'), 'camada legada'))
  nestedLegacy.id = 'nested-legacy'
  nestedLegacy.kind = 'image'
  legacyLayers.splice(1, 1, {
    id: 'smart-legacy',
    name: 'Objeto antigo',
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind: 'smart',
    styles: { enabled: true, fillOpacity: 100, effects: [] },
    transform: { x: 0, y: 0, width: 800, height: 600, rotation: 0 },
    smart: {
      id: 'smart-legacy',
      width: 800,
      height: 600,
      resolutionDpi: 72,
      colorSpace: 'sRGB',
      background: 'transparent',
      layerStyleGlobalLight: { angle: 120, altitude: 30 },
      layers: [nestedLegacy],
      revision: 1
    }
  })
  const assetUrls = Object.fromEntries(
    manifest.assets.map((asset) => [asset.id, `/__axia_asset/${asset.id}`])
  )

  const restored = restoreAxiaProject(JSON.stringify(legacy), assetUrls)
  assert.equal(entry(restored.layers, 0, 'camadas restauradas').kind, 'pixel')
  const smart = entry(restored.layers, 1, 'camadas restauradas')
  assert.ok(smart.kind === 'smart' && smart.smart)
  assert.equal(entry(smart.smart.layers, 0, 'camadas inteligentes').kind, 'pixel')

  const savedAgain = createAxiaProjectManifest(restored).manifest
  assert.equal(entry(savedAgain.layers, 0, 'camadas salvas').kind, 'pixel')
  const savedSmart = entry(savedAgain.layers, 1, 'camadas salvas')
  assert.ok(savedSmart.smart)
  assert.equal(entry(savedSmart.smart.layers, 0, 'camadas inteligentes salvas').kind, 'pixel')
  assert.equal(JSON.stringify(savedAgain).includes('"kind":"image"'), false)
})

test('persiste uma camada de forma vetorial sem criar asset raster', () => {
  const state = projectState()
  state.layers.unshift(layer({
    id: 'shape-a', name: 'Retângulo', kind: 'shape',
    shape: {
      kind: 'rectangle', color: '#e63946', cornerRadius: 18, squareness: 0,
      starPoints: 5, starInnerRatio: 50, baseWidth: 320, baseHeight: 180
    },
    transform: transform({ x: 44, y: 72, width: 640, height: 270, rotation: 12 })
  }))
  const { manifest } = createAxiaProjectManifest(state)
  assert.equal(manifest.assets.length, 1)
  assert.deepEqual(entry(manifest.layers, 0, 'camadas salvas').shape, entry(state.layers, 0, 'camadas').shape)

  const restored = restoreAxiaProject(JSON.stringify(manifest), {
    [entry(manifest.assets, 0, 'assets').id]: '/__axia_asset/restored'
  })
  const restoredShape = entry(restored.layers, 0, 'camadas restauradas')
  assert.equal(restoredShape.kind, 'shape')
  assert.deepEqual(restoredShape.shape, entry(state.layers, 0, 'camadas').shape)
  assert.deepEqual(restoredShape.transform, entry(state.layers, 0, 'camadas').transform)
})

test('projetos antigos sem mesclagem são restaurados em modo normal', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  const legacy = serializedManifest(manifest)
  legacy.version = 1
  delete object(legacy.view, 'visualização legada').smartGuidesEnabled
  delete object(legacy.document, 'documento legado').layerStyleGlobalLight
  for (const storedLayer of array(legacy.layers, 'camadas legadas')) {
    const legacyLayer = object(storedLayer, 'camada legada')
    delete legacyLayer.blendMode
    delete legacyLayer.styles
  }
  const restored = restoreAxiaProject(JSON.stringify(legacy), {
    [manifest.assets[0].id]: '/__axia_asset/restored'
  })
  assert.ok(restored.layers.every((layer) => layer.blendMode === 'normal'))
  assert.ok(restored.layers.every((layer) => layer.styles.fillOpacity === 100))
  assert.deepEqual(restored.document.layerStyleGlobalLight, { angle: 120, altitude: 30 })
  assert.equal(restored.view.smartGuidesEnabled, true)
})

test('persiste estilos, luz global e padrões sem gravar URLs transitórias no manifesto', () => {
  const state = projectState()
  state.document.layerStyleGlobalLight = { angle: -45, altitude: 55 }
  state.layers[0].styles = {
    enabled: true,
    blendIf: {
      channel: 'blue',
      thisLayer: { shadows: [12, 48], highlights: [208, 242] },
      underlyingLayer: { shadows: [22, 56], highlights: [198, 234] }
    },
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
  assert.equal(manifest.version, 4)
  assert.equal(manifest.assets.length, 2)
  assert.equal(assetSources.length, 2)
  assert.equal(JSON.stringify(manifest).includes('blob:pattern'), false)
  const patternAsset = manifest.assets.find((asset) => asset.name === 'Grade')
  assert.ok(patternAsset)

  const restored = restoreAxiaProject(JSON.stringify(manifest), Object.fromEntries(
    manifest.assets.map((asset) => [asset.id, `/__axia_asset/${asset.id}`])
  ))
  const restoredLayer = entry(restored.layers, 0, 'camadas restauradas')
  assert.deepEqual(restored.document.layerStyleGlobalLight, { angle: -45, altitude: 55 })
  assert.equal(restoredLayer.styles.fillOpacity, 72)
  assert.deepEqual(restoredLayer.styles.blendIf, {
    channel: 'blue',
    thisLayer: { shadows: [12, 48], highlights: [208, 242] },
    underlyingLayer: { shadows: [22, 56], highlights: [198, 234] }
  })
  assert.equal(effectOfType(restoredLayer.styles.effects, 0, 'pattern-overlay').pattern?.sourceUrl, `/__axia_asset/${patternAsset.id}`)
})

test('normaliza estilos adulterados e rejeita asset de padrão ausente', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  const corrupted = serializedManifest(manifest)
  const corruptedLayer = object(entry(array(corrupted.layers, 'camadas adulteradas'), 0, 'camadas adulteradas'), 'camada adulterada')
  corruptedLayer.styles = {
    enabled: true,
    fillOpacity: 1_000,
    effects: [{
      type: 'drop-shadow', id: 'shadow', enabled: true, opacity: 999,
      blendMode: 'invalid', size: 50_000, distance: -30
    }]
  }
  const assetId = entry(manifest.assets, 0, 'assets').id
  const restored = restoreAxiaProject(JSON.stringify(corrupted), {
    [assetId]: '/__axia_asset/restored'
  })
  const restoredLayer = entry(restored.layers, 0, 'camadas restauradas')
  assert.equal(restoredLayer.styles.fillOpacity, 100)
  assert.equal(effectOfType(restoredLayer.styles.effects, 0, 'drop-shadow').size, 250)

  corruptedLayer.styles = {
    enabled: true,
    fillOpacity: 100,
    effects: [{ type: 'pattern-overlay', id: 'pattern', pattern: { assetId: 'missing' } }]
  }
  assert.throws(
    () => restoreAxiaProject(JSON.stringify(corrupted), { [assetId]: '/__axia_asset/restored' }),
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
  const source = entry(state.layers, 0, 'camadas')
  state.layers = [layer({
    id: 'smart', name: 'Objeto inteligente', opacity: 90, blendMode: 'screen', kind: 'smart',
    styles: styles(),
    image: image({ width: 820, height: 620, sourceUrl: 'blob:smart-cache', byteSize: 5000 }),
    transform: transform({ x: 4, y: 8, width: 820, height: 620 }),
    smart: {
      id: 'content-smart',
      width: 820,
      height: 620,
      resolutionDpi: 144,
      colorSpace: 'sRGB',
      background: 'transparent',
      layerStyleGlobalLight: { angle: 90, altitude: 40 },
      layers: [layer({
        ...source,
        id: 'nested-image',
        styles: styles(),
        transform: transform({ x: 6, y: 12, width: 800, height: 600, rotation: 15 })
      })],
      revision: 3
    }
  })]
  state.view.activeLayerId = 'smart'

  const { manifest, assetSources } = createAxiaProjectManifest(state)
  assert.equal(manifest.version, 4)
  const savedSmart = entry(manifest.layers, 0, 'camadas salvas')
  assert.equal(savedSmart.kind, 'smart')
  assert.equal(savedSmart.image, undefined)
  assert.ok(savedSmart.smart)
  assert.equal(entry(savedSmart.smart.layers, 0, 'camadas inteligentes salvas').image?.assetId, 'asset-0001')
  assert.equal(assetSources.length, 1)
  assert.equal(JSON.stringify(manifest).includes('blob:'), false)

  const restored = restoreAxiaProject(JSON.stringify(manifest), Object.fromEntries(
    manifest.assets.map((asset) => [asset.id, `/__axia_asset/${asset.id}`])
  ))
  const smart = entry(restored.layers, 0, 'camadas restauradas')
  assert.ok(smart.kind === 'smart' && smart.smart)
  assert.equal(smart.image, undefined)
  assert.equal(smart.smart.revision, 3)
  assert.equal(smart.smart.id, 'content-smart')
  const nested = entry(smart.smart.layers, 0, 'camadas inteligentes restauradas')
  assert.ok(nested.image)
  assert.ok(nested.transform)
  assert.equal(nested.id, 'nested-image')
  assert.equal(nested.image.sourceUrl, '/__axia_asset/asset-0001')
  assert.equal(nested.transform.x, 6)
})

test('preserva o PDF original e seus metadados dentro da camada inteligente', () => {
  const state = projectState()
  const source = entry(state.layers, 0, 'camadas')
  state.layers = [layer({
    id: 'smart-pdf', name: 'Documento', kind: 'smart',
    styles: styles(),
    transform: transform({ x: 20, y: 30, width: 800, height: 600 }),
    smart: {
      id: 'content-pdf', width: 800, height: 600, resolutionDpi: 150, colorSpace: 'sRGB',
      background: 'transparent', layerStyleGlobalLight: { angle: 120, altitude: 30 },
      layers: [layer({ ...source, id: 'pdf-cache', transform: transform({ width: 800, height: 600 }) })],
      pdf: {
        name: 'documento.pdf', sourceUrl: 'blob:original-pdf', byteSize: 456_789,
        pageNumber: 3, widthPoints: 384, heightPoints: 288, background: 'transparent'
      },
      revision: 1
    }
  })]

  const { manifest, assetSources } = createAxiaProjectManifest(state)
  assert.equal(manifest.version, 4)
  assert.equal(manifest.assets.length, 2)
  const pdfAsset = manifest.assets.find((asset) => asset.mimeType === 'application/pdf')
  assert.ok(pdfAsset)
  assert.equal(pdfAsset.path.endsWith('.pdf'), true)
  assert.equal(assetSources.find((asset) => asset.id === pdfAsset.id)?.sourceUrl, 'blob:original-pdf')
  assert.equal(JSON.stringify(manifest).includes('blob:original-pdf'), false)

  const restored = restoreAxiaProject(JSON.stringify(manifest), Object.fromEntries(
    manifest.assets.map((asset) => [asset.id, `/__axia_asset/${asset.id}`])
  ))
  const restoredSmart = entry(restored.layers, 0, 'camadas restauradas')
  assert.ok(restoredSmart.kind === 'smart' && restoredSmart.smart)
  assert.deepEqual(restoredSmart.smart.pdf, {
    name: 'documento.pdf', sourceUrl: `/__axia_asset/${pdfAsset.id}`, byteSize: 456_789,
    pageNumber: 3, widthPoints: 384, heightPoints: 288, background: 'transparent'
  })
})

test('rejeita conteúdo inteligente incompleto e aninhamento acima do limite', () => {
  const { manifest } = createAxiaProjectManifest(projectState())
  const corrupted = serializedManifest(manifest)
  const corruptedLayers = array(corrupted.layers, 'camadas adulteradas')
  object(entry(corruptedLayers, 0, 'camadas adulteradas'), 'camada adulterada').kind = 'smart'
  const assetId = entry(manifest.assets, 0, 'assets').id
  assert.throws(
    () => restoreAxiaProject(JSON.stringify(corrupted), { [assetId]: '/__axia_asset/restored' }),
    /inteligente inválid/
  )

  const nested = {
    id: 'nested-content', width: 10, height: 10, resolutionDpi: 72, colorSpace: 'sRGB', background: 'transparent',
    layerStyleGlobalLight: { angle: 120, altitude: 30 }, revision: 1
  }
  let nestedLayer = structuredClone(object(entry(array(serializedManifest(manifest).layers, 'camadas'), 0, 'camadas'), 'camada'))
  for (let depth = 0; depth < 9; depth++) {
    nestedLayer = { ...nestedLayer, id: `smart-${depth}`, kind: 'smart', smart: { ...nested, layers: [nestedLayer] } }
  }
  corrupted.layers = [nestedLayer]
  assert.throws(
    () => restoreAxiaProject(JSON.stringify(corrupted), { [assetId]: '/__axia_asset/restored' }),
    /limite de aninhamento/
  )
})

test('rejeita IDs duplicados e ciclos antes de salvar o projeto', () => {
  const duplicateState = projectState()
  const duplicate = entry(duplicateState.layers, 0, 'camadas')
  duplicateState.layers = [duplicate, { ...entry(duplicateState.layers, 1, 'camadas'), id: duplicate.id }]
  assert.throws(() => createAxiaProjectManifest(duplicateState), /Camada duplicada/)

  const cyclicState = projectState()
  const cyclicLayer = layer({
    id: 'smart-cycle', name: 'Ciclo', kind: 'smart', styles: styles(),
    transform: transform({ width: 10, height: 10 }),
    smart: {
      id: 'content-cycle', width: 10, height: 10, resolutionDpi: 72, colorSpace: 'sRGB',
      background: 'transparent', layerStyleGlobalLight: { angle: 120, altitude: 30 }, layers: [], revision: 1
    }
  })
  assert.ok(cyclicLayer.kind === 'smart' && cyclicLayer.smart)
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { smartLayerCacheKey, smartLayerContentHash } from '../src/editor/smartLayers.ts'
import {
  clearSmartLayerRenderCache,
  invalidateSmartLayerContent,
  renderSmartLayer,
  seedSmartLayerRender,
  smartLayerRenderCacheStats
} from '../src/services/smartLayerRenderer.ts'

function content(patch = {}) {
  return {
    id: 'content-1',
    width: 64,
    height: 32,
    resolutionDpi: 72,
    colorSpace: 'sRGB',
    background: 'transparent',
    layerStyleGlobalLight: { angle: 120, altitude: 30 },
    layers: [{
      id: 'image', name: 'Imagem', visible: true, opacity: 100, blendMode: 'normal', kind: 'image',
      styles: { enabled: true, fillOpacity: 100, effects: [] },
      image: {
        width: 64, height: 32, mimeType: 'image/png', sourceUrl: 'blob:source',
        previewUrl: 'blob:preview-a', previewWidth: 32, previewHeight: 16
      },
      transform: { x: 0, y: 0, width: 64, height: 32, rotation: 0 }
    }],
    revision: 1,
    ...patch
  }
}

test('hash ignora previews derivados e reage ao conteúdo editável', () => {
  const first = content()
  const second = structuredClone(first)
  second.layers[0].image.previewUrl = 'blob:preview-b'
  second.layers[0].image.previewWidth = 16
  assert.equal(smartLayerContentHash(first), smartLayerContentHash(second))

  second.layers[0].opacity = 55
  assert.notEqual(smartLayerContentHash(first), smartLayerContentHash(second))
})

test('chave inclui identidade, revisão, resolução e qualidade', () => {
  const source = content()
  const base = smartLayerCacheKey(source, 64, 32, 'final')
  assert.notEqual(base, smartLayerCacheKey({ ...source, revision: 2 }, 64, 32, 'final'))
  assert.notEqual(base, smartLayerCacheKey(source, 32, 16, 'final'))
  assert.notEqual(base, smartLayerCacheKey(source, 64, 32, 'interactive'))
  assert.notEqual(base, smartLayerCacheKey({ ...source, id: 'content-2' }, 64, 32, 'final'))
})

test('cache semeado é reutilizado sem executar o renderizador', async () => {
  clearSmartLayerRenderCache()
  const source = content()
  const blob = new Blob(['cache'], { type: 'image/png' })
  const key = seedSmartLayerRender(source, blob)
  let calls = 0
  const result = await renderSmartLayer({
    consumerId: 'canvas',
    content: source,
    renderer: async () => {
      calls++
      return new Blob(['unexpected'])
    }
  })
  assert.equal(result.cacheKey, key)
  assert.equal(result.fromCache, true)
  assert.equal(result.blob, blob)
  assert.equal(calls, 0)
})

test('solicitações idênticas compartilham o trabalho em andamento', async () => {
  clearSmartLayerRenderCache()
  const source = content()
  let calls = 0
  let resolveRender
  const renderer = () => {
    calls++
    return new Promise((resolve) => { resolveRender = resolve })
  }
  const first = renderSmartLayer({ consumerId: 'canvas', content: source, renderer })
  const second = renderSmartLayer({ consumerId: 'thumbnail', content: source, renderer })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls, 1)
  resolveRender(new Blob(['rendered'], { type: 'image/png' }))
  const results = await Promise.all([first, second])
  assert.equal(results[0].cacheKey, results[1].cacheKey)
  assert.equal(smartLayerRenderCacheStats().entries, 1)
  assert.equal(smartLayerRenderCacheStats().pending, 0)
})

test('invalidação impede resultado antigo de entrar no cache ou ser publicado', async () => {
  clearSmartLayerRenderCache()
  const source = content()
  let resolveRender
  const pending = renderSmartLayer({
    consumerId: 'canvas',
    content: source,
    renderer: () => new Promise((resolve) => { resolveRender = resolve })
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  invalidateSmartLayerContent(source.id)
  resolveRender(new Blob(['stale'], { type: 'image/png' }))
  await assert.rejects(pending, /obsoleta/)
  assert.equal(smartLayerRenderCacheStats().entries, 0)
})

test('falha aninhada libera fontes temporárias criadas pelo mesmo lote', async () => {
  clearSmartLayerRenderCache()
  const validNested = content({ id: 'nested-valid', width: 8, height: 8 })
  const oversizedNested = content({ id: 'nested-oversized', width: 10_000, height: 10_000 })
  seedSmartLayerRender(validNested, new Blob(['nested'], { type: 'image/png' }), 8, 8)
  const smartLayer = (id, smart) => ({
    id, name: id, visible: true, opacity: 100, blendMode: 'normal', kind: 'smart', smart,
    styles: { enabled: true, fillOpacity: 100, effects: [] },
    transform: { x: 0, y: 0, width: smart.width, height: smart.height, rotation: 0 }
  })
  const source = content({
    id: 'parent',
    layers: [smartLayer('valid', validNested), smartLayer('oversized', oversizedNested)]
  })
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const created = []
  const revoked = []
  URL.createObjectURL = () => {
    const url = `blob:temporary-${created.length}`
    created.push(url)
    return url
  }
  URL.revokeObjectURL = (url) => revoked.push(url)
  try {
    await assert.rejects(
      renderSmartLayer({ consumerId: 'parent', content: source, renderer: async () => new Blob(['unused']) }),
      /orçamento seguro/
    )
    assert.deepEqual(created, ['blob:temporary-0'])
    assert.deepEqual(revoked, created)
  } finally {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    clearSmartLayerRenderCache()
  }
})

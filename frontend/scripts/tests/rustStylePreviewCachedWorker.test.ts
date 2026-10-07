import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { RustStylePreview, RustStylePreviewCancelledError, type RustStylePreviewPorts } from '../../src/editor/rustStylePreview.ts'
import type { LayerStylePreviewRequest } from '../../src/editor/rustStylePreviewProtocol.ts'
import { RustStylePreviewMediaCache, type RustStyleMediaReader } from '../../src/editor/rustStylePreviewMediaCache.ts'
import { prepareRustStylePreviewMedia } from '../../src/editor/rustStylePreviewPreparation.ts'
import { RustPixelPocStyleScheduler } from '../../src/editor/rustPixelPocStyleScheduler.ts'
import { RustPixelPocWorkerClient } from '../../src/editor/rustPixelPocWorkerClient.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { rustMediaBlob } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const input = (consumerId = 'canvas:a'): LayerStylePreviewRequest => ({ consumerId, layerId: consumerId, sourceIdentity: 'editorial-v1',
  sourceUrl: 'blob:source', source: async () => { throw new Error('must not call editorial loader') }, sourceWidth: 1, sourceHeight: 1,
  styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 } })
const rgba = async (blob: Blob) => (JSON.parse(await blob.text()) as { rgba: number[] }).rgba

function fixture(reader: RustStyleMediaReader, fallback?: RustStylePreviewPorts['fallback']) {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), cache = new RustStylePreviewMediaCache()
  let connections = 0
  const preview = new RustStylePreview({ mediaCache: cache,
    createScheduler: async limits => new RustPixelPocStyleScheduler(async () => {
      connections++
      const client = new RustPixelPocWorkerClient(harness.port)
      await client.send({ type: 'init', wasm: wasm.slice(0) }); return client
    }, limits),
    prepare: (request, signal, identity) => prepareRustStylePreviewMedia(request, signal, identity, cache, reader),
    fallback: fallback ?? (async () => { throw new Error('unexpected fallback') })
  })
  return { preview, cache, connections: () => connections, close: async () => { await preview.dispose(); await harness.close() } }
}

test('Cache reusa mídia mas mudanças de efeito ainda produzem pixels novos em Rust', async () => {
  let loads = 0
  const f = fixture(async () => { loads++; return rustMediaBlob({ rgba: [40, 60, 80, 255] }) })
  try {
    const first = await f.preview.render(input())
    const next = await f.preview.render({ ...input(), styles: normalizeLayerStyleConfig({ effects: [{ type: 'color-overlay', color: '#ff0000' }] }) })
    assert.equal(loads, 1); assert.equal(f.cache.stats.hits, 1); assert.equal(f.connections(), 1)
    assert.deepEqual(await rgba(first.blob), [40, 60, 80, 255]); assert.deepEqual(await rgba(next.blob), [255, 0, 0, 255])
    assert.equal(next.fromCache, false); assert.notEqual(first.cacheKey, next.cacheKey)
    assert.equal(f.preview.stats.service?.leases, 2)
    first.release(); next.release()
  } finally { await f.close() }
})

test('Limite intrínseco abre fallback apenas da camada afetada e libera sua mídia', async () => {
  let large = true, fallbacks = 0
  const f = fixture(async url => rustMediaBlob(url === 'blob:large' && large ? { width: 8192, height: 8192 } : {}), async request => {
    fallbacks++; assert.equal(request.consumerId, 'canvas:large')
    return { blob: new Blob(['legacy']), width: 1, height: 1, offsetX: 0, offsetY: 0, cacheKey: 'legacy', fromCache: false }
  })
  try {
    const bad = { ...input('canvas:large'), sourceUrl: 'blob:large' }
    const [rejected, normal] = await Promise.all([f.preview.render(bad), f.preview.render(input('canvas:normal'))])
    assert.equal(rejected.cacheKey, 'legacy'); assert.deepEqual(await rgba(normal.blob), [40, 60, 80, 255])
    assert.equal(fallbacks, 1); assert.equal(f.connections(), 1)
    assert.equal(f.preview.stats.backendCircuitOpen, false); assert.equal(f.cache.stats.entries, 1)
    assert.equal(f.preview.stats.rendered, 1); assert.equal(f.preview.stats.fallbacks, 1)
    const attempts = f.preview.stats.attempts
    ;(await f.preview.render(bad)).release(); assert.equal(f.preview.stats.attempts, attempts)
    await f.preview.releaseConsumer('canvas:large'); large = false
    const recovered = await f.preview.render(bad)
    assert.deepEqual(await rgba(recovered.blob), [40, 60, 80, 255]); assert.equal(f.connections(), 1)
    normal.release(); rejected.release(); recovered.release()
  } finally { await f.close() }
})

test('Padrões codificados são compartilhados, enquanto camadas conservam pixels e staging próprios', async () => {
  const calls: string[] = [], f = fixture(async url => {
    calls.push(url)
    return rustMediaBlob({ rgba: url === 'blob:pattern' ? [120, 7, 80, 255] : [1, 2, 3, 255] })
  })
  try {
    const styles = normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern: {
      id: 'p', name: 'Fixture', width: 1, height: 1, sourceUrl: 'blob:pattern', mimeType: 'image/png'
    } }] })
    const results = await Promise.all(['canvas:a', 'canvas:b', 'canvas:c'].map(id => f.preview.render({ ...input(id), styles })))
    assert.equal(calls.filter(url => url === 'blob:pattern').length, 1)
    assert.equal(f.connections(), 1); assert.equal(f.cache.stats.hits, 2)
    for (const result of results) { assert.deepEqual(await rgba(result.blob), [120, 7, 80, 255]); result.release() }
    await f.preview.releaseConsumer('canvas:b'); assert.equal(f.cache.stats.entries, 3)
    await f.preview.releaseConsumer('canvas:a'); await f.preview.releaseConsumer('canvas:c')
    assert.equal(f.cache.stats.entries, 0); assert.equal(f.cache.stats.bytes, 0)
  } finally { await f.close() }
})

test('Editar conteúdo invalida cache mesmo com a mesma URL; PNG anterior permanece válido', async () => {
  let color = [1, 2, 3, 255], loads = 0
  const f = fixture(async () => { loads++; return rustMediaBlob({ rgba: color }) })
  try {
    const first = await f.preview.render(input())
    color = [4, 5, 6, 255]
    const edited = await f.preview.render({ ...input(), sourceIdentity: 'editorial-v2' })
    assert.equal(loads, 2); assert.deepEqual(await rgba(first.blob), [1, 2, 3, 255])
    assert.deepEqual(await rgba(edited.blob), color)
    await f.preview.dispose()
    assert.equal(f.cache.stats.entries, 0); assert.equal(f.preview.stats.resultLeases, 2)
    first.release(); edited.release(); assert.equal(f.preview.stats.retainedResultBytes, 0)
  } finally { await f.close() }
})

test('Troca de documento durante fetch descarta mídia antiga sem contaminar cache/contexto novo', async () => {
  let finish!: (blob: Blob) => void, enter!: () => void, loads = 0
  const entered = new Promise<void>(resolve => { enter = resolve })
  const f = fixture(async () => {
    if (++loads === 1) { enter(); return new Promise(resolve => { finish = resolve }) }
    return rustMediaBlob({ rgba: [7, 8, 9, 255] })
  })
  try {
    const old = f.preview.render(input()), obsolete = assert.rejects(old, RustStylePreviewCancelledError)
    await entered; await f.preview.dispose(); await obsolete
    const current = await f.preview.render(input())
    finish(rustMediaBlob({ rgba: [255, 0, 0, 255] }))
    await new Promise(resolve => setImmediate(resolve))
    const repeated = await f.preview.render(input())
    assert.equal(loads, 2); assert.equal(f.connections(), 1)
    assert.deepEqual(await rgba(current.blob), [7, 8, 9, 255]); assert.deepEqual(await rgba(repeated.blob), [7, 8, 9, 255])
    assert.equal(f.cache.stats.entries, 1); assert.equal(f.preview.stats.fallbacks, 0)
    current.release(); repeated.release()
  } finally { await f.close() }
})

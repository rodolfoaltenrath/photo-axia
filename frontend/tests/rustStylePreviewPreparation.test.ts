import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { RustStylePreviewMediaCache, type RustStyleMediaReader } from '../src/editor/rustStylePreviewMediaCache.ts'
import { prepareRustStylePreviewMedia } from '../src/editor/rustStylePreviewPreparation.ts'
import type { LayerStylePreviewRequest } from '../src/editor/rustStylePreviewProtocol.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'
import { DEFAULT_TEXT_LAYER } from '../src/editor/text.ts'

const signal = () => new AbortController().signal
const pattern = { id: 'p', name: 'Fixture', width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'blob:pattern' }
const input = (consumerId = 'canvas:a'): LayerStylePreviewRequest => ({ consumerId, layerId: consumerId,
  sourceIdentity: 'editorial', sourceUrl: 'blob:source', source: async () => { throw new Error('editorial loader must not run') },
  sourceWidth: 1, sourceHeight: 1, styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 } })

test('Preparação reusa fonte em edição de estilo e refaz leitura ao mudar a identidade', async () => {
  const cache = new RustStylePreviewMediaCache(), calls: string[] = []
  const reader: RustStyleMediaReader = async url => { calls.push(url); return new Blob([String(calls.length)]) }
  const first = await prepareRustStylePreviewMedia(input(), signal(), 'compact:1', cache, reader)
  const edited = await prepareRustStylePreviewMedia({ ...input(), styles: normalizeLayerStyleConfig({ fillOpacity: 50 }) }, signal(), 'compact:1', cache, reader)
  assert.ok(first.source.type === 'raster' && edited.source.type === 'raster')
  assert.equal(first.source.blob, edited.source.blob); assert.equal(calls.length, 1)
  const changed = await prepareRustStylePreviewMedia(input(), signal(), 'compact:2', cache, reader)
  assert.ok(changed.source.type === 'raster'); assert.equal(await changed.source.blob.text(), '2')
  const other = await prepareRustStylePreviewMedia(input('canvas:b'), signal(), 'compact:1', cache, reader)
  assert.ok(other.source.type === 'raster'); assert.equal(await other.source.blob.text(), '3')
})

test('Padrão ativo é deduplicado por pedido e compartilhado entre camadas sem alias', async () => {
  const cache = new RustStylePreviewMediaCache(), calls: string[] = []
  const reader: RustStyleMediaReader = async url => { calls.push(url); return new Blob([url]) }
  const styles = normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern },
    { type: 'stroke', paint: { type: 'pattern', pattern } }] })
  const a = await prepareRustStylePreviewMedia({ ...input(), styles }, signal(), 'a', cache, reader)
  const b = await prepareRustStylePreviewMedia({ ...input('canvas:b'), styles }, signal(), 'b', cache, reader)
  assert.equal(calls.filter(url => url === pattern.sourceUrl).length, 1)
  assert.equal(a.patterns?.p, b.patterns?.p)
  const replaced = normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern: { ...pattern, sourceUrl: 'blob:replacement' } }] })
  const next = await prepareRustStylePreviewMedia({ ...input(), styles: replaced }, signal(), 'a', cache, reader)
  assert.equal(await next.patterns?.p?.text(), 'blob:replacement')
  assert.equal(await a.patterns?.p?.text(), 'blob:pattern')
})

test('Conflito de assets e source inválida falham antes de qualquer leitura', async () => {
  const cache = new RustStylePreviewMediaCache(); let calls = 0
  const reader: RustStyleMediaReader = async () => { calls++; return new Blob(['x']) }
  await assert.rejects(prepareRustStylePreviewMedia({ ...input(), sourceUrl: undefined }, signal(), 'a', cache, reader),
    error => error instanceof RustPixelPocError && error.code === 'invalid-input')
  const styles = normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern },
    { type: 'stroke', paint: { type: 'pattern', pattern: { ...pattern, sourceUrl: 'blob:different' } } }] })
  await assert.rejects(prepareRustStylePreviewMedia({ ...input(), styles }, signal(), 'a', cache, reader))
  assert.equal(calls, 0)
})

test('Blob direto e texto não entram no cache; textura desabilitada não é buscada', async () => {
  const cache = new RustStylePreviewMediaCache(); let calls = 0
  const reader: RustStyleMediaReader = async () => { calls++; return new Blob(['x']) }
  const blob = new Blob(['source'])
  const raster = await prepareRustStylePreviewMedia({ ...input(), sourceUrl: undefined, source: blob }, signal(), 'a', cache, reader)
  assert.ok(raster.source.type === 'raster'); assert.equal(raster.source.blob, blob)
  const source = { type: 'text' as const, text: { ...DEFAULT_TEXT_LAYER }, drawScaleX: 1, drawScaleY: 1 }
  const styles = normalizeLayerStyleConfig({ effects: [{ type: 'bevel-emboss', textureEnabled: false, texture: pattern }] })
  const text = await prepareRustStylePreviewMedia({ ...input(), sourceUrl: undefined, source, styles }, signal(), 'a', cache, reader)
  assert.equal(text.source, source); assert.equal(calls, 0); assert.equal(cache.stats.entries, 0)
})

test('Soma de assets inclui hits; atingir 64 MiB impede leitura do próximo', async () => {
  const MiB = 1024 * 1024, unit = new Blob([new Uint8Array(MiB)])
  const firstBlob = new Blob(Array<Blob>(31).fill(unit)), secondBlob = new Blob(Array<Blob>(33).fill(unit))
  const cache = new RustStylePreviewMediaCache(); let calls = 0
  const reader: RustStyleMediaReader = async url => { calls++; return url === 'blob:first' ? firstBlob : secondBlob }
  const first = { ...pattern, id: 'first', sourceUrl: 'blob:first' }
  await cache.read('pattern:first', '1x1', first.sourceUrl, signal(), 64 * MiB, reader)
  const styles = normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern: first },
    { type: 'stroke', paint: { type: 'pattern', pattern: { ...pattern, id: 'second', sourceUrl: 'blob:second' } } },
    { type: 'bevel-emboss', textureEnabled: true, texture: { ...pattern, id: 'third', sourceUrl: 'blob:third' } }] })
  await assert.rejects(prepareRustStylePreviewMedia({ ...input(), styles }, signal(), 'a', cache, reader),
    error => error instanceof RustPixelPocError && error.code === 'memory-limit')
  assert.equal(calls, 2); assert.equal(cache.stats.hits, 1)
})

test('IDs especiais de padrão permanecem propriedades próprias sem alterar protótipo', async () => {
  const cache = new RustStylePreviewMediaCache(), styles = normalizeLayerStyleConfig({
    effects: [{ type: 'pattern-overlay', pattern: { ...pattern, id: '__proto__' } }] })
  const prepared = await prepareRustStylePreviewMedia({ ...input(), styles }, signal(), 'a', cache, async () => new Blob(['x']))
  assert.ok(Object.hasOwn(prepared.patterns!, '__proto__'))
  assert.equal(Object.getPrototypeOf(prepared.patterns!), null)
  assert.ok(Object.hasOwn(structuredClone(prepared.patterns!), '__proto__'))
})

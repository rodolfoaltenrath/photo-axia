import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'
import { RustPixelPocStyleCancelledError } from '../src/editor/rustPixelPocStyleSession.ts'
import { RustStylePreview, RustStylePreviewCancelledError, rustStylePreviewEnabled, rustStylePreviewPatternAssets,
  type LayerStylePreviewRequest, type RustStylePreviewPorts } from '../src/editor/rustStylePreview.ts'
import type { RustPixelPocServiceRequest, RustPixelPocResultLease } from '../src/editor/rustPixelPocStyleService.ts'
import { DEFAULT_TEXT_LAYER } from '../src/editor/text.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const input = (consumerId = 'canvas:a'): LayerStylePreviewRequest => ({ consumerId, layerId: 'a', sourceIdentity: 'source-v1',
  source: new Blob(['fixture']), sourceWidth: 1, sourceHeight: 1, styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 } })
const legacy = { blob: new Blob(['legacy']), width: 1, height: 1, offsetX: 0, offsetY: 0, cacheKey: 'legacy', fromCache: false }

function fixture() {
  const state = { factories: 0, disposed: 0, cancels: 0, releases: 0, fallbackCalls: 0,
    requests: [] as RustPixelPocServiceRequest[], prepared: [] as LayerStylePreviewRequest[], signals: [] as AbortSignal[] }
  const output = (): RustPixelPocResultLease => {
    let released = false
    return { result: { type: 'encoded-staged-region', id: state.requests.length, sourceId: 1, generation: 1,
      blob: new Blob(['png'], { type: 'image/png' }), width: 1, height: 1, offsetX: 0, offsetY: 0,
      sourceWidth: 1, sourceHeight: 1, paddedWidth: 1, paddedHeight: 1,
      timings: { allocationMs: 0, copyInMs: 0, kernelMs: 2, copyOutMs: 0, releaseMs: 0 },
      encoding: { canvasUploadMs: 0, pngEncodeMs: 3 } },
    release() { if (!released) { released = true; state.releases++ } } }
  }
  const service = {
    stats: { active: 0, pending: 0, sourceBytes: 0, retainedResultBytes: 0, leases: 0, reservedBytes: 0, disposed: false },
    render: async (request: RustPixelPocServiceRequest) => { state.requests.push(request); return output() },
    cancel() { state.cancels++ }, dispose: async () => { state.disposed++ }
  }
  const ports: RustStylePreviewPorts = {
    createService: async () => { state.factories++; return service },
    prepare: async (request, signal) => {
      state.prepared.push(request); state.signals.push(signal)
      return { source: { type: 'raster', blob: new Blob(['fixture']) }, patterns: {} }
    },
    fallback: async () => { state.fallbackCalls++; return legacy }
  }
  return { state, service, ports, output }
}

test('Flag Rust do preview exige opt-in explícito, sem aliases/valores truthy', () => {
  assert.equal(rustStylePreviewEnabled('?axiaRustStyles=1'), true)
  for (const search of ['', '?axiaRustStyles=0', '?axiaRustStyles=true', '?axiaRustPoc=1', '?other=1']) assert.equal(rustStylePreviewEnabled(search), false)
})

test('Preview entrega lease sem usar cache legado e mantém dono exclusivo', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const first = await preview.render(input()), next = await preview.render(input())
  assert.equal(f.state.factories, 1); assert.equal(f.state.fallbackCalls, 0)
  assert.notEqual(first.cacheKey, next.cacheKey); assert.equal(next.fromCache, false)
  assert.equal(preview.stats.last?.backend, 'rust'); assert.equal(preview.stats.last?.kernelMs, 2)
  assert.equal(preview.stats.last?.encodeMs, 3)
  await preview.render(input('canvas:b')); await preview.render(input('thumbnail:a'))
  assert.equal(f.state.factories, 1); assert.equal(f.state.fallbackCalls, 2); assert.equal(f.state.disposed, 0)
  first.release(); first.release(); next.release(); assert.equal(f.state.releases, 2)
  await preview.dispose(); assert.equal(f.state.disposed, 1)
})

test('Identidade compacta usa comparação exata e não muda em edições só de estilo', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const request = { ...input(), sourceIdentity: 'x'.repeat(5000) }
  const first = await preview.render(request), second = await preview.render({ ...request, styles: normalizeLayerStyleConfig({ fillOpacity: 50 }) })
  const changed = await preview.render({ ...request, sourceIdentity: request.sourceIdentity + 'v2' })
  assert.equal(f.state.requests[0]!.sourceIdentity, f.state.requests[1]!.sourceIdentity)
  assert.notEqual(f.state.requests[1]!.sourceIdentity, f.state.requests[2]!.sourceIdentity)
  assert.ok(f.state.requests[0]!.sourceIdentity.length < 100)
  first.release(); second.release(); changed.release(); await preview.dispose()
})

test('Snapshot mantém texto/estilos/luz enquanto preparação espera', async () => {
  const f = fixture(), gate = deferred<void>()
  f.ports.prepare = async (request, signal) => {
    f.state.prepared.push(request); f.state.signals.push(signal); await gate.promise
    assert.ok(typeof request.source !== 'function' && !(request.source instanceof Blob))
    return { source: request.source }
  }
  const preview = new RustStylePreview(f.ports), request = input()
  request.source = { type: 'text', text: { ...DEFAULT_TEXT_LAYER, content: 'Original' }, drawScaleX: 1, drawScaleY: 1 }
  request.styles = normalizeLayerStyleConfig({ effects: [{ type: 'color-overlay', color: '#ff0000' }] })
  const pending = preview.render(request)
  request.styles.effects.length = 0; request.globalLight.angle = 150; request.source.text.content = 'Changed'
  gate.resolve(); const result = await pending
  assert.equal(f.state.requests[0]!.styles.effects.length, 1); assert.equal(f.state.requests[0]!.globalLight.angle, 30)
  const captured = f.state.requests[0]!.source
  assert.ok(captured.type === 'text'); assert.equal(captured.text.content, 'Original')
  result.release(); await preview.dispose()
})

test('Dispose conserva lease publicada até URL/consumidor deixarem de usá-la', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const result = await preview.render(input())
  await preview.dispose()
  assert.equal(preview.stats.resultLeases, 1); assert.equal(f.state.releases, 0)
  result.release(); result.release()
  assert.equal(preview.stats.resultLeases, 0); assert.equal(f.state.releases, 1)
})

test('Observador de diagnóstico com erro não provoca fallback nem perde lease', async () => {
  const f = fixture(); f.ports.onChange = () => { throw new Error('observer-failure') }
  const preview = new RustStylePreview(f.ports), result = await preview.render(input())
  assert.equal(f.state.fallbackCalls, 0); assert.equal(preview.stats.resultLeases, 1)
  result.release(); assert.equal(preview.stats.resultLeases, 0)
  await preview.dispose()
})

test('Cancelamento de preparação rejeita logo, aborta fetch e não dispara fallback', async () => {
  const f = fixture(), gate = deferred<void>()
  f.ports.prepare = async (_, signal) => { f.state.signals.push(signal); await gate.promise; return { source: { type: 'raster', blob: new Blob(['a']) } } }
  const preview = new RustStylePreview(f.ports), pending = preview.render(input())
  const rejected = assert.rejects(pending, RustStylePreviewCancelledError)
  preview.cancel('canvas:a'); await rejected
  assert.equal(f.state.signals[0]!.aborted, true); assert.equal(f.state.fallbackCalls, 0)
  gate.resolve(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.factories, 0); await preview.dispose()
})

test('Lease tardia após substituição é liberada, nunca publicada', async () => {
  const f = fixture(), gate = deferred<RustPixelPocResultLease>(), started = deferred<void>()
  f.service.render = async request => { f.state.requests.push(request); started.resolve(); return gate.promise }
  const preview = new RustStylePreview(f.ports), pending = preview.render(input())
  const rejected = assert.rejects(pending, RustStylePreviewCancelledError)
  await started.promise; preview.cancel('canvas:a'); await rejected
  gate.resolve(f.output()); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.releases, 1); assert.equal(preview.stats.rendered, 0); assert.equal(f.state.fallbackCalls, 0)
  await preview.dispose()
})

test('Falha Rust termina serviço antes do fallback e abre circuito apenas para esse dono', async () => {
  const f = fixture()
  f.service.render = async () => { throw new RustPixelPocError('memory-limit') }
  f.ports.fallback = async () => { assert.equal(f.state.disposed, 1); f.state.fallbackCalls++; return legacy }
  const preview = new RustStylePreview(f.ports)
  const result = await preview.render(input())
  assert.equal(result.cacheKey, 'legacy'); assert.equal(preview.stats.last?.fallbackReason, 'memory-limit')
  assert.equal(preview.stats.circuitOpen, true)
  await preview.render(input()); assert.equal(f.state.factories, 1); assert.equal(f.state.fallbackCalls, 2)
  await preview.dispose()
})

test('Cancelamento do serviço Rust não abre circuito nem inicia fallback', async () => {
  const f = fixture(); f.service.render = async () => { throw new RustPixelPocStyleCancelledError() }
  const preview = new RustStylePreview(f.ports)
  await assert.rejects(preview.render(input()), RustPixelPocStyleCancelledError)
  assert.equal(preview.stats.circuitOpen, false); assert.equal(f.state.fallbackCalls, 0)
  await preview.dispose()
})

test('Preflight acima do orçamento volta ao legado sem fetch/Worker', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  await preview.render({ ...input(), sourceWidth: 16384, sourceHeight: 16384 })
  assert.equal(f.state.prepared.length, 0); assert.equal(f.state.factories, 0)
  assert.equal(f.state.fallbackCalls, 1); assert.equal(preview.stats.last?.fallbackReason, 'memory-limit')
  await preview.dispose()
})

test('Fallback antigo não publica depois de invalidação', async () => {
  const f = fixture(), gate = deferred<typeof legacy>(), started = deferred<void>()
  f.service.render = async () => { throw new RustPixelPocError('wasm-unavailable') }
  f.ports.fallback = async () => { started.resolve(); return gate.promise }
  const preview = new RustStylePreview(f.ports), pending = preview.render(input())
  const rejected = assert.rejects(pending, RustStylePreviewCancelledError)
  await started.promise; preview.cancel('canvas:a'); gate.resolve(legacy); await rejected
  await preview.dispose()
})

test('Novo dono aguarda término do Worker anterior e cacheKey não colide', async () => {
  const f = fixture(), gate = deferred<void>()
  f.service.dispose = async () => { f.state.disposed++; await gate.promise }
  const preview = new RustStylePreview(f.ports), first = await preview.render(input())
  const disposing = preview.releaseConsumer('canvas:a'), next = preview.render(input('canvas:b'))
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.state.factories, 1)
  gate.resolve(); await disposing; const result = await next
  assert.equal(f.state.factories, 2); assert.notEqual(first.cacheKey, result.cacheKey)
  first.release(); result.release(); await preview.dispose()
})

test('Factory tardia após fechar dono é descartada sem bloquear fechamento', async () => {
  const f = fixture(), gate = deferred<typeof f.service>(), started = deferred<void>()
  f.ports.createService = async () => { started.resolve(); return gate.promise }
  const preview = new RustStylePreview(f.ports), pending = preview.render(input())
  const rejected = assert.rejects(pending, RustStylePreviewCancelledError)
  await started.promise; await preview.dispose(); await rejected
  gate.resolve(f.service); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.disposed, 1); assert.equal(f.state.requests.length, 0)
})

test('Assets só incluem efeitos ativos e textura habilitada, com deduplicação/validação', () => {
  const pattern = { id: 'asset', name: 'fixture', width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'data:image/png;base64,AA==' }
  const request = { ...input(), styles: normalizeLayerStyleConfig({ effects: [
    { type: 'pattern-overlay', pattern }, { type: 'stroke', paint: { type: 'pattern', pattern } },
    { type: 'bevel-emboss', texture: { ...pattern, id: 'unused' }, textureEnabled: false }
  ] }) }
  assert.equal(rustStylePreviewPatternAssets(request).length, 1)
  assert.equal(rustStylePreviewPatternAssets({ ...request, styles: normalizeLayerStyleConfig({ ...request.styles, enabled: false }) }).length, 0)
  const conflicting = normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern },
    { type: 'stroke', paint: { type: 'pattern', pattern: { ...pattern, width: 2 } } }] })
  assert.throws(() => rustStylePreviewPatternAssets({ ...request, styles: conflicting }), RustPixelPocError)
})

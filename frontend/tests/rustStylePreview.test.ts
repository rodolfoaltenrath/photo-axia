import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'
import { RustPixelPocStyleCancelledError } from '../src/editor/rustPixelPocStyleSession.ts'
import { RustStylePreview, RustStylePreviewCancelledError, rustStylePreviewEnabled, rustStylePreviewPatternAssets,
  type LayerStylePreviewRequest, type RustStylePreviewPorts } from '../src/editor/rustStylePreview.ts'
import type { RustPixelPocServiceRequest, RustPixelPocResultLease } from '../src/editor/rustPixelPocStyleService.ts'
import { DEFAULT_TEXT_LAYER } from '../src/editor/text.ts'
import type { RustPixelPocScheduledPreparation, RustPixelPocSchedulerLimits, RustPixelPocSchedulingOptions } from '../src/editor/rustPixelPocStyleScheduler.ts'
import type { RustStylePriority } from '../src/editor/rustStyleScheduling.ts'
import { RustStylePreviewMediaCache } from '../src/editor/rustStylePreviewMediaCache.ts'
import { prepareRustStylePreviewMedia } from '../src/editor/rustStylePreviewPreparation.ts'

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
    requests: [] as RustPixelPocServiceRequest[], prepared: [] as LayerStylePreviewRequest[], signals: [] as AbortSignal[],
    limits: [] as RustPixelPocSchedulerLimits[], consumers: [] as string[], priorities: [] as RustStylePriority[],
    reprioritized: [] as { consumerId: string; priority: RustStylePriority }[] }
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
    stats: { active: 0, pending: 0, preparing: 0, queuedInputBytes: 0, sourceBytes: 0, retainedResultBytes: 0, leases: 0, reservedBytes: 0, disposed: false },
    renderPrepared: async (consumerId: string, job: RustPixelPocScheduledPreparation, options: RustPixelPocSchedulingOptions = {}) => {
      state.consumers.push(consumerId)
      state.priorities.push(options.priority ?? 'visible')
      state.requests.push(await job.prepare(new AbortController().signal)); return output()
    },
    setPriority(consumerId: string, priority: RustStylePriority) { state.reprioritized.push({ consumerId, priority }) },
    cancel() { state.cancels++ }, dispose: async () => { state.disposed++ }
  }
  const ports: RustStylePreviewPorts = {
    createScheduler: async limits => { state.factories++; state.limits.push(limits); return service },
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

test('Preview compartilha agendador entre camadas sem usar cache legado; miniaturas continuam no legado', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const first = await preview.render(input()), next = await preview.render(input())
  assert.equal(f.state.factories, 1); assert.equal(f.state.fallbackCalls, 0)
  assert.notEqual(first.cacheKey, next.cacheKey); assert.equal(next.fromCache, false)
  assert.equal(preview.stats.last?.backend, 'rust'); assert.equal(preview.stats.last?.kernelMs, 2)
  assert.equal(preview.stats.last?.encodeMs, 3)
  const other = await preview.render(input('canvas:b')); await preview.render(input('thumbnail:a'))
  assert.equal(preview.stats.consumers, 2)
  assert.equal(f.state.factories, 1); assert.equal(f.state.fallbackCalls, 1); assert.equal(f.state.disposed, 0)
  other.release()
  first.release(); first.release(); next.release(); assert.equal(f.state.releases, 3)
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
  const f = fixture(), gate = deferred<void>(), started = deferred<void>()
  const controller = new AbortController()
  f.service.cancel = () => { controller.abort(); f.state.cancels++ }
  f.service.renderPrepared = async (_, job) => { const request = await job.prepare(controller.signal); f.state.requests.push(request); return f.output() }
  f.ports.prepare = async (_, signal) => { f.state.signals.push(signal); started.resolve(); await gate.promise; return { source: { type: 'raster', blob: new Blob(['a']) } } }
  const preview = new RustStylePreview(f.ports), pending = preview.render(input())
  const rejected = assert.rejects(pending, RustStylePreviewCancelledError)
  await started.promise; preview.cancel('canvas:a'); await rejected
  assert.equal(f.state.signals[0]!.aborted, true); assert.equal(f.state.fallbackCalls, 0)
  gate.resolve(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.factories, 1); await preview.dispose()
})

test('Lease tardia após substituição é liberada, nunca publicada', async () => {
  const f = fixture(), gate = deferred<RustPixelPocResultLease>(), started = deferred<void>()
  f.service.renderPrepared = async (_, job) => { f.state.requests.push(await job.prepare(new AbortController().signal)); started.resolve(); return gate.promise }
  const preview = new RustStylePreview(f.ports), pending = preview.render(input())
  const rejected = assert.rejects(pending, RustStylePreviewCancelledError)
  await started.promise; preview.cancel('canvas:a'); await rejected
  gate.resolve(f.output()); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.releases, 1); assert.equal(preview.stats.rendered, 0); assert.equal(f.state.fallbackCalls, 0)
  await preview.dispose()
})

test('Falha de memória abre circuito apenas da camada, sem terminar agendador compartilhado', async () => {
  const f = fixture()
  const render = f.service.renderPrepared
  f.service.renderPrepared = async (consumerId, job) => {
    if (consumerId === 'canvas:a') throw new RustPixelPocError('memory-limit')
    return render(consumerId, job)
  }
  f.ports.fallback = async () => { assert.equal(f.state.disposed, 0); f.state.fallbackCalls++; return legacy }
  const preview = new RustStylePreview(f.ports)
  const result = await preview.render(input())
  assert.equal(result.cacheKey, 'legacy'); assert.equal(preview.stats.last?.fallbackReason, 'memory-limit')
  assert.equal(preview.stats.circuitOpen, true)
  await preview.render(input()); assert.equal(f.state.factories, 1); assert.equal(f.state.fallbackCalls, 2)
  const other = await preview.render(input('canvas:b')); other.release()
  assert.equal(preview.stats.backendCircuitOpen, false); assert.equal(preview.stats.last?.backend, 'rust')
  await preview.dispose()
})

test('Cancelamento do serviço Rust não abre circuito nem inicia fallback', async () => {
  const f = fixture(); f.service.renderPrepared = async () => { throw new RustPixelPocStyleCancelledError() }
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
  f.service.renderPrepared = async () => { throw new RustPixelPocError('wasm-unavailable') }
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
  f.ports.createScheduler = async () => { started.resolve(); return gate.promise }
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

test('Remover uma camada preserva o agendador e resultados das demais', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const a = await preview.render(input()), b = await preview.render(input('canvas:b'))
  await preview.releaseConsumer('canvas:a')
  assert.equal(f.state.disposed, 0); assert.equal(preview.stats.consumers, 1)
  assert.equal(preview.stats.resultLeases, 2)
  a.release(); assert.equal(preview.stats.resultLeases, 1)
  const next = await preview.render(input('canvas:b')); assert.equal(f.state.factories, 1)
  b.release(); next.release(); await preview.dispose()
})

test('Identidades iguais não colidem após remover e recriar consumidor no mesmo contexto', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const a = await preview.render(input()), b = await preview.render(input('canvas:b'))
  await preview.releaseConsumer('canvas:a')
  const again = await preview.render(input())
  assert.notEqual(f.state.requests[0]!.sourceIdentity, f.state.requests[1]!.sourceIdentity)
  assert.notEqual(f.state.requests[0]!.sourceIdentity, f.state.requests[2]!.sourceIdentity)
  assert.notEqual(a.cacheKey, again.cacheKey)
  a.release(); b.release(); again.release(); await preview.dispose()
})

test('PNGs de contexto retirado reduzem os limites do novo até sua liberação', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const old = await preview.render(input()); await preview.dispose()
  const next = await preview.render(input('canvas:b'))
  assert.equal(f.state.limits[1]!.maxResidentBytes, 256 * 1024 * 1024 - old.blob.size)
  assert.equal(f.state.limits[1]!.maxResultBytes, 64 * 1024 * 1024 - old.blob.size)
  assert.equal(f.state.limits[1]!.maxLeases, 63)
  assert.equal(preview.stats.retainedResultBytes, old.blob.size + next.blob.size)
  old.release(); next.release(); assert.equal(preview.stats.retainedResultBytes, 0); await preview.dispose()
})

test('Falha WASM abre circuito comum e evita tentativa por camada até encerrar contexto', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const render = f.service.renderPrepared
  f.service.renderPrepared = async () => { throw new RustPixelPocError('wasm-unavailable') }
  f.ports.fallback = async () => { assert.equal(f.state.disposed, 1); f.state.fallbackCalls++; return legacy }
  await preview.render(input()); await preview.render(input('canvas:b'))
  assert.equal(preview.stats.backendCircuitOpen, true); assert.equal(f.state.factories, 1)
  assert.equal(f.state.fallbackCalls, 2); assert.equal(f.state.prepared.length, 0)
  await preview.dispose(); f.service.renderPrepared = render
  const result = await preview.render(input()); result.release()
  assert.equal(f.state.factories, 2); assert.equal(preview.stats.backendCircuitOpen, false); await preview.dispose()
})

test('Factory compartilhada pode ser adotada por B mesmo depois de fechar A', async () => {
  const f = fixture(), gate = deferred<typeof f.service>(), started = deferred<void>()
  f.ports.createScheduler = async () => { started.resolve(); return gate.promise }
  const preview = new RustStylePreview(f.ports), a = preview.render(input())
  const obsolete = assert.rejects(a, RustStylePreviewCancelledError)
  await started.promise
  const b = preview.render(input('canvas:b'))
  await preview.releaseConsumer('canvas:a'); await obsolete
  gate.resolve(f.service); const result = await b
  assert.equal(f.state.disposed, 0); assert.deepEqual(f.state.consumers, ['canvas:b'])
  result.release(); await preview.dispose()
})

test('Cancelamento da fila por falha global faz fallback dos consumidores ainda válidos', async () => {
  const f = fixture(), failure = deferred<void>(), queued = deferred<void>(), entered = deferred<void>()
  f.service.renderPrepared = async consumerId => {
    if (consumerId === 'canvas:a') { await failure.promise; throw new RustPixelPocError('wasm-unavailable') }
    entered.resolve(); await queued.promise; throw new RustPixelPocStyleCancelledError()
  }
  f.service.dispose = async () => { f.state.disposed++; queued.resolve() }
  const preview = new RustStylePreview(f.ports), a = preview.render(input()), b = preview.render(input('canvas:b'))
  await entered.promise; failure.resolve()
  const results = await Promise.all([a, b])
  assert.ok(results.every(result => result.cacheKey === 'legacy'))
  assert.equal(f.state.fallbackCalls, 2); assert.equal(f.state.disposed, 1)
  assert.equal(preview.stats.cancelled, 0); assert.equal(preview.stats.backendCircuitOpen, true)
  await preview.dispose()
})

test('Metadados enormes de padrão caem no legado antes de buscar mídia ou criar agendador', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const pattern = { id: 'large', name: 'fixture', width: 1, height: 1, mimeType: 'image/png',
    sourceUrl: 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024) }
  await preview.render({ ...input(), styles: normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern }] }) })
  assert.equal(f.state.factories, 0); assert.equal(f.state.prepared.length, 0)
  assert.equal(preview.stats.last?.fallbackReason, 'memory-limit'); await preview.dispose()
})

test('Prioridade atual durante abertura tardia é usada sem cancelar o pedido', async () => {
  const f = fixture(), gate = deferred<typeof f.service>(), started = deferred<void>()
  f.ports.createScheduler = async () => { started.resolve(); return gate.promise }
  const preview = new RustStylePreview(f.ports), pending = preview.render({ ...input(), priority: 'background' })
  await started.promise
  const cancels = f.state.cancels
  preview.setPriority('canvas:a', 'active'); preview.setPriority('unknown', 'visible')
  assert.equal(f.state.cancels, cancels)
  gate.resolve(f.service); const result = await pending
  assert.deepEqual(f.state.priorities, ['active']); assert.equal(f.state.fallbackCalls, 0)
  result.release(); await preview.dispose()
})

test('Prioridade encaminhada à fila não recompõe nem altera leases publicadas', async () => {
  const f = fixture(), preview = new RustStylePreview(f.ports)
  const result = await preview.render({ ...input(), priority: 'visible' }), cancels = f.state.cancels
  preview.setPriority('canvas:a', 'background'); preview.setPriority('canvas:a', 'active')
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.cancels, cancels)
  assert.equal(preview.stats.resultLeases, 1); assert.equal(f.state.releases, 0)
  assert.deepEqual(f.state.reprioritized.slice(-2), [
    { consumerId: 'canvas:a', priority: 'background' }, { consumerId: 'canvas:a', priority: 'active' }])
  await preview.releaseConsumer('canvas:a')
  const changes = f.state.reprioritized.length
  preview.setPriority('canvas:a', 'visible'); assert.equal(f.state.reprioritized.length, changes)
  result.release(); await preview.dispose()
})

test('Cache é descontado do orçamento, inclusive junto a PNG de contexto retirado', async () => {
  const f = fixture(), cache = new RustStylePreviewMediaCache(), MiB = 1024 * 1024
  f.ports.mediaCache = cache
  const preview = new RustStylePreview(f.ports), first = await preview.render(input())
  assert.equal(f.state.limits[0]!.maxResidentBytes, 224 * MiB)
  await preview.dispose(); const next = await preview.render(input('canvas:b'))
  assert.equal(f.state.limits[1]!.maxResidentBytes, 224 * MiB - first.blob.size)
  assert.equal(f.state.limits[1]!.maxResultBytes, 64 * MiB - first.blob.size)
  assert.equal(f.state.limits[1]!.maxLeases, 63)
  first.release(); next.release(); await preview.dispose()
})

test('Capacidade inválida do cache é rejeitada antes de abrir agendador', () => {
  const f = fixture(), cache = new RustStylePreviewMediaCache()
  for (const maxBytes of [-1, 1.5, NaN, 32 * 1024 * 1024 + 1]) {
    f.ports.mediaCache = { maxBytes, stats: cache.stats, clear() {}, releaseConsumer() {} }
    assert.throws(() => new RustStylePreview(f.ports), error => error instanceof RustPixelPocError && error.code === 'invalid-input')
  }
  assert.equal(f.state.factories, 0)
})

test('Prepare recebe identidade compacta estável; edição/recriação não reusa mídia antiga', async () => {
  const f = fixture(), cache = new RustStylePreviewMediaCache(); let loads = 0
  f.ports.mediaCache = cache
  f.ports.prepare = (request, signal, identity) => prepareRustStylePreviewMedia(request, signal, identity, cache,
    async () => new Blob([String(++loads)]))
  const preview = new RustStylePreview(f.ports), request = { ...input(), sourceUrl: 'blob:source', sourceIdentity: 'A'.repeat(5000) }
  const a = await preview.render(request), edited = await preview.render({ ...request, styles: normalizeLayerStyleConfig({ fillOpacity: 50 }) })
  assert.equal(loads, 1); assert.equal(preview.stats.mediaCache?.hits, 1)
  const changed = await preview.render({ ...request, sourceIdentity: request.sourceIdentity + ':edited' })
  assert.equal(loads, 2)
  await preview.releaseConsumer('canvas:a'); assert.equal(preview.stats.mediaCache?.bytes, 0)
  const again = await preview.render(request)
  assert.equal(loads, 3)
  for (const result of [a, edited, changed, again]) result.release()
  await preview.dispose(); assert.equal(preview.stats.mediaCache?.entries, 0)
})

test('Circuito local retira apenas fonte do dono; circuito comum limpa o cache inteiro', async () => {
  const f = fixture(), cache = new RustStylePreviewMediaCache()
  f.ports.mediaCache = cache
  const reader = async () => new Blob(['x'])
  for (const key of ['source:canvas:a', 'source:canvas:b', 'pattern:p']) await cache.read(key, '1', 'blob:x', new AbortController().signal, 64, reader)
  f.service.renderPrepared = async () => { throw new RustPixelPocError('memory-limit') }
  const preview = new RustStylePreview(f.ports)
  await preview.render(input()); assert.equal(cache.stats.entries, 2)
  f.service.renderPrepared = async () => { throw new RustPixelPocError('wasm-unavailable') }
  await preview.render(input('canvas:b')); assert.equal(cache.stats.entries, 0)
  assert.equal(cache.stats.bytes, 0); await preview.dispose()
})

test('Dispose durante cache fill não permite retenção tardia nem revoga PNG publicado', async () => {
  const f = fixture(), cache = new RustStylePreviewMediaCache(), gate = deferred<Blob>(), entered = deferred<void>()
  f.ports.mediaCache = cache
  const preview = new RustStylePreview(f.ports), first = await preview.render(input())
  f.ports.prepare = (request, signal, identity) => prepareRustStylePreviewMedia(request, signal, identity, cache,
    async () => { entered.resolve(); return gate.promise })
  const pending = preview.render({ ...input(), sourceUrl: 'blob:source' })
  const obsolete = assert.rejects(pending, RustStylePreviewCancelledError)
  await entered.promise; await preview.dispose(); await obsolete
  assert.equal(preview.stats.resultLeases, 1)
  gate.resolve(new Blob(['late'])); await new Promise(resolve => setImmediate(resolve))
  assert.equal(cache.stats.entries, 0); assert.equal(cache.stats.bytes, 0)
  assert.equal(f.state.releases, 0); first.release(); assert.equal(f.state.releases, 1)
})

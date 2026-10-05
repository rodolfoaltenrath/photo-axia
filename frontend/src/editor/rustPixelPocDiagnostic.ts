import wasmUrl from '../generated/axia_pixel_core.wasm?url'
import type { RustPixelPocRequest, RustPixelPocResponse } from './rustPixelPocProtocol.ts'
import { RustPixelPocPreviewObserver } from './rustPixelPocPreviewObserver.ts'
import { RustPixelPocTileGate } from './rustPixelPocTileGate.ts'
import { styledRasterPreviewSnapshot } from './rustPixelPocStyledSource.ts'
import { normalizeLayerStyleConfig } from './layerStyles.ts'

type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never

/** Explicit diagnostic only; never an editor renderer. */
export async function runRustPixelPocDiagnostic(): Promise<{ elapsedMs: number; wasmBytes: number }> {
  const started = performance.now()
  const response = await fetch(wasmUrl)
  if (!response.ok) throw new Error(`WASM indisponível (HTTP ${response.status}).`)
  const wasm = await response.arrayBuffer()
  if (!wasm.byteLength) throw new Error('WASM vazio no pacote.')
  const wasmBytes = wasm.byteLength // The buffer is detached after transfer to the Worker.

  const worker = new Worker(new URL('../workers/rustPixelPoc.worker.ts', import.meta.url), { type: 'module' })
  let nextId = 0
  function send(request: WithoutId<RustPixelPocRequest>, transfers: Transferable[] = []):
    Promise<RustPixelPocResponse> & { id: number } {
    const id = ++nextId
    const pending = new Promise<RustPixelPocResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error(`Tempo esgotado no Worker Rust (pedido ${id}).`))
      }, 10_000)
      function cleanup() {
        window.clearTimeout(timeout)
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
      }
      function onMessage(event: MessageEvent<RustPixelPocResponse>) {
        if (event.data.id !== id) return
        cleanup()
        if (event.data.type === 'error') reject(new Error(`Worker Rust: ${event.data.code}`))
        else resolve(event.data)
      }
      function onError(event: ErrorEvent) {
        cleanup()
        reject(new Error(`Worker Rust indisponível: ${event.message}`))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.postMessage({ ...request, id }, transfers)
    })
    return Object.assign(pending, { id })
  }

  try {
    const initialized = await send({ type: 'init', wasm }, [wasm])
    if (initialized.type !== 'ready') throw new Error('Worker Rust não inicializou.')
    const gate = new RustPixelPocTileGate()
    const observer = new RustPixelPocPreviewObserver(gate)
    const source = new Uint8Array([10, 20, 30, 101, 90, 80, 70, 255])
    const rendered = await send({ type: 'render', rgba: source.buffer as ArrayBuffer, fillOpacity: 50 }, [source.buffer])
    if (rendered.type !== 'rendered' ||
        [...new Uint8Array(rendered.rgba)].join(',') !== '10,20,30,51,90,80,70,128') {
      throw new Error('Worker Rust produziu RGBA diferente do golden.')
    }
    const regionSource = new Uint8Array([1, 2, 3, 255, 40, 50, 60, 255,
      4, 5, 6, 255, 7, 8, 9, 0])
    const tile = await send({ type: 'render-region', rgba: regionSource.buffer as ArrayBuffer,
      sourceWidth: 2, sourceHeight: 2, region: { x: 1, y: 0, width: 1, height: 2 },
      fillOpacity: 50 }, [regionSource.buffer])
    if (tile.type !== 'rendered-region' || tile.width !== 1 || tile.height !== 2 ||
        [...new Uint8Array(tile.rgba)].join(',') !== '40,50,60,128,0,0,0,0') {
      throw new Error('Worker Rust produziu tile diferente do golden.')
    }
    const stagedSource = new Uint8Array([1, 2, 3, 255, 40, 50, 60, 255,
      4, 5, 6, 255, 7, 8, 9, 0])
    const snapshot = { documentId: 'diagnostic', layerId: 'sample', sourceKey: 'sample-v1',
      appearanceKey: 'fill-50', viewportKey: 'scale-1' }
    const initial = observer.observe(snapshot)
    if (initial.kind !== 'source') throw new Error('Observador Rust não detectou a primeira fonte.')
    const staged = await send({ type: 'stage-source', rgba: stagedSource.buffer as ArrayBuffer,
      sourceWidth: 2, sourceHeight: 2, generation: initial.generation }, [stagedSource.buffer])
    if (staged.type !== 'source-staged' || !gate.adoptSource(staged)) {
      throw new Error('Worker Rust não carregou a fonte reutilizável atual.')
    }
    const target = new Uint8Array(8)
    const colorRequest = send({ type: 'color-overlay-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, target: target.buffer,
      effect: { color: [200, 120, 40, 255], opacity: 50, blendMode: 'normal' } }, [target.buffer])
    const colorToken = gate.captureTile('sobreposição-direita', colorRequest.id)
    const colored = await colorRequest
    if (!colorToken?.isCurrent(colored) || target.byteLength !== 0 ||
        [...new Uint8Array(colored.rgba)].join(',') !== '200,120,40,128,0,0,0,0') {
      throw new Error('Worker Rust produziu Sobreposição de cor diferente do golden.')
    }
    const patternTarget = new Uint8Array(8)
    const pattern = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
    const patternRequest = send({ type: 'pattern-overlay-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, target: patternTarget.buffer,
      pattern: { rgba: pattern.buffer, width: 2, height: 1 },
      effect: { angle: 0, scale: 100, opacity: 100, blendMode: 'normal' } }, [patternTarget.buffer, pattern.buffer])
    const patternToken = gate.captureTile('padrão-direita', patternRequest.id)
    const patterned = await patternRequest
    if (!patternToken?.isCurrent(patterned) || patternTarget.byteLength !== 0 || pattern.byteLength !== 0 ||
        [...new Uint8Array(patterned.rgba)].join(',') !== '0,0,255,255,0,0,0,0') {
      throw new Error('Worker Rust produziu Sobreposição de padrão diferente do golden.')
    }
    const gradientTarget = new Uint8Array(8)
    const gradientRequest = send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, target: gradientTarget.buffer, effect: {
        gradient: { type: 'linear', colorStops: [{ position: 0, color: [0, 0, 0, 255] }, { position: 1, color: [255, 255, 255, 255] }],
          opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }] },
        angle: 0, scale: 100, reverse: false, opacity: 100, blendMode: 'normal'
      } }, [gradientTarget.buffer])
    const gradientToken = gate.captureTile('gradiente-direita', gradientRequest.id)
    const gradientResult = await gradientRequest
    if (!gradientToken?.isCurrent(gradientResult) || gradientTarget.byteLength !== 0 ||
        [...new Uint8Array(gradientResult.rgba)].join(',') !== '191,191,191,255,0,0,0,0') {
      throw new Error('Worker Rust produziu Sobreposição de gradiente diferente do golden.')
    }
    const backdrop = new Uint8Array([75, 0, 0, 255, 100, 0, 0, 0])
    const blendRequest = send({ type: 'blend-if-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, backdrop: backdrop.buffer,
      blendIf: { channel: 'red', shadows: [50, 100], highlights: [255, 255] } }, [backdrop.buffer])
    const blendToken = gate.captureTile('blend-if-direita', blendRequest.id)
    const blended = await blendRequest
    if (!blendToken?.isCurrent(blended) || backdrop.byteLength !== 0 ||
        [...new Uint8Array(blended.rgba)].join(',') !== '40,50,60,128,7,8,9,0') {
      throw new Error('Worker Rust produziu Mesclar se diferente do golden.')
    }
    const thisLayerRequest = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 },
      blendIf: { channel: 'red', shadows: [20, 60], highlights: [255, 255] } })
    const thisLayerToken = gate.captureTile('esta-camada-direita', thisLayerRequest.id)
    const filtered = await thisLayerRequest
    if (!thisLayerToken?.isCurrent(filtered) || filtered.timings.copyInMs !== 0 ||
        [...new Uint8Array(filtered.rgba)].join(',') !== '40,50,60,128,7,8,9,0') {
      throw new Error('Worker Rust produziu Mesclar se — Esta camada diferente do golden.')
    }
    const pendingTile = send({ type: 'render-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, fillOpacity: 50 })
    const tileToken = gate.captureTile('coluna-direita', pendingTile.id)
    if (!tileToken) throw new Error('Fonte Rust ausente para o tile.')
    const cachedTile = await pendingTile
    if (!tileToken.isCurrent(cachedTile) ||
        cachedTile.timings.copyInMs !== 0 ||
        [...new Uint8Array(cachedTile.rgba)].join(',') !== '40,50,60,128,0,0,0,0') {
      throw new Error('Worker Rust não reutilizou a fonte entre tiles.')
    }
    if (observer.observe({ ...snapshot, viewportKey: 'scale-2' }).kind !== 'view' ||
        tileToken.isCurrent(cachedTile)) {
      throw new Error('Observador Rust não invalidou o tile após mudar a vista.')
    }
    const olderRequest = send({ type: 'render-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, fillOpacity: 25 })
    const olderToken = gate.captureTile('pedido-repetido', olderRequest.id)
    const newerRequest = send({ type: 'render-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, fillOpacity: 50 })
    const newerToken = gate.captureTile('pedido-repetido', newerRequest.id)
    const [olderResult, newerResult] = await Promise.all([olderRequest, newerRequest])
    if (!olderToken || !newerToken || olderToken.isCurrent(olderResult) ||
        !newerToken.isCurrent(newerResult)) {
      throw new Error('Gate Rust aceitou um pedido ultrapassado do mesmo tile.')
    }
    const next = observer.observe({ ...snapshot, sourceKey: 'sample-v2', viewportKey: 'scale-2' })
    if (next.kind !== 'source' || newerToken.isCurrent(newerResult)) {
      throw new Error('Observador Rust não invalidou a fonte anterior.')
    }
    const released = await send({ type: 'release-source', sourceId: staged.sourceId })
    if (released.type !== 'source-released') throw new Error('Worker Rust não liberou a fonte.')
    const invalidated = await send({ type: 'invalidate-source', generation: next.generation })
    if (invalidated.type !== 'source-invalidated' || invalidated.generation !== next.generation) {
      throw new Error('Worker Rust não avançou a geração da fonte.')
    }
    const styledDocument = { id: 'diagnostic', width: 2, height: 1, background: 'transparent' as const,
      colorSpace: 'srgb' as const, resolutionDpi: 72, layerStyleGlobalLight: { angle: 30, altitude: 30 } }
    const styledLayer = { id: 'sample', kind: 'pixel' as const, visible: true, opacity: 100,
      blendMode: 'normal' as const, styles: normalizeLayerStyleConfig({ fillOpacity: 0,
        effects: [{ type: 'color-overlay', id: 'color', color: '#c87828' }],
        blendIf: { channel: 'red', thisLayer: { shadows: [150, 250], highlights: [255, 255] } } }) }
    const styledViewport = { scale: 1, devicePixelRatio: 1, scrollLeft: 0, scrollTop: 0,
      width: 800, height: 600, stackKey: 'diagnostic' }
    const styledIdentity = { contentKey: 'styled-sample', assetKey: '', width: 2, height: 1,
      offsetX: 0, offsetY: 0, resolutionScale: 1, quality: 'final' as const }
    const styledSnapshot = styledRasterPreviewSnapshot(styledDocument, styledLayer, undefined,
      styledViewport, styledIdentity)
    const styledChange = observer.observe(styledSnapshot)
    if (styledChange.kind !== 'source') throw new Error('Observador Rust não distinguiu a fonte estilizada.')
    await send({ type: 'invalidate-source', generation: styledChange.generation })
    const styledPixels = new Uint8Array([200, 120, 40, 255, 200, 120, 40, 101])
    const styledSource = await send({ type: 'stage-source', rgba: styledPixels.buffer,
      sourceWidth: 2, sourceHeight: 1, generation: styledChange.generation }, [styledPixels.buffer])
    if (styledSource.type !== 'source-staged' || !gate.adoptSource(styledSource)) {
      throw new Error('Worker Rust rejeitou upload após invalidar a mesma geração.')
    }
    const styledRequest = send({ type: 'blend-if-this-layer-staged-region', sourceId: styledSource.sourceId,
      region: { x: 0, y: 0, width: 2, height: 1 }, blendIf: {
        channel: 'red', shadows: [150, 250], highlights: [255, 255] } })
    const styledToken = gate.captureTile('fonte-estilizada', styledRequest.id)
    const styledResult = await styledRequest
    if (!styledToken?.isCurrent(styledResult) || styledResult.timings.copyInMs !== 0 ||
        [...new Uint8Array(styledResult.rgba)].join(',') !== '200,120,40,128,200,120,40,51') {
      throw new Error('Worker Rust não filtrou a nova fonte estilizada corretamente.')
    }
    const changedThresholds = styledRasterPreviewSnapshot(styledDocument, {
      ...styledLayer, styles: normalizeLayerStyleConfig({ ...styledLayer.styles, blendIf: { channel: 'red' } })
    }, undefined, styledViewport, styledIdentity)
    if (observer.observe(changedThresholds).kind !== 'view' || styledToken.isCurrent(styledResult) ||
        !gate.captureTile('fonte-estilizada', nextId + 1)) {
      throw new Error('Observador Rust não reutilizou pixels ao mudar somente as faixas.')
    }
    const disposed = await send({ type: 'dispose' })
    if (disposed.type !== 'disposed') throw new Error('Worker Rust não descartou o estado.')
    return { elapsedMs: performance.now() - started, wasmBytes }
  } finally {
    worker.terminate()
  }
}

import wasmUrl from '../generated/axia_pixel_core.wasm?url'
import type { RustPixelPocRequest, RustPixelPocResponse } from './rustPixelPocProtocol.ts'
import { RustPixelPocPreviewObserver } from './rustPixelPocPreviewObserver.ts'
import { RustPixelPocTileGate } from './rustPixelPocTileGate.ts'

type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never

/** Explicit-only smoke test for the packaged WASM/Worker, not an editor renderer. */
export async function runRustPixelPocDiagnostic(): Promise<{ elapsedMs: number; wasmBytes: number }> {
  const started = performance.now()
  const response = await fetch(wasmUrl)
  if (!response.ok) throw new Error(`WASM indisponível (HTTP ${response.status}).`)
  const wasm = await response.arrayBuffer()
  if (!wasm.byteLength) throw new Error('WASM vazio no pacote.')

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
    const disposed = await send({ type: 'dispose' })
    if (disposed.type !== 'disposed') throw new Error('Worker Rust não descartou o estado.')
    return { elapsedMs: performance.now() - started, wasmBytes: wasm.byteLength }
  } finally {
    worker.terminate()
  }
}

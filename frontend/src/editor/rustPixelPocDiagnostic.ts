import wasmUrl from '../generated/axia_pixel_core.wasm?url'
import type { RustPixelPocRequest, RustPixelPocResponse } from './rustPixelPocProtocol.ts'

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
  function send(request: WithoutId<RustPixelPocRequest>, transfers: Transferable[] = []): Promise<RustPixelPocResponse> {
    const id = ++nextId
    return new Promise((resolve, reject) => {
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
  }

  try {
    const initialized = await send({ type: 'init', wasm }, [wasm])
    if (initialized.type !== 'ready') throw new Error('Worker Rust não inicializou.')
    const source = new Uint8Array([10, 20, 30, 101, 90, 80, 70, 255])
    const rendered = await send({ type: 'render', rgba: source.buffer as ArrayBuffer, fillOpacity: 50 }, [source.buffer])
    if (rendered.type !== 'rendered' ||
        [...new Uint8Array(rendered.rgba)].join(',') !== '10,20,30,51,90,80,70,128') {
      throw new Error('Worker Rust produziu RGBA diferente do golden.')
    }
    const disposed = await send({ type: 'dispose' })
    if (disposed.type !== 'disposed') throw new Error('Worker Rust não descartou o estado.')
    return { elapsedMs: performance.now() - started, wasmBytes: wasm.byteLength }
  } finally {
    worker.terminate()
  }
}

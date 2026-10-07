import { RustPixelPocError } from './rustPixelPocError.ts'
import type { RustPixelPocSend } from './rustPixelPocStyleSession.ts'
import type { RustPixelPocResponse } from './rustPixelPocProtocol.ts'

export interface RustPixelPocWorkerPort {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
  onMessage(listener: (message: unknown) => void): () => void
  onFailure(listener: () => void): () => void
  terminate(): void | Promise<void>
}

export interface RustPixelPocConnection {
  readonly closed: boolean
  send: RustPixelPocSend
  cancel(id: number): void
  terminate(): Promise<void>
}

export class RustPixelPocWorkerClient implements RustPixelPocConnection {
  private readonly pending = new Map<number, { resolve: (value: RustPixelPocResponse) => void;
    reject: (error: unknown) => void; timeout: ReturnType<typeof setTimeout>; cancellable: boolean }>()
  private readonly unsubscribe: (() => void)[]
  private nextId = 0
  private stopped = false
  private termination: Promise<void> | null = null
  private readonly port: RustPixelPocWorkerPort
  private readonly timeoutMs: number

  constructor(port: RustPixelPocWorkerPort, timeoutMs = 10_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new RustPixelPocError('invalid-input')
    this.port = port; this.timeoutMs = timeoutMs
    this.unsubscribe = [port.onMessage(message => {
      if (!message || typeof message !== 'object' || !('id' in message) || !Number.isSafeInteger(message.id)) return
      const entry = this.pending.get(message.id as number)
      if (!entry) return
      if (!('type' in message) || typeof message.type !== 'string') { void this.terminate(); return }
      clearTimeout(entry.timeout); this.pending.delete(message.id as number)
      entry.resolve(message as RustPixelPocResponse)
    }), port.onFailure(() => { void this.terminate() })]
  }

  get closed() { return this.stopped }

  readonly send: RustPixelPocSend = (request, transfer = []) => {
    const id = ++this.nextId
    const promise = new Promise<RustPixelPocResponse>((resolve, reject) => {
      if (this.stopped) { reject(new RustPixelPocError('wasm-unavailable')); return }
      if (request.type === 'cancel') { reject(new RustPixelPocError('invalid-input')); return }
      if (!Number.isSafeInteger(id)) { reject(new RustPixelPocError('wasm-failure')); return }
      if (this.pending.size >= 8) { reject(new RustPixelPocError('memory-limit')); return }
      const timeout = setTimeout(() => { void this.terminate() }, this.timeoutMs)
      const cancellable = !['init', 'dispose', 'invalidate-source', 'release-source',
        'stage-source', 'stage-style-source', 'stage-style-media', 'prepare-document', 'release-document'].includes(request.type)
      this.pending.set(id, { resolve, reject, timeout, cancellable })
      try { this.port.postMessage({ ...request, id }, transfer) }
      catch {
        clearTimeout(timeout); this.pending.delete(id)
        reject(new RustPixelPocError('invalid-input'))
      }
    })
    return Object.assign(promise, { id })
  }

  cancel(id: number) {
    if (this.stopped || !this.pending.get(id)?.cancellable) return
    try { this.port.postMessage({ type: 'cancel', id }, []) }
    catch { void this.terminate() }
  }

  terminate() {
    if (this.termination) return this.termination
    this.stopped = true
    for (const stop of this.unsubscribe) stop()
    for (const entry of this.pending.values()) { clearTimeout(entry.timeout); entry.reject(new RustPixelPocError('wasm-unavailable')) }
    this.pending.clear()
    this.termination = Promise.resolve().then(() => this.port.terminate()).catch(() => {})
    return this.termination
  }
}

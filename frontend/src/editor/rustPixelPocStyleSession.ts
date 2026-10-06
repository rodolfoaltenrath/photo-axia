import type { LayerStyleRaster } from './layerStyleCompositor.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { copyRustStyleSource, describeRustStyleSource, prepareRustStyleJob, type RustPixelPocStyleInput, type RustPixelPocStyleJob } from './rustPixelPocStylePreparation.ts'
import { RustPixelPocTileGate } from './rustPixelPocTileGate.ts'
import type { RustPixelPocRequest, RustPixelPocResponse } from './rustPixelPocProtocol.ts'

type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never
export type RustPixelPocSend = (request: WithoutId<RustPixelPocRequest>, transfers?: ArrayBuffer[]) =>
  Promise<RustPixelPocResponse> & { id: number }
type Staged = Extract<RustPixelPocResponse, { type: 'source-staged' }>

export class RustPixelPocStyleCancelledError extends Error {
  constructor() { super('style-request-obsolete'); this.name = 'RustPixelPocStyleCancelledError' }
}

export interface RustPixelPocStyleRequest extends RustPixelPocStyleInput {
  source: () => Promise<LayerStyleRaster>
}

/** One consumer and one exclusive Worker source slot. */
export class RustPixelPocStyleSession {
  private entry: { key: string; token: symbol; promise: Promise<Staged> } | null = null
  private revision = 0
  private disposed = false
  private disposal: Promise<void> | null = null
  private readonly send: RustPixelPocSend
  private readonly gate: RustPixelPocTileGate

  constructor(send: RustPixelPocSend, gate = new RustPixelPocTileGate()) { this.send = send; this.gate = gate }

  private checked(response: RustPixelPocResponse) {
    if (response.type === 'error') throw new RustPixelPocError(response.code)
    return response
  }

  private prepareSource(job: RustPixelPocStyleJob, load: () => Promise<LayerStyleRaster>) {
    const generation = this.gate.beginSourceChange()
    const token = Symbol(job.sourceKey)
    const promise: Promise<Staged> = (async () => {
      const barrier = this.checked(await this.send({ type: 'invalidate-source', generation }))
      if (barrier.type !== 'source-invalidated' || barrier.generation !== generation) throw new RustPixelPocError('wasm-failure')
      if (this.disposed || this.entry?.token !== token) throw new RustPixelPocStyleCancelledError()
      const source = await load()
      if (this.disposed || this.entry?.token !== token) throw new RustPixelPocStyleCancelledError()
      const rgba = copyRustStyleSource(source, job)
      const staged = this.checked(await this.send({ type: 'stage-style-source', rgba: rgba.buffer,
        input: describeRustStyleSource(job), generation }, [rgba.buffer]))
      if (this.disposed || this.entry?.token !== token) throw new RustPixelPocStyleCancelledError()
      if (staged.type !== 'source-staged' || staged.prepared?.sourceKey !== job.sourceKey ||
          staged.prepared.width !== job.width || staged.prepared.height !== job.height ||
          staged.prepared.offsetX !== job.offsetX || staged.prepared.offsetY !== job.offsetY ||
          !Number.isFinite(staged.prepared.preparationMs) || staged.prepared.preparationMs < 0 ||
          !this.gate.adoptSource(staged)) throw new RustPixelPocError('wasm-failure')
      return staged
    })()
    const entry = { key: job.sourceKey, token, promise }
    this.entry = entry
    void promise.catch(() => { if (this.entry === entry) this.entry = null })
    return entry
  }

  async compose(request: RustPixelPocStyleRequest) {
    if (this.disposed) throw new RustPixelPocError('wasm-unavailable')
    const revision = ++this.revision
    this.gate.beginViewChange()
    const job = prepareRustStyleJob(request)
    const entry = this.entry?.key === job.sourceKey ? this.entry : this.prepareSource(job, request.source)
    const staged = await entry.promise
    if (revision !== this.revision || this.disposed || this.entry !== entry) throw new RustPixelPocStyleCancelledError()
    const execution = this.send({ type: 'style-stages-staged-region', sourceId: staged.sourceId, region: job.region, plan: job.plan })
    const token = this.gate.captureTile('style', execution.id)
    const result = await execution
    if (revision !== this.revision || this.disposed || this.entry !== entry) throw new RustPixelPocStyleCancelledError()
    this.checked(result)
    if (!token?.isCurrent(result) || result.width !== job.region.width || result.height !== job.region.height ||
        !(result.rgba instanceof ArrayBuffer) || result.rgba.byteLength !== job.region.width * job.region.height * 4) {
      throw new RustPixelPocError('wasm-failure')
    }
    return { ...result, offsetX: job.offsetX + job.region.x, offsetY: job.offsetY + job.region.y,
      sourceWidth: job.sourceWidth, sourceHeight: job.sourceHeight, paddedWidth: job.width, paddedHeight: job.height }
  }

  async invalidate() {
    if (this.disposed) return
    this.revision++
    this.entry = null
    const generation = this.gate.beginSourceChange()
    const result = this.checked(await this.send({ type: 'invalidate-source', generation }))
    if (result.type !== 'source-invalidated' || result.generation !== generation) throw new RustPixelPocError('wasm-failure')
  }

  dispose() {
    if (this.disposal) return this.disposal
    this.disposal = this.invalidate()
    this.disposed = true
    return this.disposal
  }
}

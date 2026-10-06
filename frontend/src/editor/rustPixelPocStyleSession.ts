import type { LayerStyleRaster } from './layerStyleCompositor.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { copyRustStyleSource, describeRustStyleSource, prepareRustStyleJob, prepareRustStyleSourceLayout,
  type RustPixelPocStyleInput, type RustPixelPocStyleSourceInput, type RustPixelPocStyleSourceLayout } from './rustPixelPocStylePreparation.ts'
import { prepareRustStyleAssets } from './rustPixelPocMedia.ts'
import { rustStylePngLayout } from './rustPixelPocPng.ts'
import type { LayerStyleWorkerSource } from './layerStyleRenderProtocol.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'
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

export interface RustPixelPocStyleMediaRequest extends RustPixelPocStyleSourceInput {
  source: () => Promise<LayerStyleWorkerSource>
  patterns?: Record<string, Blob>
  region?: RustPixelPocRegion
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

  private prepareSource(job: RustPixelPocStyleSourceLayout,
    load: () => Promise<LayerStyleRaster | LayerStyleWorkerSource>, media = false) {
    const generation = this.gate.beginSourceChange()
    const key = `${media ? 'media' : 'raw'}:${job.sourceKey}`
    const token = Symbol(key)
    const promise: Promise<Staged> = (async () => {
      const barrier = this.checked(await this.send({ type: 'invalidate-source', generation }))
      if (barrier.type !== 'source-invalidated' || barrier.generation !== generation) throw new RustPixelPocError('wasm-failure')
      if (this.disposed || this.entry?.token !== token) throw new RustPixelPocStyleCancelledError()
      const source = await load()
      if (this.disposed || this.entry?.token !== token) throw new RustPixelPocStyleCancelledError()
      const input = describeRustStyleSource(job)
      const staged = this.checked(await (() => {
        if (media) return this.send({ type: 'stage-style-media', source: source as LayerStyleWorkerSource, input, generation })
        const rgba = copyRustStyleSource(source as LayerStyleRaster, job)
        return this.send({ type: 'stage-style-source', rgba: rgba.buffer, input, generation }, [rgba.buffer])
      })())
      if (this.disposed || this.entry?.token !== token) throw new RustPixelPocStyleCancelledError()
      if (staged.type !== 'source-staged' || staged.prepared?.sourceKey !== job.sourceKey ||
          staged.prepared.width !== job.width || staged.prepared.height !== job.height ||
          staged.prepared.offsetX !== job.offsetX || staged.prepared.offsetY !== job.offsetY ||
          !Number.isFinite(staged.prepared.preparationMs) || staged.prepared.preparationMs < 0 ||
          !this.gate.adoptSource(staged)) throw new RustPixelPocError('wasm-failure')
      return staged
    })()
    const entry = { key, token, promise }
    this.entry = entry
    void promise.catch(() => { if (this.entry === entry) this.entry = null })
    return entry
  }

  async compose(request: RustPixelPocStyleRequest) {
    if (this.disposed) throw new RustPixelPocError('wasm-unavailable')
    const revision = ++this.revision
    this.gate.beginViewChange()
    const job = prepareRustStyleJob(request)
    const entry = this.entry?.key === `raw:${job.sourceKey}` ? this.entry : this.prepareSource(job, request.source)
    return this.finish(job, entry, revision, staged => this.send({ type: 'style-stages-staged-region',
      sourceId: staged.sourceId, region: job.region, plan: job.plan }))
  }

  async composeMedia(request: RustPixelPocStyleMediaRequest) {
    const { job, entry, revision, input, patterns } = this.prepareMedia(request)
    return this.finish(job, entry, revision, staged => this.send({ type: 'style-media-staged-region',
      sourceId: staged.sourceId, input, region: job.region, patterns }))
  }

  async composeMediaPng(request: RustPixelPocStyleMediaRequest) {
    const { job, entry, revision, input, patterns } = this.prepareMedia(request, true)
    const result = await this.receive(job, entry, revision, staged => this.send({ type: 'style-media-staged-png',
      sourceId: staged.sourceId, input, region: job.region, patterns }), 'encoded-staged-region')
    if (!(result.blob instanceof Blob) || result.blob.type !== 'image/png' || !result.blob.size ||
        result.blob.size > 64 * 1024 * 1024 || !result.encoding ||
        ![result.encoding.canvasUploadMs, result.encoding.pngEncodeMs].every(value => Number.isFinite(value) && value >= 0)) {
      throw new RustPixelPocError('wasm-failure')
    }
    return { ...result, ...this.geometry(job) }
  }

  private prepareMedia(request: RustPixelPocStyleMediaRequest, png = false) {
    if (this.disposed) throw new RustPixelPocError('wasm-unavailable')
    const revision = ++this.revision
    this.gate.beginViewChange()
    const layout = prepareRustStyleSourceLayout(request)
    const region = request.region ? { ...request.region } : { x: 0, y: 0, width: layout.width, height: layout.height }
    if (![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) ||
        region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
        region.x + region.width > layout.width || region.y + region.height > layout.height) throw new RustPixelPocError('invalid-input')
    const patterns = { ...request.patterns }
    const assets = prepareRustStyleAssets(layout, patterns)
    if (png) rustStylePngLayout(region.width, region.height, layout.width * layout.height * 4 + assets.decodedBytes)
    const input = { sourceIdentity: layout.sourceIdentity, sourceWidth: layout.sourceWidth, sourceHeight: layout.sourceHeight,
      styles: layout.styles, globalLight: layout.light, resolutionScale: layout.scale, quality: layout.quality }
    const entry = this.entry?.key === `media:${layout.sourceKey}` ? this.entry : this.prepareSource(layout, request.source, true)
    return { job: { ...layout, region }, entry, revision, input, patterns }
  }

  private async finish(job: RustPixelPocStyleSourceLayout & { region: RustPixelPocRegion },
    entry: NonNullable<RustPixelPocStyleSession['entry']>, revision: number,
    execute: (source: Staged) => ReturnType<RustPixelPocSend>) {
    const result = await this.receive(job, entry, revision, execute, 'rendered-staged-region')
    if (!(result.rgba instanceof ArrayBuffer) || result.rgba.byteLength !== job.region.width * job.region.height * 4) {
      throw new RustPixelPocError('wasm-failure')
    }
    return { ...result, ...this.geometry(job) }
  }

  private async receive<T extends 'rendered-staged-region' | 'encoded-staged-region'>(
    job: RustPixelPocStyleSourceLayout & { region: RustPixelPocRegion },
    entry: NonNullable<RustPixelPocStyleSession['entry']>, revision: number,
    execute: (source: Staged) => ReturnType<RustPixelPocSend>, responseType: T) {
    const staged = await entry.promise
    if (revision !== this.revision || this.disposed || this.entry !== entry) throw new RustPixelPocStyleCancelledError()
    const execution = execute(staged)
    const token = this.gate.captureTile('style', execution.id, responseType)
    const result = await execution
    if (revision !== this.revision || this.disposed || this.entry !== entry) throw new RustPixelPocStyleCancelledError()
    if (result.type === 'cancelled') throw new RustPixelPocStyleCancelledError()
    this.checked(result)
    if (!token?.isCurrent(result) || result.width !== job.region.width || result.height !== job.region.height) {
      throw new RustPixelPocError('wasm-failure')
    }
    return result
  }

  private geometry(job: RustPixelPocStyleSourceLayout & { region: RustPixelPocRegion }) {
    return { offsetX: job.offsetX + job.region.x, offsetY: job.offsetY + job.region.y,
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

  cancelPendingRender() {
    this.revision++
    this.gate.beginViewChange()
  }

  dispose() {
    if (this.disposal) return this.disposal
    this.disposal = this.invalidate()
    this.disposed = true
    return this.disposal
  }
}

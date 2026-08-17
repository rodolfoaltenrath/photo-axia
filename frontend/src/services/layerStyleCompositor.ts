import {
  composeLayerStyleBase,
  layerStyleCacheKey,
  layerStyleInsets,
  type LayerStyleRenderQuality
} from '../editor/layerStyleCompositor.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from '../editor/layerStyles.ts'
import { ByteBudgetLruCache, LatestGenerationByKey } from '../editor/renderCache.ts'
import type { LayerStyleWorkerRequest, LayerStyleWorkerResult } from '../editor/layerStyleRenderProtocol.ts'
import type { LayerStyleConfig, LayerStyleGlobalLight } from '../types/editor.ts'

export interface LayerStyleRenderRequest {
  consumerId: string
  layerId: string
  sourceIdentity: string
  source: Blob | (() => Promise<Blob>)
  sourceWidth: number
  sourceHeight: number
  styles: LayerStyleConfig
  globalLight: LayerStyleGlobalLight
  resolutionScale?: number
  quality?: LayerStyleRenderQuality
}

export interface LayerStyleRenderResult {
  blob: Blob
  width: number
  height: number
  offsetX: number
  offsetY: number
  cacheKey: string
  fromCache: boolean
}

interface CachedLayerStyleRender extends Omit<LayerStyleRenderResult, 'fromCache'> {
  byteSize: number
}

interface WorkerPending {
  resolve: (value: Omit<LayerStyleRenderResult, 'cacheKey' | 'fromCache'>) => void
  reject: (error: Error) => void
}

interface SharedPending {
  promise: Promise<CachedLayerStyleRender>
  consumers: Set<string>
  cancel: () => void
}

export class LayerStyleRenderCancelledError extends Error {
  constructor() {
    super('Composição de estilo substituída por uma solicitação mais recente.')
    this.name = 'LayerStyleRenderCancelledError'
  }
}

const cache = new ByteBudgetLruCache<CachedLayerStyleRender>(96 * 1024 * 1024, 128)
const generations = new LatestGenerationByKey()
const sharedPending = new Map<string, SharedPending>()
const activeKeyByConsumer = new Map<string, string>()
const workerPending = new Map<number, WorkerPending>()
let compositorWorker: Worker | undefined
let nextWorkerRequestId = 1

function validateSourceDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
    width > 16_384 || height > 16_384 || width * height > 64_000_000
  ) throw new Error('Dimensões inválidas para composição de estilo.')
}

function publicResult(value: CachedLayerStyleRender, fromCache: boolean): LayerStyleRenderResult {
  return {
    blob: value.blob,
    width: value.width,
    height: value.height,
    offsetX: value.offsetX,
    offsetY: value.offsetY,
    cacheKey: value.cacheKey,
    fromCache
  }
}

function workerInstance() {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return undefined
  if (compositorWorker) return compositorWorker
  const worker = new Worker(new URL('../workers/layerStyleCompositor.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<LayerStyleWorkerResult>) => {
    const pending = workerPending.get(event.data.id)
    if (!pending) return
    workerPending.delete(event.data.id)
    if (event.data.error) pending.reject(new Error(event.data.error))
    else if (event.data.result) pending.resolve(event.data.result)
    else pending.reject(new Error('O compositor retornou um resultado inválido.'))
  }
  worker.onerror = () => {
    for (const pending of workerPending.values()) pending.reject(new Error('O compositor de estilos foi interrompido.'))
    workerPending.clear()
    worker.terminate()
    compositorWorker = undefined
  }
  compositorWorker = worker
  return worker
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas === 'undefined'
    ? Object.assign(document.createElement('canvas'), { width, height })
    : new OffscreenCanvas(width, height)
}

function context2d(canvas: HTMLCanvasElement | OffscreenCanvas, readFrequently = false) {
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: readFrequently }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) throw new Error('O sistema não disponibilizou o renderizador de estilos 2D.')
  return context
}

function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Não foi possível codificar o estilo de camada.')),
    'image/png'
  ))
}

async function fallbackRender(
  source: Blob,
  sourceWidth: number,
  sourceHeight: number,
  styles: LayerStyleConfig,
  globalLight: LayerStyleGlobalLight,
  resolutionScale: number,
  quality: LayerStyleRenderQuality
) {
  const bitmap = await createImageBitmap(source, {
    resizeWidth: sourceWidth,
    resizeHeight: sourceHeight,
    resizeQuality: quality === 'interactive' ? 'medium' : 'high'
  })
  const sourceCanvas = makeCanvas(sourceWidth, sourceHeight)
  try {
    const sourceContext = context2d(sourceCanvas, true)
    sourceContext.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight)
    const pixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight)
    const composed = composeLayerStyleBase({ width: pixels.width, height: pixels.height, data: pixels.data }, styles)
    const insets = layerStyleInsets(styles, globalLight, resolutionScale)
    const width = composed.width + insets.left + insets.right
    const height = composed.height + insets.top + insets.bottom
    const output = makeCanvas(width, height)
    try {
      const outputPixels = new ImageData(composed.width, composed.height)
      outputPixels.data.set(composed.data)
      context2d(output).putImageData(outputPixels, insets.left, insets.top)
      return { blob: await encodeCanvas(output), width, height, offsetX: -insets.left, offsetY: -insets.top }
    } finally {
      output.width = 1
      output.height = 1
    }
  } finally {
    bitmap.close()
    sourceCanvas.width = 1
    sourceCanvas.height = 1
  }
}

function executeRender(
  source: Blob,
  sourceWidth: number,
  sourceHeight: number,
  styles: LayerStyleConfig,
  globalLight: LayerStyleGlobalLight,
  resolutionScale: number,
  quality: LayerStyleRenderQuality
) {
  const worker = workerInstance()
  if (!worker) {
    return {
      promise: fallbackRender(source, sourceWidth, sourceHeight, styles, globalLight, resolutionScale, quality),
      cancel: () => undefined
    }
  }
  const id = nextWorkerRequestId++
  const promise = new Promise<Omit<LayerStyleRenderResult, 'cacheKey' | 'fromCache'>>((resolve, reject) => {
    workerPending.set(id, { resolve, reject })
    const message: LayerStyleWorkerRequest = {
      type: 'render', id, source, sourceWidth, sourceHeight, styles, globalLight, resolutionScale, quality
    }
    worker.postMessage(message)
  })
  return {
    promise,
    cancel: () => {
      const pending = workerPending.get(id)
      if (!pending) return
      workerPending.delete(id)
      pending.reject(new LayerStyleRenderCancelledError())
      const message: LayerStyleWorkerRequest = { type: 'cancel', id }
      worker.postMessage(message)
    }
  }
}

function detachConsumer(consumerId: string, key: string) {
  const pending = sharedPending.get(key)
  if (!pending) return
  pending.consumers.delete(consumerId)
  if (!pending.consumers.size) {
    sharedPending.delete(key)
    pending.cancel()
  }
}

export async function renderLayerStyle(request: LayerStyleRenderRequest): Promise<LayerStyleRenderResult> {
  validateSourceDimensions(request.sourceWidth, request.sourceHeight)
  const styles = normalizeLayerStyleConfig(request.styles)
  const globalLight = normalizeLayerStyleGlobalLight(request.globalLight)
  const resolutionScale = Number.isFinite(request.resolutionScale) && request.resolutionScale! > 0
    ? Math.min(8, Math.max(0.01, request.resolutionScale!))
    : 1
  const quality = request.quality ?? 'final'
  const key = layerStyleCacheKey({
    layerId: request.layerId,
    sourceIdentity: request.sourceIdentity,
    sourceWidth: request.sourceWidth,
    sourceHeight: request.sourceHeight,
    styles,
    globalLight,
    resolutionScale,
    quality
  })
  const generation = generations.begin(request.consumerId)
  const previousKey = activeKeyByConsumer.get(request.consumerId)
  if (previousKey && previousKey !== key) detachConsumer(request.consumerId, previousKey)
  activeKeyByConsumer.set(request.consumerId, key)

  const cached = cache.get(key)
  if (cached) {
    if (!generation.isCurrent()) throw new LayerStyleRenderCancelledError()
    return publicResult(cached, true)
  }

  let pending = sharedPending.get(key)
  if (!pending) {
    let cancelled = false
    let cancelExecution: () => void = () => undefined
    const promise = (async () => {
      const source = typeof request.source === 'function' ? await request.source() : request.source
      if (cancelled) throw new LayerStyleRenderCancelledError()
      const execution = executeRender(
        source, request.sourceWidth, request.sourceHeight, styles, globalLight, resolutionScale, quality
      )
      cancelExecution = execution.cancel
      const result = await execution.promise
      if (cancelled) throw new LayerStyleRenderCancelledError()
      const cachedResult: CachedLayerStyleRender = {
        ...result,
        cacheKey: key,
        byteSize: Math.max(result.blob.size, result.width * result.height * 4)
      }
      cache.set(key, cachedResult)
      return cachedResult
    })()
    pending = {
      promise,
      consumers: new Set(),
      cancel: () => {
        cancelled = true
        cancelExecution()
      }
    }
    sharedPending.set(key, pending)
    void promise.finally(() => {
      if (sharedPending.get(key)?.promise === promise) sharedPending.delete(key)
    }).catch(() => undefined)
  }
  pending.consumers.add(request.consumerId)

  try {
    const result = await pending.promise
    if (!generation.isCurrent()) throw new LayerStyleRenderCancelledError()
    return publicResult(result, false)
  } finally {
    pending.consumers.delete(request.consumerId)
    if (activeKeyByConsumer.get(request.consumerId) === key) activeKeyByConsumer.delete(request.consumerId)
  }
}

export function invalidateLayerStyleRender(consumerId: string) {
  generations.invalidate(consumerId)
  const key = activeKeyByConsumer.get(consumerId)
  if (key) detachConsumer(consumerId, key)
  activeKeyByConsumer.delete(consumerId)
}

export function clearLayerStyleRenderCache() {
  cache.clear()
}

export function disposeLayerStyleCompositor() {
  for (const pending of sharedPending.values()) pending.cancel()
  sharedPending.clear()
  activeKeyByConsumer.clear()
  generations.clear()
  cache.clear()
  compositorWorker?.terminate()
  compositorWorker = undefined
  for (const pending of workerPending.values()) pending.reject(new LayerStyleRenderCancelledError())
  workerPending.clear()
}

import { applyPaintBucketColorRegionCooperatively, applySolidFillRaster } from '../editor/paintBucket'
import { cloneSelection, invertMatrix, layerSourceToDocumentMatrix, selectionIsEmpty, transformSelectionPoint, type SelectionPoint, type SelectionRegion } from '../editor/selection'
import type { ImageAsset, LayerTransform } from '../types/editor'

export interface PaintBucketResult {
  blob?: Blob
  changedPixelCount: number
  previewBlob?: Blob
  previewHeight: number
  previewWidth: number
}

interface WorkerResponse { id: number; result?: PaintBucketResult; error?: string }
interface PendingBucket { resolve: (result: PaintBucketResult) => void; reject: (error: Error) => void; cleanup: () => void }
let worker: Worker | undefined
let nextId = 1
const pending = new Map<number, PendingBucket>()

function abortError() { return new DOMException('Preenchimento cancelado.', 'AbortError') }
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError() }

function terminateWorker(error: Error = abortError()) {
  worker?.terminate()
  worker = undefined
  for (const request of pending.values()) { request.cleanup(); request.reject(error) }
  pending.clear()
}

function workerInstance() {
  if (typeof Worker === 'undefined') return undefined
  if (worker) return worker
  worker = new Worker(new URL('../workers/paintBucket.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    request.cleanup()
    if (event.data.error) request.reject(new Error(event.data.error))
    else if (event.data.result) request.resolve(event.data.result)
    else request.reject(new Error('O Balde de Tinta retornou um resultado inválido.'))
  }
  worker.onerror = () => terminateWorker(new Error('O Balde de Tinta foi interrompido.'))
  return worker
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas === 'undefined' ? Object.assign(document.createElement('canvas'), { width, height }) : new OffscreenCanvas(width, height)
}

async function encode(canvas: HTMLCanvasElement | OffscreenCanvas, type = 'image/png') {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type })
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Não foi possível codificar o preenchimento.')), type
  ))
}

async function fallback(
  sourceBlob: Blob, asset: ImageAsset, transform: LayerTransform, point: SelectionPoint, color: string,
  tolerance: number, contiguous: boolean, selection: SelectionRegion | null, previewWidth: number, previewHeight: number,
  signal?: AbortSignal
): Promise<PaintBucketResult> {
  throwIfAborted(signal)
  const bitmap = await createImageBitmap(sourceBlob)
  const canvas = makeCanvas(asset.width, asset.height)
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) { bitmap.close(); throw new Error('O sistema não disponibilizou leitura de pixels.') }
  context.drawImage(bitmap, 0, 0, asset.width, asset.height); bitmap.close()
  const image = context.getImageData(0, 0, asset.width, asset.height)
  const sourceToDocument = layerSourceToDocumentMatrix(transform, asset.width, asset.height)
  const sourcePoint = transformSelectionPoint(invertMatrix(sourceToDocument), point)
  const result = await applyPaintBucketColorRegionCooperatively({
    pixels: image.data, width: asset.width, height: asset.height, color, selection, sourceToDocument,
    regionOptions: { startX: sourcePoint.x, startY: sourcePoint.y, tolerance, contiguous }
  }, {
    throwIfCancelled: () => throwIfAborted(signal),
    yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  throwIfAborted(signal)
  if (!result.pixels) {
    return { previewWidth, previewHeight, changedPixelCount: 0 }
  }
  context.putImageData(new ImageData(result.pixels, asset.width, asset.height), 0, 0)
  const previewCanvas = previewWidth === asset.width && previewHeight === asset.height ? undefined : makeCanvas(previewWidth, previewHeight)
  const previewContext = previewCanvas?.getContext('2d')
  if (previewContext) {
    previewContext.imageSmoothingEnabled = true
    previewContext.imageSmoothingQuality = 'high'
    previewContext.drawImage(canvas, 0, 0, previewWidth, previewHeight)
  }
  const [blob, previewBlob] = await Promise.all([encode(canvas), previewCanvas ? encode(previewCanvas, 'image/webp') : undefined])
  throwIfAborted(signal)
  return { blob, previewBlob, previewWidth, previewHeight, changedPixelCount: result.changedPixelCount }
}

async function fallbackSolidFill(
  sourceBlob: Blob, asset: ImageAsset, transform: LayerTransform, color: string,
  selection: SelectionRegion | null, previewWidth: number, previewHeight: number, signal?: AbortSignal
): Promise<PaintBucketResult> {
  throwIfAborted(signal)
  const bitmap = await createImageBitmap(sourceBlob)
  const canvas = makeCanvas(asset.width, asset.height)
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) { bitmap.close(); throw new Error('O sistema não disponibilizou leitura de pixels.') }
  context.drawImage(bitmap, 0, 0, asset.width, asset.height); bitmap.close()
  const image = context.getImageData(0, 0, asset.width, asset.height)
  const result = applySolidFillRaster({
    pixels: image.data, width: asset.width, height: asset.height, color, selection,
    sourceToDocument: layerSourceToDocumentMatrix(transform, asset.width, asset.height)
  })
  throwIfAborted(signal)
  if (!result.pixels) return { previewWidth, previewHeight, changedPixelCount: 0 }
  context.putImageData(new ImageData(result.pixels, asset.width, asset.height), 0, 0)
  const previewCanvas = previewWidth === asset.width && previewHeight === asset.height ? undefined : makeCanvas(previewWidth, previewHeight)
  const previewContext = previewCanvas?.getContext('2d')
  if (previewContext) {
    previewContext.imageSmoothingEnabled = true
    previewContext.imageSmoothingQuality = 'high'
    previewContext.drawImage(canvas, 0, 0, previewWidth, previewHeight)
  }
  const [blob, previewBlob] = await Promise.all([encode(canvas), previewCanvas ? encode(previewCanvas, 'image/webp') : undefined])
  throwIfAborted(signal)
  return { blob, previewBlob, previewWidth, previewHeight, changedPixelCount: result.changedPixelCount }
}

export async function applyPaintBucket(
  asset: ImageAsset, transform: LayerTransform, point: SelectionPoint, color: string, tolerance: number,
  contiguous: boolean, selection: SelectionRegion | null, previewWidth: number, previewHeight: number, signal?: AbortSignal
) {
  throwIfAborted(signal)
  const sourceToDocument = layerSourceToDocumentMatrix(transform, asset.width, asset.height)
  const sourcePoint = transformSelectionPoint(invertMatrix(sourceToDocument), point)
  if (sourcePoint.x < 0 || sourcePoint.y < 0 || sourcePoint.x >= asset.width || sourcePoint.y >= asset.height) {
    throw new Error('Clique dentro dos pixels da camada ativa.')
  }
  const response = await fetch(asset.sourceUrl, { signal })
  if (!response.ok) throw new Error('Não foi possível carregar a camada para preenchimento.')
  const sourceBlob = await response.blob()
  const activeSelection = selection && !selectionIsEmpty(selection) ? cloneSelection(selection) : null
  const activeWorker = workerInstance()
  if (!activeWorker) return fallback(sourceBlob, asset, transform, point, color, tolerance, contiguous, activeSelection, previewWidth, previewHeight, signal)
  const id = nextId++
  return new Promise<PaintBucketResult>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    const cancel = () => { if (pending.has(id)) terminateWorker() }
    pending.set(id, { resolve, reject, cleanup })
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    activeWorker.postMessage({ id, mode: 'bucket', sourceBlob, assetWidth: asset.width, assetHeight: asset.height, transform: { ...transform }, point: { ...point }, color, tolerance, contiguous, selection: activeSelection, previewWidth, previewHeight })
  })
}

export async function applySolidFill(
  asset: ImageAsset, transform: LayerTransform, color: string, selection: SelectionRegion | null,
  previewWidth: number, previewHeight: number, signal?: AbortSignal
) {
  throwIfAborted(signal)
  const response = await fetch(asset.sourceUrl, { signal })
  if (!response.ok) throw new Error('Não foi possível carregar a camada para preenchimento.')
  const sourceBlob = await response.blob()
  const activeSelection = selection && !selectionIsEmpty(selection) ? cloneSelection(selection) : null
  const activeWorker = workerInstance()
  if (!activeWorker) return fallbackSolidFill(sourceBlob, asset, transform, color, activeSelection, previewWidth, previewHeight, signal)
  const id = nextId++
  return new Promise<PaintBucketResult>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    const cancel = () => { if (pending.has(id)) terminateWorker() }
    pending.set(id, { resolve, reject, cleanup })
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    activeWorker.postMessage({
      id, mode: 'solid-fill', sourceBlob, assetWidth: asset.width, assetHeight: asset.height,
      transform: { ...transform }, color, selection: activeSelection, previewWidth, previewHeight
    })
  })
}

export function disposePaintBucketEngine() { terminateWorker() }

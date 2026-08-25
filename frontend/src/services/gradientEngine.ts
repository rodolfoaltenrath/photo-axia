import {
  createGradientRasterState,
  renderGradientRasterRows,
  type GradientRasterState
} from '../editor/gradientRaster'
import { gradientIsDegenerate, type GradientConfig, type GradientGeometry } from '../editor/gradient'
import { cloneSelection, selectionIsEmpty, type SelectionRegion } from '../editor/selection'
import type { ImageAsset, LayerTransform } from '../types/editor'

export interface GradientResult {
  blob: Blob
  width: number
  height: number
  originX: number
  originY: number
  previewBlob?: Blob
  previewWidth: number
  previewHeight: number
}

interface PendingGradient {
  resolve: (result: GradientResult) => void
  reject: (error: Error) => void
  cleanup: () => void
}

let gradientWorker: Worker | undefined
let nextGradientRequestId = 1
const pendingGradients = new Map<number, PendingGradient>()

function abortError() {
  return new DOMException('Aplicação do degradê cancelada.', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

function gradientWorkerInstance() {
  if (typeof Worker === 'undefined') return undefined
  if (gradientWorker) return gradientWorker
  gradientWorker = new Worker(new URL('../workers/gradient.worker.ts', import.meta.url), { type: 'module' })
  gradientWorker.onmessage = (event: MessageEvent<{ id: number; result?: GradientResult; error?: string }>) => {
    const pending = pendingGradients.get(event.data.id)
    if (!pending) return
    pendingGradients.delete(event.data.id)
    pending.cleanup()
    if (event.data.error) pending.reject(new Error(event.data.error))
    else if (event.data.result) pending.resolve(event.data.result)
    else pending.reject(new Error('O degradê retornou um resultado inválido.'))
  }
  gradientWorker.onerror = () => {
    for (const pending of pendingGradients.values()) {
      pending.cleanup()
      pending.reject(new Error('A aplicação do degradê foi interrompida.'))
    }
    pendingGradients.clear()
    gradientWorker?.terminate()
    gradientWorker = undefined
  }
  return gradientWorker
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas === 'undefined'
    ? Object.assign(document.createElement('canvas'), { width, height })
    : new OffscreenCanvas(width, height)
}

function canvasContext(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
  return context
}

async function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, type = 'image/png') {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Não foi possível codificar o degradê.')),
      type
    )
  })
}

async function encodeGradientResult(
  state: GradientRasterState,
  sourceWidth: number,
  sourceHeight: number,
  previewWidth: number,
  previewHeight: number,
  signal?: AbortSignal
): Promise<GradientResult> {
  throwIfAborted(signal)
  const canvas = makeCanvas(state.geometry.width, state.geometry.height)
  const context = canvasContext(canvas)
  context.putImageData(
    new ImageData(new Uint8ClampedArray(state.pixels), state.geometry.width, state.geometry.height),
    0,
    0
  )
  const scaleX = previewWidth / sourceWidth
  const scaleY = previewHeight / sourceHeight
  const outputPreviewWidth = Math.max(1, Math.min(
    state.geometry.width,
    Math.round(state.geometry.width * scaleX)
  ))
  const outputPreviewHeight = Math.max(1, Math.min(
    state.geometry.height,
    Math.round(state.geometry.height * scaleY)
  ))
  const previewCanvas = outputPreviewWidth === state.geometry.width && outputPreviewHeight === state.geometry.height
    ? undefined
    : makeCanvas(outputPreviewWidth, outputPreviewHeight)
  if (previewCanvas) {
    const previewContext = canvasContext(previewCanvas)
    previewContext.imageSmoothingEnabled = true
    previewContext.imageSmoothingQuality = 'high'
    previewContext.drawImage(canvas, 0, 0, outputPreviewWidth, outputPreviewHeight)
  }
  const [blob, previewBlob] = await Promise.all([
    encodeCanvas(canvas),
    previewCanvas ? encodeCanvas(previewCanvas, 'image/webp') : Promise.resolve(undefined)
  ])
  throwIfAborted(signal)
  canvas.width = 1
  canvas.height = 1
  if (previewCanvas) {
    previewCanvas.width = 1
    previewCanvas.height = 1
  }
  return {
    blob,
    width: state.geometry.width,
    height: state.geometry.height,
    originX: state.geometry.originX,
    originY: state.geometry.originY,
    previewBlob,
    previewWidth: outputPreviewWidth,
    previewHeight: outputPreviewHeight
  }
}

async function fallbackGradient(
  sourceBlob: Blob,
  asset: ImageAsset,
  transform: LayerTransform,
  geometry: GradientGeometry,
  config: GradientConfig,
  selection: SelectionRegion | null,
  previewWidth: number,
  previewHeight: number,
  documentWidth: number,
  documentHeight: number,
  signal?: AbortSignal
) {
  throwIfAborted(signal)
  const bitmap = await createImageBitmap(sourceBlob)
  if (signal?.aborted) {
    bitmap.close()
    throw abortError()
  }
  const sourceCanvas = makeCanvas(asset.width, asset.height)
  const sourceContext = canvasContext(sourceCanvas)
  sourceContext.drawImage(bitmap, 0, 0, asset.width, asset.height)
  bitmap.close()
  const sourcePixels = sourceContext.getImageData(0, 0, asset.width, asset.height).data
  sourceCanvas.width = 1
  sourceCanvas.height = 1
  const state = createGradientRasterState({
    sourcePixels,
    sourceWidth: asset.width,
    sourceHeight: asset.height,
    transform,
    geometry,
    config,
    selection,
    documentWidth,
    documentHeight
  })
  const rowsPerChunk = 32
  for (let row = 0; row < state.geometry.height; row += rowsPerChunk) {
    throwIfAborted(signal)
    renderGradientRasterRows(state, row, row + rowsPerChunk)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return encodeGradientResult(state, asset.width, asset.height, previewWidth, previewHeight, signal)
}

export async function applyGradient(
  asset: ImageAsset,
  transform: LayerTransform,
  geometry: GradientGeometry,
  config: GradientConfig,
  selection: SelectionRegion | null,
  previewWidth: number,
  previewHeight: number,
  documentWidth: number,
  documentHeight: number,
  signal?: AbortSignal
): Promise<GradientResult> {
  throwIfAborted(signal)
  if (gradientIsDegenerate(geometry)) throw new Error('O gesto do degradê é muito curto.')
  const activeSelection = selection && !selectionIsEmpty(selection) ? selection : null
  const response = await fetch(asset.sourceUrl, { signal })
  if (!response.ok) throw new Error('Não foi possível carregar a camada para aplicar o degradê.')
  const sourceBlob = await response.blob()
  throwIfAborted(signal)
  // Vue may wrap gesture state in proxies, which cannot cross the Worker boundary.
  // Snapshot every structured value into plain data before calling postMessage.
  const workerTransform: LayerTransform = { ...transform }
  const workerGeometry: GradientGeometry = {
    start: { ...geometry.start },
    end: { ...geometry.end }
  }
  const workerConfig: GradientConfig = { ...config }
  const workerSelection = cloneSelection(activeSelection)
  const worker = gradientWorkerInstance()
  if (!worker) {
    return fallbackGradient(
      sourceBlob,
      asset,
      workerTransform,
      workerGeometry,
      workerConfig,
      workerSelection,
      previewWidth,
      previewHeight,
      documentWidth,
      documentHeight,
      signal
    )
  }

  const id = nextGradientRequestId++
  return new Promise<GradientResult>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    const cancel = () => {
      if (!pendingGradients.has(id)) return
      pendingGradients.delete(id)
      cleanup()
      worker.postMessage({ cancel: id })
      reject(abortError())
    }
    pendingGradients.set(id, { resolve, reject, cleanup })
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) {
      cancel()
      return
    }
    worker.postMessage({
      id,
      sourceBlob,
      assetWidth: asset.width,
      assetHeight: asset.height,
      transform: workerTransform,
      geometry: workerGeometry,
      config: workerConfig,
      selection: workerSelection,
      previewWidth,
      previewHeight,
      documentWidth,
      documentHeight
    })
  })
}

export function disposeGradientEngine() {
  gradientWorker?.terminate()
  gradientWorker = undefined
  for (const pending of pendingGradients.values()) {
    pending.cleanup()
    pending.reject(abortError())
  }
  pendingGradients.clear()
}

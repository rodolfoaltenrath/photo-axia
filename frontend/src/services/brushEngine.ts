import {
  brushOperationExpandsRaster,
  brushStrokeGeometry,
  drawBrushPoints,
  type BrushOperation
} from '../editor/brush'
import {
  clipContextToSelection,
  invertMatrix,
  layerSourceToDocumentMatrix,
  multiplyMatrices,
  selectionIsEmpty,
  type SelectionPoint,
  type SelectionRegion
} from '../editor/selection'
import type { ImageAsset, LayerTransform } from '../types/editor'

export interface BrushStrokeResult {
  blob: Blob
  width: number
  height: number
  originX: number
  originY: number
  editToken?: string
  previewBlob?: Blob
  previewWidth: number
  previewHeight: number
}

interface PendingStroke {
  layerId: string
  resolve: (result: BrushStrokeResult) => void
  reject: (error: Error) => void
  cleanup: () => void
}

interface WorkerCacheState {
  layerId: string
  editToken: string
}

let brushWorker: Worker | undefined
let workerCacheState: WorkerCacheState | undefined
let nextStrokeRequestId = 1
const pendingStrokes = new Map<number, PendingStroke>()

function brushWorkerInstance() {
  if (typeof Worker === 'undefined') return undefined
  if (brushWorker) return brushWorker
  brushWorker = new Worker(new URL('../workers/brushStroke.worker.ts', import.meta.url), { type: 'module' })
  brushWorker.onmessage = (event: MessageEvent<{ id: number; result?: BrushStrokeResult; error?: string }>) => {
    const pending = pendingStrokes.get(event.data.id)
    if (!pending) return
    pendingStrokes.delete(event.data.id)
    pending.cleanup()
    if (event.data.error) {
      pending.reject(new Error(event.data.error))
    } else if (event.data.result) {
      if (event.data.result.editToken) {
        workerCacheState = { layerId: pending.layerId, editToken: event.data.result.editToken }
      }
      pending.resolve(event.data.result)
    } else {
      pending.reject(new Error('A pincelada retornou um resultado inválido.'))
    }
  }
  brushWorker.onerror = () => {
    for (const pending of pendingStrokes.values()) {
      pending.cleanup()
      pending.reject(new Error('A pincelada foi interrompida.'))
    }
    pendingStrokes.clear()
    brushWorker?.terminate()
    brushWorker = undefined
    workerCacheState = undefined
  }
  return brushWorker
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas === 'undefined'
    ? Object.assign(document.createElement('canvas'), { width, height })
    : new OffscreenCanvas(width, height)
}

function canvas2dContext(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const context = canvas.getContext('2d', { alpha: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
  return context
}

async function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, type = 'image/png', quality?: number) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível codificar a imagem editada.'))),
      type,
      quality
    )
  })
}

function abortError() {
  return new DOMException('Pincelada cancelada.', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal) {
  if (!signal) return operation
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError())
    signal.addEventListener('abort', abort, { once: true })
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function fetchAssetBlob(asset: ImageAsset, signal?: AbortSignal) {
  const response = await fetch(asset.sourceUrl, { signal })
  if (!response.ok) throw new Error('Não foi possível carregar a camada para edição.')
  return response.blob()
}

async function fallbackBrushStroke(
  sourceBlob: Blob,
  asset: ImageAsset,
  transform: LayerTransform,
  points: SelectionPoint[],
  size: number,
  color: string,
  operation: BrushOperation,
  selection: SelectionRegion | null,
  previewWidth: number,
  previewHeight: number,
  documentWidth: number,
  documentHeight: number,
  signal?: AbortSignal
): Promise<BrushStrokeResult> {
  throwIfAborted(signal)
  const bitmap = await createImageBitmap(sourceBlob)
  if (signal?.aborted) {
    bitmap.close()
    throw abortError()
  }
  const geometry = brushStrokeGeometry(
    asset.width,
    asset.height,
    transform,
    points,
    size,
    documentWidth,
    documentHeight,
    brushOperationExpandsRaster(operation, Boolean(selection))
  )
  const canvas = makeCanvas(geometry.width, geometry.height)
  const context = canvas2dContext(canvas)
  context.drawImage(bitmap, -geometry.originX, -geometry.originY, asset.width, asset.height)
  bitmap.close()

  const documentToSource = multiplyMatrices(
    [1, 0, 0, 1, -geometry.originX, -geometry.originY],
    invertMatrix(layerSourceToDocumentMatrix(transform, asset.width, asset.height))
  )
  context.save()
  if (selection) clipContextToSelection(context, selection, documentToSource)
  else {
    context.setTransform(...documentToSource)
    context.beginPath()
    context.rect(0, 0, documentWidth, documentHeight)
    context.clip()
  }
  context.setTransform(...documentToSource)
  drawBrushPoints(context, points, 0, size, color, operation)
  context.restore()

  const previewScaleX = previewWidth / asset.width
  const previewScaleY = previewHeight / asset.height
  const outputPreviewWidth = Math.max(1, Math.min(geometry.width, Math.round(geometry.width * previewScaleX)))
  const outputPreviewHeight = Math.max(1, Math.min(geometry.height, Math.round(geometry.height * previewScaleY)))
  const previewCanvas = outputPreviewWidth === geometry.width && outputPreviewHeight === geometry.height
    ? undefined
    : makeCanvas(outputPreviewWidth, outputPreviewHeight)
  if (previewCanvas) {
    const previewContext = canvas2dContext(previewCanvas)
    const previewBitmap = await createImageBitmap(canvas, {
      resizeWidth: outputPreviewWidth,
      resizeHeight: outputPreviewHeight,
      resizeQuality: 'high'
    })
    if (signal?.aborted) {
      previewBitmap.close()
      throw abortError()
    }
    previewContext.drawImage(previewBitmap, 0, 0, outputPreviewWidth, outputPreviewHeight)
    previewBitmap.close()
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
    width: geometry.width,
    height: geometry.height,
    originX: geometry.originX,
    originY: geometry.originY,
    previewBlob,
    previewWidth: outputPreviewWidth,
    previewHeight: outputPreviewHeight
  }
}

export async function applyBrushStroke(
  layerId: string,
  asset: ImageAsset,
  transform: LayerTransform,
  points: SelectionPoint[],
  size: number,
  color: string,
  operation: BrushOperation,
  selection: SelectionRegion | null,
  previewWidth: number,
  previewHeight: number,
  documentWidth: number,
  documentHeight: number,
  signal?: AbortSignal
): Promise<BrushStrokeResult> {
  throwIfAborted(signal)
  const activeSelection = selection && !selectionIsEmpty(selection) ? selection : null
  const worker = brushWorkerInstance()
  if (!worker) {
    return abortable(fallbackBrushStroke(
      await fetchAssetBlob(asset, signal),
      asset,
      transform,
      points,
      size,
      color,
      operation,
      activeSelection,
      previewWidth,
      previewHeight,
      documentWidth,
      documentHeight,
      signal
    ), signal)
  }

  const canReuseWorkerSurface = Boolean(
    asset.editToken &&
    workerCacheState?.layerId === layerId &&
    workerCacheState.editToken === asset.editToken
  )
  const blob = canReuseWorkerSurface ? undefined : await fetchAssetBlob(asset, signal)
  throwIfAborted(signal)
  const packedPoints = new Float32Array(points.length * 2)
  for (let index = 0; index < points.length; index++) {
    packedPoints[index * 2] = points[index]!.x
    packedPoints[index * 2 + 1] = points[index]!.y
  }

  const id = nextStrokeRequestId++
  return new Promise<BrushStrokeResult>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    const cancel = () => {
      const pending = pendingStrokes.get(id)
      if (!pending) return
      pendingStrokes.delete(id)
      cleanup()
      workerCacheState = undefined
      worker.postMessage({ cancel: id })
      reject(abortError())
    }
    pendingStrokes.set(id, { layerId, resolve, reject, cleanup })
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) {
      cancel()
      return
    }
    worker.postMessage(
      {
        id,
        layerId,
        sourceToken: asset.editToken,
        blob,
        assetWidth: asset.width,
        assetHeight: asset.height,
        transform,
        points: packedPoints,
        size,
        color,
        operation,
        selection: activeSelection,
        previewWidth,
        previewHeight,
        documentWidth,
        documentHeight
      },
      [packedPoints.buffer]
    )
  })
}

export function disposeBrushEngine() {
  brushWorker?.terminate()
  brushWorker = undefined
  workerCacheState = undefined
  for (const pending of pendingStrokes.values()) {
    pending.cleanup()
    pending.reject(new Error('Pincelada cancelada.'))
  }
  pendingStrokes.clear()
}

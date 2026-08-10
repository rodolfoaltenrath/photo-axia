import { drawBrushPoints } from '../editor/brush'
import {
  clipContextToSelection,
  invertMatrix,
  layerSourceToDocumentMatrix,
  selectionIsEmpty,
  type SelectionPoint,
  type SelectionRegion
} from '../editor/selection'
import type { ImageAsset, LayerTransform } from '../types/editor'

export interface BrushStrokeResult {
  blob: Blob
  width: number
  height: number
  editToken?: string
  previewBlob?: Blob
  previewWidth: number
  previewHeight: number
}

interface PendingStroke {
  layerId: string
  resolve: (result: BrushStrokeResult) => void
  reject: (error: Error) => void
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
    for (const pending of pendingStrokes.values()) pending.reject(new Error('A pincelada foi interrompida.'))
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

async function fetchAssetBlob(asset: ImageAsset) {
  const response = await fetch(asset.sourceUrl)
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
  selection: SelectionRegion | null,
  previewWidth: number,
  previewHeight: number
): Promise<BrushStrokeResult> {
  const bitmap = await createImageBitmap(sourceBlob)
  const canvas = makeCanvas(asset.width, asset.height)
  const context = canvas2dContext(canvas)
  context.drawImage(bitmap, 0, 0, asset.width, asset.height)
  bitmap.close()

  const documentToSource = invertMatrix(layerSourceToDocumentMatrix(transform, asset.width, asset.height))
  context.save()
  if (selection) clipContextToSelection(context, selection, documentToSource)
  else context.setTransform(...documentToSource)
  drawBrushPoints(context, points, 0, size, color)
  context.restore()

  const previewCanvas = previewWidth === asset.width && previewHeight === asset.height
    ? undefined
    : makeCanvas(previewWidth, previewHeight)
  if (previewCanvas) {
    const previewContext = canvas2dContext(previewCanvas)
    previewContext.imageSmoothingEnabled = true
    previewContext.imageSmoothingQuality = 'high'
    previewContext.drawImage(canvas, 0, 0, previewWidth, previewHeight)
  }
  const [blob, previewBlob] = await Promise.all([
    encodeCanvas(canvas),
    previewCanvas ? encodeCanvas(previewCanvas, 'image/webp', 0.9) : Promise.resolve(undefined)
  ])
  canvas.width = 1
  canvas.height = 1
  if (previewCanvas) {
    previewCanvas.width = 1
    previewCanvas.height = 1
  }
  return { blob, width: asset.width, height: asset.height, previewBlob, previewWidth, previewHeight }
}

export async function paintBrushStroke(
  layerId: string,
  asset: ImageAsset,
  transform: LayerTransform,
  points: SelectionPoint[],
  size: number,
  color: string,
  selection: SelectionRegion | null,
  previewWidth: number,
  previewHeight: number
): Promise<BrushStrokeResult> {
  const activeSelection = selection && !selectionIsEmpty(selection) ? selection : null
  const worker = brushWorkerInstance()
  if (!worker) {
    return fallbackBrushStroke(
      await fetchAssetBlob(asset),
      asset,
      transform,
      points,
      size,
      color,
      activeSelection,
      previewWidth,
      previewHeight
    )
  }

  const canReuseWorkerSurface = Boolean(
    asset.editToken &&
    workerCacheState?.layerId === layerId &&
    workerCacheState.editToken === asset.editToken
  )
  const blob = canReuseWorkerSurface ? undefined : await fetchAssetBlob(asset)
  const packedPoints = new Float32Array(points.length * 2)
  for (let index = 0; index < points.length; index++) {
    packedPoints[index * 2] = points[index]!.x
    packedPoints[index * 2 + 1] = points[index]!.y
  }

  const id = nextStrokeRequestId++
  return new Promise<BrushStrokeResult>((resolve, reject) => {
    pendingStrokes.set(id, { layerId, resolve, reject })
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
        selection: activeSelection,
        previewWidth,
        previewHeight
      },
      [packedPoints.buffer]
    )
  })
}

export function disposeBrushEngine() {
  brushWorker?.terminate()
  brushWorker = undefined
  workerCacheState = undefined
  for (const pending of pendingStrokes.values()) pending.reject(new Error('Pincelada cancelada.'))
  pendingStrokes.clear()
}

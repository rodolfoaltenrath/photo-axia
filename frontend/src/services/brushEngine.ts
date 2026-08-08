import { layerSourceToDocumentMatrix, invertMatrix, sourceScaleFactor, transformSelectionPoint, type SelectionPoint } from '../editor/selection'
import type { ImageAsset, LayerTransform } from '../types/editor'

export interface BrushStrokeResult {
  blob: Blob
  width: number
  height: number
}

interface PendingStroke {
  resolve: (result: BrushStrokeResult) => void
  reject: (error: Error) => void
}

let brushWorker: Worker | undefined
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
    if (event.data.error) pending.reject(new Error(event.data.error))
    else if (event.data.result) pending.resolve(event.data.result)
    else pending.reject(new Error('A pincelada retornou um resultado inválido.'))
  }
  brushWorker.onerror = () => {
    for (const pending of pendingStrokes.values()) pending.reject(new Error('A pincelada foi interrompida.'))
    pendingStrokes.clear()
    brushWorker?.terminate()
    brushWorker = undefined
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

async function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível codificar a imagem editada.'))),
      'image/png'
    )
  })
}

async function fallbackBrushStroke(
  sourceBlob: Blob,
  asset: ImageAsset,
  transform: LayerTransform,
  points: SelectionPoint[],
  size: number,
  color: string
): Promise<BrushStrokeResult> {
  const bitmap = await createImageBitmap(sourceBlob)
  const canvas = makeCanvas(asset.width, asset.height)
  const context = canvas2dContext(canvas)
  context.drawImage(bitmap, 0, 0, asset.width, asset.height)
  bitmap.close()

  const documentToSource = invertMatrix(layerSourceToDocumentMatrix(transform, asset.width, asset.height))
  const sourcePoints = points.map((point) => transformSelectionPoint(documentToSource, point))
  const scale = sourceScaleFactor(transform, asset.width, asset.height)
  const lineWidth = size / (scale || 1)

  context.save()
  context.globalCompositeOperation = 'source-over'
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = lineWidth
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  const first = sourcePoints[0]
  if (first) {
    context.moveTo(first.x, first.y)
    for (let index = 1; index < sourcePoints.length; index++) {
      const point = sourcePoints[index]!
      context.lineTo(point.x, point.y)
    }
    if (sourcePoints.length === 1) context.lineTo(first.x, first.y)
    context.stroke()
  }
  context.restore()

  const blob = await encodeCanvas(canvas)
  canvas.width = 1
  canvas.height = 1
  return { blob, width: asset.width, height: asset.height }
}

export async function paintBrushStroke(
  asset: ImageAsset,
  transform: LayerTransform,
  points: SelectionPoint[],
  size: number,
  color: string
): Promise<BrushStrokeResult> {
  const response = await fetch(asset.sourceUrl)
  if (!response.ok) throw new Error('Não foi possível carregar a camada para edição.')
  const blob = await response.blob()

  const worker = brushWorkerInstance()
  if (!worker) return fallbackBrushStroke(blob, asset, transform, points, size, color)

  const id = nextStrokeRequestId++
  return new Promise<BrushStrokeResult>((resolve, reject) => {
    pendingStrokes.set(id, { resolve, reject })
    worker.postMessage({ id, blob, assetWidth: asset.width, assetHeight: asset.height, transform, points, size, color })
  })
}

export function disposeBrushEngine() {
  brushWorker?.terminate()
  brushWorker = undefined
  for (const pending of pendingStrokes.values()) pending.reject(new Error('Pincelada cancelada.'))
  pendingStrokes.clear()
}

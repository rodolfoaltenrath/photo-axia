import {
  clipContextToSelection,
  multiplyMatrices,
  selectionMoveGeometry,
  type SelectionRegion
} from '../editor/selection'
import type { ImageAsset, LayerTransform } from '../types/editor'

export interface MoveSelectionResult {
  blob: Blob
  width: number
  height: number
  originX: number
  originY: number
  previewBlob?: Blob
  previewWidth: number
  previewHeight: number
}

interface PendingMove {
  resolve: (result: MoveSelectionResult) => void
  reject: (error: Error) => void
}

let moveWorker: Worker | undefined
let nextMoveRequestId = 1
const pendingMoves = new Map<number, PendingMove>()

function workerInstance() {
  if (typeof Worker === 'undefined') return undefined
  if (moveWorker) return moveWorker
  moveWorker = new Worker(new URL('../workers/moveSelection.worker.ts', import.meta.url), { type: 'module' })
  moveWorker.onmessage = (event: MessageEvent<{ id: number; result?: MoveSelectionResult; error?: string }>) => {
    const pending = pendingMoves.get(event.data.id)
    if (!pending) return
    pendingMoves.delete(event.data.id)
    if (event.data.error) pending.reject(new Error(event.data.error))
    else if (event.data.result) pending.resolve(event.data.result)
    else pending.reject(new Error('O movimento da seleção retornou um resultado inválido.'))
  }
  moveWorker.onerror = () => {
    for (const pending of pendingMoves.values()) pending.reject(new Error('O movimento da seleção foi interrompido.'))
    pendingMoves.clear()
    moveWorker?.terminate()
    moveWorker = undefined
  }
  return moveWorker
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas === 'undefined'
    ? Object.assign(document.createElement('canvas'), { width, height })
    : new OffscreenCanvas(width, height)
}

function context2d(canvas: HTMLCanvasElement | OffscreenCanvas) {
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
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível codificar a camada movida.'))),
      type,
      quality
    )
  })
}

async function fallbackMove(
  sourceBlob: Blob,
  asset: ImageAsset,
  transform: LayerTransform,
  selection: SelectionRegion,
  deltaX: number,
  deltaY: number
): Promise<MoveSelectionResult> {
  const bitmap = await createImageBitmap(sourceBlob)
  const geometry = selectionMoveGeometry(asset.width, asset.height, transform, selection, deltaX, deltaY)
  const baseCanvas = makeCanvas(asset.width, asset.height)
  const baseContext = context2d(baseCanvas)
  baseContext.drawImage(bitmap, 0, 0, asset.width, asset.height)
  const contentCanvas = makeCanvas(
    Math.max(1, geometry.selectionWidth),
    Math.max(1, geometry.selectionHeight)
  )
  const contentContext = context2d(contentCanvas)
  if (geometry.selectionWidth && geometry.selectionHeight) {
    const documentToContent = multiplyMatrices(
      [1, 0, 0, 1, -geometry.selectionOriginX, -geometry.selectionOriginY],
      geometry.documentToSource
    )
    contentContext.save()
    clipContextToSelection(contentContext, selection, documentToContent)
    contentContext.setTransform(1, 0, 0, 1, 0, 0)
    contentContext.drawImage(bitmap, -geometry.selectionOriginX, -geometry.selectionOriginY)
    contentContext.restore()
  }
  bitmap.close()

  baseContext.save()
  baseContext.globalCompositeOperation = 'destination-out'
  clipContextToSelection(baseContext, selection, geometry.documentToSource)
  baseContext.setTransform(1, 0, 0, 1, 0, 0)
  baseContext.fillRect(0, 0, asset.width, asset.height)
  baseContext.restore()

  const expanded = geometry.originX !== 0 || geometry.originY !== 0 ||
    geometry.width !== asset.width || geometry.height !== asset.height
  const output = expanded ? makeCanvas(geometry.width, geometry.height) : baseCanvas
  const outputContext = expanded ? context2d(output) : baseContext
  const offsetX = -geometry.originX
  const offsetY = -geometry.originY
  if (expanded) outputContext.drawImage(baseCanvas, offsetX, offsetY)
  if (geometry.selectionWidth && geometry.selectionHeight) {
    outputContext.drawImage(
      contentCanvas,
      offsetX + geometry.selectionOriginX + geometry.sourceDeltaX,
      offsetY + geometry.selectionOriginY + geometry.sourceDeltaY
    )
  }

  const scaleX = Math.abs(transform.width / asset.width)
  const scaleY = Math.abs(transform.height / asset.height)
  const previewWidth = Math.max(1, Math.min(geometry.width, Math.round(geometry.width * scaleX)))
  const previewHeight = Math.max(1, Math.min(geometry.height, Math.round(geometry.height * scaleY)))
  const previewCanvas = previewWidth === geometry.width && previewHeight === geometry.height
    ? undefined
    : makeCanvas(previewWidth, previewHeight)
  if (previewCanvas) {
    const previewContext = context2d(previewCanvas)
    previewContext.imageSmoothingEnabled = true
    previewContext.imageSmoothingQuality = 'high'
    previewContext.drawImage(output, 0, 0, previewWidth, previewHeight)
  }
  const [blob, previewBlob] = await Promise.all([
    encodeCanvas(output),
    previewCanvas ? encodeCanvas(previewCanvas, 'image/webp', 0.9) : Promise.resolve(undefined)
  ])
  return { ...geometry, blob, previewBlob, previewWidth, previewHeight }
}

export async function moveImageSelection(
  asset: ImageAsset,
  transform: LayerTransform,
  selection: SelectionRegion,
  deltaX: number,
  deltaY: number
) {
  const response = await fetch(asset.sourceUrl)
  if (!response.ok) throw new Error('Não foi possível carregar a camada para mover a seleção.')
  const blob = await response.blob()
  const worker = workerInstance()
  if (!worker) return fallbackMove(blob, asset, transform, selection, deltaX, deltaY)

  const id = nextMoveRequestId++
  return new Promise<MoveSelectionResult>((resolve, reject) => {
    pendingMoves.set(id, { resolve, reject })
    worker.postMessage({
      id,
      blob,
      assetWidth: asset.width,
      assetHeight: asset.height,
      transform,
      selection,
      deltaX,
      deltaY
    })
  })
}

export function disposeSelectionMoveEngine() {
  moveWorker?.terminate()
  moveWorker = undefined
  for (const pending of pendingMoves.values()) pending.reject(new Error('Movimento da seleção cancelado.'))
  pendingMoves.clear()
}

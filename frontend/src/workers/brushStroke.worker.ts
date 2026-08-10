import { drawPackedBrushPoints } from '../editor/brush'
import {
  clipContextToSelection,
  invertMatrix,
  layerSourceToDocumentMatrix,
  type SelectionRegion
} from '../editor/selection'
import type { LayerTransform } from '../types/editor'

interface BrushRequest {
  id: number
  layerId: string
  sourceToken?: string
  blob?: Blob
  assetWidth: number
  assetHeight: number
  transform: LayerTransform
  points: Float32Array
  size: number
  color: string
  selection: SelectionRegion | null
  previewWidth: number
  previewHeight: number
}

interface BrushResult {
  blob: Blob
  width: number
  height: number
  editToken: string
  previewBlob?: Blob
  previewWidth: number
  previewHeight: number
}

interface CachedSurface {
  layerId: string
  token: string
  canvas: OffscreenCanvas
}

let cachedSurface: CachedSurface | undefined
let nextEditToken = 1

async function sourceCanvas(request: BrushRequest) {
  if (
    request.sourceToken &&
    cachedSurface?.layerId === request.layerId &&
    cachedSurface.token === request.sourceToken &&
    cachedSurface.canvas.width === request.assetWidth &&
    cachedSurface.canvas.height === request.assetHeight
  ) {
    return cachedSurface.canvas
  }
  if (!request.blob) throw new Error('A origem da camada não está disponível para esta pincelada.')

  const bitmap = await createImageBitmap(request.blob)
  const canvas = new OffscreenCanvas(request.assetWidth, request.assetHeight)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
  context.drawImage(bitmap, 0, 0, request.assetWidth, request.assetHeight)
  bitmap.close()
  return canvas
}

async function encodePreview(source: OffscreenCanvas, width: number, height: number) {
  if (width === source.width && height === source.height) return undefined
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('O sistema não disponibilizou o renderizador de prévias.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
}

self.onmessage = async (event: MessageEvent<BrushRequest>) => {
  const request = event.data
  try {
    const canvas = await sourceCanvas(request)
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
    const documentToSource = invertMatrix(
      layerSourceToDocumentMatrix(request.transform, request.assetWidth, request.assetHeight)
    )

    context.save()
    if (request.selection) clipContextToSelection(context, request.selection, documentToSource)
    else context.setTransform(...documentToSource)
    drawPackedBrushPoints(context, request.points, request.size, request.color)
    context.restore()

    const editToken = `brush:${request.layerId}:${nextEditToken++}`
    cachedSurface = { layerId: request.layerId, token: editToken, canvas }
    const [blob, previewBlob] = await Promise.all([
      canvas.convertToBlob({ type: 'image/png' }),
      encodePreview(canvas, request.previewWidth, request.previewHeight)
    ])
    const result: BrushResult = {
      blob,
      width: canvas.width,
      height: canvas.height,
      editToken,
      previewBlob,
      previewWidth: request.previewWidth,
      previewHeight: request.previewHeight
    }
    self.postMessage({ id: request.id, result })
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Não foi possível aplicar a pincelada.'
    })
  }
}

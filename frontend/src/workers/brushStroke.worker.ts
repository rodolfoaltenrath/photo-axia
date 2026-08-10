import { brushStrokeGeometry, drawPackedBrushPoints } from '../editor/brush'
import {
  clipContextToSelection,
  invertMatrix,
  layerSourceToDocumentMatrix,
  multiplyMatrices,
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
  documentWidth: number
  documentHeight: number
}

interface BrushResult {
  blob: Blob
  width: number
  height: number
  originX: number
  originY: number
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
    const source = await sourceCanvas(request)
    let minimumX = Number.POSITIVE_INFINITY
    let minimumY = Number.POSITIVE_INFINITY
    let maximumX = Number.NEGATIVE_INFINITY
    let maximumY = Number.NEGATIVE_INFINITY
    for (let index = 0; index + 1 < request.points.length; index += 2) {
      minimumX = Math.min(minimumX, request.points[index]!)
      maximumX = Math.max(maximumX, request.points[index]!)
      minimumY = Math.min(minimumY, request.points[index + 1]!)
      maximumY = Math.max(maximumY, request.points[index + 1]!)
    }
    const extentPoints = Number.isFinite(minimumX)
      ? [{ x: minimumX, y: minimumY }, { x: maximumX, y: maximumY }]
      : []
    const geometry = brushStrokeGeometry(
      request.assetWidth,
      request.assetHeight,
      request.transform,
      extentPoints,
      request.size,
      request.documentWidth,
      request.documentHeight,
      !request.selection
    )
    const expanded =
      geometry.originX !== 0 ||
      geometry.originY !== 0 ||
      geometry.width !== request.assetWidth ||
      geometry.height !== request.assetHeight
    const canvas = expanded ? new OffscreenCanvas(geometry.width, geometry.height) : source
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
    if (expanded) context.drawImage(source, -geometry.originX, -geometry.originY)
    const documentToSource = multiplyMatrices(
      [1, 0, 0, 1, -geometry.originX, -geometry.originY],
      invertMatrix(layerSourceToDocumentMatrix(request.transform, request.assetWidth, request.assetHeight))
    )

    context.save()
    if (request.selection) clipContextToSelection(context, request.selection, documentToSource)
    else {
      context.setTransform(...documentToSource)
      context.beginPath()
      context.rect(0, 0, request.documentWidth, request.documentHeight)
      context.clip()
    }
    context.setTransform(...documentToSource)
    drawPackedBrushPoints(context, request.points, request.size, request.color)
    context.restore()

    const editToken = `brush:${request.layerId}:${nextEditToken++}`
    cachedSurface = { layerId: request.layerId, token: editToken, canvas }
    const previewScaleX = request.previewWidth / request.assetWidth
    const previewScaleY = request.previewHeight / request.assetHeight
    const previewWidth = Math.max(1, Math.min(canvas.width, Math.round(canvas.width * previewScaleX)))
    const previewHeight = Math.max(1, Math.min(canvas.height, Math.round(canvas.height * previewScaleY)))
    const [blob, previewBlob] = await Promise.all([
      canvas.convertToBlob({ type: 'image/png' }),
      encodePreview(canvas, previewWidth, previewHeight)
    ])
    const result: BrushResult = {
      blob,
      width: canvas.width,
      height: canvas.height,
      originX: geometry.originX,
      originY: geometry.originY,
      editToken,
      previewBlob,
      previewWidth,
      previewHeight
    }
    self.postMessage({ id: request.id, result })
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Não foi possível aplicar a pincelada.'
    })
  }
}

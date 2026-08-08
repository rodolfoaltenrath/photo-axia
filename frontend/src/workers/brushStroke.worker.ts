import {
  invertMatrix,
  layerSourceToDocumentMatrix,
  sourceScaleFactor,
  transformSelectionPoint,
  type SelectionPoint
} from '../editor/selection'
import type { LayerTransform } from '../types/editor'

interface BrushRequest {
  id: number
  blob: Blob
  assetWidth: number
  assetHeight: number
  transform: LayerTransform
  points: SelectionPoint[]
  size: number
  color: string
}

interface BrushResult {
  blob: Blob
  width: number
  height: number
}

self.onmessage = async (event: MessageEvent<BrushRequest>) => {
  const request = event.data
  try {
    const bitmap = await createImageBitmap(request.blob)
    const canvas = new OffscreenCanvas(request.assetWidth, request.assetHeight)
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
    context.drawImage(bitmap, 0, 0, request.assetWidth, request.assetHeight)
    bitmap.close()

    const documentToSource = invertMatrix(
      layerSourceToDocumentMatrix(request.transform, request.assetWidth, request.assetHeight)
    )
    const sourcePoints = request.points.map((point) => transformSelectionPoint(documentToSource, point))
    const scale = sourceScaleFactor(request.transform, request.assetWidth, request.assetHeight)
    const lineWidth = request.size / (scale || 1)

    context.save()
    context.globalCompositeOperation = 'source-over'
    context.strokeStyle = request.color
    context.fillStyle = request.color
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

    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const result: BrushResult = { blob, width: canvas.width, height: canvas.height }
    self.postMessage({ id: request.id, result })
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Não foi possível aplicar a pincelada.'
    })
  }
}

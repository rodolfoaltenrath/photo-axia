import {
  clipContextToSelection,
  multiplyMatrices,
  selectionMoveGeometry,
  type SelectionRegion
} from '../editor/selection'
import type { LayerTransform } from '../types/editor'

interface MoveRequest {
  id: number
  blob: Blob
  assetWidth: number
  assetHeight: number
  transform: LayerTransform
  selection: SelectionRegion
  deltaX: number
  deltaY: number
}

self.onmessage = async (event: MessageEvent<MoveRequest>) => {
  const request = event.data
  try {
    const bitmap = await createImageBitmap(request.blob)
    const geometry = selectionMoveGeometry(
      request.assetWidth,
      request.assetHeight,
      request.transform,
      request.selection,
      request.deltaX,
      request.deltaY
    )

    const baseCanvas = new OffscreenCanvas(request.assetWidth, request.assetHeight)
    const baseContext = baseCanvas.getContext('2d', { alpha: true })
    const contentCanvas = new OffscreenCanvas(
      Math.max(1, geometry.selectionWidth),
      Math.max(1, geometry.selectionHeight)
    )
    const contentContext = contentCanvas.getContext('2d', { alpha: true })
    if (!baseContext || !contentContext) throw new Error('O sistema não disponibilizou o renderizador 2D.')
    baseContext.drawImage(bitmap, 0, 0, request.assetWidth, request.assetHeight)
    if (geometry.selectionWidth && geometry.selectionHeight) {
      const documentToContent = multiplyMatrices(
        [1, 0, 0, 1, -geometry.selectionOriginX, -geometry.selectionOriginY],
        geometry.documentToSource
      )
      contentContext.save()
      clipContextToSelection(contentContext, request.selection, documentToContent)
      contentContext.setTransform(1, 0, 0, 1, 0, 0)
      contentContext.drawImage(bitmap, -geometry.selectionOriginX, -geometry.selectionOriginY)
      contentContext.restore()
    }
    bitmap.close()

    baseContext.save()
    baseContext.globalCompositeOperation = 'destination-out'
    clipContextToSelection(baseContext, request.selection, geometry.documentToSource)
    baseContext.setTransform(1, 0, 0, 1, 0, 0)
    baseContext.fillRect(0, 0, request.assetWidth, request.assetHeight)
    baseContext.restore()

    const expanded = geometry.originX !== 0 || geometry.originY !== 0 ||
      geometry.width !== request.assetWidth || geometry.height !== request.assetHeight
    const output = expanded ? new OffscreenCanvas(geometry.width, geometry.height) : baseCanvas
    const outputContext = expanded ? output.getContext('2d', { alpha: true }) : baseContext
    if (!outputContext) throw new Error('O sistema não disponibilizou o renderizador 2D.')
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

    const scaleX = Math.abs(request.transform.width / request.assetWidth)
    const scaleY = Math.abs(request.transform.height / request.assetHeight)
    const previewWidth = Math.max(1, Math.min(geometry.width, Math.round(geometry.width * scaleX)))
    const previewHeight = Math.max(1, Math.min(geometry.height, Math.round(geometry.height * scaleY)))
    let previewPromise: Promise<Blob | undefined> = Promise.resolve(undefined)
    if (previewWidth !== geometry.width || previewHeight !== geometry.height) {
      const previewCanvas = new OffscreenCanvas(previewWidth, previewHeight)
      const previewContext = previewCanvas.getContext('2d', { alpha: true })
      if (!previewContext) throw new Error('O sistema não disponibilizou o renderizador de prévias.')
      previewContext.imageSmoothingEnabled = true
      previewContext.imageSmoothingQuality = 'high'
      previewContext.drawImage(output, 0, 0, previewWidth, previewHeight)
      previewPromise = previewCanvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
    }
    const [blob, previewBlob] = await Promise.all([
      output.convertToBlob({ type: 'image/png' }),
      previewPromise
    ])
    self.postMessage({
      id: request.id,
      result: {
        blob,
        width: geometry.width,
        height: geometry.height,
        originX: geometry.originX,
        originY: geometry.originY,
        previewBlob,
        previewWidth,
        previewHeight
      }
    })
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Não foi possível mover os pixels selecionados.'
    })
  }
}

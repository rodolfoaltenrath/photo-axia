import {
  drawVectorSelection,
  invertMatrix,
  layerSourceToDocumentMatrix,
  multiplyMatrices,
  opaquePixelBounds,
  type SelectionBounds,
  type SelectionRegion
} from '../editor/selection'
import type { LayerTransform } from '../types/editor'

interface EraseRequest {
  id: number
  blob: Blob
  assetWidth: number
  assetHeight: number
  transform: LayerTransform
  selection: SelectionRegion
}

interface EraseResult {
  blob: Blob
  width: number
  height: number
  trimmedBounds: SelectionBounds | null
}

self.onmessage = async (event: MessageEvent<EraseRequest>) => {
  const request = event.data
  try {
    const bitmap = await createImageBitmap(request.blob)
    const canvas = new OffscreenCanvas(request.assetWidth, request.assetHeight)
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
    context.drawImage(bitmap, 0, 0, request.assetWidth, request.assetHeight)
    bitmap.close()

    const documentToSource = invertMatrix(
      layerSourceToDocumentMatrix(request.transform, request.assetWidth, request.assetHeight)
    )
    const matrix =
      request.selection.kind === 'pixels'
        ? multiplyMatrices(documentToSource, request.selection.sourceToDocument)
        : documentToSource
    context.save()
    context.globalCompositeOperation = 'destination-out'
    context.setTransform(...matrix)
    drawVectorSelection(context, request.selection)
    context.restore()

    const image = context.getImageData(0, 0, request.assetWidth, request.assetHeight)
    const opaqueBounds = opaquePixelBounds(image.data, request.assetWidth, request.assetHeight)
    const fullyTrimmed =
      opaqueBounds &&
      (opaqueBounds.x > 0 ||
        opaqueBounds.y > 0 ||
        opaqueBounds.width < request.assetWidth ||
        opaqueBounds.height < request.assetHeight)

    let outputCanvas: OffscreenCanvas = canvas
    let trimmedBounds: SelectionBounds | null = null
    if (opaqueBounds && fullyTrimmed) {
      const trimmedCanvas = new OffscreenCanvas(opaqueBounds.width, opaqueBounds.height)
      const trimmedContext = trimmedCanvas.getContext('2d', { alpha: true })
      if (!trimmedContext) throw new Error('O sistema não disponibilizou o renderizador 2D.')
      trimmedContext.putImageData(
        image,
        -opaqueBounds.x,
        -opaqueBounds.y,
        opaqueBounds.x,
        opaqueBounds.y,
        opaqueBounds.width,
        opaqueBounds.height
      )
      outputCanvas = trimmedCanvas
      trimmedBounds = opaqueBounds
    }

    const blob = await outputCanvas.convertToBlob({ type: 'image/png' })
    const result: EraseResult = { blob, width: outputCanvas.width, height: outputCanvas.height, trimmedBounds }
    self.postMessage({ id: request.id, result })
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Não foi possível apagar a seleção.'
    })
  }
}

import {
  clipContextToSelection,
  multiplyMatrices,
  opaquePixelBounds,
  selectionExtractionGeometry,
  type SelectionBounds,
  type SelectionRegion
} from '../editor/selection'
import type { LayerTransform } from '../types/editor'

interface ExtractRequest {
  id: number
  blob: Blob
  assetWidth: number
  assetHeight: number
  transform: LayerTransform
  selection: SelectionRegion
}

interface ExtractResult {
  blob: Blob
  width: number
  height: number
  sourceBounds: SelectionBounds
}

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  const request = event.data
  try {
    const geometry = selectionExtractionGeometry(
      request.assetWidth,
      request.assetHeight,
      request.transform,
      request.selection
    )
    if (!geometry.width || !geometry.height) throw new Error('A seleção não intersecta a camada ativa.')

    const bitmap = await createImageBitmap(request.blob)
    const canvas = new OffscreenCanvas(geometry.width, geometry.height)
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
    const documentToOutput = multiplyMatrices(
      [1, 0, 0, 1, -geometry.originX, -geometry.originY],
      geometry.documentToSource
    )
    context.save()
    clipContextToSelection(context, request.selection, documentToOutput)
    context.setTransform(1, 0, 0, 1, -geometry.originX, -geometry.originY)
    context.drawImage(bitmap, 0, 0, request.assetWidth, request.assetHeight)
    context.restore()
    bitmap.close()

    const image = context.getImageData(0, 0, geometry.width, geometry.height)
    const opaqueBounds = opaquePixelBounds(image.data, geometry.width, geometry.height)
    if (!opaqueBounds) throw new Error('A seleção não contém pixels visíveis nesta camada.')

    let output = canvas
    if (
      opaqueBounds.x > 0 ||
      opaqueBounds.y > 0 ||
      opaqueBounds.width < geometry.width ||
      opaqueBounds.height < geometry.height
    ) {
      output = new OffscreenCanvas(opaqueBounds.width, opaqueBounds.height)
      const outputContext = output.getContext('2d', { alpha: true })
      if (!outputContext) throw new Error('O sistema não disponibilizou o recorte da nova camada.')
      outputContext.putImageData(
        image,
        -opaqueBounds.x,
        -opaqueBounds.y,
        opaqueBounds.x,
        opaqueBounds.y,
        opaqueBounds.width,
        opaqueBounds.height
      )
    }

    const blob = await output.convertToBlob({ type: 'image/png' })
    const result: ExtractResult = {
      blob,
      width: output.width,
      height: output.height,
      sourceBounds: {
        x: geometry.originX + opaqueBounds.x,
        y: geometry.originY + opaqueBounds.y,
        width: opaqueBounds.width,
        height: opaqueBounds.height
      }
    }
    self.postMessage({ id: request.id, result })
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Não foi possível copiar os pixels selecionados.'
    })
  }
}

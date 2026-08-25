import { applyPaintBucketColorRegion, applySolidFillRaster } from '../editor/paintBucket'
import { invertMatrix, layerSourceToDocumentMatrix, transformSelectionPoint, type SelectionPoint, type SelectionRegion } from '../editor/selection'
import type { LayerTransform } from '../types/editor'

interface Request {
  id: number; sourceBlob: Blob; assetWidth: number; assetHeight: number; transform: LayerTransform;
  mode?: 'bucket' | 'solid-fill'; point?: SelectionPoint; color: string; tolerance?: number; contiguous?: boolean; selection: SelectionRegion | null;
  previewWidth: number; previewHeight: number
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    const bitmap = await createImageBitmap(request.sourceBlob)
    const canvas = new OffscreenCanvas(request.assetWidth, request.assetHeight)
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) { bitmap.close(); throw new Error('O sistema não disponibilizou leitura de pixels.') }
    context.drawImage(bitmap, 0, 0, request.assetWidth, request.assetHeight); bitmap.close()
    const image = context.getImageData(0, 0, request.assetWidth, request.assetHeight)
    const sourceToDocument = layerSourceToDocumentMatrix(request.transform, request.assetWidth, request.assetHeight)
    const result = request.mode === 'solid-fill'
      ? applySolidFillRaster({
          pixels: image.data, width: request.assetWidth, height: request.assetHeight,
          color: request.color, selection: request.selection, sourceToDocument
        })
      : (() => {
          if (!request.point) throw new Error('O ponto inicial do Balde de Tinta é inválido.')
          const sourcePoint = transformSelectionPoint(invertMatrix(sourceToDocument), request.point)
          return applyPaintBucketColorRegion({
            pixels: image.data, width: request.assetWidth, height: request.assetHeight,
            color: request.color, selection: request.selection, sourceToDocument,
            regionOptions: {
              startX: sourcePoint.x, startY: sourcePoint.y,
              tolerance: request.tolerance ?? 0, contiguous: request.contiguous ?? true
            }
          })
        })()
    if (!result.pixels) {
      self.postMessage({ id: request.id, result: {
        previewWidth: request.previewWidth, previewHeight: request.previewHeight, changedPixelCount: 0
      } })
      return
    }
    context.putImageData(new ImageData(result.pixels, request.assetWidth, request.assetHeight), 0, 0)
    const previewCanvas = request.previewWidth === request.assetWidth && request.previewHeight === request.assetHeight
      ? undefined : new OffscreenCanvas(request.previewWidth, request.previewHeight)
    const previewContext = previewCanvas?.getContext('2d')
    if (previewContext) {
      previewContext.imageSmoothingEnabled = true
      previewContext.imageSmoothingQuality = 'high'
      previewContext.drawImage(canvas, 0, 0, request.previewWidth, request.previewHeight)
    }
    const [blob, previewBlob] = await Promise.all([
      canvas.convertToBlob({ type: 'image/png' }),
      previewCanvas?.convertToBlob({ type: 'image/webp' })
    ])
    self.postMessage({ id: request.id, result: { blob, previewBlob, previewWidth: request.previewWidth, previewHeight: request.previewHeight, changedPixelCount: result.changedPixelCount } })
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Não foi possível aplicar o Balde de Tinta.' })
  }
}

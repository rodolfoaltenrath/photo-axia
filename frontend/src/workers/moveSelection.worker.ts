import {
  clipContextToSelection,
  multiplyMatrices,
  selectionMoveGeometry,
  type SelectionRegion
} from '../editor/selection'
import type { LayerTransform } from '../types/editor'

interface PrepareRequest {
  type: 'prepare'
  cacheKey: string
  blob: Blob
  assetWidth: number
  assetHeight: number
}

interface MoveRequest {
  type: 'move'
  cacheKey: string
  id: number
  blob: Blob
  assetWidth: number
  assetHeight: number
  transform: LayerTransform
  selection: SelectionRegion
  deltaX: number
  deltaY: number
  previewScaleX?: number
  previewScaleY?: number
}

let cachedBitmap: { key: string; bitmap: Promise<ImageBitmap> } | undefined

function sourceBitmap(request: PrepareRequest | MoveRequest) {
  if (cachedBitmap?.key === request.cacheKey) return cachedBitmap.bitmap
  const previous = cachedBitmap
  const bitmap = createImageBitmap(request.blob)
  cachedBitmap = { key: request.cacheKey, bitmap }
  if (previous) void previous.bitmap.then((image) => image.close()).catch(() => undefined)
  void bitmap.catch(() => {
    if (cachedBitmap?.bitmap === bitmap) cachedBitmap = undefined
  })
  return bitmap
}

self.onmessage = async (event: MessageEvent<PrepareRequest | MoveRequest>) => {
  const request = event.data
  if (request.type === 'prepare') {
    try {
      await sourceBitmap(request)
    } catch {
      // The actual move reports errors; warming is intentionally best-effort.
    }
    return
  }
  try {
    const bitmap = await sourceBitmap(request)
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
      if (geometry.hardRectangularMask) {
        contentContext.drawImage(
          bitmap,
          geometry.selectionOriginX,
          geometry.selectionOriginY,
          geometry.selectionWidth,
          geometry.selectionHeight,
          0,
          0,
          geometry.selectionWidth,
          geometry.selectionHeight
        )
      } else {
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
    }
    if (geometry.hardRectangularMask) {
      baseContext.clearRect(
        geometry.selectionOriginX,
        geometry.selectionOriginY,
        geometry.selectionWidth,
        geometry.selectionHeight
      )
    } else {
      baseContext.save()
      baseContext.globalCompositeOperation = 'destination-out'
      clipContextToSelection(baseContext, request.selection, geometry.documentToSource)
      baseContext.setTransform(1, 0, 0, 1, 0, 0)
      baseContext.fillRect(0, 0, request.assetWidth, request.assetHeight)
      baseContext.restore()
    }

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
    let previewCanvas: OffscreenCanvas | undefined
    if (previewWidth !== geometry.width || previewHeight !== geometry.height) {
      previewCanvas = new OffscreenCanvas(previewWidth, previewHeight)
      const previewContext = previewCanvas.getContext('2d', { alpha: true })
      if (!previewContext) throw new Error('O sistema não disponibilizou o renderizador de prévias.')
      previewContext.imageSmoothingEnabled = true
      previewContext.imageSmoothingQuality = 'high'
      previewContext.drawImage(output, 0, 0, previewWidth, previewHeight)
    }
    const quickPreviewWidth = Math.max(
      1,
      Math.min(geometry.width, Math.round(geometry.width * scaleX * Math.max(0.01, request.previewScaleX ?? 1)))
    )
    const quickPreviewHeight = Math.max(
      1,
      Math.min(geometry.height, Math.round(geometry.height * scaleY * Math.max(0.01, request.previewScaleY ?? 1)))
    )
    let quickCanvas: OffscreenCanvas | undefined
    if (quickPreviewWidth === previewWidth && quickPreviewHeight === previewHeight) {
      quickCanvas = previewCanvas
    } else if (quickPreviewWidth !== geometry.width || quickPreviewHeight !== geometry.height) {
      quickCanvas = new OffscreenCanvas(quickPreviewWidth, quickPreviewHeight)
      const quickContext = quickCanvas.getContext('2d', { alpha: true })
      if (!quickContext) throw new Error('O sistema não disponibilizou a prévia rápida da seleção.')
      quickContext.imageSmoothingEnabled = true
      quickContext.imageSmoothingQuality = 'high'
      quickContext.drawImage(output, 0, 0, quickPreviewWidth, quickPreviewHeight)
    }
    const quickPreviewBlob = quickCanvas
      ? await quickCanvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
      : undefined
    if (quickPreviewBlob) {
      self.postMessage({
        id: request.id,
        preview: {
          previewBlob: quickPreviewBlob,
          width: geometry.width,
          height: geometry.height,
          originX: geometry.originX,
          originY: geometry.originY,
          previewWidth: quickPreviewWidth,
          previewHeight: quickPreviewHeight
        }
      })
    }
    const previewPromise = previewCanvas
      ? previewCanvas === quickCanvas && quickPreviewBlob
        ? Promise.resolve(quickPreviewBlob)
        : previewCanvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
      : Promise.resolve(undefined)
    const blobPromise = output.convertToBlob({ type: 'image/png' })
    const [blob, previewBlob] = await Promise.all([blobPromise, previewPromise])
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

import { createGradientRasterState, renderGradientRasterRows } from '../editor/gradientRaster'
import type { GradientGeometry, GradientStopsConfig } from '../editor/gradient'
import type { SelectionRegion } from '../editor/selection'
import type { LayerTransform } from '../types/editor'

interface GradientRequest {
  id: number
  sourceBlob: Blob
  assetWidth: number
  assetHeight: number
  transform: LayerTransform
  geometry: GradientGeometry
  config: GradientStopsConfig
  selection: SelectionRegion | null
  previewWidth: number
  previewHeight: number
  documentWidth: number
  documentHeight: number
}

interface GradientCancelRequest {
  cancel: number
}

const cancelledRequests = new Set<number>()
const activeRequests = new Set<number>()

function requestWasCancelled(id: number) {
  return cancelledRequests.has(id)
}

async function previewBlob(source: OffscreenCanvas, width: number, height: number) {
  if (width === source.width && height === source.height) return undefined
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('O sistema não disponibilizou o renderizador de prévias.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  return canvas.convertToBlob({ type: 'image/webp' })
}

self.onmessage = async (event: MessageEvent<GradientRequest | GradientCancelRequest>) => {
  if ('cancel' in event.data) {
    if (activeRequests.has(event.data.cancel)) cancelledRequests.add(event.data.cancel)
    return
  }
  const request = event.data
  activeRequests.add(request.id)
  try {
    const bitmap = await createImageBitmap(request.sourceBlob)
    if (requestWasCancelled(request.id)) {
      bitmap.close()
      return
    }
    const sourceCanvas = new OffscreenCanvas(request.assetWidth, request.assetHeight)
    const sourceContext = sourceCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!sourceContext) {
      bitmap.close()
      throw new Error('O sistema não disponibilizou o renderizador 2D.')
    }
    sourceContext.drawImage(bitmap, 0, 0, request.assetWidth, request.assetHeight)
    bitmap.close()
    const sourcePixels = sourceContext.getImageData(0, 0, request.assetWidth, request.assetHeight).data
    const state = createGradientRasterState({
      sourcePixels,
      sourceWidth: request.assetWidth,
      sourceHeight: request.assetHeight,
      transform: request.transform,
      geometry: request.geometry,
      config: request.config,
      selection: request.selection,
      documentWidth: request.documentWidth,
      documentHeight: request.documentHeight,
      reuseSourceBuffer: true
    })
    sourceCanvas.width = 1
    sourceCanvas.height = 1
    const rowsPerChunk = 256
    for (let row = 0; row < state.geometry.height; row += rowsPerChunk) {
      if (requestWasCancelled(request.id)) return
      renderGradientRasterRows(state, row, row + rowsPerChunk)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    if (requestWasCancelled(request.id)) return
    const canvas = new OffscreenCanvas(state.geometry.width, state.geometry.height)
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
    context.putImageData(
      new ImageData(state.pixels, state.geometry.width, state.geometry.height),
      0,
      0
    )
    const outputPreviewWidth = Math.max(1, Math.min(
      state.geometry.width,
      Math.round(state.geometry.width * request.previewWidth / request.assetWidth)
    ))
    const outputPreviewHeight = Math.max(1, Math.min(
      state.geometry.height,
      Math.round(state.geometry.height * request.previewHeight / request.assetHeight)
    ))
    const [blob, derivedPreview] = await Promise.all([
      canvas.convertToBlob({ type: 'image/png' }),
      previewBlob(canvas, outputPreviewWidth, outputPreviewHeight)
    ])
    if (requestWasCancelled(request.id)) return
    self.postMessage({
      id: request.id,
      result: {
        blob,
        width: state.geometry.width,
        height: state.geometry.height,
        originX: state.geometry.originX,
        originY: state.geometry.originY,
        previewBlob: derivedPreview,
        previewWidth: outputPreviewWidth,
        previewHeight: outputPreviewHeight
      }
    })
  } catch (error) {
    if (!requestWasCancelled(request.id)) {
      self.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : 'Não foi possível aplicar o degradê.'
      })
    }
  } finally {
    activeRequests.delete(request.id)
    cancelledRequests.delete(request.id)
  }
}

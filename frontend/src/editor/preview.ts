import type { ImageAsset } from '../types/editor'

/**
 * Uses the lightweight preview whenever it already contains enough pixels for
 * the current backing canvas. Falling back to the source only improves visual
 * quality when the preview would otherwise need to be enlarged.
 */
export function imageSourceForRasterSize(
  asset: ImageAsset,
  requiredWidth: number,
  requiredHeight: number
) {
  const previewSource = asset.previewUrl
  const previewWidth = asset.previewWidth
  const previewHeight = asset.previewHeight
  if (!previewSource || !previewWidth || !previewHeight) return asset.sourceUrl

  const targetWidth = Math.min(asset.width, Math.max(1, Math.ceil(Math.abs(requiredWidth))))
  const targetHeight = Math.min(asset.height, Math.max(1, Math.ceil(Math.abs(requiredHeight))))
  return previewWidth >= targetWidth && previewHeight >= targetHeight
    ? previewSource
    : asset.sourceUrl
}

export function snapCanvasTranslation(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0
}

interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ViewportPreviewGeometry {
  x: number
  y: number
  width: number
  height: number
  rasterWidth: number
  rasterHeight: number
}

const MAX_VIEWPORT_PREVIEW_PIXELS = 4_194_304

/**
 * Allocates backing pixels only for the visible portion of the document. This
 * keeps one physical canvas pixel per visible device pixel even when the full
 * document is much larger than the viewport.
 */
export function viewportPreviewGeometry(
  documentWidth: number,
  documentHeight: number,
  viewportScale: number,
  pixelRatio: number,
  surface: RectLike,
  viewport: RectLike,
  maximumPixels = MAX_VIEWPORT_PREVIEW_PIXELS
): ViewportPreviewGeometry {
  const scale = Math.max(0.01, Math.abs(viewportScale))
  const density = Math.max(1, Math.min(2, pixelRatio || 1))
  const x = Math.max(0, Math.min(documentWidth, (Math.max(surface.left, viewport.left) - surface.left) / scale))
  const y = Math.max(0, Math.min(documentHeight, (Math.max(surface.top, viewport.top) - surface.top) / scale))
  const right = Math.max(x, Math.min(documentWidth, (Math.min(surface.right, viewport.right) - surface.left) / scale))
  const bottom = Math.max(y, Math.min(documentHeight, (Math.min(surface.bottom, viewport.bottom) - surface.top) / scale))
  const width = Math.max(1 / scale, right - x)
  const height = Math.max(1 / scale, bottom - y)
  let rasterWidth = Math.max(1, Math.ceil(width * scale * density))
  let rasterHeight = Math.max(1, Math.ceil(height * scale * density))
  const pixels = rasterWidth * rasterHeight
  if (pixels > maximumPixels) {
    const reduction = Math.sqrt(maximumPixels / pixels)
    rasterWidth = Math.max(1, Math.floor(rasterWidth * reduction))
    rasterHeight = Math.max(1, Math.floor(rasterHeight * reduction))
  }
  return { x, y, width, height, rasterWidth, rasterHeight }
}

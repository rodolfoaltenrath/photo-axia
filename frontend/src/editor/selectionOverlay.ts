import type { SelectionRegion } from './selection'
import { pixelSpansOutlinePath, vectorSelectionPath } from './selection.ts'

const MAXIMUM_ANIMATED_PIXEL_SELECTION_SPANS = 2_000

/**
 * The document surface is enlarged through a CSS transform. SVG's
 * non-scaling-stroke does not compensate for that outer transform, so convert
 * the desired screen measurements back to document units explicitly.
 */
export function selectionOverlayMetrics(scale: number) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? Math.max(0.01, scale) : 1
  return {
    strokeWidth: 1 / safeScale,
    dashLength: 4 / safeScale,
    dashOffset: -8 / safeScale
  }
}

/**
 * Animating a path made of thousands of pixel edges forces expensive painting.
 * A static dashed line retains the selection feedback while navigation stays
 * smooth. Vector and small pixel selections retain the usual marching ants.
 */
export function selectionOverlayShouldAnimate(selection: SelectionRegion, isZooming: boolean) {
  return !isZooming && (
    selection.kind !== 'pixels' || selection.spans.length <= MAXIMUM_ANIMATED_PIXEL_SELECTION_SPANS
  )
}

/**
 * Pixel selections can contain tens of thousands of independent edges. During
 * continuous zoom, drawing that full contour every frame dominates painting.
 * Keep feedback immediate with the transformed selection bounds, then restore
 * the exact contour once navigation settles.
 */
export function selectionOverlayOutlinePath(selection: SelectionRegion, reducedDetail: boolean) {
  if (selection.kind !== 'pixels') return vectorSelectionPath(selection)
  if (!reducedDetail) return pixelSpansOutlinePath(selection.spans, selection.bounds)
  const { x, y, width, height } = selection.bounds
  return `M${x} ${y}h${width}v${height}H${x}Z`
}

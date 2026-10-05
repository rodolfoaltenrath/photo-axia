import type { SelectionRegion } from './selection'
import { pixelSpansOutlinePath, vectorSelectionPath } from './selection.ts'

const MAXIMUM_ANIMATED_PIXEL_SELECTION_SPANS = 2_000

/** Compensate outer CSS zoom explicitly; SVG non-scaling-stroke cannot do it. */
export function selectionOverlayMetrics(scale: number) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? Math.max(0.01, scale) : 1
  return {
    strokeWidth: 1 / safeScale,
    dashLength: 4 / safeScale,
    dashOffset: -8 / safeScale
  }
}

/** Avoid costly contour animation during zoom or on large pixel selections. */
export function selectionOverlayShouldAnimate(selection: SelectionRegion, isZooming: boolean) {
  return !isZooming && (
    selection.kind !== 'pixels' || selection.spans.length <= MAXIMUM_ANIMATED_PIXEL_SELECTION_SPANS
  )
}

/** During zoom, use bounds; restore the exact pixel contour when zoom settles. */
export function selectionOverlayOutlinePath(selection: SelectionRegion, reducedDetail: boolean) {
  if (selection.kind !== 'pixels') return vectorSelectionPath(selection)
  if (!reducedDetail) return pixelSpansOutlinePath(selection.spans, selection.bounds)
  const { x, y, width, height } = selection.bounds
  return `M${x} ${y}h${width}v${height}H${x}Z`
}

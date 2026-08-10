export interface ViewportDimensions {
  width: number
  height: number
}

export interface ViewportCenterAnchor {
  type: 'anchor'
  viewportX: number
  viewportY: number
  documentX: number
  documentY: number
}

export function centeredScrollOffset(scrollSize: number, clientSize: number) {
  return Math.max(0, (scrollSize - clientSize) / 2)
}

export function preserveViewportCenter(
  scrollLeft: number,
  scrollTop: number,
  previous: ViewportDimensions,
  next: ViewportDimensions,
  scale: number
): ViewportCenterAnchor {
  const safeScale = Math.max(0.0001, scale)
  return {
    type: 'anchor',
    viewportX: next.width / 2,
    viewportY: next.height / 2,
    documentX: (scrollLeft - previous.width / 2) / safeScale,
    documentY: (scrollTop - previous.height / 2) / safeScale
  }
}

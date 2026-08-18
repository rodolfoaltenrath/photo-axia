export interface FloatingWindowSize {
  height: number
  width: number
}

export interface FloatingWindowRect extends FloatingWindowSize {
  left: number
  top: number
}

export type FloatingWindowCorner = 'north-east' | 'north-west' | 'south-east' | 'south-west'

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function usableSize(viewport: FloatingWindowSize, margin: number) {
  return {
    width: Math.max(1, viewport.width - margin * 2),
    height: Math.max(1, viewport.height - margin * 2)
  }
}

function constrainedMinimum(
  viewport: FloatingWindowSize,
  minimum: FloatingWindowSize,
  margin: number
) {
  const usable = usableSize(viewport, margin)
  return {
    width: Math.min(minimum.width, usable.width),
    height: Math.min(minimum.height, usable.height)
  }
}

export function fitFloatingWindow(
  rect: FloatingWindowRect,
  viewport: FloatingWindowSize,
  minimum: FloatingWindowSize,
  margin = 8
): FloatingWindowRect {
  const usable = usableSize(viewport, margin)
  const minimumSize = constrainedMinimum(viewport, minimum, margin)
  const width = clamp(rect.width, minimumSize.width, usable.width)
  const height = clamp(rect.height, minimumSize.height, usable.height)
  return {
    left: clamp(rect.left, margin, Math.max(margin, viewport.width - margin - width)),
    top: clamp(rect.top, margin, Math.max(margin, viewport.height - margin - height)),
    width,
    height
  }
}

export function centerFloatingWindow(
  viewport: FloatingWindowSize,
  preferred: FloatingWindowSize,
  minimum: FloatingWindowSize,
  margin = 8
): FloatingWindowRect {
  const usable = usableSize(viewport, margin)
  const minimumSize = constrainedMinimum(viewport, minimum, margin)
  const width = clamp(preferred.width, minimumSize.width, usable.width)
  const height = clamp(preferred.height, minimumSize.height, usable.height)
  return {
    left: Math.round((viewport.width - width) / 2),
    top: Math.round((viewport.height - height) / 2),
    width,
    height
  }
}

export function moveFloatingWindow(
  rect: FloatingWindowRect,
  deltaX: number,
  deltaY: number,
  viewport: FloatingWindowSize,
  minimum: FloatingWindowSize,
  margin = 8
) {
  const fitted = fitFloatingWindow(rect, viewport, minimum, margin)
  return fitFloatingWindow({
    ...fitted,
    left: fitted.left + deltaX,
    top: fitted.top + deltaY
  }, viewport, minimum, margin)
}

export function resizeFloatingWindow(
  rect: FloatingWindowRect,
  corner: FloatingWindowCorner,
  deltaX: number,
  deltaY: number,
  viewport: FloatingWindowSize,
  minimum: FloatingWindowSize,
  margin = 8
): FloatingWindowRect {
  const fitted = fitFloatingWindow(rect, viewport, minimum, margin)
  const minimumSize = constrainedMinimum(viewport, minimum, margin)
  let left = fitted.left
  let top = fitted.top
  let right = fitted.left + fitted.width
  let bottom = fitted.top + fitted.height

  if (corner.endsWith('west')) {
    left = clamp(left + deltaX, margin, right - minimumSize.width)
  } else {
    right = clamp(right + deltaX, left + minimumSize.width, viewport.width - margin)
  }

  if (corner.startsWith('north')) {
    top = clamp(top + deltaY, margin, bottom - minimumSize.height)
  } else {
    bottom = clamp(bottom + deltaY, top + minimumSize.height, viewport.height - margin)
  }

  return { left, top, width: right - left, height: bottom - top }
}

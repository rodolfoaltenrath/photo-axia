import type { LayerTransform } from '../types/editor'

export type TransformAxis = -1 | 0 | 1

export interface TransformHandle {
  id: string
  x: TransformAxis
  y: TransformAxis
  left: number
  top: number
  cursor: string
}

export interface DocumentPoint {
  x: number
  y: number
}

export const TRANSFORM_HANDLES: TransformHandle[] = [
  { id: 'nw', x: -1, y: -1, left: 0, top: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0, y: -1, left: 50, top: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: -1, left: 100, top: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0, left: 100, top: 50, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, left: 100, top: 100, cursor: 'nwse-resize' },
  { id: 's', x: 0, y: 1, left: 50, top: 100, cursor: 'ns-resize' },
  { id: 'sw', x: -1, y: 1, left: 0, top: 100, cursor: 'nesw-resize' },
  { id: 'w', x: -1, y: 0, left: 0, top: 50, cursor: 'ew-resize' }
]

const MIN_TRANSFORM_SIZE = 1

export function transformCenter(transform: LayerTransform): DocumentPoint {
  return {
    x: transform.x + transform.width / 2,
    y: transform.y + transform.height / 2
  }
}

export function layerTransformsMatch(first: LayerTransform, second: LayerTransform) {
  return first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height &&
    (first.rotation ?? 0) === (second.rotation ?? 0)
}

export function layerTransformOnlyMoved(first: LayerTransform, second: LayerTransform) {
  return (first.x !== second.x || first.y !== second.y) &&
    first.width === second.width &&
    first.height === second.height &&
    (first.rotation ?? 0) === (second.rotation ?? 0)
}

export function layerTransformStyle(transform: LayerTransform) {
  return {
    left: '0',
    top: '0',
    width: `${transform.width}px`,
    height: `${transform.height}px`,
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(${transform.rotation ?? 0}deg)`
  }
}

export function normalizeRotation(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return Math.abs(normalized) < 0.005 ? 0 : Math.round(normalized * 100) / 100
}

export function moveLayerTransform(
  initial: LayerTransform,
  start: DocumentPoint,
  pointer: DocumentPoint
): LayerTransform {
  return {
    ...initial,
    x: Math.round((initial.x + pointer.x - start.x) * 100) / 100,
    y: Math.round((initial.y + pointer.y - start.y) * 100) / 100
  }
}

export function constrainedTranslationDelta(deltaX: number, deltaY: number, constrain = false) {
  let x = deltaX
  let y = deltaY
  if (constrain && (x || y)) {
    const distance = Math.hypot(x, y)
    const angle = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4)
    x = Math.cos(angle) * distance
    y = Math.sin(angle) * distance
  }
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100
  }
}

export function rotateLayerTransform(
  initial: LayerTransform,
  startAngle: number,
  pointer: DocumentPoint,
  snap: boolean
): LayerTransform {
  const center = transformCenter(initial)
  const pointerAngle = Math.atan2(pointer.y - center.y, pointer.x - center.x)
  const delta = normalizeRadians(pointerAngle - startAngle)
  let rotation = (initial.rotation ?? 0) + (delta * 180) / Math.PI
  if (snap) rotation = Math.round(rotation / 15) * 15

  return { ...initial, rotation: normalizeRotation(rotation) }
}

export function resizeLayerTransform(
  initial: LayerTransform,
  handle: Pick<TransformHandle, 'x' | 'y'>,
  pointer: DocumentPoint,
  fromCenter: boolean,
  proportional: boolean
): LayerTransform {
  const center = transformCenter(initial)
  const rotation = initial.rotation ?? 0
  const localPointer = rotateVector(
    { x: pointer.x - center.x, y: pointer.y - center.y },
    (-rotation * Math.PI) / 180
  )
  let width = initial.width
  let height = initial.height
  let localCenter = { x: 0, y: 0 }

  if (proportional && handle.x !== 0 && handle.y !== 0) {
    const result = proportionalResize(initial, handle, localPointer, fromCenter)
    width = result.width
    height = result.height
    localCenter = result.localCenter
  } else {
    const result = freeResize(initial, handle, localPointer, fromCenter)
    width = result.width
    height = result.height
    localCenter = result.localCenter
  }

  const centerOffset = rotateVector(localCenter, (rotation * Math.PI) / 180)
  const nextCenter = { x: center.x + centerOffset.x, y: center.y + centerOffset.y }
  return {
    x: Math.round((nextCenter.x - width / 2) * 100) / 100,
    y: Math.round((nextCenter.y - height / 2) * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
    rotation: normalizeRotation(rotation)
  }
}

function proportionalResize(
  initial: LayerTransform,
  handle: Pick<TransformHandle, 'x' | 'y'>,
  pointer: DocumentPoint,
  fromCenter: boolean
) {
  const minimumScale = Math.max(MIN_TRANSFORM_SIZE / initial.width, MIN_TRANSFORM_SIZE / initial.height)

  if (fromCenter) {
    const initialHandle = { x: (handle.x * initial.width) / 2, y: (handle.y * initial.height) / 2 }
    const scale = Math.max(minimumScale, dot(pointer, initialHandle) / dot(initialHandle, initialHandle))
    return {
      width: initial.width * scale,
      height: initial.height * scale,
      localCenter: { x: 0, y: 0 }
    }
  }

  const anchor = { x: (-handle.x * initial.width) / 2, y: (-handle.y * initial.height) / 2 }
  const initialVector = { x: handle.x * initial.width, y: handle.y * initial.height }
  const pointerVector = { x: pointer.x - anchor.x, y: pointer.y - anchor.y }
  const scale = Math.max(minimumScale, dot(pointerVector, initialVector) / dot(initialVector, initialVector))
  const movedHandle = {
    x: anchor.x + initialVector.x * scale,
    y: anchor.y + initialVector.y * scale
  }

  return {
    width: initial.width * scale,
    height: initial.height * scale,
    localCenter: {
      x: (anchor.x + movedHandle.x) / 2,
      y: (anchor.y + movedHandle.y) / 2
    }
  }
}

function freeResize(
  initial: LayerTransform,
  handle: Pick<TransformHandle, 'x' | 'y'>,
  pointer: DocumentPoint,
  fromCenter: boolean
) {
  let width = initial.width
  let height = initial.height
  const localCenter = { x: 0, y: 0 }

  if (handle.x !== 0) {
    if (fromCenter) {
      width = Math.max(MIN_TRANSFORM_SIZE, pointer.x * handle.x * 2)
    } else {
      const anchor = (-handle.x * initial.width) / 2
      width = Math.max(MIN_TRANSFORM_SIZE, (pointer.x - anchor) * handle.x)
      const movedHandle = anchor + handle.x * width
      localCenter.x = (anchor + movedHandle) / 2
    }
  }

  if (handle.y !== 0) {
    if (fromCenter) {
      height = Math.max(MIN_TRANSFORM_SIZE, pointer.y * handle.y * 2)
    } else {
      const anchor = (-handle.y * initial.height) / 2
      height = Math.max(MIN_TRANSFORM_SIZE, (pointer.y - anchor) * handle.y)
      const movedHandle = anchor + handle.y * height
      localCenter.y = (anchor + movedHandle) / 2
    }
  }

  return { width, height, localCenter }
}

export function rotateVector(point: DocumentPoint, angle: number): DocumentPoint {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine
  }
}

function dot(first: DocumentPoint, second: DocumentPoint) {
  return first.x * second.x + first.y * second.y
}

export function normalizeRadians(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

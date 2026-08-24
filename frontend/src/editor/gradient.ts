import type { SelectionBounds, SelectionPoint } from './selection'

export type GradientType = 'linear' | 'radial'
export type GradientRgb = readonly [red: number, green: number, blue: number]

export interface GradientConfig {
  type: GradientType
  foregroundColor: string
  backgroundColor: string
  reversed: boolean
}

export interface GradientGeometry {
  start: SelectionPoint
  end: SelectionPoint
}

export type GradientGestureAction = 'confirm' | 'cancel'

export const MINIMUM_GRADIENT_LENGTH = 0.5

export const DEFAULT_GRADIENT_CONFIG: Readonly<GradientConfig> = Object.freeze({
  type: 'linear',
  foregroundColor: '#000000',
  backgroundColor: '#ffffff',
  reversed: false
})

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function parseGradientColor(value: string): GradientRgb {
  const match = /^#([\da-f]{6})$/i.exec(value)
  if (!match) throw new Error('Cor hexadecimal inválida para o degradê.')
  const hex = match[1]!
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ]
}

export function interpolateGradientColor(
  foregroundColor: string,
  backgroundColor: string,
  progress: number,
  reversed = false
): GradientRgb {
  const foreground = parseGradientColor(foregroundColor)
  const background = parseGradientColor(backgroundColor)
  const start = reversed ? background : foreground
  const end = reversed ? foreground : background
  const amount = clamp01(progress)
  return start.map((channel, index) =>
    Math.round(channel + (end[index]! - channel) * amount)
  ) as unknown as GradientRgb
}

export function gradientLength(geometry: GradientGeometry) {
  return Math.hypot(
    geometry.end.x - geometry.start.x,
    geometry.end.y - geometry.start.y
  )
}

export function gradientIsDegenerate(
  geometry: GradientGeometry,
  minimumLength = MINIMUM_GRADIENT_LENGTH
) {
  if (![geometry.start.x, geometry.start.y, geometry.end.x, geometry.end.y].every(Number.isFinite)) return true
  return gradientLength(geometry) < Math.max(0, minimumLength)
}

export function gradientGestureAction(eventType: string, geometry: GradientGeometry): GradientGestureAction {
  return eventType === 'pointerup' && !gradientIsDegenerate(geometry) ? 'confirm' : 'cancel'
}

export function gradientLineBounds(geometry: GradientGeometry): SelectionBounds {
  const x = Math.min(geometry.start.x, geometry.end.x)
  const y = Math.min(geometry.start.y, geometry.end.y)
  return {
    x,
    y,
    width: Math.max(0, Math.max(geometry.start.x, geometry.end.x) - x),
    height: Math.max(0, Math.max(geometry.start.y, geometry.end.y) - y)
  }
}

export function linearGradientProgress(point: SelectionPoint, geometry: GradientGeometry) {
  const deltaX = geometry.end.x - geometry.start.x
  const deltaY = geometry.end.y - geometry.start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (!Number.isFinite(lengthSquared) || lengthSquared <= Number.EPSILON) return 0
  return clamp01(
    ((point.x - geometry.start.x) * deltaX + (point.y - geometry.start.y) * deltaY) /
    lengthSquared
  )
}

export function radialGradientProgress(point: SelectionPoint, geometry: GradientGeometry) {
  const radius = gradientLength(geometry)
  if (!Number.isFinite(radius) || radius <= Number.EPSILON) return 0
  return clamp01(Math.hypot(point.x - geometry.start.x, point.y - geometry.start.y) / radius)
}

export function gradientProgress(point: SelectionPoint, geometry: GradientGeometry, type: GradientType) {
  return type === 'radial'
    ? radialGradientProgress(point, geometry)
    : linearGradientProgress(point, geometry)
}

function cleanCoordinate(value: number) {
  return Math.abs(value) < 1e-12 ? 0 : value
}

export function snapGradientEndpoint(
  start: SelectionPoint,
  end: SelectionPoint,
  stepDegrees = 15
): SelectionPoint {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const length = Math.hypot(deltaX, deltaY)
  const stepRadians = Math.abs(stepDegrees) * Math.PI / 180
  if (!Number.isFinite(length) || length === 0 || !Number.isFinite(stepRadians) || stepRadians === 0) {
    return { ...end }
  }
  const angle = Math.atan2(deltaY, deltaX)
  const snappedAngle = Math.round(angle / stepRadians) * stepRadians
  return {
    x: cleanCoordinate(start.x + Math.cos(snappedAngle) * length),
    y: cleanCoordinate(start.y + Math.sin(snappedAngle) * length)
  }
}

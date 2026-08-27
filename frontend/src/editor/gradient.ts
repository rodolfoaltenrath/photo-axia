import type { SelectionBounds, SelectionPoint } from './selection'

export type GradientType = 'linear' | 'radial'
export type GradientRgb = readonly [red: number, green: number, blue: number]
export type GradientRgba = readonly [red: number, green: number, blue: number, alpha: number]
export interface GradientInterpolator {
  (progress: number): GradientRgba
  write(output: { [index: number]: number }, offset: number, progress: number): void
}
export type GradientInterpolation = 'srgb'

export interface GradientColorStop {
  id: string
  position: number
  color: string
}

export interface GradientOpacityStop {
  id: string
  position: number
  opacity: number
}

export interface GradientStopsConfig {
  type: GradientType
  colorStops: readonly GradientColorStop[]
  opacityStops: readonly GradientOpacityStop[]
  reversed: boolean
  interpolation: GradientInterpolation
}

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

export type GradientConfigInput = GradientConfig | GradientStopsConfig

export type GradientGestureAction = 'confirm' | 'cancel'

export const MINIMUM_GRADIENT_LENGTH = 0.5
export const MAX_GRADIENT_COLOR_STOPS = 32
export const MAX_GRADIENT_OPACITY_STOPS = 32

export const DEFAULT_GRADIENT_CONFIG: Readonly<GradientConfig> = Object.freeze({
  type: 'linear',
  foregroundColor: '#000000',
  backgroundColor: '#ffffff',
  reversed: false
})

export const DEFAULT_GRADIENT_STOPS_CONFIG: Readonly<GradientStopsConfig> = Object.freeze({
  type: 'linear',
  colorStops: Object.freeze([
    Object.freeze({ id: 'color-start', position: 0, color: '#000000' }),
    Object.freeze({ id: 'color-end', position: 1, color: '#ffffff' })
  ]),
  opacityStops: Object.freeze([
    Object.freeze({ id: 'opacity-start', position: 0, opacity: 100 }),
    Object.freeze({ id: 'opacity-end', position: 1, opacity: 100 })
  ]),
  reversed: false,
  interpolation: 'srgb'
})

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function clampOpacity(value: number) {
  if (!Number.isFinite(value)) return 100
  return Math.min(100, Math.max(0, value))
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function normalizedHexColor(value: unknown, fallback?: string) {
  const match = typeof value === 'string' ? /^#([\da-f]{6})$/i.exec(value) : null
  return match ? `#${match[1]!.toLowerCase()}` : fallback
}

function uniqueStopId(value: unknown, prefix: string, index: number, used: Set<string>) {
  const requested = typeof value === 'string' ? value.trim() : ''
  const base = requested || `${prefix}-${index + 1}`
  let id = base
  let suffix = 2
  while (used.has(id)) id = `${base}-${suffix++}`
  used.add(id)
  return id
}

function normalizedColorStops(source: Record<string, unknown>) {
  const rawStops = Array.isArray(source.colorStops)
    ? source.colorStops.slice(0, MAX_GRADIENT_COLOR_STOPS)
    : []
  const used = new Set<string>()
  const stops: GradientColorStop[] = []
  for (const [index, value] of rawStops.entries()) {
    const stop = recordValue(value)
    const color = normalizedHexColor(stop.color)
    if (!color || typeof stop.position !== 'number' || !Number.isFinite(stop.position)) continue
    stops.push({
      id: uniqueStopId(stop.id, 'color', index, used),
      position: clamp01(stop.position as number),
      color
    })
  }

  if (stops.length === 0) {
    stops.push(
      {
        id: uniqueStopId(undefined, 'color', 0, used),
        position: 0,
        color: normalizedHexColor(source.foregroundColor, '#000000')!
      },
      {
        id: uniqueStopId(undefined, 'color', 1, used),
        position: 1,
        color: normalizedHexColor(source.backgroundColor, '#ffffff')!
      }
    )
  } else if (stops.length === 1) {
    const stop = stops[0]!
    stops.push({
      id: uniqueStopId(undefined, 'color', 1, used),
      position: stop.position <= 0.5 ? 1 : 0,
      color: stop.color
    })
  }
  return stops.sort((first, second) => first.position - second.position)
}

function normalizedOpacityStops(source: Record<string, unknown>) {
  const rawStops = Array.isArray(source.opacityStops)
    ? source.opacityStops.slice(0, MAX_GRADIENT_OPACITY_STOPS)
    : []
  const used = new Set<string>()
  const stops: GradientOpacityStop[] = []
  for (const [index, value] of rawStops.entries()) {
    const stop = recordValue(value)
    if (
      typeof stop.position !== 'number' ||
      typeof stop.opacity !== 'number' ||
      !Number.isFinite(stop.position) ||
      !Number.isFinite(stop.opacity)
    ) continue
    stops.push({
      id: uniqueStopId(stop.id, 'opacity', index, used),
      position: clamp01(stop.position as number),
      opacity: clampOpacity(stop.opacity as number)
    })
  }

  if (stops.length === 0) {
    stops.push(
      { id: uniqueStopId(undefined, 'opacity', 0, used), position: 0, opacity: 100 },
      { id: uniqueStopId(undefined, 'opacity', 1, used), position: 1, opacity: 100 }
    )
  } else if (stops.length === 1) {
    const stop = stops[0]!
    stops.push({
      id: uniqueStopId(undefined, 'opacity', 1, used),
      position: stop.position <= 0.5 ? 1 : 0,
      opacity: stop.opacity
    })
  }
  return stops.sort((first, second) => first.position - second.position)
}

export function normalizeGradientStopsConfig(value: unknown): GradientStopsConfig {
  const source = recordValue(value)
  return {
    type: source.type === 'radial' ? 'radial' : 'linear',
    colorStops: normalizedColorStops(source),
    opacityStops: normalizedOpacityStops(source),
    reversed: source.reversed === true,
    interpolation: 'srgb'
  }
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

function upperStopIndex<T extends { position: number }>(stops: readonly T[], position: number) {
  let start = 0
  let end = stops.length
  while (start < end) {
    const middle = (start + end) >>> 1
    if (stops[middle]!.position <= position) start = middle + 1
    else end = middle
  }
  return start
}

export function createGradientInterpolator(config: GradientConfigInput) {
  const normalized = normalizeGradientStopsConfig(config)
  const colorStops = normalized.colorStops.map((stop) => ({
    position: stop.position,
    color: parseGradientColor(stop.color)
  }))
  const opacityStops = normalized.opacityStops.map((stop) => ({
    position: stop.position,
    opacity: stop.opacity
  }))
  const interpolate = ((progress: number): GradientRgba => {
    const output = [0, 0, 0, 0]
    interpolate.write(output, 0, progress)
    return output as unknown as GradientRgba
  }) as GradientInterpolator
  interpolate.write = (output, offset, progress) => {
    const position = normalized.reversed ? 1 - clamp01(progress) : clamp01(progress)
    const colorRight = upperStopIndex(colorStops, position)
    const colorFirstIndex = colorRight === 0 ? 0 : Math.min(colorRight - 1, colorStops.length - 1)
    const colorSecondIndex = Math.min(colorRight, colorStops.length - 1)
    const colorFirst = colorStops[colorFirstIndex]!
    const colorSecond = colorStops[colorSecondIndex]!
    const colorDistance = colorSecond.position - colorFirst.position
    const colorAmount = colorDistance > Number.EPSILON
      ? clamp01((position - colorFirst.position) / colorDistance)
      : 0
    const opacityRight = upperStopIndex(opacityStops, position)
    const opacityFirstIndex = opacityRight === 0 ? 0 : Math.min(opacityRight - 1, opacityStops.length - 1)
    const opacitySecondIndex = Math.min(opacityRight, opacityStops.length - 1)
    const opacityFirst = opacityStops[opacityFirstIndex]!
    const opacitySecond = opacityStops[opacitySecondIndex]!
    const opacityDistance = opacitySecond.position - opacityFirst.position
    const opacityAmount = opacityDistance > Number.EPSILON
      ? clamp01((position - opacityFirst.position) / opacityDistance)
      : 0
    output[offset] = Math.round(colorFirst.color[0] + (colorSecond.color[0] - colorFirst.color[0]) * colorAmount)
    output[offset + 1] = Math.round(colorFirst.color[1] + (colorSecond.color[1] - colorFirst.color[1]) * colorAmount)
    output[offset + 2] = Math.round(colorFirst.color[2] + (colorSecond.color[2] - colorFirst.color[2]) * colorAmount)
    output[offset + 3] = Math.round(
      (opacityFirst.opacity + (opacitySecond.opacity - opacityFirst.opacity) * opacityAmount) * 255 / 100
    )
  }
  return interpolate
}

export function interpolateGradientStops(
  config: GradientConfigInput,
  progress: number
): GradientRgba {
  return createGradientInterpolator(config)(progress)
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

import type { SelectionPoint } from './selection'

export type ShapeKind = 'rectangle' | 'ellipse' | 'triangle' | 'star'

export interface ShapeToolConfig {
  kind: ShapeKind
  color: string
  cornerRadius: number
  squareness: number
  starPoints: number
  starInnerRatio: number
}

export interface ShapeGeometry {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_SHAPE_CONFIG: ShapeToolConfig = {
  kind: 'rectangle',
  color: '#000000',
  cornerRadius: 0,
  squareness: 0,
  starPoints: 5,
  starInnerRatio: 50
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

export function normalizeShapeConfig(config: ShapeToolConfig): ShapeToolConfig {
  return {
    kind: ['rectangle', 'ellipse', 'triangle', 'star'].includes(config.kind)
      ? config.kind
      : 'rectangle',
    color: /^#[\da-f]{6}$/i.test(config.color) ? config.color.toLowerCase() : '#000000',
    cornerRadius: clamp(finite(config.cornerRadius, 0), 0, 8192),
    squareness: clamp(finite(config.squareness, 0), 0, 100),
    starPoints: Math.round(clamp(finite(config.starPoints, 5), 3, 32)),
    starInnerRatio: clamp(finite(config.starInnerRatio, 50), 5, 95)
  }
}

export function shapeGeometryFromDrag(
  start: SelectionPoint,
  end: SelectionPoint,
  constrainProportions = false,
  fromCenter = false
): ShapeGeometry {
  let deltaX = finite(end.x, start.x) - start.x
  let deltaY = finite(end.y, start.y) - start.y
  if (constrainProportions) {
    const extent = Math.max(Math.abs(deltaX), Math.abs(deltaY))
    deltaX = (deltaX < 0 ? -1 : 1) * extent
    deltaY = (deltaY < 0 ? -1 : 1) * extent
  }
  if (fromCenter) {
    return {
      x: start.x - Math.abs(deltaX),
      y: start.y - Math.abs(deltaY),
      width: Math.abs(deltaX) * 2,
      height: Math.abs(deltaY) * 2
    }
  }
  return {
    x: Math.min(start.x, start.x + deltaX),
    y: Math.min(start.y, start.y + deltaY),
    width: Math.abs(deltaX),
    height: Math.abs(deltaY)
  }
}

export function shapeIsDegenerate(geometry: ShapeGeometry) {
  return !Number.isFinite(geometry.x) || !Number.isFinite(geometry.y) ||
    !Number.isFinite(geometry.width) || !Number.isFinite(geometry.height) ||
    geometry.width < 0.5 || geometry.height < 0.5
}

export function triangleVertices(geometry: ShapeGeometry): SelectionPoint[] {
  return [
    { x: geometry.x + geometry.width / 2, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
    { x: geometry.x, y: geometry.y + geometry.height }
  ]
}

export function starVertices(
  geometry: ShapeGeometry,
  points: number,
  innerRatio: number
): SelectionPoint[] {
  const count = Math.round(clamp(finite(points, 5), 3, 32))
  const ratio = clamp(finite(innerRatio, 50), 5, 95) / 100
  const centerX = geometry.x + geometry.width / 2
  const centerY = geometry.y + geometry.height / 2
  const radiusX = geometry.width / 2
  const radiusY = geometry.height / 2
  const vertices: SelectionPoint[] = []
  for (let index = 0; index < count * 2; index++) {
    const angle = -Math.PI / 2 + index * Math.PI / count
    const radius = index % 2 === 0 ? 1 : ratio
    vertices.push({
      x: centerX + Math.cos(angle) * radiusX * radius,
      y: centerY + Math.sin(angle) * radiusY * radius
    })
  }
  return vertices
}

export function superellipseVertices(
  geometry: ShapeGeometry,
  squareness: number,
  samples = 128
): SelectionPoint[] {
  const exponent = 2 + clamp(finite(squareness, 0), 0, 100) / 10
  const power = 2 / exponent
  const count = Math.max(16, Math.round(samples))
  const centerX = geometry.x + geometry.width / 2
  const centerY = geometry.y + geometry.height / 2
  const radiusX = geometry.width / 2
  const radiusY = geometry.height / 2
  const vertices: SelectionPoint[] = []
  for (let index = 0; index < count; index++) {
    const angle = index * Math.PI * 2 / count
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    vertices.push({
      x: centerX + Math.sign(cosine) * Math.abs(cosine) ** power * radiusX,
      y: centerY + Math.sign(sine) * Math.abs(sine) ** power * radiusY
    })
  }
  return vertices
}

interface ShapePathContext {
  beginPath(): void
  closePath(): void
  lineTo(x: number, y: number): void
  moveTo(x: number, y: number): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
}

function distance(left: SelectionPoint, right: SelectionPoint) {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function pointTowards(origin: SelectionPoint, target: SelectionPoint, amount: number) {
  const length = distance(origin, target)
  if (length <= Number.EPSILON) return { ...origin }
  const ratio = Math.min(1, amount / length)
  return {
    x: origin.x + (target.x - origin.x) * ratio,
    y: origin.y + (target.y - origin.y) * ratio
  }
}

export function traceRoundedPolygon(
  context: ShapePathContext,
  vertices: readonly SelectionPoint[],
  radius: number
) {
  if (vertices.length < 3) return
  const normalizedRadius = Math.max(0, finite(radius, 0))
  const corners = vertices.map((vertex, index) => {
    const previous = vertices[(index - 1 + vertices.length) % vertices.length]!
    const next = vertices[(index + 1) % vertices.length]!
    const inset = Math.min(normalizedRadius, distance(vertex, previous) * 0.45, distance(vertex, next) * 0.45)
    return {
      vertex,
      incoming: pointTowards(vertex, previous, inset),
      outgoing: pointTowards(vertex, next, inset)
    }
  })
  context.beginPath()
  context.moveTo(corners[0]!.incoming.x, corners[0]!.incoming.y)
  for (const corner of corners) {
    if (normalizedRadius > 0) {
      context.quadraticCurveTo(corner.vertex.x, corner.vertex.y, corner.outgoing.x, corner.outgoing.y)
    } else {
      context.lineTo(corner.vertex.x, corner.vertex.y)
    }
    const next = corners[(corners.indexOf(corner) + 1) % corners.length]!
    context.lineTo(next.incoming.x, next.incoming.y)
  }
  context.closePath()
}

export function traceShapePath(
  context: ShapePathContext,
  geometry: ShapeGeometry,
  rawConfig: ShapeToolConfig
) {
  const config = normalizeShapeConfig(rawConfig)
  if (config.kind === 'ellipse') {
    traceRoundedPolygon(context, superellipseVertices(geometry, config.squareness), 0)
    return
  }
  if (config.kind === 'triangle') {
    traceRoundedPolygon(context, triangleVertices(geometry), config.cornerRadius)
    return
  }
  if (config.kind === 'star') {
    traceRoundedPolygon(
      context,
      starVertices(geometry, config.starPoints, config.starInnerRatio),
      config.cornerRadius
    )
    return
  }
  const radius = Math.min(config.cornerRadius, geometry.width / 2, geometry.height / 2)
  const vertices = [
    { x: geometry.x, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
    { x: geometry.x, y: geometry.y + geometry.height }
  ]
  traceRoundedPolygon(context, vertices, radius)
}

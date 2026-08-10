import type { DocumentPoint } from './freeTransform'
import type { LayerTransform } from '../types/editor'

export type GuideOrientation = 'horizontal' | 'vertical'
export type RulerUnit = 'px' | 'cm' | 'mm' | 'in'

export interface EditorGuide {
  id: string
  orientation: GuideOrientation
  position: number
}

export interface RulerOrigin {
  x: number
  y: number
}

export interface RulerTick {
  position: number
  value: number
  major: boolean
  label?: string
}

export interface SnapResult<T> {
  value: T
  snappedX?: number
  snappedY?: number
}

export const RULER_SIZE = 18

const NICE_STEPS = [1, 2, 5, 10]

export function screenPositionForDocument(position: number, documentOffset: number, scale: number) {
  return documentOffset + position * Math.max(0.0001, scale)
}

export function documentPositionFromScreen(position: number, documentOffset: number, scale: number) {
  return (position - documentOffset) / Math.max(0.0001, scale)
}

export function pixelsPerRulerUnit(unit: RulerUnit, resolutionDpi: number) {
  const dpi = Math.max(1, resolutionDpi || 72)
  if (unit === 'in') return dpi
  if (unit === 'cm') return dpi / 2.54
  if (unit === 'mm') return dpi / 25.4
  return 1
}

export function rulerUnitLabel(unit: RulerUnit) {
  return unit === 'in' ? 'pol' : unit
}

export function guideValue(
  guide: Pick<EditorGuide, 'orientation' | 'position'>,
  unit: RulerUnit,
  resolutionDpi: number,
  origin: RulerOrigin
) {
  const axisOrigin = guide.orientation === 'vertical' ? origin.x : origin.y
  return (guide.position - axisOrigin) / pixelsPerRulerUnit(unit, resolutionDpi)
}

export function formatGuideValue(
  guide: Pick<EditorGuide, 'orientation' | 'position'>,
  unit: RulerUnit,
  resolutionDpi: number,
  origin: RulerOrigin
) {
  const value = guideValue(guide, unit, resolutionDpi, origin)
  const fractionDigits = unit === 'px'
    ? Math.abs(value - Math.round(value)) < 1e-6 ? 0 : 2
    : unit === 'mm' ? 2 : 3
  return `${Number(value.toFixed(fractionDigits)).toLocaleString('pt-BR', {
    maximumFractionDigits: fractionDigits
  })} ${rulerUnitLabel(unit)}`
}

export function niceRulerStep(minimumUnits: number) {
  const safeMinimum = Math.max(Number.EPSILON, minimumUnits)
  const magnitude = 10 ** Math.floor(Math.log10(safeMinimum))
  const normalized = safeMinimum / magnitude
  const factor = NICE_STEPS.find((candidate) => candidate >= normalized) ?? 10
  return factor * magnitude
}

export function rulerStep(scale: number, unit: RulerUnit, resolutionDpi: number, minimumMajorPixels = 72) {
  const pixelsPerUnit = pixelsPerRulerUnit(unit, resolutionDpi)
  return niceRulerStep(minimumMajorPixels / (Math.max(0.0001, scale) * pixelsPerUnit))
}

function decimalsForStep(step: number) {
  if (step >= 1) return 0
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))))
}

export function formatRulerValue(value: number, step: number) {
  const rounded = Math.abs(value) < step / 1000 ? 0 : value
  return Number(rounded.toFixed(decimalsForStep(step))).toLocaleString('pt-BR', {
    maximumFractionDigits: decimalsForStep(step)
  })
}

export function rulerTicks(
  visibleStart: number,
  visibleEnd: number,
  scale: number,
  unit: RulerUnit,
  resolutionDpi: number,
  origin: number
) {
  const pixelsPerUnit = pixelsPerRulerUnit(unit, resolutionDpi)
  const majorStep = rulerStep(scale, unit, resolutionDpi)
  const subdivisions = majorStep * pixelsPerUnit * Math.max(0.0001, scale) >= 100 ? 10 : 5
  const minorStep = majorStep / subdivisions
  const startValue = (Math.min(visibleStart, visibleEnd) - origin) / pixelsPerUnit
  const endValue = (Math.max(visibleStart, visibleEnd) - origin) / pixelsPerUnit
  const firstIndex = Math.floor(startValue / minorStep) - 1
  const lastIndex = Math.ceil(endValue / minorStep) + 1
  const ticks: RulerTick[] = []

  for (let index = firstIndex; index <= lastIndex && ticks.length < 2000; index++) {
    const value = index * minorStep
    const majorIndex = Math.round(value / majorStep)
    const major = Math.abs(value - majorIndex * majorStep) <= minorStep / 100
    ticks.push({
      position: origin + value * pixelsPerUnit,
      value,
      major,
      label: major ? formatRulerValue(value, majorStep) : undefined
    })
  }
  return { majorStep, minorStep, ticks }
}

export function snapGuidePositionToTicks(
  position: number,
  scale: number,
  unit: RulerUnit,
  resolutionDpi: number,
  origin: number
) {
  const pixelsPerUnit = pixelsPerRulerUnit(unit, resolutionDpi)
  const majorStep = rulerStep(scale, unit, resolutionDpi)
  const subdivisions = majorStep * pixelsPerUnit * Math.max(0.0001, scale) >= 100 ? 10 : 5
  const minorDocumentStep = (majorStep / subdivisions) * pixelsPerUnit
  return origin + Math.round((position - origin) / minorDocumentStep) * minorDocumentStep
}

function nearestGuideSnap(
  candidates: readonly number[],
  guides: readonly EditorGuide[],
  orientation: GuideOrientation,
  threshold: number
) {
  let best: { delta: number; target: number } | undefined
  for (const guide of guides) {
    if (guide.orientation !== orientation) continue
    const target = guide.position
    for (const candidate of candidates) {
      const delta = target - candidate
      if (Math.abs(delta) > threshold || (best && Math.abs(best.delta) <= Math.abs(delta))) continue
      best = { delta, target }
    }
  }
  return best
}

export function transformedLayerBounds(transform: LayerTransform) {
  const angle = ((transform.rotation ?? 0) * Math.PI) / 180
  const cosine = Math.abs(Math.cos(angle))
  const sine = Math.abs(Math.sin(angle))
  const centerX = transform.x + transform.width / 2
  const centerY = transform.y + transform.height / 2
  const halfWidth = (cosine * transform.width + sine * transform.height) / 2
  const halfHeight = (sine * transform.width + cosine * transform.height) / 2
  return {
    x: centerX - halfWidth,
    y: centerY - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2
  }
}

export function snapLayerTranslation(
  transform: LayerTransform,
  guides: readonly EditorGuide[],
  scale: number,
  thresholdScreenPixels = 8
): SnapResult<LayerTransform> {
  const bounds = transformedLayerBounds(transform)
  const threshold = thresholdScreenPixels / Math.max(0.0001, scale)
  const horizontal = nearestGuideSnap(
    [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
    guides,
    'horizontal',
    threshold
  )
  const vertical = nearestGuideSnap(
    [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
    guides,
    'vertical',
    threshold
  )
  return {
    value: {
      ...transform,
      x: transform.x + (vertical?.delta ?? 0),
      y: transform.y + (horizontal?.delta ?? 0)
    },
    snappedX: vertical?.target,
    snappedY: horizontal?.target
  }
}

export function snapDocumentPoint(
  point: DocumentPoint,
  guides: readonly EditorGuide[],
  scale: number,
  thresholdScreenPixels = 8
): SnapResult<DocumentPoint> {
  const threshold = thresholdScreenPixels / Math.max(0.0001, scale)
  const vertical = nearestGuideSnap([point.x], guides, 'vertical', threshold)
  const horizontal = nearestGuideSnap([point.y], guides, 'horizontal', threshold)
  return {
    value: {
      x: point.x + (vertical?.delta ?? 0),
      y: point.y + (horizontal?.delta ?? 0)
    },
    snappedX: vertical?.target,
    snappedY: horizontal?.target
  }
}

export function snapBoundsTranslation(
  bounds: { x: number; y: number; width: number; height: number },
  deltaX: number,
  deltaY: number,
  guides: readonly EditorGuide[],
  scale: number,
  thresholdScreenPixels = 8
) {
  const moved = {
    ...bounds,
    x: bounds.x + deltaX,
    y: bounds.y + deltaY
  }
  const threshold = thresholdScreenPixels / Math.max(0.0001, scale)
  const vertical = nearestGuideSnap(
    [moved.x, moved.x + moved.width / 2, moved.x + moved.width],
    guides,
    'vertical',
    threshold
  )
  const horizontal = nearestGuideSnap(
    [moved.y, moved.y + moved.height / 2, moved.y + moved.height],
    guides,
    'horizontal',
    threshold
  )
  return {
    deltaX: deltaX + (vertical?.delta ?? 0),
    deltaY: deltaY + (horizontal?.delta ?? 0),
    snappedX: vertical?.target,
    snappedY: horizontal?.target
  }
}

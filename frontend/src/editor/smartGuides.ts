import { transformedLayerBounds, type EditorGuide, type GuideOrientation } from './guides.ts'
import type { DocumentSpec, LayerItem, LayerTransform } from '../types/editor.ts'

export type AlignmentTargetSource = 'manual-guide' | 'document' | 'layer'
export type AlignmentAnchor = 'start' | 'center' | 'end' | 'any'

export interface AlignmentTarget {
  axis: 'x' | 'y'
  anchor: AlignmentAnchor
  position: number
  priority: number
  source: AlignmentTargetSource
  sourceId?: string
}

export interface SmartAlignmentGuide {
  orientation: GuideOrientation
  position: number
  source: Exclude<AlignmentTargetSource, 'manual-guide'>
  sourceId?: string
}

export interface AlignmentTargetOptions {
  document: Pick<DocumentSpec, 'width' | 'height'>
  excludedLayerIds?: readonly string[]
  guides?: readonly EditorGuide[]
  includeDocument?: boolean
  includeLayers?: boolean
  layers?: readonly LayerItem[]
}

interface AxisSnap {
  delta: number
  target: AlignmentTarget
}

function axisTargets(start: number, size: number) {
  return [
    { anchor: 'start' as const, position: start },
    { anchor: 'center' as const, position: start + size / 2 },
    { anchor: 'end' as const, position: start + size }
  ]
}

export function createAlignmentTargets(options: AlignmentTargetOptions) {
  const targets: AlignmentTarget[] = []
  for (const guide of options.guides ?? []) {
    targets.push({
      axis: guide.orientation === 'vertical' ? 'x' : 'y',
      anchor: 'any',
      position: guide.position,
      priority: 0,
      source: 'manual-guide',
      sourceId: guide.id
    })
  }

  if (options.includeDocument !== false) {
    for (const target of axisTargets(0, options.document.width)) {
      targets.push({ axis: 'x', ...target, priority: 1, source: 'document' })
    }
    for (const target of axisTargets(0, options.document.height)) {
      targets.push({ axis: 'y', ...target, priority: 1, source: 'document' })
    }
  }

  if (options.includeLayers !== false) {
    const excluded = new Set(options.excludedLayerIds ?? [])
    for (const layer of options.layers ?? []) {
      if (!layer.visible || !layer.transform || excluded.has(layer.id)) continue
      const bounds = transformedLayerBounds(layer.transform)
      for (const target of axisTargets(bounds.x, bounds.width)) {
        targets.push({ axis: 'x', ...target, priority: 2, source: 'layer', sourceId: layer.id })
      }
      for (const target of axisTargets(bounds.y, bounds.height)) {
        targets.push({ axis: 'y', ...target, priority: 2, source: 'layer', sourceId: layer.id })
      }
    }
  }
  return targets
}

function nearestAxisSnap(
  candidates: ReturnType<typeof axisTargets>,
  targets: readonly AlignmentTarget[],
  axis: 'x' | 'y',
  threshold: number
) {
  let best: AxisSnap | undefined
  for (const target of targets) {
    if (target.axis !== axis) continue
    for (const candidate of candidates) {
      if (
        target.anchor !== 'any' &&
        ((target.anchor === 'center') !== (candidate.anchor === 'center'))
      ) continue
      const delta = target.position - candidate.position
      const distance = Math.abs(delta)
      if (distance > threshold) continue
      if (
        best &&
        (Math.abs(best.delta) < distance ||
          (Math.abs(best.delta) === distance && best.target.priority <= target.priority))
      ) continue
      best = { delta, target }
    }
  }
  return best
}

export function snapTransformToAlignmentTargets(
  transform: LayerTransform,
  targets: readonly AlignmentTarget[],
  scale: number,
  thresholdScreenPixels = 4,
  maximumDocumentPixels = 12
) {
  const bounds = transformedLayerBounds(transform)
  const threshold = Math.min(
    thresholdScreenPixels / Math.max(0.0001, scale),
    maximumDocumentPixels
  )
  const xSnap = nearestAxisSnap(
    axisTargets(bounds.x, bounds.width),
    targets,
    'x',
    threshold
  )
  const ySnap = nearestAxisSnap(
    axisTargets(bounds.y, bounds.height),
    targets,
    'y',
    threshold
  )
  const lines: SmartAlignmentGuide[] = []
  for (const snap of [xSnap, ySnap]) {
    if (!snap || snap.target.source === 'manual-guide') continue
    lines.push({
      orientation: snap.target.axis === 'x' ? 'vertical' : 'horizontal',
      position: snap.target.position,
      source: snap.target.source,
      sourceId: snap.target.sourceId
    })
  }
  return {
    value: {
      ...transform,
      x: transform.x + (xSnap?.delta ?? 0),
      y: transform.y + (ySnap?.delta ?? 0)
    },
    snappedX: xSnap?.target.position,
    snappedY: ySnap?.target.position,
    lines
  }
}

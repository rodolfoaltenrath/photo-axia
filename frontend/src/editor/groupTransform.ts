import { normalizeRotation, rotateVector, transformCenter } from './freeTransform.ts'
import { transformedLayerBounds } from './guides.ts'
import type { LayerTransform } from '../types/editor.ts'

export function groupBoundsFromRects(rects: LayerTransform[]): LayerTransform {
  if (rects.length === 1) return { ...rects[0]! }
  const boxes = rects.map((rect) => transformedLayerBounds(rect))
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 }
}

// All three apply* functions take the state at the START OF THE CURRENT
// pointer interaction (not the free-transform session's original state), so
// chaining move/resize/rotate within one Ctrl+T session (drag a handle,
// release, drag another) builds on the previous interaction's result instead
// of discarding it.
export function applyGroupMove(
  layerIds: string[],
  memberStarts: Record<string, LayerTransform>,
  groupStart: LayerTransform,
  groupDraft: LayerTransform
) {
  const dx = groupDraft.x - groupStart.x
  const dy = groupDraft.y - groupStart.y
  const drafts: Record<string, LayerTransform> = {}
  for (const layerId of layerIds) {
    const start = memberStarts[layerId]
    if (!start) continue
    drafts[layerId] = {
      ...start,
      x: Math.round((start.x + dx) * 100) / 100,
      y: Math.round((start.y + dy) * 100) / 100
    }
  }
  return drafts
}

export function applyGroupResize(
  layerIds: string[],
  memberStarts: Record<string, LayerTransform>,
  groupStart: LayerTransform,
  groupDraft: LayerTransform
) {
  if (layerIds.length === 1) return { [layerIds[0]!]: groupDraft }
  const rotation = groupStart.rotation ?? 0
  const rotationRad = (rotation * Math.PI) / 180
  const groupCenter = transformCenter(groupStart)
  const draftCenter = transformCenter(groupDraft)
  const scaleX = groupStart.width === 0 ? 1 : groupDraft.width / groupStart.width
  const scaleY = groupStart.height === 0 ? 1 : groupDraft.height / groupStart.height
  const drafts: Record<string, LayerTransform> = {}
  for (const layerId of layerIds) {
    const start = memberStarts[layerId]
    if (!start) continue
    const memberCenter = transformCenter(start)
    const localOffset = rotateVector(
      { x: memberCenter.x - groupCenter.x, y: memberCenter.y - groupCenter.y },
      -rotationRad
    )
    const scaledOffset = { x: localOffset.x * scaleX, y: localOffset.y * scaleY }
    const worldOffset = rotateVector(scaledOffset, rotationRad)
    const width = start.width * scaleX
    const height = start.height * scaleY
    drafts[layerId] = {
      x: Math.round((draftCenter.x + worldOffset.x - width / 2) * 100) / 100,
      y: Math.round((draftCenter.y + worldOffset.y - height / 2) * 100) / 100,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
      rotation: start.rotation ?? 0
    }
  }
  return drafts
}

export function applyGroupRotate(
  layerIds: string[],
  memberStarts: Record<string, LayerTransform>,
  groupStart: LayerTransform,
  groupDraft: LayerTransform
) {
  if (layerIds.length === 1) return { [layerIds[0]!]: groupDraft }
  const center = transformCenter(groupStart)
  const deltaDeg = (groupDraft.rotation ?? 0) - (groupStart.rotation ?? 0)
  const deltaRad = (deltaDeg * Math.PI) / 180
  const drafts: Record<string, LayerTransform> = {}
  for (const layerId of layerIds) {
    const start = memberStarts[layerId]
    if (!start) continue
    const memberCenter = transformCenter(start)
    const relative = { x: memberCenter.x - center.x, y: memberCenter.y - center.y }
    const rotated = rotateVector(relative, deltaRad)
    const nextCenter = { x: center.x + rotated.x, y: center.y + rotated.y }
    drafts[layerId] = {
      x: Math.round((nextCenter.x - start.width / 2) * 100) / 100,
      y: Math.round((nextCenter.y - start.height / 2) * 100) / 100,
      width: start.width,
      height: start.height,
      rotation: normalizeRotation((start.rotation ?? 0) + deltaDeg)
    }
  }
  return drafts
}

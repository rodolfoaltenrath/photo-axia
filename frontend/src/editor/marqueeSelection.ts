import {
  clampSelectionToBounds,
  createShapeSelection,
  selectionIsEmpty,
  type EllipseSelection,
  type RectangleSelection,
  type SelectionBounds,
  type SelectionPoint
} from './selection.ts'

export const MARQUEE_SELECTION_MODES = [
  'rectangle',
  'ellipse',
  'single-row',
  'single-column'
] as const

const VISIBLE_MARQUEE_SELECTION_MODES = ['rectangle', 'ellipse'] as const

export type MarqueeSelectionMode = (typeof MARQUEE_SELECTION_MODES)[number]
export type MarqueeSelection = RectangleSelection | EllipseSelection

export interface MarqueeDocumentSize {
  width: number
  height: number
}

export function isMarqueeSelectionMode(mode: string): mode is MarqueeSelectionMode {
  return (MARQUEE_SELECTION_MODES as readonly string[]).includes(mode)
}

export function nextMarqueeSelectionMode(mode: MarqueeSelectionMode): MarqueeSelectionMode {
  const index = VISIBLE_MARQUEE_SELECTION_MODES.indexOf(mode as 'rectangle' | 'ellipse')
  return index === 0 ? 'ellipse' : 'rectangle'
}

function documentBounds(document: MarqueeDocumentSize): SelectionBounds | null {
  if (!Number.isFinite(document.width) || !Number.isFinite(document.height)) return null
  const width = Math.floor(document.width)
  const height = Math.floor(document.height)
  return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null
}

function singlePixelMarquee(
  mode: 'single-row' | 'single-column',
  point: SelectionPoint,
  bounds: SelectionBounds
): RectangleSelection | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  const x = Math.floor(point.x)
  const y = Math.floor(point.y)
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return null

  return mode === 'single-row'
    ? { kind: 'rectangle', bounds: { x: 0, y, width: bounds.width, height: 1 } }
    : { kind: 'rectangle', bounds: { x, y: 0, width: 1, height: bounds.height } }
}

export function createMarqueeSelection(
  mode: MarqueeSelectionMode,
  start: SelectionPoint,
  end: SelectionPoint,
  document: MarqueeDocumentSize,
  constrainProportions = false
): MarqueeSelection | null {
  const bounds = documentBounds(document)
  if (!bounds) return null
  if (mode === 'single-row' || mode === 'single-column') {
    return singlePixelMarquee(mode, start, bounds)
  }
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null

  const selection = clampSelectionToBounds(
    createShapeSelection(mode, start, end, constrainProportions),
    bounds
  ) as MarqueeSelection
  return selectionIsEmpty(selection) ? null : selection
}

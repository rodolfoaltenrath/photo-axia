import type { BrushOperation } from '../../editor/brush'
import type { GradientGeometry, GradientStopsConfig } from '../../editor/gradient'
import type { DocumentPoint, TransformHandle } from '../../editor/freeTransform'
import type { EditorGuide, GuideOrientation, RulerOrigin, RulerUnit } from '../../editor/guides'
import type { SelectionMode, SelectionPoint, SelectionRegion } from '../../editor/selection'
import type { SelectionCombineMode } from '../../editor/selectionCombine'
import type { SmartAlignmentGuide } from '../../editor/smartGuides'
import type {
  DocumentSpec,
  EditorTool,
  ImageAsset,
  ImportedImage,
  LayerItem,
  LayerStyleGlobalLight,
  LayerTransform
} from '../../types/editor'

export interface SelectionMoveAnchor {
  layerId: string
  image: ImageAsset
  transform: LayerTransform
  selection: SelectionRegion
  deltaX: number
  deltaY: number
}

export interface CanvasViewportProps {
  activeLayerId: string
  selectedLayerIds: string[]
  activeTool: EditorTool
  autoSelectLayer: boolean
  brushColor: string
  brushSize: number
  foregroundColor: string
  backgroundColor: string
  gradientConfig: GradientStopsConfig
  document: DocumentSpec
  guides: EditorGuide[]
  guidesLocked: boolean
  guidesVisible: boolean
  guideSnappingEnabled: boolean
  smartGuidesEnabled: boolean
  isBusy: boolean
  layers: LayerItem[]
  magicWandContiguous: boolean
  magicWandTolerance: number
  paintBucketContiguous: boolean
  paintBucketTolerance: number
  selection: SelectionRegion | null
  selectionCombineMode: SelectionCombineMode
  selectionMoveAnchor: SelectionMoveAnchor | null
  selectionMode: SelectionMode
  rulerOrigin: RulerOrigin
  rulerUnit: RulerUnit
  rulersVisible: boolean
  zoom: number
}

export interface CanvasViewportEmits {
  (event: 'update:zoom', zoom: number): void
  (event: 'createText', point: DocumentPoint): void
  (event: 'createGuide', guide: EditorGuide): void
  (event: 'deleteGuide', guideId: string): void
  (event: 'imagesDropped', images: ImportedImage[], errors: string[]): void
  (event: 'pdfDropped', file: File, errors: string[]): void
  (event: 'sampleColor', point: DocumentPoint, target: 'foreground' | 'background'): void
  (event: 'deleteSelection'): void
  (event: 'magicWandSelect', point: SelectionPoint): void
  (
    event: 'moveSelection',
    originalSelection: SelectionRegion,
    movedSelection: SelectionRegion,
    deltaX: number,
    deltaY: number,
    previewScaleX: number,
    previewScaleY: number
  ): void
  (
    event: 'paintStroke',
    points: SelectionPoint[],
    size: number,
    color: string,
    operation: BrushOperation,
    selection: SelectionRegion | null,
    previewWidth: number,
    previewHeight: number
  ): void
  (
    event: 'gradientGesture',
    geometry: GradientGeometry,
    config: GradientStopsConfig,
    selection: SelectionRegion | null
  ): void
  (event: 'paintBucket', point: SelectionPoint, color: string, selection: SelectionRegion | null): void
  (event: 'selectLayer', layerId: string): void
  (event: 'updateGuide', guide: EditorGuide): void
  (event: 'moveLayers', updates: Array<{ layerId: string; transform: LayerTransform }>): void
  (event: 'updateTransform', layerId: string, transform: LayerTransform): void
  (event: 'update:autoSelectLayer', enabled: boolean): void
  (event: 'update:brushColor', color: string): void
  (event: 'update:brushSize', size: number): void
  (event: 'update:magicWandContiguous', enabled: boolean): void
  (event: 'update:magicWandTolerance', tolerance: number): void
  (event: 'update:paintBucketContiguous', enabled: boolean): void
  (event: 'update:paintBucketTolerance', tolerance: number): void
  (event: 'update:gradientConfig', config: GradientStopsConfig): void
  (event: 'update:guidesLocked', enabled: boolean): void
  (event: 'update:guidesVisible', enabled: boolean): void
  (event: 'update:guideSnappingEnabled', enabled: boolean): void
  (event: 'update:smartGuidesEnabled', enabled: boolean): void
  (event: 'update:rulerOrigin', origin: RulerOrigin): void
  (event: 'update:rulerUnit', unit: RulerUnit): void
  (event: 'update:rulersVisible', enabled: boolean): void
  (event: 'update:selection', selection: SelectionRegion | null): void
  (event: 'update:selectionCombineMode', mode: SelectionCombineMode): void
  (event: 'update:selectionMode', mode: SelectionMode): void
  (event: 'clearGuides'): void
}

export interface CanvasSurfaceView {
  activeBrushOperation?: BrushOperation
  activeLayerId: string
  backgroundStyle: CSSProperties
  brushPreviewDimensions: { width: number; height: number }
  brushPreviewStyle?: CSSProperties
  gradientInteraction: GradientInteraction | null
  gradientPreviewDimensions: { width: number; height: number }
  gradientPreviewStyle?: CSSProperties
  defaultLayerTransform: LayerTransform
  documentHeight: number
  documentOffsetX: number
  documentOffsetY: number
  documentResolutionDpi: number
  documentWidth: number
  draftGuide: EditorGuide | null
  frameStyle: CSSProperties
  freeTransformStyle?: CSSProperties
  guides: EditorGuide[]
  guidesInteractive: boolean
  guidesVisible: boolean
  layers: LayerItem[]
  layerStyleGlobalLight: LayerStyleGlobalLight
  origin: RulerOrigin
  paintableLayerId?: string
  pasteboardStyle: CSSProperties
  rulerUnit: RulerUnit
  rulersVisible: boolean
  scale: number
  selection: SelectionRegion | null
  selectedGuideId: string | null
  selectionMoveInteraction: SelectionMoveInteraction | null
  selectionMovePreviewStyle?: CSSProperties
  smartGuides: SmartAlignmentGuide[]
  snappedX?: number
  snappedY?: number
  surfaceStyle: CSSProperties
  viewportCursorClass: Record<string, boolean>
  viewportHeight: number
  viewportWidth: number
}

export interface CanvasSurfaceActions {
  brushPreviewHidesLayer: (layerId: string) => boolean
  gradientPreviewHidesLayer: (layerId: string) => boolean
  captureBrushPreviewCanvas: (element: unknown) => void
  captureGradientPreviewCanvas: (element: unknown) => void
  captureCanvasRulers: (element: unknown) => void
  captureFreeTransformBox: (element: unknown) => void
  captureGuideOverlay: (element: unknown) => void
  captureScrollArea: (element: unknown) => void
  captureSelectionMoveCanvas: (element: unknown) => void
  captureSurface: (element: unknown) => void
  clearRulerPointer: () => void
  commitFreeTransform: () => void
  displayTransform: (layer: LayerItem) => LayerTransform | undefined
  handleLayerImageError: (layerId: string, source: string) => void
  handleLayerImageLoaded: (layerId: string, source: string) => void
  handleLostPointerCapture: (event: PointerEvent) => void
  handleNativeScroll: () => void
  resetRulerOrigin: () => void
  selectionMoveHidesLayer: (layerId: string) => boolean
  startGuideCreation: (orientation: GuideOrientation, event: PointerEvent) => void
  startGuideMove: (guide: EditorGuide, event: PointerEvent) => void
  startLayerPointer: (event: PointerEvent, layer: LayerItem) => void
  startRulerOrigin: (event: PointerEvent) => void
  startTransformMove: (event: PointerEvent) => void
  startTransformResize: (event: PointerEvent, handle: TransformHandle) => void
  startTransformRotate: (event: PointerEvent) => void
  startViewportPointer: (event: PointerEvent) => void
  stopPointer: (event: PointerEvent) => void
  updatePointer: (event: PointerEvent) => void
}

export interface LayerReadyWaiter {
  remaining: Map<string, string>
  resolve: () => void
  timeout: ReturnType<typeof setTimeout>
}

export interface GuideInteraction {
  pointerId: number
  pointerTarget: Element | null
  guide: EditorGuide
  initialGuide: EditorGuide | null
  initialOrientation: GuideOrientation
}

export interface OriginInteraction {
  pointerId: number
  draft: RulerOrigin
}

export interface LayerDragSession {
  pointerId: number
  startX: number
  startY: number
  groupTransform: LayerTransform
  members: TransformSessionMember[]
  previews: Record<string, LayerTransform>
}

export interface TransformSessionMember {
  layerId: string
  original: LayerTransform
  target: HTMLElement
}

export interface TransformSession {
  members: TransformSessionMember[]
  groupDraft: LayerTransform
  drafts: Record<string, LayerTransform>
}

export interface KeyboardLayerMoveSession {
  members: TransformSessionMember[]
  drafts: Record<string, LayerTransform>
}

interface TransformInteractionBase {
  pointerId: number
  initial: LayerTransform
  // Snapshot of the group box and each member's transform at the moment this
  // specific drag started, so applying the drag never discards whatever an
  // earlier interaction in the same Ctrl+T session already did.
  groupStart: LayerTransform
  memberStarts: Record<string, LayerTransform>
}

export type TransformInteraction =
  | (TransformInteractionBase & { type: 'move'; start: DocumentPoint })
  | (TransformInteractionBase & { type: 'resize'; handle: TransformHandle })
  | (TransformInteractionBase & { type: 'rotate'; startAngle: number })

export interface SelectionInteraction {
  pointerId: number
  mode: Exclude<SelectionMode, 'magic-wand'>
  start: SelectionPoint
  points: SelectionPoint[]
  parentSelection: SelectionRegion | null
  combineMode: SelectionCombineMode
}

export interface BrushInteraction {
  pointerId: number
  layerId: string
  operation: BrushOperation
  points: SelectionPoint[]
  renderedPointCount: number
  selection: SelectionRegion | null
  selectionPath: Path2D | null
  baseImageSource: string
  previewWidth: number
  previewHeight: number
}

export interface GradientInteraction {
  pointerId: number
  layerId: string
  geometry: GradientGeometry
  config: GradientStopsConfig
  selection: SelectionRegion | null
}

export interface SelectionMoveInteraction {
  pointerId: number
  layerId: string
  start: SelectionPoint
  deltaX: number
  deltaY: number
  originalSelection: SelectionRegion
  baseImageSource: string
  previewImageSource: string
  previewSelection: SelectionRegion
  previewBaseDeltaX: number
  previewBaseDeltaY: number
  previewWidth: number
  previewHeight: number
  previewX: number
  previewY: number
  previewDocumentWidth: number
  previewDocumentHeight: number
  transform: LayerTransform
  baseCanvas?: HTMLCanvasElement
  contentCanvas?: HTMLCanvasElement
}

export type PendingNavigation =
  | { type: 'anchor'; viewportX: number; viewportY: number; documentX: number; documentY: number }
  | { type: 'center' }
import type { CSSProperties } from 'vue'

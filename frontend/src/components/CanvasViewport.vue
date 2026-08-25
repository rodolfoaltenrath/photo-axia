<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import CanvasContextBar from './canvas/CanvasContextBar.vue'
import CanvasSurface from './canvas/CanvasSurface.vue'
import type { LayerItem, LayerTransform } from '../types/editor'
import type {
  CanvasSurfaceActions,
  CanvasSurfaceView,
  CanvasViewportEmits,
  CanvasViewportProps
} from './canvas/canvas.types'
import { useCanvasNavigation } from './canvas/composables/useCanvasNavigation'
import {
  useCanvasGuides,
  type CanvasRulersApi,
  type GuideOverlayApi
} from './canvas/composables/useCanvasGuides'
import {
  isEditableShortcutTarget,
  useCanvasShortcuts
} from './canvas/composables/useCanvasShortcuts'
import { useFreeTransform } from './canvas/composables/useFreeTransform'
import { useSelectionInteraction } from './canvas/composables/useSelectionInteraction'
import { useSelectionMove } from './canvas/composables/useSelectionMove'
import { useBrushInteraction } from './canvas/composables/useBrushInteraction'
import { useGradientInteraction } from './canvas/composables/useGradientInteraction'
import { useLayerImageReadiness } from './canvas/composables/useLayerImageHandoff'
import { readBrowserImages } from '../services/imageImport'
import type { DocumentPoint } from '../editor/freeTransform'
import {
  documentPositionFromScreen,
  snapDocumentPoint,
  snapLayerTranslation,
  transformedLayerBounds
} from '../editor/guides'
import {
  selectionIsEmpty
} from '../editor/selection'
import { layerStyleFillOpacity } from '../editor/layerStyles'
import {
  colorSampleButtonIsPressed,
  colorSampleTarget,
  sampledDocumentPixel,
  type ColorSampleTarget
} from '../editor/colorSampler'

const props = defineProps<CanvasViewportProps>()
const emit = defineEmits<CanvasViewportEmits>()

const scrollArea = ref<HTMLDivElement | null>(null)
const surface = ref<HTMLDivElement | null>(null)
const canvasRulers = ref<CanvasRulersApi | null>(null)
const guideOverlay = ref<GuideOverlayApi | null>(null)
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0, pointerId: -1 })
let interactionFrame = 0
let pendingInteractionFrame: (() => void) | undefined
let colorSampleFrame = 0
let pendingColorSample: { point: DocumentPoint; target: ColorSampleTarget } | undefined
let colorSamplePointer: {
  pointerId: number
  target: ColorSampleTarget
  lastPoint: DocumentPoint
} | undefined
const {
  documentViewportOffset,
  fitDocument,
  frameStyle,
  handleNativeScroll,
  handleWheel,
  isNativeScrolling,
  isViewportReady,
  pasteboardStyle,
  requestZoom,
  scale,
  scaledDocumentSize,
  surfaceStyle,
  syncViewportScroll,
  viewportSize,
  visualZoom,
  zoomByStep,
  zoomIn,
  zoomOut
} = useCanvasNavigation({
  scrollArea,
  document: () => props.document,
  zoom: () => props.zoom,
  emitZoom: (zoom) => emit('update:zoom', zoom),
  scheduleInteractionFrame,
  onViewportOffsetChange: (offset) => {
    canvasRulers.value?.updateViewportOffsets(offset.x, offset.y)
    guideOverlay.value?.updateViewportOffsets(offset.x, offset.y)
  }
})

const {
  activeDisplayTransform,
  cancelFreeTransform,
  cancelPointerInteractions,
  commitFreeTransform,
  commitKeyboardLayerMove,
  displayTransform,
  freeTransformBox,
  freeTransformStyle,
  isTransforming,
  nudgeActiveLayer,
  startFreeTransform,
  startLayerDrag,
  startTransformMove,
  startTransformResize,
  startTransformRotate,
  stopTransformPointer,
  transformRotationOutput,
  updateTransformPointer
} = useFreeTransform({
  activeLayer: () => activeLayer.value,
  activeLayerId: () => props.activeLayerId,
  selectedLayerIds: () => props.selectedLayerIds,
  layers: () => props.layers,
  activeTool: () => props.activeTool,
  isBusy: () => props.isBusy,
  modifierKeys: () => modifierKeys.value,
  scale: () => scale.value,
  autoSelectLayer: () => props.autoSelectLayer,
  scrollArea,
  surface,
  documentPointFromClient,
  snapPoint: snapPointForInteraction,
  snapTransform: snapTransformForInteraction,
  scheduleInteractionFrame,
  flushInteractionFrame,
  discardInteractionFrame,
  selectLayer: (layerId) => emit('selectLayer', layerId),
  updateTransform: (layerId, transform) => emit('updateTransform', layerId, transform)
})

const {
  cancelSelection,
  cancelSelectionPointer,
  hasSelectionPointer,
  selectionDraft,
  startSelectionPointer,
  stopSelectionPointer,
  updateSelectionWithDocumentPoint,
  visibleSelection
} = useSelectionInteraction({
  activeTool: () => props.activeTool,
  activeLayerTransform: () => activeLayer.value?.transform,
  document: () => props.document,
  scale: () => scale.value,
  selection: () => props.selection,
  selectionCombineMode: () => props.selectionCombineMode,
  selectionMode: () => props.selectionMode,
  scrollArea,
  snapPoint: snapPointForInteraction,
  scheduleInteractionFrame,
  discardInteractionFrame,
  magicWandSelect: (point) => emit('magicWandSelect', point),
  updateSelection: (selection) => emit('update:selection', selection)
})

const {
  cancelInteraction: cancelGuideInteraction,
  clearRulerPointer,
  clearSelectedGuide,
  deleteSelectedGuide,
  displayedRulerOrigin,
  draftGuide,
  resetRulerOrigin,
  resetTransientInteractions: resetGuideInteractions,
  selectedGuideId,
  setSnappedGuides,
  snappedGuides,
  startGuideCreation,
  startGuideMove,
  startRulerOrigin,
  updateRulerPointer
} = useCanvasGuides({
  canvasRulers,
  activeTool: () => props.activeTool,
  document: () => props.document,
  guideIds: () => props.guides.map((guide) => guide.id),
  guideSnappingEnabled: () => props.guideSnappingEnabled,
  guidesLocked: () => props.guidesLocked,
  rulersVisible: () => props.rulersVisible,
  rulerOrigin: () => props.rulerOrigin,
  rulerUnit: () => props.rulerUnit,
  scale: () => scale.value,
  activeSnapTransform: () => activeLayer.value?.visible ? activeDisplayTransform.value : undefined,
  documentPointFromClient,
  scheduleInteractionFrame,
  flushInteractionFrame,
  createGuide: (guide) => emit('createGuide', guide),
  updateGuide: (guide) => emit('updateGuide', guide),
  deleteGuide: (guideId) => emit('deleteGuide', guideId),
  updateGuidesVisible: (visible) => emit('update:guidesVisible', visible),
  updateRulerOrigin: (origin) => emit('update:rulerOrigin', origin)
})

function layerIntersectsDocument(layer: LayerItem) {
  if (layer.id === props.activeLayerId || !layer.transform) return true
  const bounds = transformedLayerBounds(layer.transform)
  return (
    bounds.x < props.document.width &&
    bounds.y < props.document.height &&
    bounds.x + bounds.width > 0 &&
    bounds.y + bounds.height > 0
  )
}

const renderedLayers = computed(() => [...props.layers].reverse().filter((layer) =>
  (layer.kind !== 'background' || Boolean(layer.image)) && layer.visible && layerIntersectsDocument(layer)
))
const defaultLayerTransform = computed<LayerTransform>(() => ({
  x: 0,
  y: 0,
  width: props.document.width,
  height: props.document.height,
  rotation: 0
}))
const backgroundLayer = computed(() => props.layers.find((layer) => layer.kind === 'background'))
const backgroundStyle = computed(() => {
  const background = backgroundLayer.value
  if (!background?.visible || background.image || props.document.background === 'transparent') return { display: 'none' }

  return {
    background: props.document.background === 'black' ? '#000000' : '#ffffff',
    opacity: (background.opacity / 100) * layerStyleFillOpacity(background.styles)
  }
})
const activeLayer = computed(() => props.layers.find((layer) => layer.id === props.activeLayerId))
const paintableLayer = computed(() => {
  const layer = activeLayer.value
  if (
    !layer?.visible ||
    (layer.kind !== 'image' && layer.kind !== 'background' && layer.kind !== 'pixel') ||
    !layer.image ||
    !layer.transform
  ) return undefined
  return layer
})

const {
  activeBrushOperation,
  brushPreviewDimensions,
  brushPreviewHidesLayer,
  brushPreviewStyle,
  cancelBrush,
  captureBrushPreviewCanvas,
  clearBrushPreview,
  hasBrushPointer,
  notifyLayerImageError: notifyBrushImageError,
  notifyLayerImageLoaded: notifyBrushImageLoaded,
  startBrushPointer,
  stopBrushPointer,
  updateBrushPointer
} = useBrushInteraction({
  activeDisplayTransform: () => activeDisplayTransform.value,
  activeTool: () => props.activeTool,
  brushColor: () => props.brushColor,
  brushSize: () => props.brushSize,
  document: () => props.document,
  isBusy: () => props.isBusy,
  paintableLayer: () => paintableLayer.value,
  scale: () => scale.value,
  selection: () => props.selection,
  scrollArea,
  surface,
  documentPointFromPointer: pointerToDocument,
  scheduleInteractionFrame,
  discardInteractionFrame,
  paintStroke: (points, size, color, operation, selection, previewWidth, previewHeight) => {
    emit('paintStroke', points, size, color, operation, selection, previewWidth, previewHeight)
  }
})

const {
  cancelGradient,
  captureGradientPreviewCanvas,
  gradientInteraction,
  gradientPreviewDimensions,
  gradientPreviewStyle,
  hasGradientPointer,
  notifyLayerImageError: notifyGradientImageError,
  notifyLayerImageLoaded: notifyGradientImageLoaded,
  startGradientPointer,
  stopGradientPointer,
  updateGradientPointer
} = useGradientInteraction({
  activeTool: () => props.activeTool,
  config: () => ({
    type: props.gradientType,
    foregroundColor: props.foregroundColor,
    backgroundColor: props.backgroundColor,
    reversed: props.gradientReversed
  }),
  document: () => props.document,
  isBusy: () => props.isBusy,
  paintableLayer: () => paintableLayer.value,
  scale: () => scale.value,
  selection: () => props.selection,
  scrollArea,
  documentPointFromPointer: pointerToDocument,
  scheduleInteractionFrame,
  discardInteractionFrame,
  confirm: (geometry, config, selection) => emit('gradientGesture', geometry, config, selection)
})

const {
  cancelSelectionMove,
  captureSelectionMoveCanvas,
  commitKeyboardSelectionMove,
  handleKeyboardSelectionNudge,
  hasSelectionMovePointer,
  notifyLayerImageError: notifySelectionMoveImageError,
  notifyLayerImageLoaded: notifySelectionMoveImageLoaded,
  selectionMoveHidesLayer,
  selectionMoveInteraction,
  selectionMovePreviewStyle,
  shouldKeepPointerCapture: shouldKeepSelectionMovePointerCapture,
  startSelectionMove,
  stopSelectionMovePointer,
  updateSelectionMovePointer
} = useSelectionMove({
  activeTool: () => props.activeTool,
  document: () => props.document,
  guideSnappingEnabled: () => props.guideSnappingEnabled,
  guides: () => props.guides,
  guidesVisible: () => props.guidesVisible,
  isBusy: () => props.isBusy,
  paintableLayer: () => paintableLayer.value,
  scale: () => scale.value,
  selectionMoveAnchor: () => props.selectionMoveAnchor,
  scrollArea,
  surface,
  selectionDraft,
  scheduleInteractionFrame,
  discardInteractionFrame,
  setSnappedGuides,
  onWindowPointerMove: updatePointer,
  onWindowPointerStop: stopPointer,
  moveSelection: (original, moved, deltaX, deltaY, previewScaleX, previewScaleY) => {
    emit('moveSelection', original, moved, deltaX, deltaY, previewScaleX, previewScaleY)
  }
})

const {
  handleLayerImageError,
  handleLayerImageLoaded,
  waitForLayerImages
} = useLayerImageReadiness({
  notifyImageLoaded: [notifySelectionMoveImageLoaded, notifyBrushImageLoaded, notifyGradientImageLoaded],
  notifyImageError: [notifySelectionMoveImageError, notifyBrushImageError, notifyGradientImageError]
})

const {
  handleCanvasKeydown,
  isSpacePressed,
  modifierKeys
} = useCanvasShortcuts({
  scrollArea,
  handleArrowNudge: handleKeyboardNudge,
  commitKeyboardNudge,
  cancelGuideInteraction,
  deleteSelectedGuide,
  deleteSelection: () => {
    if (!props.selection) return false
    emit('deleteSelection')
    return true
  },
  isTransforming: () => isTransforming.value,
  cancelTransform: cancelFreeTransform,
  commitTransform: commitFreeTransform,
  cancelBrush,
  cancelGradient,
  cancelSelectionMove,
  cancelSelection,
  clearSelection: () => emit('update:selection', null),
  selectAll: () => emit('update:selection', {
    kind: 'rectangle',
    bounds: { x: 0, y: 0, width: props.document.width, height: props.document.height }
  }),
  startTransform: startFreeTransform,
  fitDocument,
  requestZoom,
  zoomByStep,
  resetTransientInteractions: resetGuideInteractions
})
const viewportCursorClass = computed(() => ({
  'canvas-scroll--ready': isViewportReady.value,
  'canvas-scroll--panning': isPanning.value,
  'canvas-scroll--scrolling': isNativeScrolling.value,
  'canvas-scroll--text': props.activeTool === 'text',
  'canvas-scroll--selection':
    props.activeTool === 'crop' || props.activeTool === 'brush' || props.activeTool === 'eraser' ||
    props.activeTool === 'gradient' || props.activeTool === 'paint-bucket',
  'canvas-scroll--eyedropper': props.activeTool === 'eyedropper',
  'canvas-scroll--pan-ready':
    props.activeTool === 'hand' || (isSpacePressed.value && !modifierKeys.value.command && !modifierKeys.value.alt),
  'canvas-scroll--zoom-in':
    (props.activeTool === 'zoom' && !modifierKeys.value.alt) ||
    (isSpacePressed.value && modifierKeys.value.command),
  'canvas-scroll--zoom-out':
    (props.activeTool === 'zoom' && modifierKeys.value.alt) ||
    (isSpacePressed.value && modifierKeys.value.alt)
}))

const canvasSurfaceView = computed<CanvasSurfaceView>(() => ({
  activeBrushOperation: activeBrushOperation.value,
  activeLayerId: props.activeLayerId,
  backgroundStyle: backgroundStyle.value,
  brushPreviewDimensions: brushPreviewDimensions.value,
  brushPreviewStyle: brushPreviewStyle.value,
  gradientInteraction: gradientInteraction.value,
  gradientPreviewDimensions: gradientPreviewDimensions.value,
  gradientPreviewStyle: gradientPreviewStyle.value,
  defaultLayerTransform: defaultLayerTransform.value,
  documentHeight: props.document.height,
  documentOffsetX: documentViewportOffset.value.x,
  documentOffsetY: documentViewportOffset.value.y,
  documentResolutionDpi: props.document.resolutionDpi,
  documentWidth: props.document.width,
  draftGuide: draftGuide.value,
  frameStyle: frameStyle.value,
  freeTransformStyle: freeTransformStyle.value,
  guides: props.guides,
  guidesInteractive: props.activeTool === 'move' && !props.guidesLocked,
  guidesVisible: props.guidesVisible,
  layers: renderedLayers.value,
  layerStyleGlobalLight: props.document.layerStyleGlobalLight,
  origin: displayedRulerOrigin.value,
  paintableLayerId: paintableLayer.value?.id,
  pasteboardStyle: pasteboardStyle.value,
  rulerUnit: props.rulerUnit,
  rulersVisible: props.rulersVisible,
  scale: scale.value,
  selection: visibleSelection.value,
  selectedGuideId: selectedGuideId.value,
  selectionMoveInteraction: selectionMoveInteraction.value,
  selectionMovePreviewStyle: selectionMovePreviewStyle.value,
  snappedX: snappedGuides.value.x,
  snappedY: snappedGuides.value.y,
  surfaceStyle: surfaceStyle.value,
  viewportCursorClass: viewportCursorClass.value,
  viewportHeight: viewportSize.value.height,
  viewportWidth: viewportSize.value.width
}))

const canvasSurfaceActions: CanvasSurfaceActions = {
  brushPreviewHidesLayer,
  captureBrushPreviewCanvas,
  captureGradientPreviewCanvas,
  captureCanvasRulers,
  captureFreeTransformBox,
  captureGuideOverlay,
  captureScrollArea,
  captureSelectionMoveCanvas,
  captureSurface,
  clearRulerPointer,
  commitFreeTransform,
  displayTransform,
  handleLayerImageError,
  handleLayerImageLoaded,
  handleLostPointerCapture,
  handleNativeScroll,
  resetRulerOrigin,
  selectionMoveHidesLayer,
  startGuideCreation,
  startGuideMove,
  startLayerPointer,
  startRulerOrigin,
  startTransformMove,
  startTransformResize,
  startTransformRotate,
  startViewportPointer,
  stopPointer,
  updatePointer
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  if (!event.dataTransfer?.files.length) return

  const result = await readBrowserImages(event.dataTransfer.files)
  if (result.images.length || result.errors.length) {
    emit('imagesDropped', result.images, result.errors)
  }
}

function documentPointFromClient(clientX: number, clientY: number) {
  const canvas = surface.value
  if (!canvas) return undefined
  const bounds = canvas.getBoundingClientRect()
  return {
    x: documentPositionFromScreen(clientX, bounds.left, scale.value),
    y: documentPositionFromScreen(clientY, bounds.top, scale.value)
  }
}

function captureSurface(element: unknown) {
  surface.value = element instanceof HTMLDivElement ? element : null
}

function captureScrollArea(element: unknown) {
  scrollArea.value = element instanceof HTMLDivElement ? element : null
}

function captureCanvasRulers(element: unknown) {
  canvasRulers.value = element as CanvasRulersApi | null
}

function captureGuideOverlay(element: unknown) {
  guideOverlay.value = element as GuideOverlayApi | null
}

function captureFreeTransformBox(element: unknown) {
  freeTransformBox.value = element instanceof HTMLElement ? element : null
}

function captureTransformRotationOutput(element: unknown) {
  transformRotationOutput.value = element instanceof HTMLElement ? element : null
}

function handleKeyboardNudge(event: KeyboardEvent, nudge: { x: number; y: number }) {
  if (props.activeTool !== 'move' || isEditableShortcutTarget(event.target)) return false
  event.preventDefault()
  event.stopPropagation()
  if (props.isBusy) return true

  if (!props.selection) {
    return nudgeActiveLayer(nudge)
  }
  return handleKeyboardSelectionNudge(nudge, props.selection)
}

function commitKeyboardNudge() {
  commitKeyboardSelectionMove()
  commitKeyboardLayerMove()
}

function scheduleInteractionFrame(action: () => void) {
  pendingInteractionFrame = action
  if (interactionFrame) return

  interactionFrame = requestAnimationFrame(() => {
    interactionFrame = 0
    const pending = pendingInteractionFrame
    pendingInteractionFrame = undefined
    pending?.()
  })
}

function flushInteractionFrame() {
  if (interactionFrame) cancelAnimationFrame(interactionFrame)
  interactionFrame = 0
  const pending = pendingInteractionFrame
  pendingInteractionFrame = undefined
  pending?.()
}

function discardInteractionFrame() {
  if (interactionFrame) cancelAnimationFrame(interactionFrame)
  interactionFrame = 0
  pendingInteractionFrame = undefined
}

function pointerToDocument(event: PointerEvent): DocumentPoint | undefined {
  return documentPointFromClient(event.clientX, event.clientY)
}

function colorSamplePoint(event: PointerEvent) {
  const point = pointerToDocument(event)
  return point
    ? sampledDocumentPixel(point.x, point.y, props.document.width, props.document.height) ?? undefined
    : undefined
}

function scheduleColorSample(point: DocumentPoint, target: ColorSampleTarget) {
  pendingColorSample = { point, target }
  if (colorSampleFrame) return
  colorSampleFrame = requestAnimationFrame(() => {
    colorSampleFrame = 0
    const pending = pendingColorSample
    pendingColorSample = undefined
    if (pending) emit('sampleColor', pending.point, pending.target)
  })
}

function flushColorSample() {
  if (colorSampleFrame) cancelAnimationFrame(colorSampleFrame)
  colorSampleFrame = 0
  const pending = pendingColorSample
  pendingColorSample = undefined
  if (pending) emit('sampleColor', pending.point, pending.target)
}

function snappingActive(event: Pick<PointerEvent, 'ctrlKey' | 'metaKey'>) {
  return props.guideSnappingEnabled && props.guidesVisible && props.guides.length > 0 && !event.ctrlKey && !event.metaKey
}

function snapPointForInteraction(point: DocumentPoint, event: PointerEvent) {
  if (!snappingActive(event)) {
    setSnappedGuides({})
    return point
  }
  const result = snapDocumentPoint(point, props.guides, scale.value)
  setSnappedGuides({ x: result.snappedX, y: result.snappedY })
  return result.value
}

function snapTransformForInteraction(transform: LayerTransform, event: PointerEvent) {
  if (!snappingActive(event)) {
    setSnappedGuides({})
    return transform
  }
  const result = snapLayerTranslation(transform, props.guides, scale.value)
  setSnappedGuides({ x: result.snappedX, y: result.snappedY })
  return result.value
}

function startViewportPointer(event: PointerEvent) {
  const scroll = scrollArea.value
  if (!scroll) return

  if (event.button === 0) clearSelectedGuide()
  scroll.focus()
  const target = event.target as HTMLElement | null
  const isMiddleButton = event.button === 1 || (event.buttons & 4) === 4
  const temporaryZoom = isSpacePressed.value && (event.ctrlKey || event.metaKey || event.altKey)
  const sampleTarget = colorSampleTarget(event.button)
  if (
    props.activeTool === 'eyedropper' &&
    !props.isBusy &&
    !isSpacePressed.value &&
    sampleTarget
  ) {
    const point = colorSamplePoint(event)
    if (point) {
      event.preventDefault()
      event.stopPropagation()
      scroll.setPointerCapture(event.pointerId)
      colorSamplePointer = { pointerId: event.pointerId, target: sampleTarget, lastPoint: point }
      emit('sampleColor', point, sampleTarget)
    }
    return
  }
  if (
    event.button === 0 &&
    isTransforming.value &&
    !isSpacePressed.value &&
    target?.closest('.free-transform-box')
  )
    return

  if (props.activeTool === 'move' && props.selection && !isSpacePressed.value) {
    const point = pointerToDocument(event)
    if (point && startSelectionMove(event, point, props.selection)) return
  }

  if (props.activeTool === 'crop' && !isSpacePressed.value) {
    const point = pointerToDocument(event)
    if (point && startSelectionPointer(event, point)) return
    if (event.button === 0) {
      event.preventDefault()
      event.stopPropagation()
      cancelSelection()
      return
    }
  }

  if ((props.activeTool === 'brush' || props.activeTool === 'eraser') && !isSpacePressed.value) {
    const point = pointerToDocument(event)
    if (point && startBrushPointer(event, point, props.activeTool === 'eraser' ? 'erase' : 'paint')) return
  }

  if (props.activeTool === 'gradient' && !isSpacePressed.value) {
    const point = pointerToDocument(event)
    if (point && startGradientPointer(event, point)) return
  }

  if (props.activeTool === 'paint-bucket' && !isSpacePressed.value && (event.button === 0 || event.button === 2)) {
    if (!paintableLayer.value) return
    const point = pointerToDocument(event)
    if (!point || point.x < 0 || point.y < 0 || point.x >= props.document.width || point.y >= props.document.height) return
    event.preventDefault()
    event.stopPropagation()
    emit('paintBucket', point, event.button === 2 ? props.backgroundColor : props.foregroundColor, props.selection)
    return
  }

  const textLayerTarget = target?.closest('.document-layer[data-layer-kind="text"]')
  if (event.button === 0 && props.activeTool === 'text' && !isSpacePressed.value && !textLayerTarget) {
    const point = pointerToDocument(event)
    if (
      !point ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > props.document.width ||
      point.y > props.document.height
    )
      return
    event.preventDefault()
    event.stopPropagation()
    emit('createText', point)
    return
  }
  const shouldZoom = event.button === 0 && (props.activeTool === 'zoom' || temporaryZoom)
  if (shouldZoom) {
    event.preventDefault()
    event.stopPropagation()
    const direction = event.altKey ? -1 : 1
    zoomByStep(direction, event.clientX, event.clientY)
    return
  }

  const shouldPan =
    isMiddleButton ||
    (event.button === 0 && (props.activeTool === 'hand' || (isSpacePressed.value && !temporaryZoom)))
  if (!shouldPan) return

  event.preventDefault()
  event.stopPropagation()
  discardInteractionFrame()
  cancelGradient()
  cancelPointerInteractions()
  scroll.setPointerCapture(event.pointerId)
  isPanning.value = true
  panStart.value = {
    x: event.clientX,
    y: event.clientY,
    scrollLeft: scroll.scrollLeft,
    scrollTop: scroll.scrollTop,
    pointerId: event.pointerId
  }
}

function onCanvasContextMenu(event: MouseEvent) {
  if (props.activeTool === 'paint-bucket') event.preventDefault()
}

function startLayerPointer(event: PointerEvent, layer: LayerItem) {
  if (
    props.isBusy ||
    event.button !== 0 ||
    (event.buttons & 4) === 4 ||
    isPanning.value ||
    props.activeTool === 'hand' ||
    props.activeTool === 'zoom' ||
    isSpacePressed.value
  )
    return
  clearSelectedGuide()
  if (props.activeTool === 'text' && layer.kind === 'text') {
    event.stopPropagation()
    event.preventDefault()
    emit('selectLayer', layer.id)
    return
  }
  if (props.activeTool !== 'move') return

  commitKeyboardLayerMove()
  if (isTransforming.value) commitFreeTransform()

  if (props.selection && !selectionIsEmpty(props.selection)) {
    event.stopPropagation()
    event.preventDefault()
    const point = pointerToDocument(event)
    if (
      point &&
      (activeLayer.value?.kind === 'image' || activeLayer.value?.kind === 'background' || activeLayer.value?.kind === 'pixel')
    ) {
      startSelectionMove(event, point, props.selection)
    }
    return
  }

  startLayerDrag(event, layer)
}

function updatePointer(event: PointerEvent) {
  if (colorSamplePointer?.pointerId === event.pointerId) {
    event.preventDefault()
    event.stopPropagation()
    if (colorSampleButtonIsPressed(colorSamplePointer.target, event.buttons)) {
      const point = colorSamplePoint(event)
      if (
        point &&
        (point.x !== colorSamplePointer.lastPoint.x || point.y !== colorSamplePointer.lastPoint.y)
      ) {
        colorSamplePointer.lastPoint = point
        scheduleColorSample(point, colorSamplePointer.target)
      }
    }
    return
  }
  if (isPanning.value && scrollArea.value && panStart.value.pointerId === event.pointerId) {
    event.preventDefault()
    const scrollLeft = panStart.value.scrollLeft - (event.clientX - panStart.value.x)
    const scrollTop = panStart.value.scrollTop - (event.clientY - panStart.value.y)
    const clientX = event.clientX
    const clientY = event.clientY
    scheduleInteractionFrame(() => {
      if (!isPanning.value || !scrollArea.value) return
      scrollArea.value.scrollLeft = scrollLeft
      scrollArea.value.scrollTop = scrollTop
      syncViewportScroll()
      updateRulerPointer(clientX, clientY)
    })
    return
  }
  updateRulerPointer(event.clientX, event.clientY)

  if (hasSelectionPointer(event.pointerId)) {
    const selectionPoint = pointerToDocument(event)
    if (selectionPoint) updateSelectionWithDocumentPoint(event, selectionPoint)
    return
  }

  if (hasBrushPointer(event.pointerId) && updateBrushPointer(event)) return

  if (hasGradientPointer(event.pointerId) && updateGradientPointer(event)) return

  if (hasSelectionMovePointer(event.pointerId)) {
    const point = pointerToDocument(event)
    if (point) updateSelectionMovePointer(event, point)
    return
  }

  if (updateTransformPointer(event)) return
}

function stopPointer(event: PointerEvent) {
  flushInteractionFrame()
  if (colorSamplePointer?.pointerId === event.pointerId) {
    flushColorSample()
    colorSamplePointer = undefined
  }
  if (event.type === 'pointerup') stopSelectionPointer(event.pointerId)
  else cancelSelectionPointer(event.pointerId)
  stopBrushPointer(event)
  stopGradientPointer(event)
  stopSelectionMovePointer(event)
  stopTransformPointer(event.pointerId)
  if (panStart.value.pointerId === event.pointerId) {
    isPanning.value = false
    panStart.value.pointerId = -1
  }
  setSnappedGuides({})
}

function handleLostPointerCapture(event: PointerEvent) {
  if (shouldKeepSelectionMovePointerCapture(event)) return
  stopPointer(event)
}

onBeforeUnmount(() => {
  cancelAnimationFrame(interactionFrame)
  cancelAnimationFrame(colorSampleFrame)
})

defineExpose({
  commitPendingTransform: () => {
    commitKeyboardLayerMove()
    commitFreeTransform()
  },
  discardPendingBrushPreview: clearBrushPreview,
  fitDocument,
  waitForLayerImages,
  zoomToActualSize: () => requestZoom(100)
})
</script>

<template>
  <section
    class="canvas-stage"
    aria-label="Área de edição"
    @dragover.prevent
    @drop="handleDrop"
    @keydown="handleCanvasKeydown"
    @contextmenu="onCanvasContextMenu"
    @wheel="handleWheel"
  >
    <CanvasContextBar
      :active-tool="activeTool"
      :auto-select-layer="autoSelectLayer"
      :brush-size="brushSize"
      :capture-rotation-output="captureTransformRotationOutput"
      :document="document"
      :guide-count="guides.length"
      :gradient-reversed="gradientReversed"
      :gradient-type="gradientType"
      :guide-snapping-enabled="guideSnappingEnabled"
      :guides-locked="guidesLocked"
      :guides-visible="guidesVisible"
      :has-selection="Boolean(visibleSelection)"
      :is-transforming="isTransforming"
      :is-viewport-ready="isViewportReady"
      :magic-wand-contiguous="magicWandContiguous"
      :magic-wand-tolerance="magicWandTolerance"
      :paint-bucket-contiguous="paintBucketContiguous"
      :paint-bucket-tolerance="paintBucketTolerance"
      :rotation="activeDisplayTransform?.rotation ?? 0"
      :ruler-unit="rulerUnit"
      :rulers-visible="rulersVisible"
      :selection-mode="selectionMode"
      :selection-combine-mode="selectionCombineMode"
      :visual-zoom="visualZoom"
      @cancel-transform="cancelFreeTransform"
      @clear-guides="emit('clearGuides')"
      @clear-selection="emit('update:selection', null)"
      @commit-transform="commitFreeTransform"
      @delete-selection="emit('deleteSelection')"
      @fit-document="fitDocument"
      @update-auto-select-layer="emit('update:autoSelectLayer', $event)"
      @update-guide-snapping-enabled="emit('update:guideSnappingEnabled', $event)"
      @update-gradient-reversed="emit('update:gradientReversed', $event)"
      @update-gradient-type="emit('update:gradientType', $event)"
      @update-guides-locked="emit('update:guidesLocked', $event)"
      @update-guides-visible="emit('update:guidesVisible', $event)"
      @update-magic-wand-contiguous="emit('update:magicWandContiguous', $event)"
      @update-magic-wand-tolerance="emit('update:magicWandTolerance', $event)"
      @update-paint-bucket-contiguous="emit('update:paintBucketContiguous', $event)"
      @update-paint-bucket-tolerance="emit('update:paintBucketTolerance', $event)"
      @update-ruler-unit="emit('update:rulerUnit', $event)"
      @update-rulers-visible="emit('update:rulersVisible', $event)"
      @update-selection-mode="emit('update:selectionMode', $event)"
      @update-selection-combine-mode="emit('update:selectionCombineMode', $event)"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
    />

    <CanvasSurface :actions="canvasSurfaceActions" :view="canvasSurfaceView" />
  </section>
</template>

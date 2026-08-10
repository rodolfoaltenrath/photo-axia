<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CanvasLayer from './CanvasLayer.vue'
import SelectionOverlay from './SelectionOverlay.vue'
import type { DocumentSpec, EditorTool, ImageAsset, ImportedImage, LayerItem, LayerTransform } from '../types/editor'
import { readBrowserImages } from '../services/imageImport'
import {
  clampZoom,
  formatZoom,
  MAX_ZOOM,
  nextZoomLevel,
  wheelZoomLevel
} from '../editor/viewport'
import {
  moveLayerTransform,
  resizeLayerTransform,
  rotateLayerTransform,
  TRANSFORM_HANDLES,
  transformCenter,
  type DocumentPoint,
  type TransformHandle
} from '../editor/freeTransform'
import {
  appendBrushPoint,
  brushPointSpacing,
  brushPreviewSize,
  drawBrushPoints
} from '../editor/brush'
import {
  imageSourceForRasterSize,
  snapCanvasTranslation,
  viewportPreviewGeometry
} from '../editor/preview'
import {
  clampSelectionToBounds,
  clipContextToSelection,
  constrainedSelectionEndpoint,
  createLassoSelection,
  createShapeSelection,
  invertMatrix,
  layerSourceToDocumentMatrix,
  multiplyMatrices,
  pointsBounds,
  selectionContainsPoint,
  selectionIsEmpty,
  selectionNudgeDelta,
  snapShapeSelectionToBounds,
  translateSelection,
  type Matrix2D,
  type SelectionMode,
  type SelectionPoint,
  type SelectionRegion
} from '../editor/selection'

const props = defineProps<{
  activeLayerId: string
  activeTool: EditorTool
  autoSelectLayer: boolean
  brushColor: string
  brushSize: number
  document: DocumentSpec
  isBusy: boolean
  layers: LayerItem[]
  magicWandContiguous: boolean
  magicWandTolerance: number
  selection: SelectionRegion | null
  selectionMoveAnchor: {
    layerId: string
    image: ImageAsset
    transform: LayerTransform
    selection: SelectionRegion
    deltaX: number
    deltaY: number
  } | null
  selectionMode: SelectionMode
  zoom: number
}>()

const emit = defineEmits<{
  (event: 'update:zoom', zoom: number): void
  (event: 'createText', point: DocumentPoint): void
  (event: 'imagesDropped', images: ImportedImage[], errors: string[]): void
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
    selection: SelectionRegion | null
  ): void
  (event: 'selectLayer', layerId: string): void
  (event: 'updateTransform', layerId: string, transform: LayerTransform): void
  (event: 'update:autoSelectLayer', enabled: boolean): void
  (event: 'update:magicWandContiguous', enabled: boolean): void
  (event: 'update:magicWandTolerance', tolerance: number): void
  (event: 'update:selection', selection: SelectionRegion | null): void
  (event: 'update:selectionMode', mode: SelectionMode): void
}>()

const scrollArea = ref<HTMLDivElement | null>(null)
const surface = ref<HTMLDivElement | null>(null)
const isPanning = ref(false)
const isNativeScrolling = ref(false)
let nativeScrollTimeout: ReturnType<typeof setTimeout> | undefined
const isSpacePressed = ref(false)
const modifierKeys = ref({ alt: false, command: false, shift: false })
const visualZoom = ref(props.zoom)
const zoomTarget = ref(props.zoom)
const viewportSize = ref({ width: 1, height: 1 })
const isViewportReady = ref(false)
const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0, pointerId: -1 })
const dragState = ref<{
  layerId: string
  pointerId: number
  startX: number
  startY: number
  transform: LayerTransform
} | null>(null)
const layerDragPreview = ref<{ layerId: string; transform: LayerTransform } | null>(null)
const transformSession = ref<{
  layerId: string
  original: LayerTransform
  draft: LayerTransform
} | null>(null)
const transformInteraction = ref<
  | {
      type: 'move'
      pointerId: number
      start: DocumentPoint
      initial: LayerTransform
    }
  | {
      type: 'resize'
      pointerId: number
      handle: TransformHandle
      initial: LayerTransform
    }
  | {
      type: 'rotate'
      pointerId: number
      startAngle: number
      initial: LayerTransform
    }
  | null
>(null)
const selectionDraft = shallowRef<SelectionRegion | null>(null)
const selectionInteraction = ref<{
  pointerId: number
  mode: Exclude<SelectionMode, 'magic-wand'>
  start: SelectionPoint
  points: SelectionPoint[]
} | null>(null)
const brushInteraction = shallowRef<{
  pointerId: number
  layerId: string
  points: SelectionPoint[]
  renderedPointCount: number
  selection: SelectionRegion | null
  selectionPath: Path2D | null
  baseImageSource: string
} | null>(null)
const selectionMoveInteraction = shallowRef<{
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
  opacity: number
  baseCanvas?: HTMLCanvasElement
  contentCanvas?: HTMLCanvasElement
} | null>(null)
const selectionMoveCanvas = ref<HTMLCanvasElement | null>(null)
const selectionMoveReady = ref(false)
const selectionMovePending = ref(false)
const brushPreviewCanvas = ref<HTMLCanvasElement | null>(null)
const brushPreviewPending = ref(false)
let resizeObserver: ResizeObserver | undefined
let interactionFrame = 0
let pendingBrushBaseImageSource: string | undefined
let pendingBrushCommittedImageSource: string | undefined
let pendingBrushWasFree = false
let pendingSelectionMoveBaseSource: string | undefined
let pendingSelectionMoveCommittedSource: string | undefined
let cachedSelectionMoveImage: { source: string; image: HTMLImageElement } | undefined
let keyboardSelectionCommitTimeout: ReturnType<typeof setTimeout> | undefined
let wheelZoomFrame = 0
let wheelZoomFrameTime = 0
let navigationScheduled = false
let pendingInteractionFrame: (() => void) | undefined
let wheelZoomAnchor: { clientX: number; clientY: number } | undefined

function captureSelectionMoveCanvas(element: unknown) {
  selectionMoveCanvas.value = element instanceof HTMLCanvasElement ? element : null
}
let viewportInitialization = 0
let pendingNavigation:
  | { type: 'anchor'; viewportX: number; viewportY: number; documentX: number; documentY: number }
  | { type: 'center' }
  | undefined

const scale = computed(() => visualZoom.value / 100)
const scaledDocumentSize = computed(() => ({
  width: Math.max(1, props.document.width * scale.value),
  height: Math.max(1, props.document.height * scale.value)
}))
const pasteboardStyle = computed(() => ({
  width: `${viewportSize.value.width * 2 + scaledDocumentSize.value.width}px`,
  height: `${viewportSize.value.height * 2 + scaledDocumentSize.value.height}px`
}))
const frameStyle = computed(() => ({
  left: `${viewportSize.value.width}px`,
  top: `${viewportSize.value.height}px`,
  width: `${scaledDocumentSize.value.width}px`,
  height: `${scaledDocumentSize.value.height}px`
}))
const surfaceStyle = computed(() => ({
  width: `${props.document.width}px`,
  height: `${props.document.height}px`,
  transform: `scale(${scale.value})`,
  '--transform-handle-size': `${10 / scale.value}px`,
  '--transform-line-width': `${1 / scale.value}px`,
  '--transform-rotate-offset': `${34 / scale.value}px`
}))
const renderedLayers = computed(() =>
  [...props.layers].reverse().filter((layer) => layer.kind !== 'background' && layer.visible)
)
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
  if (!background?.visible || props.document.background === 'transparent') return { display: 'none' }

  return {
    background: props.document.background === 'black' ? '#000000' : '#ffffff',
    opacity: background.opacity / 100
  }
})
const activeLayer = computed(() => props.layers.find((layer) => layer.id === props.activeLayerId))
const visibleSelection = computed(() => selectionDraft.value ?? props.selection)
const isTransforming = computed(() => Boolean(transformSession.value))
const activeDisplayTransform = computed(() => {
  const layer = activeLayer.value
  if (!layer) return undefined
  return displayTransform(layer)
})
const freeTransformStyle = computed(() => {
  const transform = activeDisplayTransform.value
  if (!transform || !activeLayer.value?.visible || !isTransforming.value) return undefined
  return positionedTransformStyle(transform)
})
const paintableLayer = computed(() => {
  const layer = activeLayer.value
  if (!layer?.visible || layer.kind !== 'image' || !layer.image || !layer.transform) return undefined
  return layer
})
const brushPreviewDimensions = computed(() => {
  const layer = paintableLayer.value
  if (!layer?.image || !layer.transform) return { width: 1, height: 1 }
  const free = brushInteraction.value ? !brushInteraction.value.selection : brushPreviewPending.value && pendingBrushWasFree
  if (free) {
    return brushPreviewSize(
      props.document.width * 2,
      props.document.height * 2,
      props.document.width,
      props.document.height,
      scale.value,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio
    )
  }
  return brushPreviewSize(
    layer.image.width,
    layer.image.height,
    layer.transform.width,
    layer.transform.height,
    scale.value,
    typeof window === 'undefined' ? 1 : window.devicePixelRatio
  )
})
const brushPreviewStyle = computed(() => {
  const transform = activeDisplayTransform.value
  if (!transform || !paintableLayer.value || (!brushInteraction.value && !brushPreviewPending.value)) return undefined
  const free = brushInteraction.value ? !brushInteraction.value.selection : pendingBrushWasFree
  if (free) {
    return {
      left: '0',
      top: '0',
      width: `${props.document.width}px`,
      height: `${props.document.height}px`
    }
  }
  return positionedTransformStyle(transform)
})
const selectionMovePreviewStyle = computed(() => {
  const interaction = selectionMoveInteraction.value
  if (!interaction) return undefined
  return {
    left: `${interaction.previewX}px`,
    top: `${interaction.previewY}px`,
    width: `${interaction.previewDocumentWidth}px`,
    height: `${interaction.previewDocumentHeight}px`,
    opacity: interaction.opacity / 100
  }
})
const selectionMoveHidesLayer = (layerId: string) =>
  selectionMoveReady.value && selectionMoveInteraction.value?.layerId === layerId
function handleNativeScroll() {
  isNativeScrolling.value = true
  if (nativeScrollTimeout) clearTimeout(nativeScrollTimeout)
  nativeScrollTimeout = setTimeout(() => {
    isNativeScrolling.value = false
  }, 120)
}

const viewportCursorClass = computed(() => ({
  'canvas-scroll--ready': isViewportReady.value,
  'canvas-scroll--panning': isPanning.value,
  'canvas-scroll--scrolling': isNativeScrolling.value,
  'canvas-scroll--text': props.activeTool === 'text',
  'canvas-scroll--selection': props.activeTool === 'crop' || props.activeTool === 'brush',
  'canvas-scroll--pan-ready':
    props.activeTool === 'hand' || (isSpacePressed.value && !modifierKeys.value.command && !modifierKeys.value.alt),
  'canvas-scroll--zoom-in':
    (props.activeTool === 'zoom' && !modifierKeys.value.alt) ||
    (isSpacePressed.value && modifierKeys.value.command),
  'canvas-scroll--zoom-out':
    (props.activeTool === 'zoom' && modifierKeys.value.alt) ||
    (isSpacePressed.value && modifierKeys.value.alt)
}))

function displayTransform(layer: Pick<LayerItem, 'id' | 'transform'>) {
  if (transformSession.value?.layerId === layer.id) return transformSession.value.draft
  if (layerDragPreview.value?.layerId === layer.id) return layerDragPreview.value.transform
  return layer.transform
}

function positionedTransformStyle(transform: LayerTransform) {
  return {
    left: '0',
    top: '0',
    width: `${transform.width}px`,
    height: `${transform.height}px`,
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(${transform.rotation ?? 0}deg)`
  }
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  if (!event.dataTransfer?.files.length) return

  const result = await readBrowserImages(event.dataTransfer.files)
  if (result.images.length || result.errors.length) {
    emit('imagesDropped', result.images, result.errors)
  }
}

function handleWheel(event: WheelEvent) {
  const scroll = scrollArea.value
  scroll?.focus()

  if (event.ctrlKey || event.metaKey || event.altKey) {
    event.preventDefault()
    zoomTarget.value = wheelZoomLevel(zoomTarget.value, event.deltaY)
    wheelZoomAnchor = { clientX: event.clientX, clientY: event.clientY }
    startWheelZoomAnimation()
    return
  }

  if (event.shiftKey && scroll) {
    event.preventDefault()
    const scrollLeft = scroll.scrollLeft + (event.deltaY || event.deltaX)
    scheduleInteractionFrame(() => {
      if (scrollArea.value) scrollArea.value.scrollLeft = scrollLeft
    })
  }
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'))
}

function handleSelectionNudge(event: KeyboardEvent) {
  const nudge = selectionNudgeDelta(event.key, event.shiftKey)
  if (!nudge || props.activeTool !== 'move' || !props.selection || isEditableTarget(event.target)) return false
  event.preventDefault()
  event.stopPropagation()
  if (props.isBusy) return true
  let interaction = selectionMoveInteraction.value
  if (!interaction || interaction.pointerId !== -2) {
    if (interaction || !beginSelectionMove(-2, { x: 0, y: 0 }, props.selection)) return true
    interaction = selectionMoveInteraction.value
  }
  if (!interaction) return true
  interaction.deltaX += nudge.x
  interaction.deltaY += nudge.y
  selectionDraft.value = translateSelection(
    interaction.originalSelection,
    interaction.deltaX,
    interaction.deltaY
  )
  redrawSelectionMovePreview()
  if (keyboardSelectionCommitTimeout) clearTimeout(keyboardSelectionCommitTimeout)
  keyboardSelectionCommitTimeout = setTimeout(commitKeyboardSelectionMove, 2000)
  return true
}

function handleCanvasKeydown(event: KeyboardEvent) {
  const scroll = scrollArea.value
  if (!scroll || handleSelectionNudge(event)) return

  const step = event.shiftKey ? 96 : 36
  const movement: Record<string, [number, number]> = {
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0]
  }
  const delta = movement[event.key]
  if (delta) {
    event.preventDefault()
    scroll.scrollBy({ left: delta[0], top: delta[1], behavior: 'auto' })
    return
  }

  if (event.key === 'PageUp' || event.key === 'PageDown') {
    event.preventDefault()
    const direction = event.key === 'PageUp' ? -1 : 1
    scroll.scrollBy({
      left: event.ctrlKey || event.metaKey ? direction * scroll.clientWidth * 0.9 : 0,
      top: event.ctrlKey || event.metaKey ? 0 : direction * scroll.clientHeight * 0.9,
      behavior: 'auto'
    })
  }
}

function updateModifierKeys(event: KeyboardEvent) {
  modifierKeys.value = {
    alt: event.altKey,
    command: event.ctrlKey || event.metaKey,
    shift: event.shiftKey
  }
}

function handleWindowKeydown(event: KeyboardEvent) {
  updateModifierKeys(event)
  if (event.defaultPrevented || isEditableTarget(event.target)) return
  if (handleSelectionNudge(event)) return

  if ((event.key === 'Delete' || event.key === 'Backspace') && props.selection) {
    event.preventDefault()
    emit('deleteSelection')
    return
  }

  if (isTransforming.value && event.key === 'Escape') {
    event.preventDefault()
    cancelFreeTransform()
    return
  }

  if (isTransforming.value && event.key === 'Enter') {
    event.preventDefault()
    commitFreeTransform()
    return
  }

  if (event.code === 'Space') {
    event.preventDefault()
    isSpacePressed.value = true
  }

  if (event.key === 'Escape' && brushInteraction.value) {
    event.preventDefault()
    discardInteractionFrame()
    clearBrushPreview()
    brushInteraction.value = null
    return
  }

  if (event.key === 'Escape' && selectionMoveInteraction.value && selectionMoveInteraction.value.pointerId !== -1) {
    event.preventDefault()
    discardInteractionFrame()
    clearSelectionMovePreview()
    return
  }

  if (event.key === 'Escape' && (selectionInteraction.value || props.selection)) {
    event.preventDefault()
    discardInteractionFrame()
    selectionInteraction.value = null
    selectionDraft.value = null
    emit('update:selection', null)
    return
  }

  if (!event.ctrlKey && !event.metaKey) return

  if (event.code === 'KeyD') {
    event.preventDefault()
    emit('update:selection', null)
    return
  }

  if (event.code === 'KeyA') {
    event.preventDefault()
    emit('update:selection', {
      kind: 'rectangle',
      bounds: { x: 0, y: 0, width: props.document.width, height: props.document.height }
    })
    return
  }

  if (event.code === 'KeyT') {
    event.preventDefault()
    startFreeTransform()
    return
  }

  const shortcuts: Record<string, () => void> = {
    Digit0: fitDocument,
    Numpad0: fitDocument,
    Digit1: () => requestZoom(100),
    Numpad1: () => requestZoom(100),
    Digit2: () => requestZoom(200),
    Numpad2: () => requestZoom(200),
    Equal: zoomIn,
    NumpadAdd: zoomIn,
    Minus: zoomOut,
    NumpadSubtract: zoomOut
  }
  const action = shortcuts[event.code]
  if (!action) return

  event.preventDefault()
  action()
}

function handleWindowKeyup(event: KeyboardEvent) {
  updateModifierKeys(event)
  if (event.code === 'Space') isSpacePressed.value = false
  if (selectionNudgeDelta(event.key)) commitKeyboardSelectionMove()
}

function resetInteractionKeys() {
  commitKeyboardSelectionMove()
  isSpacePressed.value = false
  modifierKeys.value = { alt: false, command: false, shift: false }
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

function transformsMatch(first: LayerTransform, second: LayerTransform) {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height &&
    (first.rotation ?? 0) === (second.rotation ?? 0)
  )
}

function startFreeTransform() {
  if (transformSession.value) return
  const layer = activeLayer.value
  if (!layer?.transform || !layer.visible || layer.kind === 'background') return

  dragState.value = null
  layerDragPreview.value = null
  const original = { ...layer.transform, rotation: layer.transform.rotation ?? 0 }
  transformSession.value = {
    layerId: layer.id,
    original,
    draft: { ...original }
  }
  scrollArea.value?.focus()
}

function commitFreeTransform() {
  flushInteractionFrame()
  const session = transformSession.value
  if (session && !transformsMatch(session.original, session.draft)) {
    emit('updateTransform', session.layerId, { ...session.draft })
  }
  transformInteraction.value = null
  transformSession.value = null
}

function cancelFreeTransform() {
  discardInteractionFrame()
  transformInteraction.value = null
  transformSession.value = null
}

function pointerToDocument(event: PointerEvent): DocumentPoint | undefined {
  const canvas = surface.value
  if (!canvas) return undefined
  const bounds = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) / scale.value,
    y: (event.clientY - bounds.top) / scale.value
  }
}

function captureTransformPointer(event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
}

function startTransformMove(event: PointerEvent) {
  const transform = activeDisplayTransform.value
  const pointer = pointerToDocument(event)
  if (event.button !== 0 || !transform || !pointer) return

  captureTransformPointer(event)
  transformInteraction.value = {
    type: 'move',
    pointerId: event.pointerId,
    start: pointer,
    initial: { ...transform }
  }
}

function startTransformResize(event: PointerEvent, handle: TransformHandle) {
  const transform = activeDisplayTransform.value
  if (event.button !== 0 || !transform) return

  captureTransformPointer(event)
  transformInteraction.value = {
    type: 'resize',
    pointerId: event.pointerId,
    handle,
    initial: { ...transform }
  }
}

function startTransformRotate(event: PointerEvent) {
  const transform = activeDisplayTransform.value
  const pointer = pointerToDocument(event)
  if (event.button !== 0 || !transform || !pointer) return

  const center = transformCenter(transform)
  captureTransformPointer(event)
  transformInteraction.value = {
    type: 'rotate',
    pointerId: event.pointerId,
    startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
    initial: { ...transform }
  }
}

function selectionBounds() {
  const transform = activeLayer.value?.transform
  if (!transform) return { x: 0, y: 0, width: props.document.width, height: props.document.height }
  return { x: transform.x, y: transform.y, width: transform.width, height: transform.height }
}

function startSelectionPointer(event: PointerEvent, point: SelectionPoint) {
  const scroll = scrollArea.value
  if (!scroll || event.button !== 0) return false
  event.preventDefault()
  event.stopPropagation()
  if (props.selectionMode === 'magic-wand') {
    emit('magicWandSelect', point)
    return true
  }

  const start = point
  scroll.setPointerCapture(event.pointerId)
  selectionInteraction.value = {
    pointerId: event.pointerId,
    mode: props.selectionMode,
    start,
    points: [start]
  }
  selectionDraft.value = props.selectionMode === 'lasso'
    ? { kind: 'lasso', points: [start], bounds: { x: start.x, y: start.y, width: 0, height: 0 } }
    : createShapeSelection(props.selectionMode, start, start)
  return true
}

function clearSelectionMovePreview() {
  unbindSelectionMoveWindowEvents()
  if (keyboardSelectionCommitTimeout) clearTimeout(keyboardSelectionCommitTimeout)
  keyboardSelectionCommitTimeout = undefined
  const canvas = selectionMoveCanvas.value
  canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  selectionMoveInteraction.value = null
  selectionMoveReady.value = false
  selectionMovePending.value = false
  selectionDraft.value = null
  pendingSelectionMoveBaseSource = undefined
  pendingSelectionMoveCommittedSource = undefined
}

function bindSelectionMoveWindowEvents() {
  window.addEventListener('pointermove', updatePointer)
  window.addEventListener('pointerup', stopPointer)
  window.addEventListener('pointercancel', stopPointer)
}

function unbindSelectionMoveWindowEvents() {
  window.removeEventListener('pointermove', updatePointer)
  window.removeEventListener('pointerup', stopPointer)
  window.removeEventListener('pointercancel', stopPointer)
}

function redrawSelectionMovePreview() {
  const interaction = selectionMoveInteraction.value
  const canvas = selectionMoveCanvas.value
  const baseCanvas = interaction?.baseCanvas
  const contentCanvas = interaction?.contentCanvas
  if (!interaction || !canvas || !baseCanvas || !contentCanvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  const deltaX = snapCanvasTranslation(
    (interaction.previewBaseDeltaX + interaction.deltaX) * (canvas.width / interaction.previewDocumentWidth)
  )
  const deltaY = snapCanvasTranslation(
    (interaction.previewBaseDeltaY + interaction.deltaY) * (canvas.height / interaction.previewDocumentHeight)
  )
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(baseCanvas, 0, 0)
  context.drawImage(contentCanvas, deltaX, deltaY)
}

async function loadSelectionMovePreviewImage(source: string) {
  if (cachedSelectionMoveImage?.source === source && cachedSelectionMoveImage.image.complete) {
    return cachedSelectionMoveImage.image
  }
  const image = new Image()
  image.decoding = 'async'
  image.src = source
  try {
    await image.decode()
  } catch {
    await new Promise<void>((resolve, reject) => {
      if (image.complete && image.naturalWidth > 0) resolve()
      else {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Não foi possível preparar a prévia da seleção flutuante.'))
      }
    })
  }
  cachedSelectionMoveImage = { source, image }
  return image
}

async function prepareSelectionMovePreview() {
  const interaction = selectionMoveInteraction.value
  const canvas = selectionMoveCanvas.value
  const layer = paintableLayer.value
  if (!interaction || !canvas || !layer?.image) return
  const layerElements = surface.value?.querySelectorAll<HTMLElement>('.document-layer')
  const layerElement = layerElements
    ? Array.from(layerElements).find((element) => element.dataset.layerId === interaction.layerId)
    : undefined
  const activeImage = layerElement?.querySelector<HTMLImageElement>('img.layer-image-buffer--active')
  const activeSource = activeImage?.currentSrc || activeImage?.src
  const image =
    activeImage?.complete && activeImage.naturalWidth > 0 && activeSource === interaction.previewImageSource
      ? activeImage
      : await loadSelectionMovePreviewImage(interaction.previewImageSource)
  if (selectionMoveInteraction.value !== interaction || image.naturalWidth === 0) return

  const baseCanvas = document.createElement('canvas')
  baseCanvas.width = canvas.width
  baseCanvas.height = canvas.height
  const baseContext = baseCanvas.getContext('2d', { alpha: true })
  const contentCanvas = document.createElement('canvas')
  contentCanvas.width = canvas.width
  contentCanvas.height = canvas.height
  const contentContext = contentCanvas.getContext('2d', { alpha: true })
  if (!baseContext || !contentContext) return
  baseContext.imageSmoothingEnabled = true
  baseContext.imageSmoothingQuality = 'high'
  contentContext.imageSmoothingEnabled = true
  contentContext.imageSmoothingQuality = 'high'
  const documentToPreview: [number, number, number, number, number, number] = [
    canvas.width / interaction.previewDocumentWidth,
    0,
    0,
    canvas.height / interaction.previewDocumentHeight,
    -interaction.previewX * (canvas.width / interaction.previewDocumentWidth),
    -interaction.previewY * (canvas.height / interaction.previewDocumentHeight)
  ]
  const imageToPreview = multiplyMatrices(
    documentToPreview,
    layerSourceToDocumentMatrix(interaction.transform, image.naturalWidth, image.naturalHeight)
  )
  baseContext.setTransform(...imageToPreview)
  baseContext.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight)
  baseContext.setTransform(1, 0, 0, 1, 0, 0)

  contentContext.save()
  clipContextToSelection(contentContext, interaction.previewSelection, documentToPreview)
  contentContext.setTransform(...imageToPreview)
  contentContext.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight)
  contentContext.restore()
  baseContext.save()
  baseContext.globalCompositeOperation = 'destination-out'
  clipContextToSelection(baseContext, interaction.previewSelection, documentToPreview)
  baseContext.setTransform(1, 0, 0, 1, 0, 0)
  baseContext.fillRect(0, 0, canvas.width, canvas.height)
  baseContext.restore()

  if (selectionMoveInteraction.value !== interaction) return
  interaction.baseCanvas = baseCanvas
  interaction.contentCanvas = contentCanvas
  redrawSelectionMovePreview()
  selectionMoveReady.value = true
}

function startSelectionMove(event: PointerEvent, point: SelectionPoint, selection: SelectionRegion) {
  const scroll = scrollArea.value
  const layer = paintableLayer.value
  if (
    !scroll ||
    !layer?.image ||
    !selectionContainsPoint(selection, point) ||
    props.isBusy
  ) return false
  event.preventDefault()
  event.stopPropagation()
  const started = beginSelectionMove(event.pointerId, point, selection)
  if (started) bindSelectionMoveWindowEvents()
  return started
}

function beginSelectionMove(pointerId: number, start: SelectionPoint, selection: SelectionRegion) {
  const scroll = scrollArea.value
  const surfaceElement = surface.value
  const layer = paintableLayer.value
  if (!scroll || !surfaceElement || !layer?.image || props.isBusy) return false
  const anchor = props.selectionMoveAnchor?.layerId === layer.id ? props.selectionMoveAnchor : null
  const surfaceRect = surfaceElement.getBoundingClientRect()
  const viewportRect = scroll.getBoundingClientRect()
  const previewGeometry = viewportPreviewGeometry(
    props.document.width,
    props.document.height,
    scale.value,
    typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    surfaceRect,
    viewportRect
  )
  const previewAsset = anchor?.image ?? layer.image
  const previewTransform = anchor?.transform ?? layer.transform!
  const previewImageSource = imageSourceForRasterSize(
    previewAsset,
    Math.abs(previewTransform.width) * (previewGeometry.rasterWidth / previewGeometry.width),
    Math.abs(previewTransform.height) * (previewGeometry.rasterHeight / previewGeometry.height)
  )
  selectionMoveInteraction.value = {
    pointerId,
    layerId: layer.id,
    start,
    deltaX: 0,
    deltaY: 0,
    originalSelection: selection,
    baseImageSource: layer.image.previewUrl ?? layer.image.sourceUrl,
    previewImageSource,
    previewSelection: anchor?.selection ?? selection,
    previewBaseDeltaX: anchor?.deltaX ?? 0,
    previewBaseDeltaY: anchor?.deltaY ?? 0,
    previewWidth: previewGeometry.rasterWidth,
    previewHeight: previewGeometry.rasterHeight,
    previewX: previewGeometry.x,
    previewY: previewGeometry.y,
    previewDocumentWidth: previewGeometry.width,
    previewDocumentHeight: previewGeometry.height,
    transform: { ...previewTransform },
    opacity: layer.opacity
  }
  selectionDraft.value = selection
  nextTick(() => void prepareSelectionMovePreview())
  return true
}

function commitKeyboardSelectionMove() {
  if (keyboardSelectionCommitTimeout) clearTimeout(keyboardSelectionCommitTimeout)
  keyboardSelectionCommitTimeout = undefined
  const interaction = selectionMoveInteraction.value
  if (!interaction || interaction.pointerId !== -2) return
  if (!interaction.deltaX && !interaction.deltaY) {
    clearSelectionMovePreview()
    return
  }
  const movedSelection = translateSelection(
    interaction.originalSelection,
    interaction.deltaX,
    interaction.deltaY
  )
  interaction.pointerId = -1
  selectionMovePending.value = true
  pendingSelectionMoveBaseSource = interaction.baseImageSource
  pendingSelectionMoveCommittedSource = undefined
  selectionDraft.value = movedSelection
  emit(
    'moveSelection',
    interaction.originalSelection,
    movedSelection,
    interaction.deltaX,
    interaction.deltaY,
    interaction.previewWidth / interaction.previewDocumentWidth,
    interaction.previewHeight / interaction.previewDocumentHeight
  )
}

function selectionMoveDelta(start: SelectionPoint, point: SelectionPoint, constrain: boolean) {
  let deltaX = point.x - start.x
  let deltaY = point.y - start.y
  if (constrain && (deltaX || deltaY)) {
    const distance = Math.hypot(deltaX, deltaY)
    const angle = Math.round(Math.atan2(deltaY, deltaX) / (Math.PI / 4)) * (Math.PI / 4)
    deltaX = Math.cos(angle) * distance
    deltaY = Math.sin(angle) * distance
  }
  return { deltaX: Math.round(deltaX), deltaY: Math.round(deltaY) }
}

function drawPendingBrushPreview() {
  const interaction = brushInteraction.value
  const layer = paintableLayer.value
  const canvas = brushPreviewCanvas.value
  if (!interaction || !layer?.image || !layer.transform || !canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  const documentToPreview: Matrix2D = interaction.selection
    ? invertMatrix(layerSourceToDocumentMatrix(layer.transform, canvas.width, canvas.height))
    : [canvas.width / props.document.width, 0, 0, canvas.height / props.document.height, 0, 0]

  context.save()
  if (interaction.selection && interaction.selectionPath) {
    const selectionToPreview = interaction.selection.kind === 'pixels'
      ? multiplyMatrices(documentToPreview, interaction.selection.sourceToDocument)
      : documentToPreview
    context.setTransform(...selectionToPreview)
    context.clip(interaction.selectionPath)
  }
  context.setTransform(...documentToPreview)
  interaction.renderedPointCount = drawBrushPoints(
    context,
    interaction.points,
    interaction.renderedPointCount,
    props.brushSize,
    props.brushColor
  )
  context.restore()
}

function clearBrushPreview() {
  const canvas = brushPreviewCanvas.value
  const context = canvas?.getContext('2d')
  context?.clearRect(0, 0, canvas!.width, canvas!.height)
  brushPreviewPending.value = false
  pendingBrushWasFree = false
  pendingBrushBaseImageSource = undefined
  pendingBrushCommittedImageSource = undefined
}

function handleLayerImageLoaded(layerId: string, source: string) {
  if (brushPreviewPending.value && source !== pendingBrushBaseImageSource) {
    pendingBrushCommittedImageSource = source
  }
  if (
    brushPreviewPending.value &&
    layerId === paintableLayer.value?.id &&
    source === pendingBrushCommittedImageSource
  ) {
    clearBrushPreview()
  }
  if (selectionMovePending.value && source !== pendingSelectionMoveBaseSource) {
    pendingSelectionMoveCommittedSource = source
  }
  if (
    selectionMovePending.value &&
    layerId === selectionMoveInteraction.value?.layerId &&
    source === pendingSelectionMoveCommittedSource
  ) {
    clearSelectionMovePreview()
  }
}

function handleLayerImageError(layerId: string, source: string) {
  if (
    brushPreviewPending.value &&
    layerId === paintableLayer.value?.id &&
    source === pendingBrushCommittedImageSource
  ) {
    clearBrushPreview()
  }
  if (
    selectionMovePending.value &&
    layerId === selectionMoveInteraction.value?.layerId &&
    source === pendingSelectionMoveCommittedSource
  ) {
    clearSelectionMovePreview()
  }
}

function createBrushSelectionPath(selection: SelectionRegion | null) {
  if (!selection) return null
  const path = new Path2D()
  if (selection.kind === 'pixels') {
    for (const span of selection.spans) path.rect(span.x0, span.y, span.x1 - span.x0, 1)
  } else if (selection.kind === 'rectangle') {
    const { x, y, width, height } = selection.bounds
    path.rect(x, y, width, height)
  } else if (selection.kind === 'ellipse') {
    const { x, y, width, height } = selection.bounds
    path.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
  } else {
    const first = selection.points[0]
    if (first) {
      path.moveTo(first.x, first.y)
      for (let index = 1; index < selection.points.length; index++) {
        const point = selection.points[index]!
        path.lineTo(point.x, point.y)
      }
      path.closePath()
    }
  }
  return path
}

function startBrushPointer(event: PointerEvent, point: SelectionPoint) {
  const scroll = scrollArea.value
  const layer = paintableLayer.value
  if (!scroll || event.button !== 0 || props.isBusy || !layer?.image) return false
  event.preventDefault()
  event.stopPropagation()
  scroll.setPointerCapture(event.pointerId)
  brushInteraction.value = {
    pointerId: event.pointerId,
    layerId: layer.id,
    points: [point],
    renderedPointCount: 0,
    selection: props.selection,
    selectionPath: createBrushSelectionPath(props.selection),
    baseImageSource: layer.image.previewUrl ?? layer.image.sourceUrl
  }
  nextTick(() => drawPendingBrushPreview())
  return true
}

function startViewportPointer(event: PointerEvent) {
  const scroll = scrollArea.value
  if (!scroll) return

  scroll.focus()
  const target = event.target as HTMLElement | null
  const isMiddleButton = event.button === 1 || (event.buttons & 4) === 4
  const temporaryZoom = isSpacePressed.value && (event.ctrlKey || event.metaKey || event.altKey)
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
  }

  if (props.activeTool === 'brush' && !isSpacePressed.value) {
    const point = pointerToDocument(event)
    if (point && startBrushPointer(event, point)) return
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
    requestZoom(nextZoomLevel(zoomTarget.value, direction), event.clientX, event.clientY)
    return
  }

  const shouldPan =
    isMiddleButton ||
    (event.button === 0 && (props.activeTool === 'hand' || (isSpacePressed.value && !temporaryZoom)))
  if (!shouldPan) return

  event.preventDefault()
  event.stopPropagation()
  discardInteractionFrame()
  dragState.value = null
  layerDragPreview.value = null
  transformInteraction.value = null
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

function startLayerPointer(event: PointerEvent, layer: LayerItem) {
  if (
    event.button !== 0 ||
    (event.buttons & 4) === 4 ||
    isPanning.value ||
    props.activeTool === 'hand' ||
    props.activeTool === 'zoom' ||
    isSpacePressed.value
  )
    return
  if (props.activeTool === 'text' && layer.kind === 'text') {
    event.stopPropagation()
    event.preventDefault()
    emit('selectLayer', layer.id)
    return
  }
  if (props.activeTool !== 'move') return

  if (transformSession.value) commitFreeTransform()

  if (props.selection && !selectionIsEmpty(props.selection)) {
    event.stopPropagation()
    event.preventDefault()
    const point = pointerToDocument(event)
    if (point && activeLayer.value?.kind === 'image') startSelectionMove(event, point, props.selection)
    return
  }

  event.stopPropagation()
  event.preventDefault()
  const targetLayer = props.activeTool === 'move' && !props.autoSelectLayer ? activeLayer.value : layer
  if (!targetLayer?.visible || targetLayer.kind === 'background') return
  if (targetLayer.id !== props.activeLayerId) emit('selectLayer', targetLayer.id)

  if (props.activeTool !== 'move' || !targetLayer.transform) return

  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  dragState.value = {
    layerId: targetLayer.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    transform: { ...targetLayer.transform }
  }
  layerDragPreview.value = { layerId: targetLayer.id, transform: { ...targetLayer.transform } }
}

function updatePointer(event: PointerEvent) {
  if (isPanning.value && scrollArea.value && panStart.value.pointerId === event.pointerId) {
    event.preventDefault()
    const scrollLeft = panStart.value.scrollLeft - (event.clientX - panStart.value.x)
    const scrollTop = panStart.value.scrollTop - (event.clientY - panStart.value.y)
    scheduleInteractionFrame(() => {
      if (!isPanning.value || !scrollArea.value) return
      scrollArea.value.scrollLeft = scrollLeft
      scrollArea.value.scrollTop = scrollTop
    })
    return
  }

  const activeSelection = selectionInteraction.value
  if (activeSelection?.pointerId === event.pointerId) {
    const rawPoint = pointerToDocument(event)
    if (!rawPoint) return
    event.preventDefault()
    const point = rawPoint
    if (activeSelection.mode === 'lasso') {
      const previous = activeSelection.points.at(-1)!
      const minimumDistance = Math.max(0.25, 1.5 / scale.value)
      if ((point.x - previous.x) ** 2 + (point.y - previous.y) ** 2 < minimumDistance ** 2) return
      activeSelection.points.push(point)
      const points = activeSelection.points.slice()
      scheduleInteractionFrame(() => {
        if (selectionInteraction.value?.pointerId !== event.pointerId) return
        selectionDraft.value = { kind: 'lasso', points, bounds: pointsBounds(points) }
      })
    } else {
      const endpoint = event.shiftKey
        ? constrainedSelectionEndpoint(
            activeSelection.start,
            point,
            Number.POSITIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            Number.NEGATIVE_INFINITY
          )
        : point
      const selection = createShapeSelection(activeSelection.mode, activeSelection.start, endpoint, event.shiftKey)
      scheduleInteractionFrame(() => {
        if (selectionInteraction.value?.pointerId !== event.pointerId) return
        selectionDraft.value = selection
      })
    }
    return
  }

  const activeBrush = brushInteraction.value
  if (activeBrush?.pointerId === event.pointerId) {
    event.preventDefault()
    const spacing = brushPointSpacing(props.brushSize, scale.value)
    const samples = event.getCoalescedEvents?.() ?? []
    for (const sample of samples) {
      const point = pointerToDocument(sample)
      if (point) appendBrushPoint(activeBrush.points, point, spacing)
    }
    const point = pointerToDocument(event)
    if (point) appendBrushPoint(activeBrush.points, point, spacing)
    scheduleInteractionFrame(() => {
      if (brushInteraction.value?.pointerId !== event.pointerId) return
      drawPendingBrushPreview()
    })
    return
  }

  const activeSelectionMove = selectionMoveInteraction.value
  if (activeSelectionMove?.pointerId === event.pointerId) {
    const point = pointerToDocument(event)
    if (!point) return
    event.preventDefault()
    const delta = selectionMoveDelta(activeSelectionMove.start, point, event.shiftKey)
    scheduleInteractionFrame(() => {
      const interaction = selectionMoveInteraction.value
      if (!interaction || interaction.pointerId !== event.pointerId) return
      interaction.deltaX = delta.deltaX
      interaction.deltaY = delta.deltaY
      selectionDraft.value = translateSelection(
        interaction.originalSelection,
        interaction.deltaX,
        interaction.deltaY
      )
      redrawSelectionMovePreview()
    })
    return
  }

  const interaction = transformInteraction.value
  if (interaction?.pointerId === event.pointerId && transformSession.value) {
    const pointer = pointerToDocument(event)
    if (!pointer) return

    event.preventDefault()
    let transform: LayerTransform
    if (interaction.type === 'move') {
      transform = moveLayerTransform(interaction.initial, interaction.start, pointer)
    } else if (interaction.type === 'resize') {
      const isCorner = interaction.handle.x !== 0 && interaction.handle.y !== 0
      const fromCenter = event.altKey || modifierKeys.value.alt
      const freeProportions = event.shiftKey || modifierKeys.value.shift
      transform = resizeLayerTransform(
        interaction.initial,
        interaction.handle,
        pointer,
        fromCenter,
        isCorner && !freeProportions
      )
    } else {
      const snapRotation = event.shiftKey || modifierKeys.value.shift
      transform = rotateLayerTransform(interaction.initial, interaction.startAngle, pointer, snapRotation)
    }

    const layerId = transformSession.value.layerId
    scheduleInteractionFrame(() => {
      const session = transformSession.value
      if (!session || session.layerId !== layerId) return
      session.draft = transform
    })
    return
  }

  if (dragState.value?.pointerId === event.pointerId) {
    const drag = dragState.value
    const transform = {
      ...drag.transform,
      x: Math.round(drag.transform.x + (event.clientX - drag.startX) / scale.value),
      y: Math.round(drag.transform.y + (event.clientY - drag.startY) / scale.value)
    }
    scheduleInteractionFrame(() => {
      if (dragState.value?.layerId !== drag.layerId) return
      layerDragPreview.value = { layerId: drag.layerId, transform }
    })
    return
  }
}

function stopPointer(event: PointerEvent) {
  flushInteractionFrame()
  if (selectionInteraction.value?.pointerId === event.pointerId) {
    let completed = selectionDraft.value
    if (completed?.kind === 'lasso') {
      completed = createLassoSelection(completed.points, Math.max(0.2, 0.75 / scale.value))
    }
    if (completed) {
      const bounds = selectionBounds()
      completed = clampSelectionToBounds(completed, bounds)
      completed = snapShapeSelectionToBounds(completed, bounds, 6 / Math.max(scale.value, 0.01))
    }
    emit('update:selection', completed && !selectionIsEmpty(completed) ? completed : null)
    selectionInteraction.value = null
    selectionDraft.value = null
  }
  if (brushInteraction.value?.pointerId === event.pointerId) {
    const interaction = brushInteraction.value
    const finalPoint = pointerToDocument(event)
    if (finalPoint) appendBrushPoint(interaction.points, finalPoint, 0, true)
    drawPendingBrushPreview()
    brushInteraction.value = null
    if (event.type !== 'pointercancel' && interaction.points.length > 0) {
      pendingBrushBaseImageSource = interaction.baseImageSource
      pendingBrushCommittedImageSource = undefined
      pendingBrushWasFree = !interaction.selection
      brushPreviewPending.value = true
      emit('paintStroke', interaction.points, props.brushSize, props.brushColor, interaction.selection)
    } else {
      clearBrushPreview()
    }
  }
  if (selectionMoveInteraction.value?.pointerId === event.pointerId) {
    const interaction = selectionMoveInteraction.value
    unbindSelectionMoveWindowEvents()
    if (event.type === 'pointercancel' || (!interaction.deltaX && !interaction.deltaY)) {
      clearSelectionMovePreview()
    } else {
      const movedSelection = translateSelection(
        interaction.originalSelection,
        interaction.deltaX,
        interaction.deltaY
      )
      interaction.pointerId = -1
      selectionMovePending.value = true
      pendingSelectionMoveBaseSource = interaction.baseImageSource
      pendingSelectionMoveCommittedSource = undefined
      selectionDraft.value = movedSelection
      emit(
        'moveSelection',
        interaction.originalSelection,
        movedSelection,
        interaction.deltaX,
        interaction.deltaY,
        interaction.previewWidth / interaction.previewDocumentWidth,
        interaction.previewHeight / interaction.previewDocumentHeight
      )
    }
  }
  if (transformInteraction.value?.pointerId === event.pointerId) transformInteraction.value = null
  if (dragState.value?.pointerId === event.pointerId) {
    const preview = layerDragPreview.value
    if (preview?.layerId === dragState.value.layerId && !transformsMatch(dragState.value.transform, preview.transform)) {
      emit('updateTransform', preview.layerId, { ...preview.transform })
    }
    dragState.value = null
    layerDragPreview.value = null
  }
  if (panStart.value.pointerId === event.pointerId) {
    isPanning.value = false
    panStart.value.pointerId = -1
  }
}

function handleLostPointerCapture(event: PointerEvent) {
  if (
    event.buttons !== 0 &&
    selectionMoveInteraction.value?.pointerId === event.pointerId
  ) return
  stopPointer(event)
}

function defaultZoomAnchor() {
  const scroll = scrollArea.value
  if (!scroll) return undefined

  const viewport = scroll.getBoundingClientRect()
  const canvasLeft = viewport.left + viewportSize.value.width - scroll.scrollLeft
  const canvasTop = viewport.top + viewportSize.value.height - scroll.scrollTop
  const canvasRight = canvasLeft + scaledDocumentSize.value.width
  const canvasBottom = canvasTop + scaledDocumentSize.value.height
  return {
    x: Math.max(canvasLeft, Math.min(canvasRight, viewport.left + viewport.width / 2)),
    y: Math.max(canvasTop, Math.min(canvasBottom, viewport.top + viewport.height / 2))
  }
}

function captureZoomNavigation(clientX?: number, clientY?: number) {
  const scroll = scrollArea.value
  if (!scroll) return

  const anchor = clientX === undefined || clientY === undefined ? defaultZoomAnchor() : { x: clientX, y: clientY }
  if (!anchor) return

  const viewport = scroll.getBoundingClientRect()
  const viewportX = anchor.x - viewport.left
  const viewportY = anchor.y - viewport.top
  pendingNavigation = {
    type: 'anchor',
    viewportX,
    viewportY,
    documentX: (scroll.scrollLeft + viewportX - viewportSize.value.width) / scale.value,
    documentY: (scroll.scrollTop + viewportY - viewportSize.value.height) / scale.value
  }
}

function applyPendingNavigation() {
  const scroll = scrollArea.value
  const navigation = pendingNavigation
  pendingNavigation = undefined
  if (!scroll || !navigation) return

  if (navigation.type === 'center') {
    scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2
    scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) / 2
    return
  }

  scroll.scrollLeft = viewportSize.value.width + navigation.documentX * scale.value - navigation.viewportX
  scroll.scrollTop = viewportSize.value.height + navigation.documentY * scale.value - navigation.viewportY
}

function schedulePendingNavigation() {
  if (navigationScheduled) return
  navigationScheduled = true

  // Vue applies the new scale before resolving nextTick. Updating the scroll
  // here keeps both operations in the same browser frame and avoids exposing
  // an intermediate, incorrectly anchored canvas during continuous zoom.
  void nextTick(() => {
    navigationScheduled = false
    applyPendingNavigation()
  })
}

function stageZoom(value: number, clientX?: number, clientY?: number) {
  captureZoomNavigation(clientX, clientY)
  visualZoom.value = clampZoom(value)
  schedulePendingNavigation()
}

function stopWheelZoomAnimation() {
  cancelAnimationFrame(wheelZoomFrame)
  wheelZoomFrame = 0
  wheelZoomFrameTime = 0
  wheelZoomAnchor = undefined
}

function animateWheelZoom(timestamp: number) {
  const elapsed = wheelZoomFrameTime ? Math.min(34, timestamp - wheelZoomFrameTime) : 16.67
  wheelZoomFrameTime = timestamp

  const current = visualZoom.value
  const target = zoomTarget.value
  const blend = 1 - Math.exp(-elapsed / 42)
  const interpolated = current * Math.exp(Math.log(target / current) * blend)
  const roundedZoom = clampZoom(interpolated)
  const complete = Math.abs(Math.log(target / interpolated)) < 0.001 || roundedZoom === current
  const nextZoom = complete ? target : roundedZoom
  const anchor = wheelZoomAnchor

  stageZoom(nextZoom, anchor?.clientX, anchor?.clientY)

  if (complete) {
    wheelZoomFrame = 0
    wheelZoomFrameTime = 0
    wheelZoomAnchor = undefined
    emit('update:zoom', target)
    return
  }

  wheelZoomFrame = requestAnimationFrame(animateWheelZoom)
}

function startWheelZoomAnimation() {
  if (wheelZoomFrame) return
  wheelZoomFrame = requestAnimationFrame(animateWheelZoom)
}

function requestZoom(value: number, clientX?: number, clientY?: number) {
  const nextZoom = clampZoom(value)
  stopWheelZoomAnimation()
  zoomTarget.value = nextZoom
  stageZoom(nextZoom, clientX, clientY)
  emit('update:zoom', nextZoom)
}

function zoomIn() {
  requestZoom(nextZoomLevel(zoomTarget.value, 1))
}

function zoomOut() {
  requestZoom(nextZoomLevel(zoomTarget.value, -1))
}

function fitDocument() {
  const scroll = scrollArea.value
  if (!scroll) return

  const availableWidth = Math.max(1, scroll.clientWidth - 96)
  const availableHeight = Math.max(1, scroll.clientHeight - 96)
  const fittedZoom = clampZoom(
    Math.min(MAX_ZOOM / 100, availableWidth / props.document.width, availableHeight / props.document.height) * 100
  )
  stopWheelZoomAnimation()
  pendingNavigation = { type: 'center' }
  visualZoom.value = fittedZoom
  zoomTarget.value = fittedZoom
  emit('update:zoom', fittedZoom)
  schedulePendingNavigation()
}

function syncViewportSize() {
  const scroll = scrollArea.value
  if (!scroll) return

  const width = scroll.clientWidth
  const height = scroll.clientHeight
  if (viewportSize.value.width === width && viewportSize.value.height === height) return

  viewportSize.value = { width, height }
}

async function initializeViewport() {
  const initialization = ++viewportInitialization
  isViewportReady.value = false

  // The first measurement has no scrollbars yet. Render the pasteboard once,
  // then measure again so fit and centering use the stable editing area.
  syncViewportSize()
  await nextTick()
  syncViewportSize()
  await nextTick()
  fitDocument()
  await nextTick()

  if (initialization !== viewportInitialization) return
  applyPendingNavigation()
  isViewportReady.value = true
}

watch(
  () => props.zoom,
  (value) => {
    zoomTarget.value = value
    if (Math.abs(value - visualZoom.value) < 0.005) {
      schedulePendingNavigation()
      return
    }

    stopWheelZoomAnimation()
    stageZoom(value)
  }
)

watch(
  () => [props.document.id, props.document.width, props.document.height],
  () => void initializeViewport()
)

watch(
  () => props.activeLayerId,
  (layerId) => {
    if (transformSession.value && transformSession.value.layerId !== layerId) commitFreeTransform()
  }
)

watch(
  () => props.selectionMoveAnchor?.image.previewUrl ?? props.selectionMoveAnchor?.image.sourceUrl,
  (source) => {
    if (!source || cachedSelectionMoveImage?.source !== source) cachedSelectionMoveImage = undefined
  }
)

watch(
  () => paintableLayer.value?.image?.previewUrl ?? paintableLayer.value?.image?.sourceUrl,
  (source) => {
    if (brushPreviewPending.value && source && source !== pendingBrushBaseImageSource) {
      pendingBrushCommittedImageSource = source
    }
    if (selectionMovePending.value && source && source !== pendingSelectionMoveBaseSource) {
      pendingSelectionMoveCommittedSource = source
    }
  }
)

watch(
  () => props.isBusy,
  (busy) => {
    if (busy) return
    const currentSource = paintableLayer.value?.image?.previewUrl ?? paintableLayer.value?.image?.sourceUrl
    if (brushPreviewPending.value) {
      if (currentSource && currentSource !== pendingBrushBaseImageSource) {
        pendingBrushCommittedImageSource = currentSource
      } else {
        clearBrushPreview()
      }
    }
    if (selectionMovePending.value) {
      if (currentSource && currentSource !== pendingSelectionMoveBaseSource) {
        pendingSelectionMoveCommittedSource = currentSource
      } else {
        clearSelectionMovePreview()
      }
    }
  }
)

watch(
  () => props.activeTool,
  (tool) => {
    if (tool !== 'crop' && selectionInteraction.value) {
      discardInteractionFrame()
      selectionInteraction.value = null
      selectionDraft.value = null
    }
    if (tool !== 'brush' && brushInteraction.value) {
      discardInteractionFrame()
      clearBrushPreview()
      brushInteraction.value = null
    }
    if (
      tool !== 'move' &&
      selectionMoveInteraction.value &&
      selectionMoveInteraction.value.pointerId !== -1
    ) {
      discardInteractionFrame()
      clearSelectionMovePreview()
    }
  }
)

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('keyup', handleWindowKeyup)
  window.addEventListener('blur', resetInteractionKeys)
  if (scrollArea.value) {
    syncViewportSize()
    resizeObserver = new ResizeObserver(() => {
      syncViewportSize()
    })
    resizeObserver.observe(scrollArea.value)
    void initializeViewport()
  }
})

onBeforeUnmount(() => {
  unbindSelectionMoveWindowEvents()
  cachedSelectionMoveImage = undefined
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('keyup', handleWindowKeyup)
  window.removeEventListener('blur', resetInteractionKeys)
  cancelAnimationFrame(interactionFrame)
  stopWheelZoomAnimation()
  resizeObserver?.disconnect()
  if (nativeScrollTimeout) clearTimeout(nativeScrollTimeout)
  if (keyboardSelectionCommitTimeout) clearTimeout(keyboardSelectionCommitTimeout)
})

defineExpose({
  commitPendingTransform: commitFreeTransform,
  fitDocument,
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
    @wheel="handleWheel"
  >
    <div class="context-bar">
      <span>{{ activeTool }}</span>
      <div v-if="activeTool === 'crop'" class="selection-options">
        <label>
          Modo
          <select
            :value="selectionMode"
            @change="emit('update:selectionMode', ($event.target as HTMLSelectElement).value as SelectionMode)"
          >
            <option value="rectangle">Retângulo</option>
            <option value="ellipse">Elipse</option>
            <option value="lasso">Laço livre</option>
            <option value="magic-wand">Varinha mágica</option>
          </select>
        </label>
        <label v-if="selectionMode === 'magic-wand'" class="selection-tolerance">
          Tolerância
          <input
            :value="magicWandTolerance"
            max="255"
            min="0"
            type="range"
            @input="emit('update:magicWandTolerance', Number(($event.target as HTMLInputElement).value))"
          />
          <output>{{ magicWandTolerance }}</output>
        </label>
        <label v-if="selectionMode === 'magic-wand'" class="selection-contiguous">
          <input
            :checked="magicWandContiguous"
            type="checkbox"
            @change="emit('update:magicWandContiguous', ($event.target as HTMLInputElement).checked)"
          />
          Contíguo
        </label>
        <button :disabled="!visibleSelection" type="button" title="Apagar pixels selecionados (Delete)" @click="emit('deleteSelection')">
          Apagar
        </button>
        <button :disabled="!visibleSelection" type="button" title="Desmarcar (Ctrl+D)" @click="emit('update:selection', null)">
          Desmarcar
        </button>
      </div>
      <span v-if="activeTool === 'move' && visibleSelection" class="selection-move-hint">
        Arraste dentro da seleção para mover os pixels · Ctrl+D move a camada inteira
      </span>
      <label
        v-else-if="activeTool === 'move'"
        class="auto-select-control"
        title="Ao desativar, clicar no documento mantém e move a camada selecionada"
      >
        <input
          :checked="autoSelectLayer"
          type="checkbox"
          @change="emit('update:autoSelectLayer', ($event.target as HTMLInputElement).checked)"
        />
        <span>Seleção automática</span>
      </label>
      <span v-if="activeTool === 'brush' || activeTool === 'eraser'">{{ brushSize }} px</span>
      <span>{{ document.width }} × {{ document.height }}</span>
      <span>{{ document.unit === 'cm' ? `${document.physicalWidth} × ${document.physicalHeight} cm` : 'pixels' }}</span>
      <span>{{ isViewportReady ? `${formatZoom(visualZoom)}%` : '—' }}</span>
      <div v-if="isTransforming" class="zoom-actions transform-actions">
        <span>{{ activeDisplayTransform?.rotation ?? 0 }}°</span>
        <button type="button" title="Cancelar transformação (Esc)" @click="cancelFreeTransform">Cancelar</button>
        <button type="button" title="Aplicar transformação (Enter)" @click="commitFreeTransform">Aplicar</button>
      </div>
      <div v-else class="zoom-actions">
        <button type="button" title="Reduzir zoom (Ctrl+-)" @click="zoomOut">−</button>
        <button type="button" title="Ajustar à tela (Ctrl+0)" @click="fitDocument">Ajustar</button>
        <button type="button" title="Aumentar zoom (Ctrl++)" @click="zoomIn">+</button>
      </div>
    </div>

    <div
      ref="scrollArea"
      class="canvas-scroll"
      :class="viewportCursorClass"
      tabindex="0"
      @auxclick.prevent
      @lostpointercapture="handleLostPointerCapture"
      @pointercancel="stopPointer"
      @pointerdown.capture="startViewportPointer"
      @pointermove="updatePointer"
      @pointerup="stopPointer"
      @scroll.passive="handleNativeScroll"
    >
      <div class="canvas-pasteboard" :style="pasteboardStyle">
        <div class="canvas-frame" :style="frameStyle">
          <div ref="surface" class="canvas-surface" :style="surfaceStyle">
            <div class="transparent-grid"></div>
            <div class="document-background" :style="backgroundStyle"></div>
            <div class="document-layers">
              <template v-for="layer in renderedLayers" :key="layer.id">
                <CanvasLayer
                  :active="layer.id === activeLayerId"
                  :content-hidden="selectionMoveHidesLayer(layer.id)"
                  :layer="layer"
                  :transform="displayTransform(layer) ?? defaultLayerTransform"
                  @image-error="handleLayerImageError"
                  @image-loaded="handleLayerImageLoaded"
                  @pointerdown="startLayerPointer($event, layer)"
                />
                <canvas
                  v-if="
                    selectionMovePreviewStyle &&
                    selectionMoveInteraction?.layerId === layer.id
                  "
                  :ref="captureSelectionMoveCanvas"
                  class="selection-move-preview"
                  :style="selectionMovePreviewStyle"
                  :width="selectionMoveInteraction.previewWidth"
                  :height="selectionMoveInteraction.previewHeight"
                ></canvas>
              </template>
            </div>
            <canvas
              v-if="brushPreviewStyle && paintableLayer?.image"
              ref="brushPreviewCanvas"
              class="brush-preview"
              :style="brushPreviewStyle"
              :width="brushPreviewDimensions.width"
              :height="brushPreviewDimensions.height"
            ></canvas>
            <SelectionOverlay
              v-if="visibleSelection"
              :document-height="document.height"
              :document-width="document.width"
              :selection="visibleSelection"
            />
            <div
              v-if="freeTransformStyle"
              class="free-transform-box"
              :style="freeTransformStyle"
              @dblclick.stop="commitFreeTransform"
            >
              <div class="free-transform-body" title="Arraste para mover" @pointerdown="startTransformMove"></div>
              <div class="free-transform-origin" aria-hidden="true"></div>
              <div class="free-transform-rotate-stem" aria-hidden="true"></div>
              <button
                class="free-transform-rotate"
                type="button"
                title="Girar; segure Shift para passos de 15°"
                aria-label="Girar camada"
                @pointerdown="startTransformRotate"
              >
                <svg
                  class="free-transform-rotate-icon"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                >
                  <path class="free-transform-rotate-icon-outline" d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />
                  <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />
                </svg>
              </button>
              <button
                v-for="handle in TRANSFORM_HANDLES"
                :key="handle.id"
                class="free-transform-handle"
                :style="{ left: `${handle.left}%`, top: `${handle.top}%`, cursor: handle.cursor }"
                type="button"
                :aria-label="`Redimensionar por ${handle.id}`"
                title="Arraste para redimensionar; Alt usa o centro; Shift libera a proporção"
                @pointerdown="startTransformResize($event, handle)"
              ></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

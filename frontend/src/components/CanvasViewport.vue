<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CanvasLayer from './CanvasLayer.vue'
import type { DocumentSpec, EditorTool, ImportedImage, LayerItem, LayerTransform } from '../types/editor'
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

const props = defineProps<{
  activeLayerId: string
  activeTool: EditorTool
  brushSize: number
  document: DocumentSpec
  layers: LayerItem[]
  zoom: number
}>()

const emit = defineEmits<{
  (event: 'update:zoom', zoom: number): void
  (event: 'imagesDropped', images: ImportedImage[], errors: string[]): void
  (event: 'selectLayer', layerId: string): void
  (event: 'updateTransform', layerId: string, transform: LayerTransform): void
}>()

const scrollArea = ref<HTMLDivElement | null>(null)
const surface = ref<HTMLDivElement | null>(null)
const isPanning = ref(false)
const isSpacePressed = ref(false)
const modifierKeys = ref({ alt: false, command: false, shift: false })
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
let resizeObserver: ResizeObserver | undefined
let navigationFrame = 0
let interactionFrame = 0
let wheelZoomFrame = 0
let pendingInteractionFrame: (() => void) | undefined
let pendingWheelZoom: { value: number; clientX: number; clientY: number } | undefined
let viewportInitialization = 0
let pendingNavigation:
  | { type: 'anchor'; clientX: number; clientY: number; documentX: number; documentY: number }
  | { type: 'center' }
  | undefined

const scale = computed(() => props.zoom / 100)
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
const renderedLayers = computed(() => [...props.layers].reverse().filter((layer) => layer.kind !== 'background'))
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
const isTransforming = computed(() => Boolean(transformSession.value))
const activeDisplayTransform = computed(() => {
  const layer = activeLayer.value
  if (!layer) return undefined
  return displayTransform(layer)
})
const selectionStyle = computed(() => {
  const transform = activeDisplayTransform.value
  if (!transform || !activeLayer.value?.visible || isTransforming.value) return undefined
  return positionedTransformStyle(transform)
})
const freeTransformStyle = computed(() => {
  const transform = activeDisplayTransform.value
  if (!transform || !activeLayer.value?.visible || !isTransforming.value) return undefined
  return positionedTransformStyle(transform)
})
const viewportCursorClass = computed(() => ({
  'canvas-scroll--ready': isViewportReady.value,
  'canvas-scroll--panning': isPanning.value,
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
    const value = wheelZoomLevel(zoomTarget.value, event.deltaY)
    zoomTarget.value = value
    pendingWheelZoom = { value, clientX: event.clientX, clientY: event.clientY }
    if (!wheelZoomFrame) {
      wheelZoomFrame = requestAnimationFrame(() => {
        wheelZoomFrame = 0
        const pending = pendingWheelZoom
        pendingWheelZoom = undefined
        if (pending) requestZoom(pending.value, pending.clientX, pending.clientY)
      })
    }
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

function handleCanvasKeydown(event: KeyboardEvent) {
  const scroll = scrollArea.value
  if (!scroll) return

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
  if (isEditableTarget(event.target)) return

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

  if (!event.ctrlKey && !event.metaKey) return

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
}

function resetInteractionKeys() {
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
  if (props.activeTool !== 'move' && props.activeTool !== 'select') return

  if (transformSession.value) commitFreeTransform()

  event.stopPropagation()
  event.preventDefault()
  emit('selectLayer', layer.id)

  if (props.activeTool !== 'move' || !layer.transform) return

  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  dragState.value = {
    layerId: layer.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    transform: { ...layer.transform }
  }
  layerDragPreview.value = { layerId: layer.id, transform: { ...layer.transform } }
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

function defaultZoomAnchor() {
  const scroll = scrollArea.value
  const canvas = surface.value
  if (!scroll || !canvas) return undefined

  const viewport = scroll.getBoundingClientRect()
  const bounds = canvas.getBoundingClientRect()
  return {
    x: Math.max(bounds.left, Math.min(bounds.right, viewport.left + viewport.width / 2)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, viewport.top + viewport.height / 2))
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

  const canvas = surface.value
  if (!canvas) return
  const bounds = canvas.getBoundingClientRect()
  const currentX = bounds.left + navigation.documentX * scale.value
  const currentY = bounds.top + navigation.documentY * scale.value
  scroll.scrollLeft += currentX - navigation.clientX
  scroll.scrollTop += currentY - navigation.clientY
}

function schedulePendingNavigation() {
  void nextTick(() => {
    cancelAnimationFrame(navigationFrame)
    navigationFrame = requestAnimationFrame(applyPendingNavigation)
  })
}

function requestZoom(value: number, clientX?: number, clientY?: number) {
  const nextZoom = clampZoom(value)
  const canvas = surface.value
  const anchor = clientX === undefined || clientY === undefined ? defaultZoomAnchor() : { x: clientX, y: clientY }

  if (canvas && anchor) {
    const bounds = canvas.getBoundingClientRect()
    pendingNavigation = {
      type: 'anchor',
      clientX: anchor.x,
      clientY: anchor.y,
      documentX: (anchor.x - bounds.left) / scale.value,
      documentY: (anchor.y - bounds.top) / scale.value
    }
  }

  zoomTarget.value = nextZoom
  emit('update:zoom', nextZoom)
  schedulePendingNavigation()
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
  pendingNavigation = { type: 'center' }
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
  cancelAnimationFrame(navigationFrame)
  applyPendingNavigation()
  isViewportReady.value = true
}

watch(
  () => props.zoom,
  (value) => {
    zoomTarget.value = value
    schedulePendingNavigation()
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
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('keyup', handleWindowKeyup)
  window.removeEventListener('blur', resetInteractionKeys)
  cancelAnimationFrame(navigationFrame)
  cancelAnimationFrame(interactionFrame)
  cancelAnimationFrame(wheelZoomFrame)
  resizeObserver?.disconnect()
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
      <span v-if="activeTool === 'brush' || activeTool === 'eraser'">{{ brushSize }} px</span>
      <span>{{ document.width }} × {{ document.height }}</span>
      <span>{{ document.unit === 'cm' ? `${document.physicalWidth} × ${document.physicalHeight} cm` : 'pixels' }}</span>
      <span>{{ isViewportReady ? `${formatZoom(zoom)}%` : '—' }}</span>
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
      @lostpointercapture="stopPointer"
      @pointercancel="stopPointer"
      @pointerdown.capture="startViewportPointer"
      @pointermove="updatePointer"
      @pointerup="stopPointer"
    >
      <div class="canvas-pasteboard" :style="pasteboardStyle">
        <div class="canvas-frame" :style="frameStyle">
          <div ref="surface" class="canvas-surface" :style="surfaceStyle">
            <div class="transparent-grid"></div>
            <div class="document-background" :style="backgroundStyle"></div>
            <div class="document-layers">
              <CanvasLayer
                v-for="layer in renderedLayers"
                :key="layer.id"
                :active="layer.id === activeLayerId"
                :layer="layer"
                :transform="displayTransform(layer) ?? defaultLayerTransform"
                @pointerdown="startLayerPointer($event, layer)"
              />
            </div>
            <div v-if="selectionStyle" class="layer-selection" :style="selectionStyle"></div>
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
            <div v-if="!layers.some((layer) => layer.kind === 'image')" class="drop-hint">
              Arraste uma imagem para começar
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

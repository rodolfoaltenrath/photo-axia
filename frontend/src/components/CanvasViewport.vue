<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DocumentSpec, EditorTool, ImportedImage, LayerItem, LayerTransform } from '../types/editor'
import { readBrowserImages } from '../services/imageImport'
import {
  clampZoom,
  formatZoom,
  MAX_ZOOM,
  nextZoomLevel,
  wheelZoomLevel
} from '../editor/viewport'

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
const modifierKeys = ref({ alt: false, command: false })
const zoomTarget = ref(props.zoom)
const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0, pointerId: -1 })
const dragState = ref<{
  layerId: string
  pointerId: number
  startX: number
  startY: number
  transform: LayerTransform
} | null>(null)
let resizeObserver: ResizeObserver | undefined
let pendingNavigation:
  | { type: 'anchor'; clientX: number; clientY: number; documentX: number; documentY: number }
  | { type: 'center' }
  | undefined

const scale = computed(() => props.zoom / 100)
const frameStyle = computed(() => ({
  width: `${Math.max(1, props.document.width * scale.value)}px`,
  height: `${Math.max(1, props.document.height * scale.value)}px`
}))
const surfaceStyle = computed(() => ({
  width: `${props.document.width}px`,
  height: `${props.document.height}px`,
  transform: `scale(${scale.value})`
}))
const renderedLayers = computed(() => [...props.layers].reverse().filter((layer) => layer.kind !== 'background'))
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
const selectionStyle = computed(() => {
  const transform = activeLayer.value?.transform
  if (!transform || !activeLayer.value?.visible) return undefined
  return {
    left: `${transform.x}px`,
    top: `${transform.y}px`,
    width: `${transform.width}px`,
    height: `${transform.height}px`
  }
})
const viewportCursorClass = computed(() => ({
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

function layerStyle(layer: Pick<LayerItem, 'transform' | 'opacity'>) {
  const transform = layer.transform ?? {
    x: 0,
    y: 0,
    width: props.document.width,
    height: props.document.height
  }

  return {
    left: `${transform.x}px`,
    top: `${transform.y}px`,
    width: `${transform.width}px`,
    height: `${transform.height}px`,
    opacity: layer.opacity === undefined ? 1 : layer.opacity / 100
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
    requestZoom(wheelZoomLevel(zoomTarget.value, event.deltaY), event.clientX, event.clientY)
    return
  }

  if (event.shiftKey && scroll) {
    event.preventDefault()
    scroll.scrollLeft += event.deltaY || event.deltaX
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
  modifierKeys.value = { alt: event.altKey, command: event.ctrlKey || event.metaKey }
}

function handleWindowKeydown(event: KeyboardEvent) {
  updateModifierKeys(event)
  if (isEditableTarget(event.target)) return

  if (event.code === 'Space') {
    event.preventDefault()
    isSpacePressed.value = true
  }

  if (!event.ctrlKey && !event.metaKey) return

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
  modifierKeys.value = { alt: false, command: false }
}

function startViewportPointer(event: PointerEvent) {
  const scroll = scrollArea.value
  if (!scroll) return

  scroll.focus()
  const temporaryZoom = isSpacePressed.value && (event.ctrlKey || event.metaKey || event.altKey)
  const shouldZoom = event.button === 0 && (props.activeTool === 'zoom' || temporaryZoom)
  if (shouldZoom) {
    event.preventDefault()
    const direction = event.altKey ? -1 : 1
    requestZoom(nextZoomLevel(zoomTarget.value, direction), event.clientX, event.clientY)
    return
  }

  const shouldPan =
    event.button === 1 ||
    (event.button === 0 && (props.activeTool === 'hand' || (isSpacePressed.value && !temporaryZoom)))
  if (!shouldPan) return

  event.preventDefault()
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
  if (event.button !== 0 || props.activeTool === 'hand' || props.activeTool === 'zoom' || isSpacePressed.value) return
  if (props.activeTool !== 'move' && props.activeTool !== 'select') return

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
}

function updatePointer(event: PointerEvent) {
  if (dragState.value?.pointerId === event.pointerId) {
    const drag = dragState.value
    emit('updateTransform', drag.layerId, {
      ...drag.transform,
      x: Math.round(drag.transform.x + (event.clientX - drag.startX) / scale.value),
      y: Math.round(drag.transform.y + (event.clientY - drag.startY) / scale.value)
    })
    return
  }

  if (!isPanning.value || !scrollArea.value || panStart.value.pointerId !== event.pointerId) return
  event.preventDefault()
  scrollArea.value.scrollLeft = panStart.value.scrollLeft - (event.clientX - panStart.value.x)
  scrollArea.value.scrollTop = panStart.value.scrollTop - (event.clientY - panStart.value.y)
}

function stopPointer(event: PointerEvent) {
  if (dragState.value?.pointerId === event.pointerId) dragState.value = null
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
  const canvas = surface.value
  const navigation = pendingNavigation
  pendingNavigation = undefined
  if (!scroll || !canvas || !navigation) return

  if (navigation.type === 'center') {
    scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2
    scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) / 2
    return
  }

  const bounds = canvas.getBoundingClientRect()
  const currentX = bounds.left + navigation.documentX * scale.value
  const currentY = bounds.top + navigation.documentY * scale.value
  scroll.scrollLeft += currentX - navigation.clientX
  scroll.scrollTop += currentY - navigation.clientY
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
  if (Math.abs(nextZoom - props.zoom) < 0.001) void nextTick(applyPendingNavigation)
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
  if (Math.abs(fittedZoom - props.zoom) < 0.001) void nextTick(applyPendingNavigation)
}

watch(
  () => props.zoom,
  (value) => {
    zoomTarget.value = value
    void nextTick(applyPendingNavigation)
  }
)

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('keyup', handleWindowKeyup)
  window.addEventListener('blur', resetInteractionKeys)
  if (scrollArea.value) {
    resizeObserver = new ResizeObserver(() => {
      if (props.document.id === 'draft') fitDocument()
    })
    resizeObserver.observe(scrollArea.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('keyup', handleWindowKeyup)
  window.removeEventListener('blur', resetInteractionKeys)
  resizeObserver?.disconnect()
})

defineExpose({ fitDocument, zoomToActualSize: () => requestZoom(100) })
</script>

<template>
  <section
    class="canvas-stage"
    aria-label="Área de edição"
    @dragover.prevent
    @drop="handleDrop"
    @keydown="handleCanvasKeydown"
    @pointerdown="startViewportPointer"
    @pointermove="updatePointer"
    @pointerup="stopPointer"
    @pointercancel="stopPointer"
    @auxclick.prevent
    @wheel="handleWheel"
  >
    <div class="context-bar">
      <span>{{ activeTool }}</span>
      <span v-if="activeTool === 'brush' || activeTool === 'eraser'">{{ brushSize }} px</span>
      <span>{{ document.width }} × {{ document.height }}</span>
      <span>{{ document.unit === 'cm' ? `${document.physicalWidth} × ${document.physicalHeight} cm` : 'pixels' }}</span>
      <span>{{ formatZoom(zoom) }}%</span>
      <div class="zoom-actions">
        <button type="button" title="Reduzir zoom (Ctrl+-)" @click="zoomOut">−</button>
        <button type="button" title="Ajustar à tela (Ctrl+0)" @click="fitDocument">Ajustar</button>
        <button type="button" title="Aumentar zoom (Ctrl++)" @click="zoomIn">+</button>
      </div>
    </div>

    <div ref="scrollArea" class="canvas-scroll" :class="viewportCursorClass" tabindex="0">
      <div class="canvas-frame" :style="frameStyle">
        <div ref="surface" class="canvas-surface" :style="surfaceStyle">
          <div class="transparent-grid"></div>
          <div class="document-background" :style="backgroundStyle"></div>
          <div class="document-layers">
            <div
              v-for="layer in renderedLayers"
              v-show="layer.visible"
              :key="layer.id"
              class="document-layer"
              :class="{ 'document-layer--active': layer.id === activeLayerId }"
              :style="layerStyle(layer)"
              @pointerdown="startLayerPointer($event, layer)"
            >
              <img
                v-if="layer.kind === 'image' && layer.image"
                :alt="layer.name"
                draggable="false"
                :src="layer.image.sourceUrl"
              />
            </div>
          </div>
          <div v-if="selectionStyle" class="layer-selection" :style="selectionStyle"></div>
          <div v-if="!layers.some((layer) => layer.kind === 'image')" class="drop-hint">
            Arraste uma imagem para começar
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

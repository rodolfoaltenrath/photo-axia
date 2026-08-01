<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DocumentSpec, EditorTool, ImportedImage, LayerItem, LayerTransform } from '../types/editor'
import { readBrowserImages } from '../services/imageImport'

const props = defineProps<{
  activeLayerId: string
  activeTool: EditorTool
  brushSize: number
  document: DocumentSpec
  layers: LayerItem[]
  zoom: number
}>()

const emit = defineEmits<{
  (event: 'zoomIn'): void
  (event: 'zoomOut'): void
  (event: 'fit', zoom: number): void
  (event: 'imagesDropped', images: ImportedImage[], errors: string[]): void
  (event: 'selectLayer', layerId: string): void
  (event: 'updateTransform', layerId: string, transform: LayerTransform): void
}>()

const scrollArea = ref<HTMLDivElement | null>(null)
const isPanning = ref(false)
const isSpacePressed = ref(false)
const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0, pointerId: -1 })
const dragState = ref<{
  layerId: string
  pointerId: number
  startX: number
  startY: number
  transform: LayerTransform
} | null>(null)
let resizeObserver: ResizeObserver | undefined

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
  'canvas-scroll--pan-ready': props.activeTool === 'hand' || isSpacePressed.value
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
  scrollArea.value?.focus()
  if (!event.ctrlKey && !event.metaKey) return

  event.preventDefault()
  event.deltaY < 0 ? emit('zoomIn') : emit('zoomOut')
}

function handleKeydown(event: KeyboardEvent) {
  const scroll = scrollArea.value
  if (!scroll) return

  if (event.code === 'Space') {
    event.preventDefault()
    isSpacePressed.value = true
    return
  }

  const step = event.shiftKey ? 96 : 36
  const movement: Record<string, [number, number]> = {
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0]
  }
  const delta = movement[event.key]
  if (!delta) return

  event.preventDefault()
  scroll.scrollBy({ left: delta[0], top: delta[1], behavior: 'auto' })
}

function handleKeyup(event: KeyboardEvent) {
  if (event.code === 'Space') isSpacePressed.value = false
}

function startViewportPointer(event: PointerEvent) {
  const scroll = scrollArea.value
  if (!scroll) return

  scroll.focus()
  const shouldPan = event.button === 1 || event.altKey || props.activeTool === 'hand' || isSpacePressed.value
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
  if (event.button !== 0 || props.activeTool === 'hand' || isSpacePressed.value || event.altKey) return
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
  if (panStart.value.pointerId === event.pointerId) isPanning.value = false
}

function fitDocument() {
  const scroll = scrollArea.value
  if (!scroll) return

  const availableWidth = Math.max(1, scroll.clientWidth - 96)
  const availableHeight = Math.max(1, scroll.clientHeight - 96)
  const fittedZoom = Math.floor(
    Math.min(4, availableWidth / props.document.width, availableHeight / props.document.height) * 100
  )
  emit('fit', Math.max(12, fittedZoom))
  void nextTick(() => {
    if (!scrollArea.value) return
    scrollArea.value.scrollLeft = (scrollArea.value.scrollWidth - scrollArea.value.clientWidth) / 2
    scrollArea.value.scrollTop = (scrollArea.value.scrollHeight - scrollArea.value.clientHeight) / 2
  })
}

onMounted(() => {
  window.addEventListener('keyup', handleKeyup)
  if (scrollArea.value) {
    resizeObserver = new ResizeObserver(() => {
      if (props.document.id === 'draft') fitDocument()
    })
    resizeObserver.observe(scrollArea.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keyup', handleKeyup)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section
    class="canvas-stage"
    aria-label="Área de edição"
    @dragover.prevent
    @drop="handleDrop"
    @keydown="handleKeydown"
    @pointerdown="startViewportPointer"
    @pointermove="updatePointer"
    @pointerup="stopPointer"
    @pointercancel="stopPointer"
    @wheel="handleWheel"
  >
    <div class="context-bar">
      <span>{{ activeTool }}</span>
      <span v-if="activeTool === 'brush' || activeTool === 'eraser'">{{ brushSize }} px</span>
      <span>{{ document.width }} × {{ document.height }}</span>
      <span>{{ document.unit === 'cm' ? `${document.physicalWidth} × ${document.physicalHeight} cm` : 'pixels' }}</span>
      <span>{{ zoom }}%</span>
      <div class="zoom-actions">
        <button type="button" title="Reduzir zoom" @click="$emit('zoomOut')">−</button>
        <button type="button" title="Ajustar à tela" @click="fitDocument">Ajustar</button>
        <button type="button" title="Aumentar zoom" @click="$emit('zoomIn')">+</button>
      </div>
    </div>

    <div ref="scrollArea" class="canvas-scroll" :class="viewportCursorClass" tabindex="0">
      <div class="canvas-frame" :style="frameStyle">
        <div class="canvas-surface" :style="surfaceStyle">
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

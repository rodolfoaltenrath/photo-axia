<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DocumentSpec, EditorTool, ImportedImage, LayerItem } from '../types/editor'

const props = defineProps<{
  activeTool: EditorTool
  brushSize: number
  document: DocumentSpec
  layers: LayerItem[]
  zoom: number
}>()

const emit = defineEmits<{
  (event: 'zoomIn'): void
  (event: 'zoomOut'): void
  (event: 'fit'): void
  (event: 'imagesDropped', images: ImportedImage[]): void
}>()

const scrollArea = ref<HTMLDivElement | null>(null)
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 })

const canvasStyle = computed(() => ({
  width: `${Math.max(1, props.document.width * (props.zoom / 100))}px`,
  height: `${Math.max(1, props.document.height * (props.zoom / 100))}px`
}))

const renderedLayers = computed(() => [...props.layers].reverse())

const backgroundClass = computed(() => `canvas-surface--${props.document.background}`)

function layerStyle(layer: LayerItem) {
  const transform = layer.transform ?? {
    x: 0,
    y: 0,
    width: props.document.width,
    height: props.document.height
  }

  return {
    left: `${transform.x * (props.zoom / 100)}px`,
    top: `${transform.y * (props.zoom / 100)}px`,
    width: `${transform.width * (props.zoom / 100)}px`,
    height: `${transform.height * (props.zoom / 100)}px`,
    opacity: layer.opacity / 100
  }
}

async function readDroppedImages(files: FileList) {
  const images = await Promise.all(
    Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => {
        return new Promise<ImportedImage>((resolve, reject) => {
          const image = new Image()
          const reader = new FileReader()

          reader.onerror = () => reject(reader.error)
          reader.onload = () => {
            const dataUrl = String(reader.result)
            image.onload = () => {
              resolve({
                id: crypto.randomUUID(),
                name: file.name,
                width: image.naturalWidth,
                height: image.naturalHeight,
                mimeType: file.type,
                dataUrl
              })
            }
            image.onerror = () => reject(new Error(`Nao foi possivel ler ${file.name}`))
            image.src = dataUrl
          }
          reader.readAsDataURL(file)
        })
      })
  )

  if (images.length > 0) {
    emit('imagesDropped', images)
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer?.files.length) {
    void readDroppedImages(event.dataTransfer.files)
  }
}

function handleWheel(event: WheelEvent) {
  scrollArea.value?.focus()

  if (!event.ctrlKey && !event.metaKey) return

  event.preventDefault()
  if (event.deltaY < 0) {
    emit('zoomIn')
    return
  }

  emit('zoomOut')
}

function handleKeydown(event: KeyboardEvent) {
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

  if (!delta) return

  event.preventDefault()
  scroll.scrollBy({ left: delta[0], top: delta[1], behavior: 'auto' })
}

function startPan(event: MouseEvent) {
  const scroll = scrollArea.value
  if (!scroll) return

  scroll.focus()
  if (event.button !== 1 && !event.altKey) return

  event.preventDefault()
  isPanning.value = true
  panStart.value = {
    x: event.clientX,
    y: event.clientY,
    scrollLeft: scroll.scrollLeft,
    scrollTop: scroll.scrollTop
  }
}

function updatePan(event: MouseEvent) {
  if (!isPanning.value || !scrollArea.value) return

  event.preventDefault()
  scrollArea.value.scrollLeft = panStart.value.scrollLeft - (event.clientX - panStart.value.x)
  scrollArea.value.scrollTop = panStart.value.scrollTop - (event.clientY - panStart.value.y)
}

function stopPan() {
  isPanning.value = false
}
</script>

<template>
  <section
    class="canvas-stage"
    aria-label="Area de edicao"
    @dragover.prevent
    @drop="handleDrop"
    @keydown="handleKeydown"
    @mousedown="startPan"
    @mouseleave="stopPan"
    @mousemove="updatePan"
    @mouseup="stopPan"
    @wheel="handleWheel"
  >
    <div class="context-bar">
      <span>{{ activeTool }}</span>
      <span>{{ brushSize }} px</span>
      <span>{{ document.width }}x{{ document.height }}</span>
      <span>{{ document.unit === 'cm' ? `${document.physicalWidth}x${document.physicalHeight} cm` : 'pixels' }}</span>
      <span>{{ zoom }}%</span>
      <div class="zoom-actions">
        <button type="button" title="Reduzir zoom" @click="$emit('zoomOut')">-</button>
        <button type="button" title="Ajustar zoom" @click="$emit('fit')">100</button>
        <button type="button" title="Aumentar zoom" @click="$emit('zoomIn')">+</button>
      </div>
    </div>

    <div
      ref="scrollArea"
      class="canvas-scroll"
      :class="{ 'canvas-scroll--panning': isPanning }"
      tabindex="0"
    >
      <div class="canvas-surface" :class="backgroundClass" :style="canvasStyle">
        <div class="transparent-grid"></div>
        <div class="document-layers">
          <div
            v-for="layer in renderedLayers"
            v-show="layer.visible"
            :key="layer.id"
            class="document-layer"
            :style="layerStyle(layer)"
          >
            <img
              v-if="layer.kind === 'image' && layer.image"
              :alt="layer.name"
              draggable="false"
              :src="layer.image.dataUrl"
            />
          </div>
        </div>
        <div v-if="!layers.some((layer) => layer.kind === 'image')" class="drop-hint">
          Arraste imagens para o documento
        </div>
      </div>
    </div>
  </section>
</template>

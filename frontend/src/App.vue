<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CanvasViewport from './components/CanvasViewport.vue'
import LayersPanel from './components/LayersPanel.vue'
import NewDocumentDialog from './components/NewDocumentDialog.vue'
import PropertiesPanel from './components/PropertiesPanel.vue'
import ToolBar from './components/ToolBar.vue'
import TopMenu from './components/TopMenu.vue'
import { ApplyPreviewFilter, CreateDocument, GetEditorStatus, SelectImageFiles } from '../wailsjs/go/main/App'
import type { DocumentSpec, EditorTool, ImportedImage, LayerItem, NewDocumentSettings } from './types/editor'

const activeTool = ref<EditorTool>('move')
const zoom = ref(100)
const brushSize = ref(24)
const opacity = ref(100)
const statusText = ref('Inicializando')
const activeLayerId = ref('layer-bg')
const showNewDocumentDialog = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const activeDocument = ref<DocumentSpec>({
  id: 'draft',
  name: 'Sem titulo',
  width: 1920,
  height: 1080,
  unit: 'px',
  physicalWidth: 1920,
  physicalHeight: 1080,
  resolutionDpi: 72,
  colorSpace: 'sRGB',
  background: 'transparent',
  createdAt: ''
})

const layers = ref<LayerItem[]>([
  { id: 'layer-bg', name: 'Fundo', visible: true, opacity: 100, kind: 'background' }
])

const zoomEventOptions = { capture: true, passive: false }

const activeLayer = computed(() => {
  return layers.value.find((layer) => layer.id === activeLayerId.value) ?? layers.value[0]
})

function setZoom(value: number) {
  zoom.value = Math.min(400, Math.max(12, value))
}

function addLayer() {
  const id = crypto.randomUUID()
  layers.value.unshift({
    id,
    name: `Camada ${layers.value.length}`,
    visible: true,
    opacity: 100,
    kind: 'pixel'
  })
  activeLayerId.value = id
}

function toggleLayer(layerId: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (layer) layer.visible = !layer.visible
}

function toPixelSize(settings: NewDocumentSettings) {
  if (settings.unit === 'px') {
    return {
      width: Math.max(1, Math.round(settings.width)),
      height: Math.max(1, Math.round(settings.height))
    }
  }

  return {
    width: Math.max(1, Math.round((settings.width / 2.54) * settings.resolutionDpi)),
    height: Math.max(1, Math.round((settings.height / 2.54) * settings.resolutionDpi))
  }
}

async function createDocument(settings: NewDocumentSettings) {
  const pixels = toPixelSize(settings)
  activeDocument.value = (await CreateDocument(
    settings.name,
    pixels.width,
    pixels.height,
    settings.unit,
    settings.width,
    settings.height,
    settings.resolutionDpi,
    settings.background
  )) as unknown as DocumentSpec
  layers.value = [
    { id: 'layer-bg', name: 'Fundo', visible: true, opacity: 100, kind: 'background' }
  ]
  activeLayerId.value = 'layer-bg'
  showNewDocumentDialog.value = false
  statusText.value = `${activeDocument.value.name} - ${activeDocument.value.width}x${activeDocument.value.height} px`
}

function imageTransform(image: ImportedImage) {
  const maxWidth = activeDocument.value.width * 0.82
  const maxHeight = activeDocument.value.height * 0.82
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  return {
    x: Math.round((activeDocument.value.width - width) / 2),
    y: Math.round((activeDocument.value.height - height) / 2),
    width,
    height
  }
}

function addImportedImages(images: ImportedImage[]) {
  const imageLayers = images.map((image) => ({
    id: image.id || crypto.randomUUID(),
    name: image.name,
    visible: true,
    opacity: 100,
    kind: 'image' as const,
    image: {
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
      dataUrl: image.dataUrl
    },
    transform: imageTransform(image)
  }))

  layers.value = [...imageLayers, ...layers.value]
  activeLayerId.value = imageLayers[0]?.id ?? activeLayerId.value
  statusText.value = `${images.length} imagem(ns) importada(s)`
}

async function importImages() {
  if ((window as any).go?.main?.App) {
    const images = await SelectImageFiles()
    addImportedImages(images)
    return
  }

  fileInput.value?.click()
}

async function readLocalFiles(files: FileList | null) {
  if (!files?.length) return

  const images = await Promise.all(
    Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => {
        return new Promise<ImportedImage>((resolve, reject) => {
          const reader = new FileReader()
          const image = new Image()

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

  addImportedImages(images)
}

async function previewFilter(filterName: string) {
  statusText.value = await ApplyPreviewFilter(filterName)
}

function blockBrowserWheelZoom(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
  }
}

onMounted(async () => {
  window.addEventListener('wheel', blockBrowserWheelZoom, zoomEventOptions)
  document.addEventListener('wheel', blockBrowserWheelZoom, zoomEventOptions)

  const status = await GetEditorStatus()
  statusText.value = `${status.appName} - ${status.engine}`
})

onBeforeUnmount(() => {
  window.removeEventListener('wheel', blockBrowserWheelZoom, true)
  document.removeEventListener('wheel', blockBrowserWheelZoom, true)
})
</script>

<template>
  <main class="app-shell">
    <TopMenu
      :document-name="activeDocument.name"
      :status-text="statusText"
      @import-images="importImages"
      @new-document="showNewDocumentDialog = true"
      @preview-filter="previewFilter"
    />

    <input
      ref="fileInput"
      accept="image/*"
      class="visually-hidden"
      multiple
      type="file"
      @change="readLocalFiles(($event.target as HTMLInputElement).files)"
    />

    <section class="workspace">
      <ToolBar v-model:active-tool="activeTool" />

      <CanvasViewport
        :active-tool="activeTool"
        :brush-size="brushSize"
        :document="activeDocument"
        :layers="layers"
        :zoom="zoom"
        @fit="setZoom(100)"
        @images-dropped="addImportedImages"
        @zoom-in="setZoom(zoom + 10)"
        @zoom-out="setZoom(zoom - 10)"
      />

      <aside class="side-panels" aria-label="Paineis do documento">
        <PropertiesPanel
          :active-layer="activeLayer"
          :active-tool="activeTool"
          :brush-size="brushSize"
          :opacity="opacity"
          :zoom="zoom"
          @update:brush-size="brushSize = $event"
          @update:opacity="opacity = $event"
          @update:zoom="setZoom($event)"
        />

        <LayersPanel
          :active-layer-id="activeLayerId"
          :layers="layers"
          @add-layer="addLayer"
          @select-layer="activeLayerId = $event"
          @toggle-layer="toggleLayer"
        />
      </aside>
    </section>

    <NewDocumentDialog
      :open="showNewDocumentDialog"
      @close="showNewDocumentDialog = false"
      @create="createDocument"
    />
  </main>
</template>

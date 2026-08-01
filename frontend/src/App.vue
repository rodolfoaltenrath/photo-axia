<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CanvasViewport from './components/CanvasViewport.vue'
import LayersPanel from './components/LayersPanel.vue'
import NewDocumentDialog from './components/NewDocumentDialog.vue'
import PropertiesPanel from './components/PropertiesPanel.vue'
import ToolBar from './components/ToolBar.vue'
import TopMenu from './components/TopMenu.vue'
import {
  applyPreviewFilter,
  createEditorDocument,
  getEditorStatus,
  hasDesktopBackend,
  saveExportedPNG,
  selectDesktopImages
} from './services/backend'
import { readBrowserImages, releaseLayerAssets } from './services/imageImport'
import { renderDocumentPNG } from './services/renderDocument'
import type {
  DocumentSpec,
  EditorTool,
  ImportedImage,
  LayerItem,
  LayerTransform,
  NewDocumentSettings
} from './types/editor'

const activeTool = ref<EditorTool>('move')
const zoom = ref(100)
const brushSize = ref(24)
const statusText = ref('Inicializando…')
const errorText = ref('')
const isBusy = ref(false)
const activeLayerId = ref('layer-bg')
const showNewDocumentDialog = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const activeDocument = ref<DocumentSpec>({
  id: 'draft',
  name: 'Sem título',
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
const layers = ref<LayerItem[]>([createBackgroundLayer()])
const zoomEventOptions = { capture: true, passive: false }

const activeLayer = computed<LayerItem>(() => {
  return layers.value.find((layer) => layer.id === activeLayerId.value) ?? layers.value[0]!
})

function createBackgroundLayer(): LayerItem {
  return { id: 'layer-bg', name: 'Fundo', visible: true, opacity: 100, kind: 'background' }
}

function setZoom(value: number) {
  if (!Number.isFinite(value)) return
  zoom.value = Math.min(400, Math.max(12, Math.round(value)))
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
  statusText.value = 'Nova camada criada'
}

function toggleLayer(layerId: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (layer) layer.visible = !layer.visible
}

function updateLayerOpacity(value: number) {
  activeLayer.value.opacity = Math.min(100, Math.max(0, value))
}

function updateLayerTransform(layerId: string, transform: LayerTransform) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (layer) layer.transform = transform
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
  errorText.value = ''
  isBusy.value = true
  try {
    const pixels = toPixelSize(settings)
    const document = await createEditorDocument(settings, pixels.width, pixels.height)
    releaseLayerAssets(layers.value)
    activeDocument.value = document
    layers.value = [createBackgroundLayer()]
    activeLayerId.value = 'layer-bg'
    zoom.value = 100
    showNewDocumentDialog.value = false
    statusText.value = `${document.name} — ${document.width} × ${document.height} px`
  } catch (error) {
    showError(error, 'Não foi possível criar o documento.')
  } finally {
    isBusy.value = false
  }
}

function imageTransform(image: ImportedImage): LayerTransform {
  const maxWidth = activeDocument.value.width * 0.82
  const maxHeight = activeDocument.value.height * 0.82
  const imageScale = Math.min(1, maxWidth / image.width, maxHeight / image.height)
  const width = Math.max(1, Math.round(image.width * imageScale))
  const height = Math.max(1, Math.round(image.height * imageScale))

  return {
    x: Math.round((activeDocument.value.width - width) / 2),
    y: Math.round((activeDocument.value.height - height) / 2),
    width,
    height
  }
}

function addImportedImages(images: ImportedImage[], errors: string[] = []) {
  if (images.length) {
    const imageLayers: LayerItem[] = images.map((image) => ({
      id: image.id || crypto.randomUUID(),
      name: image.name,
      visible: true,
      opacity: 100,
      kind: 'image',
      image: {
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
        sourceUrl: image.sourceUrl
      },
      transform: imageTransform(image)
    }))

    layers.value = [...imageLayers, ...layers.value]
    activeLayerId.value = imageLayers[0]!.id
    activeTool.value = 'move'
    statusText.value = images.length === 1 ? 'Imagem importada' : `${images.length} imagens importadas`
  }

  errorText.value = errors.join('\n')
}

async function importImages() {
  errorText.value = ''
  if (!hasDesktopBackend()) {
    fileInput.value?.click()
    return
  }

  isBusy.value = true
  statusText.value = 'Importando imagens…'
  try {
    addImportedImages(await selectDesktopImages())
  } catch (error) {
    showError(error, 'Não foi possível importar as imagens.')
  } finally {
    isBusy.value = false
  }
}

async function readLocalFiles(input: HTMLInputElement) {
  if (!input.files?.length) return

  isBusy.value = true
  statusText.value = 'Importando imagens…'
  try {
    const result = await readBrowserImages(input.files)
    addImportedImages(result.images, result.errors)
  } catch (error) {
    showError(error, 'Não foi possível importar as imagens.')
  } finally {
    input.value = ''
    isBusy.value = false
  }
}

async function previewFilter(filterName: string) {
  try {
    statusText.value = await applyPreviewFilter(filterName)
  } catch (error) {
    showError(error, 'Não foi possível aplicar o filtro.')
  }
}

async function exportDocument() {
  errorText.value = ''
  isBusy.value = true
  statusText.value = 'Preparando PNG…'
  try {
    const dataURL = await renderDocumentPNG(activeDocument.value, layers.value)
    const cleanName = activeDocument.value.name.replace(/\.[^.]+$/, '').trim() || 'imagem'
    const path = await saveExportedPNG(cleanName, dataURL)
    statusText.value = path ? `PNG exportado: ${path}` : 'Exportação cancelada'
  } catch (error) {
    showError(error, 'Não foi possível exportar o documento.')
  } finally {
    isBusy.value = false
  }
}

function showError(error: unknown, fallback: string) {
  errorText.value = error instanceof Error && error.message ? error.message : fallback
  statusText.value = fallback
}

function blockBrowserWheelZoom(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) event.preventDefault()
}

function handleShortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.matches('input, select, textarea')) return
  if (event.ctrlKey || event.metaKey || event.altKey) return

  if (event.key.toLowerCase() === 'v') activeTool.value = 'move'
  if (event.key.toLowerCase() === 'h') activeTool.value = 'hand'
}

onMounted(async () => {
  window.addEventListener('wheel', blockBrowserWheelZoom, zoomEventOptions)
  window.addEventListener('keydown', handleShortcut)

  try {
    const status = await getEditorStatus()
    statusText.value = `${status.appName} — ${status.engine}`
  } catch (error) {
    showError(error, 'Editor iniciado com recursos locais.')
  }
})

onBeforeUnmount(() => {
  releaseLayerAssets(layers.value)
  window.removeEventListener('wheel', blockBrowserWheelZoom, true)
  window.removeEventListener('keydown', handleShortcut)
})
</script>

<template>
  <main class="app-shell" :class="{ 'app-shell--busy': isBusy }">
    <TopMenu
      :document-name="activeDocument.name"
      :status-text="statusText"
      @export-document="exportDocument"
      @import-images="importImages"
      @new-document="showNewDocumentDialog = true"
      @preview-filter="previewFilter"
    />

    <div v-if="errorText" class="error-banner" role="alert">
      <span>{{ errorText }}</span>
      <button type="button" title="Fechar mensagem" @click="errorText = ''">×</button>
    </div>

    <input
      ref="fileInput"
      accept="image/png,image/jpeg,image/gif"
      class="visually-hidden"
      multiple
      type="file"
      @change="readLocalFiles($event.target as HTMLInputElement)"
    />

    <section class="workspace">
      <ToolBar v-model:active-tool="activeTool" />

      <CanvasViewport
        :active-layer-id="activeLayerId"
        :active-tool="activeTool"
        :brush-size="brushSize"
        :document="activeDocument"
        :layers="layers"
        :zoom="zoom"
        @fit="setZoom"
        @images-dropped="addImportedImages"
        @select-layer="activeLayerId = $event"
        @update-transform="updateLayerTransform"
        @zoom-in="setZoom(zoom + 10)"
        @zoom-out="setZoom(zoom - 10)"
      />

      <aside class="side-panels" aria-label="Painéis do documento">
        <PropertiesPanel
          :active-layer="activeLayer"
          :active-tool="activeTool"
          :brush-size="brushSize"
          :zoom="zoom"
          @update:brush-size="brushSize = $event"
          @update:layer-opacity="updateLayerOpacity"
          @update:zoom="setZoom"
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

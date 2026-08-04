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
import { clampZoom } from './editor/viewport'
import { DEFAULT_TEXT_LAYER, measureTextLayer } from './editor/text'
import type {
  DocumentSpec,
  EditorTool,
  ImportedImage,
  LayerItem,
  LayerTransform,
  NewDocumentSettings,
  TextLayerContent
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
const canvasViewport = ref<InstanceType<typeof CanvasViewport> | null>(null)
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
  zoom.value = clampZoom(value)
}

function handleToolDoubleClick(tool: EditorTool) {
  if (tool === 'hand') canvasViewport.value?.fitDocument()
  if (tool === 'zoom') canvasViewport.value?.zoomToActualSize()
}

function addLayer() {
  const id = crypto.randomUUID()
  const activeIndex = layers.value.findIndex((layer) => layer.id === activeLayerId.value)
  const insertionIndex = activeIndex < 0 ? 0 : activeIndex
  layers.value.splice(insertionIndex, 0, {
    id,
    name: `Camada ${layers.value.length}`,
    visible: true,
    opacity: 100,
    kind: 'pixel'
  })
  activeLayerId.value = id
  statusText.value = 'Nova camada criada'
}

function addTextLayer(point: { x: number; y: number }) {
  const id = crypto.randomUUID()
  const text = { ...DEFAULT_TEXT_LAYER }
  const size = measureTextLayer(text)
  text.baseWidth = size.width
  text.baseHeight = size.height

  const activeIndex = layers.value.findIndex((layer) => layer.id === activeLayerId.value)
  const insertionIndex = activeIndex < 0 ? 0 : activeIndex
  layers.value.splice(insertionIndex, 0, {
    id,
    name: text.content,
    visible: true,
    opacity: 100,
    kind: 'text',
    text,
    transform: {
      x: Math.round(Math.max(0, Math.min(point.x, activeDocument.value.width - size.width))),
      y: Math.round(Math.max(0, Math.min(point.y, activeDocument.value.height - size.height))),
      width: size.width,
      height: size.height,
      rotation: 0
    }
  })
  activeLayerId.value = id
  statusText.value = 'Camada de texto criada'
}

function updateTextLayer(layerId: string, patch: Partial<TextLayerContent>) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer?.text || !layer.transform) return

  const previous = layer.text
  const scaleX = layer.transform.width / previous.baseWidth
  const scaleY = layer.transform.height / previous.baseHeight
  const text: TextLayerContent = { ...previous, ...patch }
  text.fontSize = Math.min(1000, Math.max(1, Number.isFinite(text.fontSize) ? text.fontSize : previous.fontSize))
  text.fontWeight = Math.min(900, Math.max(100, Number.isFinite(text.fontWeight) ? text.fontWeight : previous.fontWeight))
  text.lineHeight = Math.min(3, Math.max(0.6, Number.isFinite(text.lineHeight) ? text.lineHeight : previous.lineHeight))
  const size = measureTextLayer(text)
  text.baseWidth = size.width
  text.baseHeight = size.height
  layer.text = text
  layer.transform = {
    ...layer.transform,
    width: Math.round(size.width * scaleX * 100) / 100,
    height: Math.round(size.height * scaleY * 100) / 100
  }

  if (patch.content !== undefined) {
    layer.name = patch.content.trim().split('\n')[0]?.slice(0, 36) || 'Texto'
  }
}

function toggleLayer(layerId: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (layer) layer.visible = !layer.visible
}

function renameLayer(layerId: string, name: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  const cleanName = name.trim()
  if (!layer || layer.kind === 'background' || !cleanName) return

  layer.name = cleanName
  statusText.value = `Camada renomeada para ${cleanName}`
}

function duplicateLayer(layerId = activeLayerId.value) {
  const index = layers.value.findIndex((layer) => layer.id === layerId)
  const source = layers.value[index]
  if (!source || source.kind === 'background') return

  const duplicate: LayerItem = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} cópia`,
    image: source.image ? { ...source.image } : undefined,
    text: source.text ? { ...source.text } : undefined,
    transform: source.transform
      ? {
          ...source.transform,
          x: source.transform.x + 12,
          y: source.transform.y + 12
        }
      : undefined
  }

  layers.value.splice(index, 0, duplicate)
  activeLayerId.value = duplicate.id
  statusText.value = 'Camada duplicada'
}

function deleteLayer(layerId: string) {
  const index = layers.value.findIndex((layer) => layer.id === layerId)
  const layer = layers.value[index]
  if (!layer) return
  if (layers.value.length === 1) {
    errorText.value = 'O documento precisa manter pelo menos uma camada.'
    statusText.value = 'Não é possível excluir a única camada do documento'
    return
  }

  layers.value.splice(index, 1)
  const source = layer.image?.sourceUrl
  if (source?.startsWith('blob:') && !layers.value.some((item) => item.image?.sourceUrl === source)) {
    URL.revokeObjectURL(source)
  }

  if (activeLayerId.value === layerId) {
    activeLayerId.value = layers.value[Math.min(index, layers.value.length - 1)]!.id
  }
  errorText.value = ''
  statusText.value = 'Camada excluída'
}

function moveLayer(layerId: string, direction: -1 | 1) {
  const index = layers.value.findIndex((layer) => layer.id === layerId)
  const layer = layers.value[index]
  const targetIndex = index + direction
  const target = layers.value[targetIndex]
  if (!layer || layer.kind === 'background' || !target || target.kind === 'background') return

  layers.value.splice(index, 1)
  layers.value.splice(targetIndex, 0, layer)
  statusText.value = direction < 0 ? 'Camada elevada' : 'Camada abaixada'
}

function reorderLayer(layerId: string, targetId: string, position: 'before' | 'after') {
  const source = layers.value.find((layer) => layer.id === layerId)
  if (!source || source.kind === 'background' || layerId === targetId) return

  const reordered = layers.value.filter((layer) => layer.id !== layerId)
  const targetIndex = reordered.findIndex((layer) => layer.id === targetId)
  if (targetIndex < 0) return

  const target = reordered[targetIndex]!
  let insertionIndex = targetIndex + (position === 'after' && target.kind !== 'background' ? 1 : 0)
  const backgroundIndex = reordered.findIndex((layer) => layer.kind === 'background')
  if (backgroundIndex >= 0) insertionIndex = Math.min(insertionIndex, backgroundIndex)

  reordered.splice(insertionIndex, 0, source)
  layers.value = reordered
  statusText.value = 'Ordem das camadas atualizada'
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
  canvasViewport.value?.commitPendingTransform()
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
  if (target?.closest('input, select, textarea, [contenteditable="true"]')) return

  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyJ') {
    event.preventDefault()
    duplicateLayer()
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return

  const toolsByKey: Record<string, EditorTool> = {
    v: 'move',
    m: 'select',
    t: 'text',
    h: 'hand',
    z: 'zoom'
  }
  const tool = toolsByKey[event.key.toLowerCase()]
  if (!tool) return

  event.preventDefault()
  activeTool.value = tool
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
      <ToolBar v-model:active-tool="activeTool" @tool-double-click="handleToolDoubleClick" />

      <CanvasViewport
        ref="canvasViewport"
        :active-layer-id="activeLayerId"
        :active-tool="activeTool"
        :brush-size="brushSize"
        :document="activeDocument"
        :layers="layers"
        :zoom="zoom"
        @images-dropped="addImportedImages"
        @create-text="addTextLayer"
        @select-layer="activeLayerId = $event"
        @update-transform="updateLayerTransform"
        @update:zoom="setZoom"
      />

      <aside class="side-panels" aria-label="Painéis do documento">
        <PropertiesPanel
          :active-layer="activeLayer"
          :active-tool="activeTool"
          :brush-size="brushSize"
          :zoom="zoom"
          @update:brush-size="brushSize = $event"
          @update:layer-opacity="updateLayerOpacity"
          @update:text="updateTextLayer(activeLayer.id, $event)"
          @update:zoom="setZoom"
        />

        <LayersPanel
          :active-layer-id="activeLayerId"
          :layers="layers"
          @add-layer="addLayer"
          @delete-layer="deleteLayer"
          @duplicate-layer="duplicateLayer"
          @move-layer="moveLayer"
          @rename-layer="renameLayer"
          @reorder-layer="reorderLayer"
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

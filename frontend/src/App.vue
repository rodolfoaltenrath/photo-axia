<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import {
  createImagePreview,
  imagePreviewSize,
  imagePreviewNeedsUpdate,
  readBrowserImages,
  releaseLayerAssets
} from './services/imageImport'
import { renderDocumentPNG } from './services/renderDocument'
import {
  applyEditorHistoryDelta,
  cloneLayerPatch,
  cloneLayerState,
  estimateEditorHistoryBytes,
  historyDeltaLayers,
  historyDeltaObjectUrls,
  isEditorHistoryDeltaNoop,
  mergeEditorHistoryDelta,
  type EditorHistoryDelta
} from './editor/editorHistory'
import { useHistory, type HistoryRecordOptions, type HistoryStep } from './editor/history'
import { clampZoom } from './editor/viewport'
import { DEFAULT_TEXT_LAYER, measureTextLayer } from './editor/text'
import {
  cloneSelection,
  layerSourceToDocumentMatrix,
  selectionIsEmpty,
  translateSelection,
  transformSelectionPoint,
  type SelectionMode,
  type SelectionPoint,
  type SelectionRegion
} from './editor/selection'
import { createMagicWandSelection, disposeSelectionEngine, eraseImageSelection } from './services/selectionEngine'
import { disposeBrushEngine, paintBrushStroke } from './services/brushEngine'
import {
  disposeSelectionMoveEngine,
  moveImageSelection,
  warmSelectionMove,
  type MoveSelectionPreview
} from './services/selectionMoveEngine'
import type {
  DocumentSpec,
  EditorTool,
  ImageAsset,
  ImportedImage,
  LayerItem,
  LayerTransform,
  NewDocumentSettings,
  TextLayerContent
} from './types/editor'

const activeTool = ref<EditorTool>('move')
const autoSelectLayer = ref(true)
const zoom = ref(100)
const brushSize = ref(24)
const brushColor = ref('#000000')
const selectionMode = ref<SelectionMode>('rectangle')
const magicWandTolerance = ref(32)
const magicWandContiguous = ref(true)
const selection = shallowRef<SelectionRegion | null>(null)
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
const previewGenerations = new Map<string, number>()
const trackedObjectUrls = new Set<string>()
const transientObjectUrls = new Set<string>()
let selectionGeneration = 0
let pendingSelectionTasks = 0

interface FloatingSelectionSession {
  layerId: string
  anchorImage: ImageAsset
  anchorTransform: LayerTransform
  anchorSelection: SelectionRegion
  currentSelection: SelectionRegion
  deltaX: number
  deltaY: number
}

const floatingSelectionSession = shallowRef<FloatingSelectionSession | null>(null)

const history = useHistory<EditorHistoryDelta>(
  {
    maxBytes: 8 * 1024 * 1024,
    maxEntries: 200,
    estimateBytes: estimateEditorHistoryBytes,
    isNoop: isEditorHistoryDeltaNoop,
    merge: mergeEditorHistoryDelta
  },
  'Documento inicial'
)
const canRedo = history.canRedo
const canUndo = history.canUndo
const historyBytes = history.sizeBytes
const historyItems = history.timeline
const historyPosition = history.currentPosition
const redoLabel = history.redoLabel
const undoLabel = history.undoLabel

const activeLayer = computed<LayerItem>(() => {
  return layers.value.find((layer) => layer.id === activeLayerId.value) ?? layers.value[0]!
})
const selectionMoveAnchor = computed(() => {
  const session = floatingSelectionSession.value
  if (!session) return null
  return {
    layerId: session.layerId,
    image: session.anchorImage,
    transform: session.anchorTransform,
    selection: session.anchorSelection,
    deltaX: session.deltaX,
    deltaY: session.deltaY
  }
})

watch(activeLayerId, (layerId) => {
  if (floatingSelectionSession.value?.layerId !== layerId) clearFloatingSelectionSession()
})

watch(selection, (currentSelection) => {
  const session = floatingSelectionSession.value
  if (session && currentSelection !== session.currentSelection) clearFloatingSelectionSession()
  if (!currentSelection) return
  const image = session?.anchorImage ?? activeLayer.value.image
  if (image) void warmSelectionMove(image).catch(() => undefined)
})

function createBackgroundLayer(): LayerItem {
  return { id: 'layer-bg', name: 'Fundo', visible: true, opacity: 100, kind: 'background' }
}

function recordHistory(label: string, delta: EditorHistoryDelta, options?: HistoryRecordOptions) {
  const discarded = history.record(label, delta, options)
  if (discarded.some((entry) => historyDeltaLayers(entry.delta).length || historyDeltaObjectUrls(entry.delta).length)) {
    collectUnusedObjectUrls()
  }
}

function layerObjectUrls(layer: LayerItem) {
  return [layer.image?.sourceUrl, layer.image?.previewUrl].filter(
    (source): source is string => Boolean(source?.startsWith('blob:'))
  )
}

function trackLayerAssets(items: LayerItem[]) {
  for (const layer of items) {
    for (const source of layerObjectUrls(layer)) trackedObjectUrls.add(source)
  }
}

function retainedHistoryLayers() {
  return history.entries().flatMap((entry) => historyDeltaLayers(entry.delta))
}

function collectUnusedObjectUrls() {
  const retainedUrls = new Set<string>()
  for (const layer of [...layers.value, ...retainedHistoryLayers()]) {
    for (const source of layerObjectUrls(layer)) retainedUrls.add(source)
  }
  for (const entry of history.entries()) {
    for (const source of historyDeltaObjectUrls(entry.delta)) retainedUrls.add(source)
  }
  for (const source of transientObjectUrls) retainedUrls.add(source)
  const floatingAnchor = floatingSelectionSession.value?.anchorImage
  for (const source of [floatingAnchor?.sourceUrl, floatingAnchor?.previewUrl]) {
    if (source?.startsWith('blob:')) retainedUrls.add(source)
  }

  for (const source of trackedObjectUrls) {
    if (retainedUrls.has(source)) continue
    URL.revokeObjectURL(source)
    trackedObjectUrls.delete(source)
  }
}

function releaseAllEditorAssets() {
  floatingSelectionSession.value = null
  releaseLayerAssets([...layers.value, ...retainedHistoryLayers()])
  for (const source of trackedObjectUrls) URL.revokeObjectURL(source)
  trackedObjectUrls.clear()
}

function applyHistorySteps(steps: HistoryStep<EditorHistoryDelta>[]) {
  const refreshIds = new Set<string>()
  let resourcesMayBeUnused = false
  let restoredSelection: SelectionRegion | null | undefined
  for (const { delta, direction } of steps) {
    const result = applyEditorHistoryDelta(layers.value, activeLayerId.value, delta, direction)
    activeLayerId.value = result.activeLayerId
    trackLayerAssets(result.insertedLayers)
    for (const layerId of result.removedLayerIds) {
      previewGenerations.set(layerId, (previewGenerations.get(layerId) ?? 0) + 1)
    }
    for (const layerId of result.refreshLayerIds) refreshIds.add(layerId)
    if (result.removedLayerIds.length) resourcesMayBeUnused = true
    if (delta.type === 'layer:patch' && ('selectionBefore' in delta || 'selectionAfter' in delta)) {
      restoredSelection = cloneSelection(direction === 'redo' ? delta.selectionAfter ?? null : delta.selectionBefore ?? null)
    }
  }

  for (const layerId of refreshIds) {
    const layer = layers.value.find((item) => item.id === layerId)
    if (layer?.image) {
      trackLayerAssets([layer])
      void refreshLayerPreview(layer)
    }
  }
  if (resourcesMayBeUnused) collectUnusedObjectUrls()
  if (restoredSelection !== undefined) {
    selection.value = restoredSelection
    selectionGeneration++
  }
}

function undoHistory() {
  canvasViewport.value?.commitPendingTransform()
  selection.value = null
  const transition = history.undo()
  if (!transition) return
  applyHistorySteps(transition.steps)
  statusText.value = `Desfeito: ${transition.label}`
  errorText.value = ''
}

function redoHistory() {
  canvasViewport.value?.commitPendingTransform()
  selection.value = null
  const transition = history.redo()
  if (!transition) return
  applyHistorySteps(transition.steps)
  statusText.value = `Refeito: ${transition.label}`
  errorText.value = ''
}

function jumpHistory(position: number) {
  canvasViewport.value?.commitPendingTransform()
  selection.value = null
  const transition = history.jump(position)
  if (!transition) return
  applyHistorySteps(transition.steps)
  statusText.value = `Histórico: ${transition.label}`
  errorText.value = ''
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
  const activeBefore = activeLayerId.value
  const activeIndex = layers.value.findIndex((layer) => layer.id === activeBefore)
  const insertionIndex = activeIndex < 0 ? 0 : activeIndex
  const layer: LayerItem = {
    id,
    name: `Camada ${layers.value.length}`,
    visible: true,
    opacity: 100,
    kind: 'pixel'
  }
  layers.value.splice(insertionIndex, 0, layer)
  activeLayerId.value = id
  recordHistory('Criar camada', {
    type: 'layers:add',
    items: [{ index: insertionIndex, layer: cloneLayerState(layer) }],
    activeBefore,
    activeAfter: id
  })
  statusText.value = 'Nova camada criada'
}

function addTextLayer(point: { x: number; y: number }) {
  const id = crypto.randomUUID()
  const text = { ...DEFAULT_TEXT_LAYER }
  const size = measureTextLayer(text)
  text.baseWidth = size.width
  text.baseHeight = size.height

  const activeBefore = activeLayerId.value
  const activeIndex = layers.value.findIndex((layer) => layer.id === activeBefore)
  const insertionIndex = activeIndex < 0 ? 0 : activeIndex
  const layer: LayerItem = {
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
  }
  layers.value.splice(insertionIndex, 0, layer)
  activeLayerId.value = id
  recordHistory('Criar texto', {
    type: 'layers:add',
    items: [{ index: insertionIndex, layer: cloneLayerState(layer) }],
    activeBefore,
    activeAfter: id
  })
  statusText.value = 'Camada de texto criada'
}

function updateTextLayer(layerId: string, patch: Partial<TextLayerContent>) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer?.text || !layer.transform) return
  const patchEntries = Object.entries(patch) as Array<[keyof TextLayerContent, TextLayerContent[keyof TextLayerContent]]>
  if (!patchEntries.some(([key, value]) => layer.text?.[key] !== value)) return

  const property = Object.keys(patch).sort().join('-')
  const previous = layer.text
  const transform = layer.transform
  const before = cloneLayerPatch({ name: layer.name, text: previous, transform })
  const scaleX = transform.width / previous.baseWidth
  const scaleY = transform.height / previous.baseHeight
  const text: TextLayerContent = { ...previous, ...patch }
  text.fontSize = Math.min(1000, Math.max(1, Number.isFinite(text.fontSize) ? text.fontSize : previous.fontSize))
  text.fontWeight = Math.min(900, Math.max(100, Number.isFinite(text.fontWeight) ? text.fontWeight : previous.fontWeight))
  text.lineHeight = Math.min(3, Math.max(0.6, Number.isFinite(text.lineHeight) ? text.lineHeight : previous.lineHeight))
  const size = measureTextLayer(text)
  text.baseWidth = size.width
  text.baseHeight = size.height
  layer.text = text
  layer.transform = {
    ...transform,
    width: Math.round(size.width * scaleX * 100) / 100,
    height: Math.round(size.height * scaleY * 100) / 100
  }

  if (patch.content !== undefined) {
    layer.name = patch.content.trim().split('\n')[0]?.slice(0, 36) || 'Texto'
  }
  recordHistory(
    patch.content !== undefined ? 'Editar texto' : 'Alterar texto',
    {
      type: 'layer:patch',
      layerId,
      before,
      after: cloneLayerPatch({ name: layer.name, text: layer.text, transform: layer.transform })
    },
    { mergeKey: `text:${layerId}:${property}`, mergeWindowMs: 800 }
  )
}

function toggleLayer(layerId: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) return
  const label = layer.visible ? 'Ocultar camada' : 'Mostrar camada'
  const before = layer.visible
  layer.visible = !before
  recordHistory(label, {
    type: 'layer:patch',
    layerId,
    before: { visible: before },
    after: { visible: layer.visible }
  })
}

function renameLayer(layerId: string, name: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  const cleanName = name.trim()
  if (!layer || layer.kind === 'background' || !cleanName) return

  if (layer.name === cleanName) return
  const before = layer.name
  layer.name = cleanName
  recordHistory('Renomear camada', {
    type: 'layer:patch',
    layerId,
    before: { name: before },
    after: { name: cleanName }
  })
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

  const activeBefore = activeLayerId.value
  layers.value.splice(index, 0, duplicate)
  activeLayerId.value = duplicate.id
  recordHistory('Duplicar camada', {
    type: 'layers:add',
    items: [{ index, layer: cloneLayerState(duplicate) }],
    activeBefore,
    activeAfter: duplicate.id
  })
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

  const activeBefore = activeLayerId.value
  const removed = cloneLayerState(layer)
  layers.value.splice(index, 1)
  previewGenerations.set(layerId, (previewGenerations.get(layerId) ?? 0) + 1)
  if (activeLayerId.value === layerId) {
    activeLayerId.value = layers.value[Math.min(index, layers.value.length - 1)]!.id
  }
  recordHistory('Excluir camada', {
    type: 'layers:remove',
    items: [{ index, layer: removed }],
    activeBefore,
    activeAfter: activeLayerId.value
  })
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
  recordHistory(direction < 0 ? 'Elevar camada' : 'Abaixar camada', {
    type: 'layer:reorder',
    layerId,
    beforeIndex: index,
    afterIndex: targetIndex
  })
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
  if (reordered.every((layer, index) => layer.id === layers.value[index]?.id)) return
  const beforeIndex = layers.value.findIndex((layer) => layer.id === layerId)
  const afterIndex = reordered.findIndex((layer) => layer.id === layerId)
  layers.value = reordered
  recordHistory('Reordenar camada', {
    type: 'layer:reorder',
    layerId,
    beforeIndex,
    afterIndex
  })
  statusText.value = 'Ordem das camadas atualizada'
}

function updateLayerOpacity(value: number) {
  const layer = activeLayer.value
  const opacity = Math.min(100, Math.max(0, value))
  if (layer.opacity === opacity) return
  const before = layer.opacity
  layer.opacity = opacity
  recordHistory(
    'Alterar opacidade',
    {
      type: 'layer:patch',
      layerId: layer.id,
      before: { opacity: before },
      after: { opacity }
    },
    { mergeKey: `opacity:${layer.id}`, mergeWindowMs: 800 }
  )
}

function updateLayerTransform(layerId: string, transform: LayerTransform) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) return
  const previous = layer.transform
  if (
    previous &&
    previous.x === transform.x &&
    previous.y === transform.y &&
    previous.width === transform.width &&
    previous.height === transform.height &&
    (previous.rotation ?? 0) === (transform.rotation ?? 0)
  )
    return

  if (floatingSelectionSession.value?.layerId === layerId) clearFloatingSelectionSession()

  const sizeChanged = previous?.width !== transform.width || previous?.height !== transform.height
  const onlyMoved =
    previous &&
    previous.width === transform.width &&
    previous.height === transform.height &&
    (previous.rotation ?? 0) === (transform.rotation ?? 0)
  layer.transform = transform
  recordHistory(onlyMoved ? 'Mover camada' : 'Transformar camada', {
    type: 'layer:patch',
    layerId,
    before: { transform: previous ? { ...previous } : undefined },
    after: { transform: { ...transform } }
  })
  if (sizeChanged) void refreshLayerPreview(layer)
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
    releaseAllEditorAssets()
    history.clear('Documento criado')
    previewGenerations.clear()
    selection.value = null
    selectionGeneration++
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
  const maxWidth = activeDocument.value.width
  const maxHeight = activeDocument.value.height
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

async function refreshLayerPreview(layer: LayerItem, force = false, allowDetached = false) {
  const asset = layer.image
  const transform = layer.transform
  if (!asset || !transform || (!force && !imagePreviewNeedsUpdate(asset, transform.width, transform.height))) return

  const generation = (previewGenerations.get(layer.id) ?? 0) + 1
  previewGenerations.set(layer.id, generation)

  try {
    const preview = await createImagePreview(asset, transform.width, transform.height)
    if (previewGenerations.get(layer.id) !== generation || (!allowDetached && !layers.value.includes(layer))) {
      if (preview?.url.startsWith('blob:')) URL.revokeObjectURL(preview.url)
      return
    }

    const previousPreview = asset.previewUrl
    asset.previewUrl = preview?.url
    asset.previewWidth = preview?.width ?? asset.width
    asset.previewHeight = preview?.height ?? asset.height
    if (asset.previewUrl?.startsWith('blob:')) trackedObjectUrls.add(asset.previewUrl)
    if (!allowDetached && previousPreview !== asset.previewUrl) collectUnusedObjectUrls()
  } catch {
    // The original remains a safe fallback when preview generation is unavailable.
  }
}

async function addImportedImages(images: ImportedImage[], errors: string[] = []) {
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
    trackLayerAssets(imageLayers)

    for (const [index, layer] of imageLayers.entries()) {
      statusText.value =
        imageLayers.length === 1
          ? 'Otimizando imagem para edição…'
          : `Otimizando imagem ${index + 1} de ${imageLayers.length}…`
      await refreshLayerPreview(layer, true, true)
    }

    const activeBefore = activeLayerId.value
    layers.value = [...imageLayers, ...layers.value]
    activeLayerId.value = imageLayers[0]!.id
    activeTool.value = 'move'
    selection.value = null
    selectionGeneration++
    recordHistory(images.length === 1 ? 'Importar imagem' : 'Importar imagens', {
      type: 'layers:add',
      items: imageLayers.map((layer, index) => ({ index, layer: cloneLayerState(layer) })),
      activeBefore,
      activeAfter: activeLayerId.value
    })
    statusText.value = images.length === 1 ? 'Imagem importada' : `${images.length} imagens importadas`
  }

  errorText.value = errors.join('\n')
}

async function selectWithMagicWand(point: SelectionPoint) {
  if (isBusy.value) return
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if (layer.kind !== 'image' || !layer.image || !layer.transform) {
    showError(new Error('A varinha mágica precisa de uma camada de imagem ativa.'), 'Seleção indisponível.')
    return
  }

  const generation = ++selectionGeneration
  pendingSelectionTasks++
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Analisando cores com a varinha mágica…'
  try {
    const result = await createMagicWandSelection(
      layer.id,
      layer.image,
      layer.transform,
      point,
      magicWandTolerance.value,
      magicWandContiguous.value
    )
    if (generation !== selectionGeneration) return
    selection.value = result
    statusText.value = `${result.pixelCount.toLocaleString('pt-BR')} pixels selecionados`
  } catch (error) {
    if (generation === selectionGeneration) showError(error, 'Não foi possível criar a seleção.')
  } finally {
    pendingSelectionTasks--
    if (pendingSelectionTasks === 0) isBusy.value = false
  }
}

function setSelectionMode(mode: SelectionMode) {
  selectionGeneration++
  selectionMode.value = mode
}

function updateSelection(value: SelectionRegion | null) {
  selectionGeneration++
  selection.value = selectionIsEmpty(value) ? null : value
  if (selection.value) statusText.value = 'Seleção criada — pressione Delete para apagar os pixels'
  else statusText.value = 'Seleção removida'
}

async function deleteSelectedPixels() {
  if (isBusy.value) return
  clearFloatingSelectionSession()
  const currentSelection = selection.value
  const layer = activeLayer.value
  if (!currentSelection || selectionIsEmpty(currentSelection)) return
  if (layer.kind !== 'image' || !layer.image || !layer.transform) {
    showError(new Error('Selecione uma camada de imagem para apagar pixels.'), 'Não foi possível apagar a seleção.')
    return
  }

  canvasViewport.value?.commitPendingTransform()
  const beforeImage = { ...layer.image }
  const beforeTransform = { ...layer.transform }
  for (const source of [beforeImage.sourceUrl, beforeImage.previewUrl]) {
    if (source?.startsWith('blob:')) transientObjectUrls.add(source)
  }
  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Apagando pixels selecionados…'
  try {
    const result = await eraseImageSelection(beforeImage, beforeTransform, currentSelection)
    createdSource = URL.createObjectURL(result.blob)
    trackedObjectUrls.add(createdSource)

    let newTransform = beforeTransform
    if (result.trimmedBounds) {
      const bounds = result.trimmedBounds
      const oldMatrix = layerSourceToDocumentMatrix(beforeTransform, beforeImage.width, beforeImage.height)
      const center = transformSelectionPoint(oldMatrix, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2
      })
      const scaleX = beforeTransform.width / beforeImage.width
      const scaleY = beforeTransform.height / beforeImage.height
      const newWidth = bounds.width * scaleX
      const newHeight = bounds.height * scaleY
      newTransform = {
        ...beforeTransform,
        x: center.x - newWidth / 2,
        y: center.y - newHeight / 2,
        width: newWidth,
        height: newHeight
      }
    }

    const newAsset = {
      width: result.width,
      height: result.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: result.blob.size
    }
    const preview = await createImagePreview(newAsset, newTransform.width, newTransform.height)
    createdPreviewUrl = preview?.url.startsWith('blob:') ? preview.url : undefined
    if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)
    await Promise.all([preloadImage(newAsset.sourceUrl), preview ? preloadImage(preview.url) : Promise.resolve()])

    layer.image = {
      ...newAsset,
      previewUrl: preview?.url,
      previewWidth: preview?.width ?? newAsset.width,
      previewHeight: preview?.height ?? newAsset.height
    }
    layer.transform = newTransform

    recordHistory('Apagar seleção', {
      type: 'layer:patch',
      layerId: layer.id,
      before: { image: beforeImage, transform: beforeTransform },
      after: { image: { ...layer.image }, transform: { ...layer.transform } }
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    selection.value = null
    selectionGeneration++
    statusText.value = 'Pixels apagados'
  } catch (error) {
    layer.image = beforeImage
    layer.transform = beforeTransform
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    if (createdPreviewUrl) {
      URL.revokeObjectURL(createdPreviewUrl)
      trackedObjectUrls.delete(createdPreviewUrl)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível apagar a seleção.')
  } finally {
    isBusy.value = false
  }
}

function clearFloatingSelectionSession(collectAssets = true) {
  if (!floatingSelectionSession.value) return
  floatingSelectionSession.value = null
  if (collectAssets) collectUnusedObjectUrls()
}

async function commitSelectionMove(
  originalSelection: SelectionRegion,
  _movedSelection: SelectionRegion,
  deltaX: number,
  deltaY: number,
  previewScaleX: number,
  previewScaleY: number
) {
  if (isBusy.value || (!deltaX && !deltaY)) return
  const layer = activeLayer.value
  if (layer.kind !== 'image' || !layer.image || !layer.transform) {
    showError(new Error('Selecione uma camada de imagem para mover pixels.'), 'Não foi possível mover a seleção.')
    return
  }

  canvasViewport.value?.commitPendingTransform()
  const beforeImage = { ...layer.image }
  const beforeTransform = { ...layer.transform }
  const beforeSelection = cloneSelection(originalSelection)!
  const previousSession = floatingSelectionSession.value
  const session =
    previousSession?.layerId === layer.id && previousSession.currentSelection === originalSelection
      ? previousSession
      : {
          layerId: layer.id,
          anchorImage: beforeImage,
          anchorTransform: beforeTransform,
          anchorSelection: beforeSelection,
          currentSelection: beforeSelection,
          deltaX: 0,
          deltaY: 0
        }
  const totalDeltaX = session.deltaX + deltaX
  const totalDeltaY = session.deltaY + deltaY
  const afterSelection = translateSelection(session.anchorSelection, totalDeltaX, totalDeltaY)
  for (const source of [
    beforeImage.sourceUrl,
    beforeImage.previewUrl,
    session.anchorImage.sourceUrl,
    session.anchorImage.previewUrl
  ]) {
    if (source?.startsWith('blob:')) transientObjectUrls.add(source)
  }
  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  let quickPreviewUrl: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Movendo pixels selecionados…'
  try {
    const transformForRaster = (result: Pick<MoveSelectionPreview, 'originX' | 'originY' | 'width' | 'height'>) => {
      const oldMatrix = layerSourceToDocumentMatrix(
        session.anchorTransform,
        session.anchorImage.width,
        session.anchorImage.height
      )
      const center = transformSelectionPoint(oldMatrix, {
        x: result.originX + result.width / 2,
        y: result.originY + result.height / 2
      })
      const newWidth = result.width * (session.anchorTransform.width / session.anchorImage.width)
      const newHeight = result.height * (session.anchorTransform.height / session.anchorImage.height)
      return {
        ...session.anchorTransform,
        x: center.x - newWidth / 2,
        y: center.y - newHeight / 2,
        width: newWidth,
        height: newHeight
      }
    }
    let newAsset: ImageAsset
    let newTransform: LayerTransform
    if (!totalDeltaX && !totalDeltaY) {
      newAsset = { ...session.anchorImage }
      newTransform = { ...session.anchorTransform }
    } else {
      const result = await moveImageSelection(
        session.anchorImage,
        session.anchorTransform,
        session.anchorSelection,
        totalDeltaX,
        totalDeltaY,
        previewScaleX,
        previewScaleY,
        (preview) => {
          if (quickPreviewUrl) return
          quickPreviewUrl = URL.createObjectURL(preview.previewBlob)
          trackedObjectUrls.add(quickPreviewUrl)
          transientObjectUrls.add(quickPreviewUrl)
          layer.image = {
            ...session.anchorImage,
            width: preview.width,
            height: preview.height,
            previewUrl: quickPreviewUrl,
            previewWidth: preview.previewWidth,
            previewHeight: preview.previewHeight
          }
          layer.transform = transformForRaster(preview)
          floatingSelectionSession.value = {
            ...session,
            currentSelection: afterSelection,
            deltaX: totalDeltaX,
            deltaY: totalDeltaY
          }
          selection.value = afterSelection
        }
      )
      createdSource = URL.createObjectURL(result.blob)
      trackedObjectUrls.add(createdSource)
      createdPreviewUrl = result.previewBlob
        ? URL.createObjectURL(result.previewBlob)
        : quickPreviewUrl
      if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)

      newTransform = transformForRaster(result)
      newAsset = {
        width: result.width,
        height: result.height,
        mimeType: 'image/png',
        sourceUrl: createdSource,
        byteSize: result.blob.size,
        previewUrl: createdPreviewUrl,
        previewWidth: result.previewWidth,
        previewHeight: result.previewHeight
      }
    }
    await preloadImage(newAsset.previewUrl ?? newAsset.sourceUrl)

    layer.image = newAsset
    layer.transform = newTransform
    selection.value = afterSelection
    floatingSelectionSession.value = {
      ...session,
      currentSelection: afterSelection,
      deltaX: totalDeltaX,
      deltaY: totalDeltaY
    }
    selectionGeneration++
    recordHistory('Mover seleção', {
      type: 'layer:patch',
      layerId: layer.id,
      before: { image: beforeImage, transform: beforeTransform },
      after: { image: { ...newAsset }, transform: { ...newTransform } },
      selectionBefore: beforeSelection,
      selectionAfter: afterSelection
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = 'Pixels selecionados movidos'
  } catch (error) {
    layer.image = beforeImage
    layer.transform = beforeTransform
    floatingSelectionSession.value = previousSession
    selection.value = originalSelection
    selectionGeneration++
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    if (createdPreviewUrl) {
      URL.revokeObjectURL(createdPreviewUrl)
      trackedObjectUrls.delete(createdPreviewUrl)
    }
    if (quickPreviewUrl && quickPreviewUrl !== createdPreviewUrl) {
      URL.revokeObjectURL(quickPreviewUrl)
      trackedObjectUrls.delete(quickPreviewUrl)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível mover os pixels selecionados.')
  } finally {
    isBusy.value = false
  }
}

async function commitBrushStroke(
  points: SelectionPoint[],
  size: number,
  color: string,
  strokeSelection: SelectionRegion | null
) {
  if (isBusy.value) return
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if (layer.kind !== 'image' || !layer.image || !layer.transform || points.length === 0) return

  const beforeImage = { ...layer.image }
  const beforeTransform = { ...layer.transform }
  const strokePoints = points.map((point) => ({ x: point.x, y: point.y }))
  for (const source of [beforeImage.sourceUrl, beforeImage.previewUrl]) {
    if (source?.startsWith('blob:')) transientObjectUrls.add(source)
  }
  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Pintando…'
  try {
    const previewTarget = imagePreviewSize(beforeImage, beforeTransform.width, beforeTransform.height)
    const result = await paintBrushStroke(
      layer.id,
      beforeImage,
      beforeTransform,
      strokePoints,
      size,
      color,
      strokeSelection,
      previewTarget.width,
      previewTarget.height
    )
    createdSource = URL.createObjectURL(result.blob)
    trackedObjectUrls.add(createdSource)
    createdPreviewUrl = result.previewBlob ? URL.createObjectURL(result.previewBlob) : undefined
    if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)

    const newAsset = {
      width: result.width,
      height: result.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: result.blob.size,
      editToken: result.editToken,
      previewUrl: createdPreviewUrl,
      previewWidth: result.previewWidth,
      previewHeight: result.previewHeight
    }
    await preloadImage(newAsset.previewUrl ?? newAsset.sourceUrl)

    layer.image = newAsset

    recordHistory('Pincelada', {
      type: 'layer:patch',
      layerId: layer.id,
      before: { image: beforeImage },
      after: { image: { ...layer.image } }
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = 'Pincelada aplicada'
  } catch (error) {
    layer.image = beforeImage
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    if (createdPreviewUrl) {
      URL.revokeObjectURL(createdPreviewUrl)
      trackedObjectUrls.delete(createdPreviewUrl)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível aplicar a pincelada.')
  } finally {
    isBusy.value = false
  }
}

function preloadImage(url: string) {
  return new Promise<void>((resolve) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => resolve()
    image.src = url
  })
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
    await addImportedImages(await selectDesktopImages())
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
    await addImportedImages(result.images, result.errors)
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
  const command = event.ctrlKey || event.metaKey
  if (command && event.code === 'KeyZ') {
    event.preventDefault()
    if (event.shiftKey) redoHistory()
    else undoHistory()
    return
  }
  if (command && event.code === 'KeyY') {
    event.preventDefault()
    redoHistory()
    return
  }

  const target = event.target as HTMLElement | null
  if (target?.closest('input, select, textarea, [contenteditable="true"]')) return

  if (command && event.code === 'KeyJ') {
    event.preventDefault()
    duplicateLayer()
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return

  const toolsByKey: Record<string, EditorTool> = {
    v: 'move',
    b: 'brush',
    c: 'crop',
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
  disposeSelectionEngine()
  disposeBrushEngine()
  disposeSelectionMoveEngine()
  releaseAllEditorAssets()
  window.removeEventListener('wheel', blockBrowserWheelZoom, true)
  window.removeEventListener('keydown', handleShortcut)
})
</script>

<template>
  <main class="app-shell" :class="{ 'app-shell--busy': isBusy }">
    <TopMenu
      :can-redo="canRedo"
      :can-undo="canUndo"
      :document-name="activeDocument.name"
      :history-bytes="historyBytes"
      :history-items="historyItems"
      :history-position="historyPosition"
      :redo-label="redoLabel"
      :status-text="statusText"
      :undo-label="undoLabel"
      @export-document="exportDocument"
      @history-jump="jumpHistory"
      @import-images="importImages"
      @new-document="showNewDocumentDialog = true"
      @preview-filter="previewFilter"
      @redo="redoHistory"
      @undo="undoHistory"
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
        :auto-select-layer="autoSelectLayer"
        :brush-color="brushColor"
        :brush-size="brushSize"
        :document="activeDocument"
        :is-busy="isBusy"
        :layers="layers"
        :magic-wand-contiguous="magicWandContiguous"
        :magic-wand-tolerance="magicWandTolerance"
        :selection="selection"
        :selection-move-anchor="selectionMoveAnchor"
        :selection-mode="selectionMode"
        :zoom="zoom"
        @delete-selection="deleteSelectedPixels"
        @images-dropped="addImportedImages"
        @magic-wand-select="selectWithMagicWand"
        @move-selection="commitSelectionMove"
        @paint-stroke="commitBrushStroke"
        @create-text="addTextLayer"
        @select-layer="activeLayerId = $event"
        @update:magic-wand-contiguous="magicWandContiguous = $event"
        @update:magic-wand-tolerance="magicWandTolerance = $event"
        @update:selection="updateSelection"
        @update:selection-mode="setSelectionMode"
        @update-transform="updateLayerTransform"
        @update:auto-select-layer="autoSelectLayer = $event"
        @update:zoom="setZoom"
      />

      <aside class="side-panels" aria-label="Painéis do documento">
        <PropertiesPanel
          :active-layer="activeLayer"
          :active-tool="activeTool"
          :brush-color="brushColor"
          :brush-size="brushSize"
          :zoom="zoom"
          @update:brush-color="brushColor = $event"
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

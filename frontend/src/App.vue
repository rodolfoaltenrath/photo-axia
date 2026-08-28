<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CanvasViewport from './components/CanvasViewport.vue'
import FlattenImageDialog from './components/FlattenImageDialog.vue'
import ImportPdfDialog from './components/ImportPdfDialog.vue'
import LayerStyleDialog from './components/LayerStyleDialog.vue'
import LayersPanel from './components/LayersPanel.vue'
import NewDocumentDialog from './components/NewDocumentDialog.vue'
import ExportImageDialog from './components/ExportImageDialog.vue'
import ProjectHome from './components/ProjectHome.vue'
import PropertiesPanel from './components/PropertiesPanel.vue'
import ToolBar from './components/ToolBar.vue'
import TopMenu from './components/TopMenu.vue'
import UnsavedChangesDialog from './components/UnsavedChangesDialog.vue'
import {
  createEditorDocument,
  finalizeAxiaProjectOpen,
  clearRecentProjects,
  getEditorStatus,
  hasDesktopBackend,
  openAxiaProject,
  openRecentProject,
  prepareAxiaProjectSave,
  listRecentProjects,
  recordRecentProject,
  registerNativeFileDrop,
  releaseDesktopPDF,
  releaseAxiaProjectAssets,
  saveExportedImageBlob,
  removeRecentProject,
  setNativeDocumentDirty,
  uploadRecentThumbnail,
  selectDesktopImages,
  selectDesktopPDF
} from './services/backend'
import {
  clearPreparedImageCache,
  createImagePreview,
  disposeImagePreviewWorker,
  editorPreviewSize,
  imagePreviewNeedsUpdate,
  prepareImageSource,
  readBrowserImages,
  releasePreparedImage,
  releaseLayerAssets
} from './services/imageImport'
import {
  renderDocumentBlob,
  renderDocumentExportBlob,
  renderDocumentThumbnail,
  renderLayerAppearance,
  renderMergedLayers,
  sampleDocumentColor
} from './services/renderDocument'
import { pngBlobWithResolution } from './services/pngMetadata'
import { closePDFImport, renderPDFPages, type PDFImportSource, type PDFRenderRequest } from './services/pdfImport'
import {
  createAxiaProjectManifest,
  restoreAxiaProject,
  uploadAxiaProject
} from './services/project'
import {
  applyEditorHistoryDelta,
  cloneLayerHistoryState,
  cloneLayerPatch,
  cloneLayerState,
  estimateEditorHistoryBytes,
  historyDeltaLayers,
  historyDeltaObjectUrls,
  isEditorHistoryDeltaNoop,
  mergeEditorHistoryDelta,
  type EditorHistoryDelta
} from './editor/editorHistory'
import { useHistory, type HistoryRecordOptions, type HistorySnapshot, type HistoryStep } from './editor/history'
import { MutationBarrier } from './editor/mutationBarrier'
import type { ExportSettings } from './editor/exportSettings'
import { clampZoom } from './editor/viewport'
import { documentPixelSize } from './editor/document'
import { readAutoSelectLayerPreference, writeAutoSelectLayerPreference } from './editor/preferences'
import { canCreateDocument, editorIsBlockedByModal } from './editor/interactionGuards'
import { moveLayerBy, moveLayerRelativeTo } from './editor/layerOrder'
import { layerCanRasterize, layerSupportsRotationBaking, rasterizedLayerPatch } from './editor/layerRasterization'
import { layerCanExportPNG, quickLayerExportName } from './editor/layerExport'
import { createFlattenedLayer, documentCanFlatten } from './editor/flattenImage'
import { updateLayerSelection, type LayerSelectionMode } from './editor/layerSelection'
import { createSmartLayer, layersCanConvertToSmart, smartLayerObjectLayers } from './editor/smartLayers'
import {
  createEditedSmartLayerContent,
  createSmartLayerEditDocument,
  smartLayerEditHasChanges
} from './editor/smartLayerEditing'
import { LatestPathTaskQueue, LatestRequestGate } from './editor/recentTasks'
import type { EditorGuide, RulerOrigin, RulerUnit } from './editor/guides'
import { DEFAULT_TEXT_LAYER, measureTextLayer } from './editor/text'
import {
  cloneLayerStyleConfig,
  createLayerStyleConfig,
  DEFAULT_LAYER_STYLE_GLOBAL_LIGHT,
  layerStylePatternAssets,
  normalizeLayerStyleGlobalLight
} from './editor/layerStyles'
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
import {
  isMarqueeSelectionMode,
  nextMarqueeSelectionMode,
  type MarqueeSelectionMode
} from './editor/marqueeSelection'
import type { SelectionCombineMode } from './editor/selectionCombine'
import {
  availableIntelligentSelectionTool,
  isIntelligentSelectionTool,
  nextIntelligentSelectionTool,
  type IntelligentSelectionTool
} from './editor/intelligentSelectionTools'
import {
  createMagicWandSelection,
  disposeSelectionEngine,
  eraseImageSelection,
  extractImageSelection
} from './services/selectionEngine'
import { combineSelectionsAsync, disposeSelectionCombineEngine } from './services/selectionCombineEngine'
import { applyBrushStroke, disposeBrushEngine } from './services/brushEngine'
import { applyGradient, disposeGradientEngine } from './services/gradientEngine'
import { applyPaintBucket, applySolidFill, disposePaintBucketEngine } from './services/paintBucketEngine'
import { clearLayerStyleRenderCache, disposeLayerStyleCompositor } from './services/layerStyleCompositor'
import {
  clearSmartLayerRenderCache,
  invalidateSmartLayerContent,
  renderSmartLayer,
  seedSmartLayerRender
} from './services/smartLayerRenderer'
import type { BrushOperation } from './editor/brush'
import type { GradientGeometry, GradientStopsConfig } from './editor/gradient'
import { createGradientToolConfig, syncSimpleGradientColors } from './editor/gradientToolState'
import { gradientResultTransform } from './editor/gradientRaster'
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
  LayerBlendMode,
  LayerItem,
  LayerStyleConfig,
  LayerTransform,
  NewDocumentSettings,
  RecentProject,
  TextLayerContent
} from './types/editor'

const RULERS_VISIBLE_PREFERENCE = 'axia:rulers-visible'

function initialRulersVisibility() {
  if (typeof window === 'undefined') return true
  try {
    const stored = window.localStorage.getItem(RULERS_VISIBLE_PREFERENCE)
    if (stored === 'false') return false
    if (stored === 'true') return true
  } catch {
    // Ambientes com armazenamento indisponivel continuam com o padrao seguro.
  }
  return true
}

function browserPreferenceStorage() {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const activeTool = ref<EditorTool>('move')
const lastIntelligentSelectionTool = ref<IntelligentSelectionTool>('magic-wand')
const autoSelectLayer = ref(readAutoSelectLayerPreference(browserPreferenceStorage()))
const zoom = ref(100)
const brushSize = ref(24)
const brushColor = ref('#000000')
const backgroundColor = ref('#ffffff')
const gradientConfig = ref<GradientStopsConfig>(createGradientToolConfig(
  brushColor.value,
  backgroundColor.value
))
const guides = ref<EditorGuide[]>([])
const rulersVisible = ref(initialRulersVisibility())
const guidesVisible = ref(true)
const guidesLocked = ref(false)
const guideSnappingEnabled = ref(true)
const smartGuidesEnabled = ref(true)
const rulerUnit = ref<RulerUnit>('px')
const rulerOrigin = ref<RulerOrigin>({ x: 0, y: 0 })
const selectionMode = ref<SelectionMode>('rectangle')
const lastMarqueeMode = ref<MarqueeSelectionMode>('rectangle')
const selectionCombineMode = ref<SelectionCombineMode>('replace')
const magicWandTolerance = ref(32)
const magicWandContiguous = ref(true)
const paintBucketTolerance = ref(32)
const paintBucketContiguous = ref(true)
const selection = shallowRef<SelectionRegion | null>(null)
const statusText = ref('Inicializando…')
const errorText = ref('')
const isBusy = ref(false)
const activeLayerId = ref('layer-bg')
const selectedLayerIds = ref<string[]>(['layer-bg'])
const layerSelectionAnchorId = ref('layer-bg')
const showNewDocumentDialog = ref(false)
const showExportImageDialog = ref(false)
const showImportPdfDialog = ref(false)
const pdfImportSource = shallowRef<PDFImportSource | null>(null)
const pdfImportProgress = ref('')
const exportEstimateBusy = ref(false)
const exportEstimatedBytes = ref<number | null>(null)
const preparedExport = shallowRef<{ key: string; blob: Blob } | null>(null)
let exportEstimateGeneration = 0
const appScreen = ref<'home' | 'editor'>('home')
const hasOpenDocument = ref(false)
const recentProjects = ref<RecentProject[]>([])
const recentProjectsLoading = ref(true)
const showUnsavedChangesDialog = ref(false)
const showFlattenImageDialog = ref(false)
const layerStyleDialog = shallowRef<{ layerId: string; before: LayerStyleConfig }>()
const fileInput = ref<HTMLInputElement | null>(null)
const pdfFileInput = ref<HTMLInputElement | null>(null)
const canvasViewport = ref<InstanceType<typeof CanvasViewport> | null>(null)
const projectPath = ref('')
const savedHistoryRevision = ref<number | null>(null)
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
  createdAt: '',
  layerStyleGlobalLight: { ...DEFAULT_LAYER_STYLE_GLOBAL_LIGHT }
})
const layers = ref<LayerItem[]>([createBackgroundLayer()])
const zoomEventOptions = { capture: true, passive: false }
const previewGenerations = new Map<string, number>()
const previewControllers = new Map<string, AbortController>()
const trackedObjectUrls = new Set<string>()
const transientObjectUrls = new Set<string>()
let selectionGeneration = 0
let pendingSelectionTasks = 0
let previewRefreshTimer: ReturnType<typeof setTimeout> | undefined
let previewLayerCountHint = 0
let discardChangesResolver: ((confirmed: boolean) => void) | undefined
let rasterPreparationPromise: Promise<void> | undefined
const recentRefreshGate = new LatestRequestGate()
const thumbnailQueue = new LatestPathTaskQueue()
const ACTIVE_PREVIEW_PIXELS = 4_194_304
const DOCUMENT_PREVIEW_PIXELS = 24_000_000
const MIN_LAYER_PREVIEW_PIXELS = 262_144

interface FloatingSelectionSession {
  layerId: string
  anchorImage: ImageAsset
  anchorTransform: LayerTransform
  anchorSelection: SelectionRegion
  currentSelection: SelectionRegion
  deltaX: number
  deltaY: number
}

interface SmartLayerEditSession {
  targetLayerId: string
  targetLayerName: string
  parentActiveLayerId: string
  parentActiveTool: EditorTool
  parentDocument: DocumentSpec
  parentDirty: boolean
  parentGuideSnappingEnabled: boolean
  parentSmartGuidesEnabled: boolean
  parentGuides: EditorGuide[]
  parentGuidesLocked: boolean
  parentGuidesVisible: boolean
  parentHistory: HistorySnapshot<EditorHistoryDelta>
  parentLayerSelectionAnchorId: string
  parentLayers: LayerItem[]
  parentRulerOrigin: RulerOrigin
  parentRulerUnit: RulerUnit
  parentRulersVisible: boolean
  parentSelectedLayerIds: string[]
  parentSelection: SelectionRegion | null
  parentZoom: number
  retainedObjectUrls: Set<string>
}

const floatingSelectionSession = shallowRef<FloatingSelectionSession | null>(null)
const smartLayerEditSessions = shallowRef<SmartLayerEditSession[]>([])

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
const historyRevision = history.currentRevision
const redoLabel = history.redoLabel
const undoLabel = history.undoLabel
const activeSmartLayerEditSession = computed(() => smartLayerEditSessions.value.at(-1))
const smartLayerEditBreadcrumb = computed(() => smartLayerEditSessions.value.map((session) => session.targetLayerName))
const documentDirty = computed(() => {
  if (!hasOpenDocument.value) return false
  const session = activeSmartLayerEditSession.value
  if (session) return session.parentDirty || history.currentPosition.value > 0
  return savedHistoryRevision.value === null || historyRevision.value !== savedHistoryRevision.value
})
const modalOpen = computed(() => editorIsBlockedByModal(
  showNewDocumentDialog.value || showExportImageDialog.value || showImportPdfDialog.value,
  showUnsavedChangesDialog.value,
  Boolean(layerStyleDialog.value) || showFlattenImageDialog.value
))
const layerStyleDialogLayer = computed(() => {
  const session = layerStyleDialog.value
  return session ? layers.value.find((layer) => layer.id === session.layerId) : undefined
})

watch(documentDirty, (dirty) => {
  void setNativeDocumentDirty(dirty)
}, { immediate: true, flush: 'sync' })

const activeLayer = computed<LayerItem>(() => {
  return layers.value.find((layer) => layer.id === activeLayerId.value) ?? layers.value[0]!
})
const selectedLayerItems = computed(() => {
  const selected = new Set(selectedLayerIds.value)
  return layers.value
    .map((layer, index) => ({ index, layer }))
    .filter((item) => selected.has(item.layer.id))
})
const canConvertSelectedLayersToSmart = computed(() => layersCanConvertToSmart(selectedLayerItems.value))
const canFlattenImage = computed(() => documentCanFlatten(activeDocument.value, layers.value))
const hiddenLayerCount = computed(() => layers.value.reduce((count, layer) => count + Number(!layer.visible), 0))

function selectSingleLayer(layerId: string) {
  if (!layers.value.some((layer) => layer.id === layerId)) return
  selectedLayerIds.value = [layerId]
  layerSelectionAnchorId.value = layerId
  activeLayerId.value = layerId
}

function selectLayerFromPanel(layerId: string, mode: LayerSelectionMode) {
  const next = updateLayerSelection(
    layers.value,
    selectedLayerIds.value,
    activeLayerId.value,
    layerSelectionAnchorId.value,
    layerId,
    mode
  )
  selectedLayerIds.value = next.selectedIds
  layerSelectionAnchorId.value = next.anchorId
  activeLayerId.value = next.activeId
}
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

watch(activeLayerId, (layerId, previousLayerId) => {
  if (!selectedLayerIds.value.includes(layerId)) {
    selectedLayerIds.value = [layerId]
    layerSelectionAnchorId.value = layerId
  }
  if (floatingSelectionSession.value?.layerId !== layerId) clearFloatingSelectionSession()
  for (const candidateId of [layerId, previousLayerId]) {
    const layer = layers.value.find((item) => item.id === candidateId)
    if (layer?.visible && layer.image && layer.transform) void refreshLayerPreview(layer)
  }
})

watch(
  () => layers.value.map((layer) => layer.id).join('\u0000'),
  () => {
    const available = new Set(layers.value.map((layer) => layer.id))
    const retained = selectedLayerIds.value.filter((id) => available.has(id))
    selectedLayerIds.value = retained.length ? retained : [activeLayerId.value]
    if (!available.has(layerSelectionAnchorId.value)) layerSelectionAnchorId.value = activeLayerId.value
  }
)
const rasterMutationBarrier = new MutationBarrier()
let pendingBrushCommit: {
  controller: AbortController
  label: string
} | undefined
let pendingGradientCommit: AbortController | undefined
let pendingPaintBucketCommit: AbortController | undefined
let pendingMagicWandSelection: AbortController | undefined

function cancelMagicWandSelection() {
  if (!pendingMagicWandSelection) return
  const controller = pendingMagicWandSelection
  pendingMagicWandSelection = undefined
  selectionGeneration++
  controller.abort()
}

watch(
  [activeTool, activeLayerId, () => activeDocument.value.id],
  () => {
    cancelMagicWandSelection()
    if (isIntelligentSelectionTool(activeTool.value)) {
      lastIntelligentSelectionTool.value = availableIntelligentSelectionTool(activeTool.value)
    }
    if (activeTool.value === 'brush' || activeTool.value === 'eraser' || activeTool.value === 'gradient' || activeTool.value === 'paint-bucket') {
      void ensureRasterLayerPaintable()
    }
  },
  { flush: 'post' }
)

watch(selection, (currentSelection) => {
  const session = floatingSelectionSession.value
  if (session && currentSelection !== session.currentSelection) clearFloatingSelectionSession()
  if (!currentSelection) return
  const image = session?.anchorImage ?? activeLayer.value.image
  if (image) void warmSelectionMove(image).catch(() => undefined)
})

watch(zoom, () => {
  if (previewRefreshTimer) clearTimeout(previewRefreshTimer)
  previewRefreshTimer = setTimeout(() => {
    previewRefreshTimer = undefined
    for (const layer of layers.value) {
      if (layer.visible && layer.image && layer.transform) void refreshLayerPreview(layer)
    }
  }, 220)
})

watch(rulersVisible, (visible) => {
  try {
    window.localStorage.setItem(RULERS_VISIBLE_PREFERENCE, String(visible))
  } catch {
    // A preferencia em memoria ainda funciona quando o armazenamento e bloqueado.
  }
})

watch(autoSelectLayer, (enabled) => {
  writeAutoSelectLayerPreference(browserPreferenceStorage(), enabled)
})

watch([brushColor, backgroundColor], ([foreground, background]) => {
  gradientConfig.value = syncSimpleGradientColors(gradientConfig.value, foreground, background)
})

function createBackgroundLayer(): LayerItem {
  return {
    id: 'layer-bg', name: 'Fundo', visible: true, opacity: 100, blendMode: 'normal', kind: 'pixel',
    styles: createLayerStyleConfig()
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a camada raster.')), 'image/png')
  })
}

async function materializeRasterLayer(
  layer: LayerItem,
  width: number,
  height: number,
  background: DocumentSpec['background'] = 'transparent'
) {
  const canvas = window.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
  if (background !== 'transparent') {
    context.fillStyle = background === 'black' ? '#000000' : '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  const blob = await canvasToPngBlob(canvas)
  canvas.width = 1
  canvas.height = 1
  const sourceUrl = URL.createObjectURL(blob)
  trackedObjectUrls.add(sourceUrl)
  layer.image = {
    width,
    height,
    mimeType: 'image/png',
    sourceUrl,
    byteSize: blob.size
  }
  layer.transform = { x: 0, y: 0, width, height, rotation: 0 }
  await preloadImage(sourceUrl)
  return sourceUrl
}

async function ensureRasterLayerPaintable() {
  if (rasterPreparationPromise) return rasterPreparationPromise
  const layer = activeLayer.value
  if (
    isBusy.value ||
    (activeTool.value !== 'brush' && activeTool.value !== 'eraser' && activeTool.value !== 'gradient' && activeTool.value !== 'paint-bucket') ||
    (layer.kind !== 'background' && layer.kind !== 'pixel') ||
    layer.image ||
    layer.transform
  ) return

  const documentId = activeDocument.value.id
  const width = activeDocument.value.width
  const height = activeDocument.value.height
  const background = layer.kind === 'background' ? activeDocument.value.background : 'transparent'
  const previousStatus = statusText.value
  rasterPreparationPromise = (async () => {
    isBusy.value = true
    errorText.value = ''
    statusText.value = 'Preparando camada para edição…'
    let sourceUrl: string | undefined
    try {
      sourceUrl = await materializeRasterLayer(layer, width, height, background)
      if (activeDocument.value.id !== documentId || activeLayer.value !== layer) {
        URL.revokeObjectURL(sourceUrl)
        trackedObjectUrls.delete(sourceUrl)
        layer.image = undefined
        layer.transform = undefined
        return
      }
      await refreshLayerPreview(layer, true)
      statusText.value = previousStatus
    } catch (error) {
      if (sourceUrl && !layer.image) {
        URL.revokeObjectURL(sourceUrl)
        trackedObjectUrls.delete(sourceUrl)
      }
      showError(error, 'Não foi possível preparar a camada para pintura.')
    } finally {
      isBusy.value = false
      rasterPreparationPromise = undefined
    }
  })()
  return rasterPreparationPromise
}

function recordHistory(label: string, delta: EditorHistoryDelta, options?: HistoryRecordOptions) {
  const discarded = history.record(label, delta, options)
  if (discarded.some((entry) => historyDeltaLayers(entry.delta).length || historyDeltaObjectUrls(entry.delta).length)) {
    collectUnusedObjectUrls()
  }
}

function layerObjectUrls(layer: LayerItem) {
  return smartLayerObjectLayers(layer).flatMap((item) => [
    item.image?.sourceUrl,
    item.image?.previewUrl,
    ...layerStylePatternAssets(item.styles).map((asset) => asset.sourceUrl)
  ]).filter(
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
  for (const session of smartLayerEditSessions.value) {
    for (const source of session.retainedObjectUrls) retainedUrls.add(source)
  }
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

function releaseAllEditorAssets(preserveSmartCache = false) {
  for (const controller of previewControllers.values()) controller.abort()
  previewControllers.clear()
  floatingSelectionSession.value = null
  clearPreparedImageCache()
  clearLayerStyleRenderCache()
  if (!preserveSmartCache) clearSmartLayerRenderCache()
  releaseLayerAssets([...layers.value, ...retainedHistoryLayers()])
  for (const source of trackedObjectUrls) URL.revokeObjectURL(source)
  trackedObjectUrls.clear()
}

async function applyHistorySteps(steps: HistoryStep<EditorHistoryDelta>[]) {
  const refreshIds = new Set<string>()
  let resourcesMayBeUnused = false
  let restoredSelection: SelectionRegion | null | undefined
  for (const { delta, direction } of steps) {
    if (delta.type === 'guides:change') {
      guides.value = (direction === 'redo' ? delta.after : delta.before).map((guide) => ({ ...guide }))
      continue
    }
    if (delta.type === 'document:global-light') {
      activeDocument.value.layerStyleGlobalLight = normalizeLayerStyleGlobalLight(
        direction === 'redo' ? delta.after : delta.before
      )
      continue
    }
    const result = applyEditorHistoryDelta(layers.value, activeLayerId.value, delta, direction, selectedLayerIds.value)
    activeLayerId.value = result.activeLayerId
    selectedLayerIds.value = result.selectedLayerIds
    trackLayerAssets(result.insertedLayers)
    for (const layerId of result.removedLayerIds) {
      previewGenerations.set(layerId, (previewGenerations.get(layerId) ?? 0) + 1)
    }
    for (const layerId of result.refreshLayerIds) refreshIds.add(layerId)
    if (result.removedLayerIds.length) resourcesMayBeUnused = true
    if ('selectionBefore' in delta || 'selectionAfter' in delta) {
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
  for (const layer of layers.value) {
    if (layer.kind === 'smart' && layer.smart && !layer.image) await refreshSmartLayerSource(layer)
  }
  if (resourcesMayBeUnused) collectUnusedObjectUrls()
  if (restoredSelection !== undefined) {
    selection.value = restoredSelection
    selectionGeneration++
  }
}

async function undoHistory() {
  canvasViewport.value?.commitPendingTransform()
  if (pendingBrushCommit && rasterMutationBarrier.isPending) {
    const { controller, label } = pendingBrushCommit
    pendingBrushCommit = undefined
    controller.abort()
    rasterMutationBarrier.discard()
    canvasViewport.value?.discardPendingBrushPreview()
    statusText.value = `Desfeito: ${label}`
    errorText.value = ''
    return
  }
  if (pendingGradientCommit && rasterMutationBarrier.isPending) {
    pendingGradientCommit.abort()
    pendingGradientCommit = undefined
    rasterMutationBarrier.discard()
    statusText.value = 'Desfeito: Degradê'
    errorText.value = ''
    return
  }
  if (pendingPaintBucketCommit && rasterMutationBarrier.isPending) {
    pendingPaintBucketCommit.abort()
    pendingPaintBucketCommit = undefined
    rasterMutationBarrier.discard()
    statusText.value = 'Desfeito: Balde de Tinta'
    errorText.value = ''
    return
  }
  if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição antes de desfazer…'
  if (!await rasterMutationBarrier.wait()) return
  selection.value = null
  const transition = history.undo()
  if (!transition) return
  await applyHistorySteps(transition.steps)
  statusText.value = `Desfeito: ${transition.label}`
  errorText.value = ''
}

async function redoHistory() {
  canvasViewport.value?.commitPendingTransform()
  if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição antes de refazer…'
  if (!await rasterMutationBarrier.wait()) return
  selection.value = null
  const transition = history.redo()
  if (!transition) return
  await applyHistorySteps(transition.steps)
  statusText.value = `Refeito: ${transition.label}`
  errorText.value = ''
}

async function jumpHistory(position: number) {
  canvasViewport.value?.commitPendingTransform()
  if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição antes de navegar no histórico…'
  if (!await rasterMutationBarrier.wait()) return
  selection.value = null
  const transition = history.jump(position)
  if (!transition) return
  await applyHistorySteps(transition.steps)
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

let colorSampleGeneration = 0
let pendingColorSample: {
  documentId: string
  generation: number
  point: SelectionPoint
  target: 'foreground' | 'background'
} | undefined
let colorSampleRunning = false

async function processColorSamples() {
  if (colorSampleRunning) return
  colorSampleRunning = true
  try {
    while (pendingColorSample) {
      const request = pendingColorSample
      pendingColorSample = undefined
      if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição antes de coletar a cor…'
      if (!await rasterMutationBarrier.wait()) continue
      if (request.documentId !== activeDocument.value.id) continue
      const color = await sampleDocumentColor(
        activeDocument.value,
        layers.value,
        request.point.x,
        request.point.y
      )
      if (
        request.generation !== colorSampleGeneration ||
        request.documentId !== activeDocument.value.id
      ) continue
      if (!color) {
        statusText.value = 'Área transparente: nenhuma cor coletada'
        continue
      }
      if (request.target === 'background') backgroundColor.value = color
      else brushColor.value = color
      statusText.value = `${request.target === 'background' ? 'Cor secundária' : 'Cor principal'}: ${color.toUpperCase()}`
      errorText.value = ''
    }
  } catch (error) {
    showError(error, 'Não foi possível coletar a cor.')
  } finally {
    colorSampleRunning = false
    if (pendingColorSample) void processColorSamples()
  }
}

function sampleColor(point: SelectionPoint, target: 'foreground' | 'background') {
  const generation = ++colorSampleGeneration
  pendingColorSample = {
    documentId: activeDocument.value.id,
    generation,
    point: { ...point },
    target
  }
  canvasViewport.value?.commitPendingTransform()
  void processColorSamples()
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
    blendMode: 'normal',
    kind: 'pixel',
    styles: createLayerStyleConfig()
  }
  layers.value.splice(insertionIndex, 0, layer)
  activeLayerId.value = id
  recordHistory('Criar camada', {
    type: 'layers:add',
    items: [{ index: insertionIndex, layer: cloneLayerHistoryState(layer) }],
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
    blendMode: 'normal',
    kind: 'text',
    styles: createLayerStyleConfig(),
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
    items: [{ index: insertionIndex, layer: cloneLayerHistoryState(layer) }],
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
  if (layer.visible && layer.image) void refreshLayerPreview(layer)
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
  if (!layer || !cleanName) return

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
  if (!source) return

  const duplicate: LayerItem = {
    ...cloneLayerState(source),
    id: crypto.randomUUID(),
    name: `${source.name} cópia`,
    kind: source.kind === 'background' ? 'image' : source.kind,
    transform: source.transform
      ? {
          ...source.transform,
          x: source.transform.x + (source.kind === 'background' ? 0 : 12),
          y: source.transform.y + (source.kind === 'background' ? 0 : 12)
        }
      : undefined
  }

  const activeBefore = activeLayerId.value
  layers.value.splice(index, 0, duplicate)
  activeLayerId.value = duplicate.id
  recordHistory('Duplicar camada', {
    type: 'layers:add',
    items: [{ index, layer: cloneLayerHistoryState(duplicate) }],
    activeBefore,
    activeAfter: duplicate.id
  })
  statusText.value = 'Camada duplicada'
}

async function settleRasterMutation(status: string) {
  canvasViewport.value?.commitPendingTransform()
  if (rasterMutationBarrier.isPending) statusText.value = status
  return rasterMutationBarrier.wait()
}

async function convertSelectedLayersToSmart() {
  if (isBusy.value) return
  const selectedItems = selectedLayerItems.value
  if (!layersCanConvertToSmart(selectedItems)) {
    showError(new Error('A seleção não possui conteúdo visual compatível.'), 'Não foi possível criar a camada inteligente.')
    return
  }

  const documentId = activeDocument.value.id
  const activeBefore = activeLayerId.value
  const selectedIds = new Set(selectedItems.map(({ layer }) => layer.id))

  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = selectedItems.length === 1
    ? 'Convertendo em camada inteligente…'
    : `Convertendo ${selectedItems.length} camadas…`
  try {
    if (!await settleRasterMutation('Finalizando edição antes de criar a camada inteligente…')) return
    clearFloatingSelectionSession()
    selection.value = null
    selectionGeneration++
    for (const { layer } of selectedItems) {
      for (const source of layerObjectUrls(layer)) transientObjectUrls.add(source)
    }
    const selectedLayers = selectedItems.map(({ layer }) => layer)
    const appearance = selectedLayers.length === 1
      ? await renderLayerAppearance(activeDocument.value, selectedLayers[0]!, 'local')
      : await renderMergedLayers(activeDocument.value, selectedLayers)
    createdSource = URL.createObjectURL(appearance.blob)
    trackedObjectUrls.add(createdSource)
    const cache: ImageAsset = {
      width: appearance.width,
      height: appearance.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: appearance.blob.size
    }
    const smartLayer = createSmartLayer(
      activeDocument.value,
      selectedItems,
      appearance,
      cache,
      crypto.randomUUID()
    )
    cache.editToken = seedSmartLayerRender(smartLayer.smart!, appearance.blob, cache.width, cache.height)
    const previewTarget = workingPreviewSize(cache, smartLayer.transform!)
    const preview = await createImagePreview(cache, previewTarget.width, previewTarget.height)
    createdPreviewUrl = preview?.url.startsWith('blob:') ? preview.url : undefined
    if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)
    await Promise.all([preloadImage(createdSource), preview ? preloadImage(preview.url) : Promise.resolve()])

    if (activeDocument.value.id !== documentId || selectedItems.some(({ layer }) => !layers.value.includes(layer))) {
      throw new Error('As camadas originais não estão mais disponíveis.')
    }

    smartLayer.image = {
      ...cache,
      previewUrl: preview?.url,
      previewWidth: preview?.width ?? cache.width,
      previewHeight: preview?.height ?? cache.height
    }
    const insertionIndex = layers.value
      .slice(0, selectedItems[0]!.index)
      .filter((layer) => !selectedIds.has(layer.id)).length
    const remaining = layers.value.filter((layer) => !selectedIds.has(layer.id))
    remaining.splice(insertionIndex, 0, smartLayer)
    layers.value = remaining
    trackLayerAssets([smartLayer])
    selectSingleLayer(smartLayer.id)

    recordHistory(selectedItems.length === 1 ? 'Converter em camada inteligente' : 'Criar camada inteligente', {
      type: 'layers:replace',
      before: selectedItems.map(({ index, layer }) => ({ index, layer: cloneLayerHistoryState(layer) })),
      after: [{ index: insertionIndex, layer: cloneLayerHistoryState(smartLayer) }],
      activeBefore,
      activeAfter: smartLayer.id
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = selectedItems.length === 1
      ? 'Camada inteligente criada'
      : `${selectedItems.length} camadas convertidas em uma camada inteligente`
  } catch (error) {
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    if (createdPreviewUrl) {
      URL.revokeObjectURL(createdPreviewUrl)
      trackedObjectUrls.delete(createdPreviewUrl)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível criar a camada inteligente.')
  } finally {
    isBusy.value = false
  }
}

function commitGuides(label: string, nextGuides: EditorGuide[]) {
  const before = guides.value.map((guide) => ({ ...guide }))
  const after = nextGuides.map((guide) => ({ ...guide }))
  guides.value = after
  recordHistory(label, { type: 'guides:change', before, after })
  statusText.value = label
}

function createGuide(guide: EditorGuide) {
  commitGuides('Criar guia', [...guides.value, guide])
}

function updateGuide(guide: EditorGuide) {
  commitGuides(
    'Mover guia',
    guides.value.map((current) => current.id === guide.id ? { ...guide } : current)
  )
}

function deleteGuide(guideId: string) {
  if (!guides.value.some((guide) => guide.id === guideId)) return
  commitGuides('Excluir guia', guides.value.filter((guide) => guide.id !== guideId))
}

function clearGuides() {
  if (!guides.value.length) return
  commitGuides('Limpar guias', [])
}

async function duplicateSelectionOrLayer() {
  const currentSelection = selection.value
  if (!currentSelection || selectionIsEmpty(currentSelection)) {
    duplicateLayer()
    return
  }
  if (isBusy.value) return
  clearFloatingSelectionSession()
  const source = activeLayer.value
  if ((source.kind !== 'image' && source.kind !== 'background' && source.kind !== 'pixel') || !source.image || !source.transform) {
    showError(new Error('A seleção precisa estar sobre uma camada de imagem.'), 'Não foi possível copiar a seleção.')
    return
  }

  if (!await settleRasterMutation('Finalizando edição antes de copiar a seleção…')) return
  if (!layers.value.includes(source) || !source.image || !source.transform) return
  const sourceImage = { ...source.image }
  const sourceTransform = { ...source.transform }
  for (const assetSource of [sourceImage.sourceUrl, sourceImage.previewUrl]) {
    if (assetSource?.startsWith('blob:')) transientObjectUrls.add(assetSource)
  }
  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Criando camada pela seleção…'
  try {
    const result = await extractImageSelection(sourceImage, sourceTransform, currentSelection)
    createdSource = URL.createObjectURL(result.blob)
    trackedObjectUrls.add(createdSource)

    const oldMatrix = layerSourceToDocumentMatrix(sourceTransform, sourceImage.width, sourceImage.height)
    const bounds = result.sourceBounds
    const center = transformSelectionPoint(oldMatrix, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    })
    const width = bounds.width * (sourceTransform.width / sourceImage.width)
    const height = bounds.height * (sourceTransform.height / sourceImage.height)
    const transform: LayerTransform = {
      ...sourceTransform,
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height
    }
    const asset: ImageAsset = {
      width: result.width,
      height: result.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: result.blob.size
    }
    const previewTarget = workingPreviewSize(asset, transform)
    const preview = await createImagePreview(asset, previewTarget.width, previewTarget.height)
    createdPreviewUrl = preview?.url.startsWith('blob:') ? preview.url : undefined
    if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)
    await Promise.all([preloadImage(createdSource), preview ? preloadImage(preview.url) : Promise.resolve()])

    const duplicate: LayerItem = {
      id: crypto.randomUUID(),
      name: `${source.name} seleção`,
      visible: true,
      opacity: 100,
      blendMode: source.blendMode,
      kind: 'image',
      styles: cloneLayerStyleConfig(source.styles),
      image: {
        ...asset,
        previewUrl: preview?.url,
        previewWidth: preview?.width ?? asset.width,
        previewHeight: preview?.height ?? asset.height
      },
      transform
    }
    const sourceIndex = layers.value.findIndex((layer) => layer.id === source.id)
    if (sourceIndex < 0) throw new Error('A camada original não está mais disponível.')
    const activeBefore = activeLayerId.value
    layers.value.splice(sourceIndex, 0, duplicate)
    activeLayerId.value = duplicate.id
    selection.value = null
    selectionGeneration++
    activeTool.value = 'move'
    recordHistory('Camada via cópia', {
      type: 'layers:add',
      items: [{ index: sourceIndex, layer: cloneLayerHistoryState(duplicate) }],
      activeBefore,
      activeAfter: duplicate.id,
      selectionBefore: cloneSelection(currentSelection),
      selectionAfter: null
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = 'Área copiada para uma nova camada — pronta para mover'
  } catch (error) {
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    if (createdPreviewUrl) {
      URL.revokeObjectURL(createdPreviewUrl)
      trackedObjectUrls.delete(createdPreviewUrl)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível copiar a seleção.')
  } finally {
    isBusy.value = false
  }
}

async function rasterizeLayer(layerId = activeLayerId.value) {
  if (isBusy.value) return
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer || !layerCanRasterize(layer)) {
    showError(new Error('A camada não possui conteúdo visual compatível.'), 'Não foi possível rasterizar a camada.')
    return
  }

  const documentId = activeDocument.value.id
  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Rasterizando camada…'
  try {
    if (!await settleRasterMutation('Finalizando edição antes de rasterizar…')) return
    clearFloatingSelectionSession()
    const before = cloneLayerPatch({
      kind: layer.kind,
      image: layer.image,
      smart: layer.smart,
      text: layer.text,
      transform: layer.transform,
      styles: layer.styles
    })
    const appearance = await renderLayerAppearance(activeDocument.value, layer, 'local')
    createdSource = URL.createObjectURL(appearance.blob)
    trackedObjectUrls.add(createdSource)

    const sourceImage: ImageAsset = {
      width: appearance.width,
      height: appearance.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: appearance.blob.size
    }
    const patch = rasterizedLayerPatch(appearance, sourceImage)
    const previewTarget = workingPreviewSize(sourceImage, patch.transform)
    const preview = await createImagePreview(sourceImage, previewTarget.width, previewTarget.height)
    createdPreviewUrl = preview?.url.startsWith('blob:') ? preview.url : undefined
    if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)
    await Promise.all([preloadImage(createdSource), preview ? preloadImage(preview.url) : Promise.resolve()])

    if (activeDocument.value.id !== documentId || !layers.value.includes(layer)) {
      throw new Error('A camada original não está mais disponível.')
    }

    for (const source of layerObjectUrls(layer)) transientObjectUrls.add(source)
    previewControllers.get(layer.id)?.abort()
    previewControllers.delete(layer.id)
    previewGenerations.set(layer.id, (previewGenerations.get(layer.id) ?? 0) + 1)
    const image: ImageAsset = {
      ...sourceImage,
      previewUrl: preview?.url,
      previewWidth: preview?.width ?? sourceImage.width,
      previewHeight: preview?.height ?? sourceImage.height
    }
    const after = cloneLayerPatch({ ...patch, image })
    Object.assign(layer, after)
    recordHistory('Rasterizar camada', {
      type: 'layer:patch',
      layerId: layer.id,
      before,
      after
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = 'Camada rasterizada'
  } catch (error) {
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    if (createdPreviewUrl) {
      URL.revokeObjectURL(createdPreviewUrl)
      trackedObjectUrls.delete(createdPreviewUrl)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível rasterizar a camada.')
  } finally {
    isBusy.value = false
  }
}

async function mergeSelectedLayers() {
  if (isBusy.value) return
  const selected = new Set(selectedLayerIds.value)
  const selectedItems = layers.value
    .map((layer, index) => ({ index, layer }))
    .filter((item) => selected.has(item.layer.id))
  if (selectedItems.length < 2) {
    errorText.value = 'Selecione pelo menos duas camadas com Ctrl+clique.'
    statusText.value = 'São necessárias duas camadas para mesclar'
    return
  }
  if (selectedItems.some((item) => !item.layer.visible)) {
    errorText.value = 'Existem camadas ocultas na seleção. Torne-as visíveis ou remova-as da seleção antes de mesclar.'
    statusText.value = 'A mesclagem foi cancelada para preservar camadas ocultas'
    return
  }

  const activeBefore = activeLayerId.value
  const selectedLayers = selectedItems.map((item) => item.layer)
  let createdSource: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Mesclando camadas…'
  try {
    if (!await settleRasterMutation('Finalizando edição antes de mesclar…')) return
    clearFloatingSelectionSession()
    selection.value = null
    selectionGeneration++
    for (const layer of selectedLayers) {
      for (const source of layerObjectUrls(layer)) transientObjectUrls.add(source)
    }
    const result = await renderMergedLayers(activeDocument.value, selectedLayers)
    createdSource = URL.createObjectURL(result.blob)
    trackedObjectUrls.add(createdSource)
    const includesBackground = selectedLayers.some((layer) => layer.kind === 'background')
    const merged: LayerItem = {
      id: crypto.randomUUID(),
      name: includesBackground ? 'Fundo mesclado' : `Mesclagem (${selectedItems.length})`,
      visible: true,
      opacity: 100,
      blendMode: 'normal',
      kind: includesBackground ? 'background' : 'image',
      styles: createLayerStyleConfig(),
      image: {
        width: result.width,
        height: result.height,
        mimeType: 'image/png',
        sourceUrl: createdSource,
        byteSize: result.blob.size
      },
      transform: {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
        rotation: 0
      }
    }
    await preloadImage(createdSource)

    const remaining = layers.value.filter((layer) => !selected.has(layer.id))
    const firstSelectedIndex = selectedItems[0]!.index
    const insertionIndex = includesBackground
      ? remaining.length
      : layers.value.slice(0, firstSelectedIndex).filter((layer) => !selected.has(layer.id)).length
    remaining.splice(insertionIndex, 0, merged)
    layers.value = remaining
    trackLayerAssets([merged])
    selectSingleLayer(merged.id)
    await refreshLayerPreview(merged, true, false, true)

    recordHistory('Mesclar camadas', {
      type: 'layers:replace',
      before: selectedItems.map((item) => ({ index: item.index, layer: cloneLayerHistoryState(item.layer) })),
      after: [{ index: insertionIndex, layer: cloneLayerHistoryState(merged) }],
      activeBefore,
      activeAfter: merged.id
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = `${selectedItems.length} camadas mescladas`
  } catch (error) {
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível mesclar as camadas selecionadas.')
  } finally {
    isBusy.value = false
  }
}

function requestFlattenImage() {
  if (isBusy.value) return
  if (!canFlattenImage.value) {
    showError(new Error('O documento não possui camadas que precisem ser achatadas.'), 'Não foi possível achatar a imagem.')
    return
  }
  if (hiddenLayerCount.value) {
    showFlattenImageDialog.value = true
    return
  }
  void flattenImage()
}

function cancelFlattenImage() {
  if (!isBusy.value) showFlattenImageDialog.value = false
}

async function confirmFlattenImage() {
  showFlattenImageDialog.value = false
  await flattenImage()
}

async function flattenImage() {
  if (isBusy.value || !documentCanFlatten(activeDocument.value, layers.value)) return false
  let createdSource: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Achatando imagem…'
  try {
    if (!await settleRasterMutation('Finalizando edição antes de achatar…')) return false
    clearFloatingSelectionSession()
    selection.value = null
    selectionGeneration++
    const documentId = activeDocument.value.id
    const originalLayers = layers.value.slice()
    const activeBefore = activeLayerId.value
    const selectedBefore = selectedLayerIds.value.slice()
    for (const layer of originalLayers) {
      for (const source of layerObjectUrls(layer)) transientObjectUrls.add(source)
    }
    for (const layer of originalLayers) {
      if (layer.visible && layer.kind === 'smart') await refreshSmartLayerSource(layer)
    }
    const blob = await renderDocumentBlob(activeDocument.value, originalLayers)
    createdSource = URL.createObjectURL(blob)
    trackedObjectUrls.add(createdSource)
    const image: ImageAsset = {
      width: activeDocument.value.width,
      height: activeDocument.value.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: blob.size
    }
    const flattened = createFlattenedLayer(activeDocument.value, image, crypto.randomUUID())
    await preloadImage(createdSource)

    if (
      activeDocument.value.id !== documentId || layers.value.length !== originalLayers.length ||
      originalLayers.some((layer, index) => layers.value[index] !== layer)
    ) throw new Error('As camadas originais não estão mais disponíveis.')

    for (const layer of originalLayers) {
      for (const source of layerObjectUrls(layer)) transientObjectUrls.add(source)
    }
    layers.value = [flattened]
    trackLayerAssets([flattened])
    selectSingleLayer(flattened.id)
    await refreshLayerPreview(flattened, true, false, true)
    recordHistory('Achatar imagem', {
      type: 'layers:replace',
      before: originalLayers.map((layer, index) => ({ index, layer: cloneLayerHistoryState(layer) })),
      after: [{ index: 0, layer: cloneLayerHistoryState(flattened) }],
      activeBefore,
      activeAfter: flattened.id,
      selectedBefore,
      selectedAfter: [flattened.id]
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = originalLayers.some((layer) => !layer.visible)
      ? 'Imagem achatada; camadas ocultas removidas'
      : 'Imagem achatada'
    return true
  } catch (error) {
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível achatar a imagem.')
    return false
  } finally {
    isBusy.value = false
  }
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
  previewControllers.get(layerId)?.abort()
  previewControllers.delete(layerId)

  const activeBefore = activeLayerId.value
  const removed = cloneLayerHistoryState(layer)
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
  const change = moveLayerBy(layers.value, layerId, direction)
  if (!change) return
  layers.value = change.layers
  recordHistory(direction < 0 ? 'Elevar camada' : 'Abaixar camada', {
    type: 'layer:reorder',
    layerId,
    beforeIndex: change.beforeIndex,
    afterIndex: change.afterIndex
  })
  statusText.value = direction < 0 ? 'Camada elevada' : 'Camada abaixada'
}

function reorderLayer(layerId: string, targetId: string, position: 'before' | 'after') {
  const change = moveLayerRelativeTo(layers.value, layerId, targetId, position)
  if (!change) return
  layers.value = change.layers
  recordHistory('Reordenar camada', {
    type: 'layer:reorder',
    layerId,
    beforeIndex: change.beforeIndex,
    afterIndex: change.afterIndex
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

function openLayerStyles(layerId: string) {
  if (isBusy.value || layerStyleDialog.value) return
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) return
  selectSingleLayer(layerId)
  layerStyleDialog.value = { layerId, before: cloneLayerStyleConfig(layer.styles) }
}

function previewLayerStyles(styles: LayerStyleConfig) {
  const layer = layerStyleDialogLayer.value
  if (!layer) return
  layer.styles = cloneLayerStyleConfig(styles)
}

function cancelLayerStyles() {
  const session = layerStyleDialog.value
  const layer = layerStyleDialogLayer.value
  if (session && layer) layer.styles = cloneLayerStyleConfig(session.before)
  layerStyleDialog.value = undefined
}

function applyLayerStyles(styles: LayerStyleConfig) {
  const session = layerStyleDialog.value
  const layer = layerStyleDialogLayer.value
  if (!session || !layer) {
    layerStyleDialog.value = undefined
    return
  }

  const before = cloneLayerStyleConfig(session.before)
  const after = cloneLayerStyleConfig(styles)
  layer.styles = after
  layerStyleDialog.value = undefined
  if (JSON.stringify(before) === JSON.stringify(after)) return
  recordHistory('Alterar estilos de camada', {
    type: 'layer:patch',
    layerId: layer.id,
    before: { styles: before },
    after: { styles: after }
  })
  statusText.value = 'Estilos de camada atualizados'
}

function updateLayerBlendMode(blendMode: LayerBlendMode) {
  const layer = activeLayer.value
  if (layer.blendMode === blendMode) return
  const before = layer.blendMode
  layer.blendMode = blendMode
  recordHistory('Alterar modo de mesclagem', {
    type: 'layer:patch',
    layerId: layer.id,
    before: { blendMode: before },
    after: { blendMode }
  })
  statusText.value = 'Modo de mesclagem atualizado'
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

  if ((transform.rotation ?? 0) !== 0 && layerSupportsRotationBaking(layer)) {
    // Apply the committed (still rotated) geometry immediately so nothing
    // visually reverts to the pre-rotation state while the pixel bake runs
    // in the background — this matters most for a multi-layer group rotate,
    // where each member's bake is queued and only runs once earlier ones finish.
    layer.transform = transform
    queueLayerRotationBake(layer, previous, transform)
    return
  }

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

function moveLayerTransforms(updates: Array<{ layerId: string; transform: LayerTransform }>) {
  const items: Array<{ layerId: string; before: LayerTransform; after: LayerTransform }> = []
  for (const update of updates) {
    const layer = layers.value.find((item) => item.id === update.layerId)
    const previous = layer?.transform
    if (!layer || !previous) continue
    const transform = update.transform
    const onlyPositionChanged =
      previous.width === transform.width &&
      previous.height === transform.height &&
      (previous.rotation ?? 0) === (transform.rotation ?? 0)
    if (!onlyPositionChanged || (previous.x === transform.x && previous.y === transform.y)) continue
    items.push({
      layerId: layer.id,
      before: { ...previous },
      after: { ...transform }
    })
  }
  if (!items.length) return

  if (items.some((item) => floatingSelectionSession.value?.layerId === item.layerId)) {
    clearFloatingSelectionSession()
  }
  for (const item of items) {
    const layer = layers.value.find((candidate) => candidate.id === item.layerId)
    if (layer) layer.transform = { ...item.after }
  }
  recordHistory(items.length === 1 ? 'Mover camada' : 'Mover camadas', {
    type: 'layers:transform',
    items
  })
  statusText.value = items.length === 1 ? 'Camada movida' : `${items.length} camadas movidas`
}

// Bakes run one at a time: a multi-layer group rotate (Ctrl+T with several
// layers selected) commits each member synchronously in the same tick, and
// bakeLayerRotation shares global mutable state (isBusy, transientObjectUrls,
// preview bookkeeping) that isn't safe for overlapping runs.
let rotationBakeQueue: Promise<boolean> = Promise.resolve(true)

// Tracked on rasterMutationBarrier so undo/redo/export (which already wait
// on that barrier before touching layers.value) also wait for an in-flight
// bake instead of racing history navigation against it. Also chains onto
// whatever the barrier is already tracking (e.g. a brush stroke still
// committing) so that unrelated pending work isn't silently dropped from
// tracking when rasterMutationBarrier.track() below overwrites it.
function queueLayerRotationBake(layer: LayerItem, previous: LayerTransform | undefined, transform: LayerTransform) {
  const waitForOtherPendingMutation = rasterMutationBarrier.isPending
    ? rasterMutationBarrier.wait()
    : Promise.resolve(true)
  rotationBakeQueue = Promise.all([rotationBakeQueue, waitForOtherPendingMutation])
    .then(() => bakeLayerRotation(layer, previous, transform))
  rasterMutationBarrier.track(rotationBakeQueue)
}

// Bakes a committed rotation into the layer's pixels, resetting the
// transform to an axis-aligned box (rotation 0) so the next Ctrl+T session
// starts straight, the same way Photoshop settles a rotated pixel layer.
async function bakeLayerRotation(
  layer: LayerItem,
  previous: LayerTransform | undefined,
  transform: LayerTransform
): Promise<boolean> {
  const documentId = activeDocument.value.id
  const previousPatch = cloneLayerPatch({
    kind: layer.kind,
    image: layer.image,
    smart: layer.smart,
    text: layer.text,
    transform: previous,
    styles: layer.styles
  })
  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  // Restore (not just clear) isBusy on exit: a bake can be queued while
  // another isBusy-owning operation (e.g. rasterizeLayer) is already running
  // and awaiting this same bake via settleRasterMutation — clearing isBusy
  // unconditionally would re-enable other actions mid-operation.
  const wasBusy = isBusy.value
  isBusy.value = true
  statusText.value = 'Aplicando rotação…'
  try {
    const appearance = await renderLayerAppearance(activeDocument.value, layer, 'local')
    createdSource = URL.createObjectURL(appearance.blob)
    trackedObjectUrls.add(createdSource)

    const sourceImage: ImageAsset = {
      width: appearance.width,
      height: appearance.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: appearance.blob.size
    }
    const patch = rasterizedLayerPatch(appearance, sourceImage)
    const previewTarget = workingPreviewSize(sourceImage, patch.transform)
    const preview = await createImagePreview(sourceImage, previewTarget.width, previewTarget.height)
    createdPreviewUrl = preview?.url.startsWith('blob:') ? preview.url : undefined
    if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)
    await Promise.all([preloadImage(createdSource), preview ? preloadImage(preview.url) : Promise.resolve()])

    if (activeDocument.value.id !== documentId || !layers.value.includes(layer)) {
      throw new Error('A camada original não está mais disponível.')
    }

    for (const source of layerObjectUrls(layer)) transientObjectUrls.add(source)
    previewControllers.get(layer.id)?.abort()
    previewControllers.delete(layer.id)
    previewGenerations.set(layer.id, (previewGenerations.get(layer.id) ?? 0) + 1)
    const image: ImageAsset = {
      ...sourceImage,
      previewUrl: preview?.url,
      previewWidth: preview?.width ?? sourceImage.width,
      previewHeight: preview?.height ?? sourceImage.height
    }
    const after = cloneLayerPatch({ ...patch, image })
    Object.assign(layer, after)
    recordHistory('Girar camada', {
      type: 'layer:patch',
      layerId: layer.id,
      before: previousPatch,
      after
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = 'Rotação aplicada'
    return true
  } catch (error) {
    layer.transform = previous
    if (createdSource) {
      URL.revokeObjectURL(createdSource)
      trackedObjectUrls.delete(createdSource)
    }
    if (createdPreviewUrl) {
      URL.revokeObjectURL(createdPreviewUrl)
      trackedObjectUrls.delete(createdPreviewUrl)
    }
    transientObjectUrls.clear()
    showError(error, 'Não foi possível aplicar a rotação da camada.')
    return false
  } finally {
    isBusy.value = wasBusy
  }
}

function toPixelSize(settings: NewDocumentSettings) {
  return documentPixelSize(settings)
}

async function createDocument(settings: NewDocumentSettings) {
  if (!canCreateDocument(isBusy.value)) return
  errorText.value = ''
  isBusy.value = true
  try {
    const pixels = toPixelSize(settings)
    const document = await createEditorDocument(settings, pixels.width, pixels.height)
    releaseAllEditorAssets()
    await releaseAxiaProjectAssets()
    history.clear('Documento criado')
    previewGenerations.clear()
    selection.value = null
    selectionGeneration++
    activeDocument.value = document
    guides.value = []
    rulerOrigin.value = { x: 0, y: 0 }
    const baseLayer = createBackgroundLayer()
    layers.value = [baseLayer]
    activeLayerId.value = 'layer-bg'
    selectedLayerIds.value = ['layer-bg']
    layerSelectionAnchorId.value = 'layer-bg'
    zoom.value = 100
    await materializeRasterLayer(baseLayer, document.width, document.height, document.background)
    await refreshLayerPreview(baseLayer, true, false, true)
    projectPath.value = ''
    savedHistoryRevision.value = null
    showNewDocumentDialog.value = false
    hasOpenDocument.value = true
    appScreen.value = 'editor'
    statusText.value = `${document.name} — ${document.width} × ${document.height} px`
  } catch (error) {
    showError(error, 'Não foi possível criar o documento.')
  } finally {
    isBusy.value = false
    if (activeTool.value === 'brush' || activeTool.value === 'eraser' || activeTool.value === 'gradient' || activeTool.value === 'paint-bucket') {
      void ensureRasterLayerPaintable()
    }
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

function workingPreviewSize(
  asset: Pick<ImageAsset, 'width' | 'height'>,
  transform: LayerTransform,
  active = true
) {
  const visibleImages = layers.value.reduce(
    (count, layer) => count + Number(layer.visible && Boolean(layer.image)),
    0
  )
  const layerCount = Math.max(1, visibleImages, previewLayerCountHint)
  const sharedPixels = Math.max(
    MIN_LAYER_PREVIEW_PIXELS,
    Math.min(ACTIVE_PREVIEW_PIXELS, Math.floor(DOCUMENT_PREVIEW_PIXELS / layerCount))
  )
  return editorPreviewSize(
    asset,
    transform.width,
    transform.height,
    zoom.value / 100,
    typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    active ? ACTIVE_PREVIEW_PIXELS : sharedPixels
  )
}

async function refreshLayerPreview(
  layer: LayerItem,
  force = false,
  allowDetached = false,
  prioritize = layer.id === activeLayerId.value
) {
  const asset = layer.image
  const transform = layer.transform
  if (!asset || !transform) return
  const target = workingPreviewSize(asset, transform, prioritize)
  if (!force && !imagePreviewNeedsUpdate(asset, target.width, target.height)) return

  const generation = (previewGenerations.get(layer.id) ?? 0) + 1
  previewGenerations.set(layer.id, generation)
  previewControllers.get(layer.id)?.abort()
  const controller = new AbortController()
  previewControllers.set(layer.id, controller)

  let generatedPreview: Awaited<ReturnType<typeof createImagePreview>>
  let adopted = false
  try {
    generatedPreview = await createImagePreview(asset, target.width, target.height, controller.signal)
    await prepareImageSource(generatedPreview?.url ?? asset.sourceUrl, controller.signal)
    if (previewGenerations.get(layer.id) !== generation || (!allowDetached && !layers.value.includes(layer))) {
      releasePreparedImage(generatedPreview?.url ?? asset.sourceUrl)
      if (generatedPreview?.url.startsWith('blob:')) URL.revokeObjectURL(generatedPreview.url)
      return
    }

    const previousPreview = asset.previewUrl
    asset.previewUrl = generatedPreview?.url
    asset.previewWidth = generatedPreview?.width ?? asset.width
    asset.previewHeight = generatedPreview?.height ?? asset.height
    adopted = true
    if (asset.previewUrl?.startsWith('blob:')) trackedObjectUrls.add(asset.previewUrl)
    if (!allowDetached && previousPreview !== asset.previewUrl) collectUnusedObjectUrls()
  } catch {
    releasePreparedImage(generatedPreview?.url ?? asset.sourceUrl)
    if (!adopted && generatedPreview?.url.startsWith('blob:')) URL.revokeObjectURL(generatedPreview.url)
    // The original remains a safe fallback when preview generation is unavailable.
  } finally {
    if (previewControllers.get(layer.id) === controller) previewControllers.delete(layer.id)
  }
}

async function refreshSmartLayerSource(layer: LayerItem, allowDetached = false) {
  const content = layer.smart
  const transform = layer.transform
  if (layer.kind !== 'smart' || !content || !transform) return
  const result = await renderSmartLayer({
    consumerId: `smart:${layer.id}`,
    content,
    quality: 'final'
  })
  const sourceUrl = URL.createObjectURL(result.blob)
  trackedObjectUrls.add(sourceUrl)
  let previewUrl: string | undefined
  try {
    const asset: ImageAsset = {
      width: result.width,
      height: result.height,
      mimeType: 'image/png',
      sourceUrl,
      byteSize: result.blob.size,
      editToken: result.cacheKey
    }
    const target = workingPreviewSize(asset, transform, layer.id === activeLayerId.value)
    const preview = await createImagePreview(asset, target.width, target.height)
    previewUrl = preview?.url.startsWith('blob:') ? preview.url : undefined
    if (previewUrl) trackedObjectUrls.add(previewUrl)
    await Promise.all([preloadImage(sourceUrl), preview ? preloadImage(preview.url) : Promise.resolve()])
    if (!allowDetached && !layers.value.includes(layer)) throw new Error('A camada inteligente não está mais disponível.')

    for (const source of [layer.image?.sourceUrl, layer.image?.previewUrl]) {
      if (source?.startsWith('blob:')) transientObjectUrls.add(source)
    }
    layer.image = {
      ...asset,
      previewUrl: preview?.url,
      previewWidth: preview?.width ?? asset.width,
      previewHeight: preview?.height ?? asset.height
    }
    transientObjectUrls.clear()
    if (!allowDetached) collectUnusedObjectUrls()
  } catch (error) {
    URL.revokeObjectURL(sourceUrl)
    trackedObjectUrls.delete(sourceUrl)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      trackedObjectUrls.delete(previewUrl)
    }
    throw error
  }
}

function editorScopeObjectUrls() {
  const sources = new Set<string>()
  for (const layer of layers.value) {
    for (const source of layerObjectUrls(layer)) sources.add(source)
  }
  for (const entry of history.entries()) {
    for (const source of historyDeltaObjectUrls(entry.delta)) sources.add(source)
  }
  return sources
}

function resetEditorScopeRuntime() {
  if (previewRefreshTimer) {
    clearTimeout(previewRefreshTimer)
    previewRefreshTimer = undefined
  }
  for (const controller of previewControllers.values()) controller.abort()
  previewControllers.clear()
  previewGenerations.clear()
  clearFloatingSelectionSession()
  selection.value = null
  selectionGeneration++
  layerStyleDialog.value = undefined
}

function restoreSmartLayerParent(session: SmartLayerEditSession) {
  resetEditorScopeRuntime()
  smartLayerEditSessions.value = smartLayerEditSessions.value.slice(0, -1)
  history.restore(session.parentHistory)
  activeDocument.value = session.parentDocument
  layers.value = session.parentLayers
  guides.value = session.parentGuides
  guidesVisible.value = session.parentGuidesVisible
  guidesLocked.value = session.parentGuidesLocked
  guideSnappingEnabled.value = session.parentGuideSnappingEnabled
  smartGuidesEnabled.value = session.parentSmartGuidesEnabled
  rulerOrigin.value = session.parentRulerOrigin
  rulerUnit.value = session.parentRulerUnit
  rulersVisible.value = session.parentRulersVisible
  zoom.value = session.parentZoom
  activeTool.value = session.parentActiveTool
  activeLayerId.value = session.parentActiveLayerId
  selectedLayerIds.value = session.parentSelectedLayerIds
  layerSelectionAnchorId.value = session.parentLayerSelectionAnchorId
  selection.value = cloneSelection(session.parentSelection)
  selectionGeneration++
  trackLayerAssets(session.parentLayers)
}

async function settleRestoredSmartLayerParent(session: SmartLayerEditSession) {
  await nextTick()
  await nextTick()
  await nextTick()
  setZoom(session.parentZoom)
}

function releaseSmartLayerEditSession(session: SmartLayerEditSession) {
  session.retainedObjectUrls.clear()
  collectUnusedObjectUrls()
}

async function editSmartLayerContent(layerId = activeLayerId.value) {
  if (isBusy.value || modalOpen.value) return
  const layer = layers.value.find((item) => item.id === layerId)
  if (layer?.kind !== 'smart' || !layer.smart || !layer.smart.layers.length) {
    showError(new Error('A camada não possui conteúdo inteligente editável.'), 'Não foi possível editar a camada inteligente.')
    return
  }

  canvasViewport.value?.commitPendingTransform()
  if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição atual…'
  if (!await rasterMutationBarrier.wait()) return

  const editDocument = createSmartLayerEditDocument(layer)
  const editLayers = layer.smart.layers.map(cloneLayerState)
  const session: SmartLayerEditSession = {
    targetLayerId: layer.id,
    targetLayerName: layer.name,
    parentActiveLayerId: activeLayerId.value,
    parentActiveTool: activeTool.value,
    parentDocument: activeDocument.value,
    parentDirty: documentDirty.value,
    parentGuideSnappingEnabled: guideSnappingEnabled.value,
    parentSmartGuidesEnabled: smartGuidesEnabled.value,
    parentGuides: guides.value,
    parentGuidesLocked: guidesLocked.value,
    parentGuidesVisible: guidesVisible.value,
    parentHistory: history.snapshot(),
    parentLayerSelectionAnchorId: layerSelectionAnchorId.value,
    parentLayers: layers.value,
    parentRulerOrigin: rulerOrigin.value,
    parentRulerUnit: rulerUnit.value,
    parentRulersVisible: rulersVisible.value,
    parentSelectedLayerIds: selectedLayerIds.value,
    parentSelection: cloneSelection(selection.value),
    parentZoom: zoom.value,
    retainedObjectUrls: editorScopeObjectUrls()
  }

  isBusy.value = true
  errorText.value = ''
  statusText.value = `Abrindo conteúdo de ${layer.name}…`
  try {
    resetEditorScopeRuntime()
    smartLayerEditSessions.value = [...smartLayerEditSessions.value, session]
    activeDocument.value = editDocument
    layers.value = editLayers
    guides.value = []
    guidesVisible.value = true
    guidesLocked.value = false
    guideSnappingEnabled.value = true
    smartGuidesEnabled.value = true
    rulerOrigin.value = { x: 0, y: 0 }
    rulerUnit.value = 'px'
    history.clear('Conteúdo inteligente aberto')
    activeTool.value = 'move'
    activeLayerId.value = editLayers[0]!.id
    selectedLayerIds.value = [editLayers[0]!.id]
    layerSelectionAnchorId.value = editLayers[0]!.id
    trackLayerAssets(editLayers)

    for (const nested of editLayers) {
      if (nested.kind === 'smart' && nested.smart && !nested.image) await refreshSmartLayerSource(nested)
    }
    await nextTick()
    canvasViewport.value?.fitDocument()
    statusText.value = `Editando conteúdo inteligente: ${layer.name}`
  } catch (error) {
    restoreSmartLayerParent(session)
    releaseSmartLayerEditSession(session)
    await settleRestoredSmartLayerParent(session)
    showError(error, 'Não foi possível editar a camada inteligente.')
  } finally {
    isBusy.value = false
  }
}

async function cancelSmartLayerEdit() {
  const session = activeSmartLayerEditSession.value
  if (!session || isBusy.value) return false
  canvasViewport.value?.commitPendingTransform()
  if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição antes de cancelar…'
  if (!await rasterMutationBarrier.wait()) return false
  restoreSmartLayerParent(session)
  releaseSmartLayerEditSession(session)
  await settleRestoredSmartLayerParent(session)
  statusText.value = `Edição de ${session.targetLayerName} cancelada`
  errorText.value = ''
  return true
}

async function finishSmartLayerEdit() {
  const session = activeSmartLayerEditSession.value
  if (!session || isBusy.value) return false
  const target = session.parentLayers.find((layer) => layer.id === session.targetLayerId)
  if (target?.kind !== 'smart' || !target.smart) {
    showError(new Error('A camada inteligente original não está mais disponível.'), 'Não foi possível concluir a edição.')
    return false
  }

  canvasViewport.value?.commitPendingTransform()
  if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição do conteúdo…'
  if (!await rasterMutationBarrier.wait()) return false

  const beforeContent = target.smart
  const afterContent = createEditedSmartLayerContent(beforeContent, activeDocument.value, layers.value)
  const changed = smartLayerEditHasChanges(beforeContent, afterContent)
  const previousImage = target.image ? { ...target.image } : undefined
  let restored = false
  isBusy.value = true
  errorText.value = ''
  statusText.value = changed ? 'Atualizando camada inteligente…' : 'Fechando conteúdo inteligente…'
  try {
    if (changed) {
      invalidateSmartLayerContent(afterContent.id)
      await renderSmartLayer({
        consumerId: `smart-edit:${afterContent.id}`,
        content: afterContent,
        quality: 'final'
      })
    }

    restoreSmartLayerParent(session)
    restored = true
    if (!changed) {
      releaseSmartLayerEditSession(session)
      await settleRestoredSmartLayerParent(session)
      statusText.value = `Conteúdo de ${session.targetLayerName} fechado sem alterações`
      return true
    }

    const before = cloneLayerPatch({ smart: beforeContent })
    target.smart = afterContent
    target.image = undefined
    try {
      await refreshSmartLayerSource(target)
    } catch (error) {
      target.smart = beforeContent
      target.image = previousImage
      throw error
    }
    const after = cloneLayerPatch({ smart: afterContent })
    recordHistory('Editar conteúdo inteligente', {
      type: 'layer:patch',
      layerId: target.id,
      before,
      after
    })
    releaseSmartLayerEditSession(session)
    await settleRestoredSmartLayerParent(session)
    statusText.value = `Conteúdo de ${session.targetLayerName} atualizado`
    return true
  } catch (error) {
    if (restored) {
      releaseSmartLayerEditSession(session)
      await settleRestoredSmartLayerParent(session)
    }
    showError(error, 'Não foi possível concluir a edição da camada inteligente.')
    return false
  } finally {
    isBusy.value = false
  }
}

async function addImportedImages(images: ImportedImage[], errors: string[] = []) {
  if (images.length) {
    const imageLayers: LayerItem[] = images.map((image) => ({
      id: image.id || crypto.randomUUID(),
      name: image.name,
      visible: true,
      opacity: 100,
      blendMode: 'normal',
      kind: 'image',
      styles: createLayerStyleConfig(),
      image: {
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
        sourceUrl: image.sourceUrl,
        byteSize: image.byteSize,
        resolutionDpiX: image.resolutionDpiX,
        resolutionDpiY: image.resolutionDpiY,
        resolutionSource: image.resolutionSource
      },
      transform: imageTransform(image)
    }))
    const importedIds = new Set(imageLayers.map((layer) => layer.id))
    const activeBefore = activeLayerId.value
    const toolBefore = activeTool.value
    const selectionBefore = selection.value
    let inserted = false
    trackLayerAssets(imageLayers)
    previewLayerCountHint = imageLayers.length + layers.value.filter((layer) => layer.visible && layer.image).length
    try {
      for (const [index, layer] of imageLayers.entries()) {
        statusText.value =
          imageLayers.length === 1
            ? 'Otimizando imagem para edição…'
            : `Otimizando imagem ${index + 1} de ${imageLayers.length}…`
        await refreshLayerPreview(layer, true, true, index === 0)
      }

      layers.value = [...imageLayers, ...layers.value]
      inserted = true
      previewLayerCountHint = 0
      activeLayerId.value = imageLayers[0]!.id
      activeTool.value = 'move'
      selection.value = null
      selectionGeneration++
      statusText.value = images.length === 1 ? 'Sincronizando preview…' : 'Sincronizando previews…'
      await nextTick()
      await canvasViewport.value?.waitForLayerImages(imageLayers.map((layer) => ({
        layerId: layer.id,
        source: layer.image?.previewUrl ?? layer.image!.sourceUrl
      })))
      recordHistory(images.length === 1 ? 'Importar imagem' : 'Importar imagens', {
        type: 'layers:add',
        items: imageLayers.map((layer, index) => ({ index, layer: cloneLayerHistoryState(layer) })),
        activeBefore,
        activeAfter: activeLayerId.value
      })
      statusText.value = images.length === 1 ? 'Imagem importada' : `${images.length} imagens importadas`
    } catch (error) {
      previewLayerCountHint = 0
      for (const layer of imageLayers) previewControllers.get(layer.id)?.abort()
      if (inserted) {
        layers.value = layers.value.filter((layer) => !importedIds.has(layer.id))
        activeLayerId.value = activeBefore
        activeTool.value = toolBefore
        selection.value = selectionBefore
        selectionGeneration++
        await nextTick()
      }
      for (const layer of imageLayers) {
        for (const source of [layer.image?.previewUrl, layer.image?.sourceUrl]) {
          if (source) releasePreparedImage(source)
        }
      }
      collectUnusedObjectUrls()
      throw error
    }
  }

  errorText.value = errors.join('\n')
}

async function addDroppedImages(images: ImportedImage[], errors: string[]) {
  if (isBusy.value) return
  isBusy.value = true
  statusText.value = 'Importando imagens…'
  try {
    await addImportedImages(images, errors)
  } finally {
    isBusy.value = false
  }
}

async function selectWithMagicWand(point: SelectionPoint, combineMode: SelectionCombineMode) {
  if (isBusy.value) return
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if (!layer.visible) {
    showError(new Error('Torne a camada ativa visível antes de usar a Varinha Mágica.'), 'Seleção indisponível.')
    return
  }
  if ((layer.kind !== 'image' && layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) {
    showError(new Error('A varinha mágica precisa de uma camada de imagem ativa.'), 'Seleção indisponível.')
    return
  }

  const generation = ++selectionGeneration
  const controller = new AbortController()
  pendingMagicWandSelection = controller
  const parentSelection = cloneSelection(selection.value)
  const document = { width: activeDocument.value.width, height: activeDocument.value.height }
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
      magicWandContiguous.value,
      controller.signal
    )
    if (generation !== selectionGeneration) return
    const combined = await combineSelectionsAsync(
      parentSelection,
      result,
      combineMode,
      document,
      controller.signal,
      true
    )
    if (generation !== selectionGeneration) return
    selection.value = combined && !selectionIsEmpty(combined) ? combined : null
    statusText.value = selection.value
      ? `${result.pixelCount.toLocaleString('pt-BR')} pixels encontrados · seleção atualizada`
      : 'A combinação resultou em uma seleção vazia'
  } catch (error) {
    if (
      generation === selectionGeneration &&
      !(error instanceof DOMException && error.name === 'AbortError')
    ) showError(error, 'Não foi possível criar a seleção.')
  } finally {
    if (pendingMagicWandSelection === controller) pendingMagicWandSelection = undefined
    pendingSelectionTasks--
    if (pendingSelectionTasks === 0) isBusy.value = false
  }
}

function setSelectionMode(mode: SelectionMode) {
  cancelMagicWandSelection()
  selectionGeneration++
  selectionMode.value = mode
  if (isMarqueeSelectionMode(mode)) lastMarqueeMode.value = mode
}

function updateSelection(value: SelectionRegion | null) {
  cancelMagicWandSelection()
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
  if ((layer.kind !== 'image' && layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) {
    showError(new Error('Selecione uma camada de imagem para apagar pixels.'), 'Não foi possível apagar a seleção.')
    return
  }

  if (!await settleRasterMutation('Finalizando edição antes de apagar…')) return
  if (!layers.value.includes(layer) || !layer.image || !layer.transform) return
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
    const previewTarget = workingPreviewSize(newAsset, newTransform)
    const preview = await createImagePreview(newAsset, previewTarget.width, previewTarget.height)
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
  if ((layer.kind !== 'image' && layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) {
    showError(new Error('Selecione uma camada de imagem para mover pixels.'), 'Não foi possível mover a seleção.')
    return
  }

  if (!await settleRasterMutation('Finalizando edição antes de mover a seleção…')) return
  if (!layers.value.includes(layer) || !layer.image || !layer.transform) return
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

async function performBrushStroke(
  points: SelectionPoint[],
  size: number,
  color: string,
  operation: BrushOperation,
  strokeSelection: SelectionRegion | null,
  livePreviewWidth: number,
  livePreviewHeight: number,
  signal: AbortSignal
) {
  if (isBusy.value) return false
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if ((layer.kind !== 'image' && layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform || points.length === 0) return false

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
  const isEraser = operation === 'erase'
  statusText.value = isEraser ? 'Apagando…' : 'Pintando…'
  try {
    const previewTarget = isEraser
      ? {
          width: Math.max(1, Math.min(beforeImage.width, Math.round(livePreviewWidth))),
          height: Math.max(1, Math.min(beforeImage.height, Math.round(livePreviewHeight)))
        }
      : workingPreviewSize(beforeImage, beforeTransform)
    const result = await applyBrushStroke(
      layer.id,
      beforeImage,
      beforeTransform,
      strokePoints,
      size,
      color,
      operation,
      strokeSelection,
      previewTarget.width,
      previewTarget.height,
      activeDocument.value.width,
      activeDocument.value.height,
      signal
    )
    signal.throwIfAborted()
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
    await preloadImage(newAsset.previewUrl ?? newAsset.sourceUrl, signal)
    signal.throwIfAborted()

    let newTransform = beforeTransform
    if (
      result.originX !== 0 ||
      result.originY !== 0 ||
      result.width !== beforeImage.width ||
      result.height !== beforeImage.height
    ) {
      const oldMatrix = layerSourceToDocumentMatrix(beforeTransform, beforeImage.width, beforeImage.height)
      const center = transformSelectionPoint(oldMatrix, {
        x: result.originX + result.width / 2,
        y: result.originY + result.height / 2
      })
      const width = result.width * (beforeTransform.width / beforeImage.width)
      const height = result.height * (beforeTransform.height / beforeImage.height)
      newTransform = {
        ...beforeTransform,
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height
      }
    }
    layer.image = newAsset
    layer.transform = newTransform

    recordHistory(isEraser ? 'Borracha' : 'Pincelada', {
      type: 'layer:patch',
      layerId: layer.id,
      before: { image: beforeImage, transform: beforeTransform },
      after: { image: { ...layer.image }, transform: { ...layer.transform } }
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = isEraser ? 'Borracha aplicada' : 'Pincelada aplicada'
    return true
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
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      showError(error, isEraser ? 'Não foi possível aplicar a borracha.' : 'Não foi possível aplicar a pincelada.')
    }
    return false
  } finally {
    isBusy.value = false
  }
}

function commitBrushStroke(
  points: SelectionPoint[],
  size: number,
  color: string,
  operation: BrushOperation,
  strokeSelection: SelectionRegion | null,
  livePreviewWidth: number,
  livePreviewHeight: number
) {
  if (rasterMutationBarrier.isPending) return
  const controller = new AbortController()
  const label = operation === 'erase' ? 'Borracha' : 'Pincelada'
  pendingBrushCommit = { controller, label }
  const commit = rasterMutationBarrier.track(performBrushStroke(
    points,
    size,
    color,
    operation,
    strokeSelection,
    livePreviewWidth,
    livePreviewHeight,
    controller.signal
  ))
  void commit.finally(() => {
    if (pendingBrushCommit?.controller === controller) pendingBrushCommit = undefined
  }).catch(() => undefined)
}

async function performGradient(
  geometry: GradientGeometry,
  config: GradientStopsConfig,
  gradientSelection: SelectionRegion | null,
  signal: AbortSignal
) {
  if (isBusy.value) return false
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if (
    (layer.kind !== 'image' && layer.kind !== 'background' && layer.kind !== 'pixel') ||
    !layer.image ||
    !layer.transform
  ) return false

  const documentId = activeDocument.value.id
  const beforeImage = { ...layer.image }
  const beforeTransform = { ...layer.transform }
  for (const source of [beforeImage.sourceUrl, beforeImage.previewUrl]) {
    if (source?.startsWith('blob:')) transientObjectUrls.add(source)
  }
  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Aplicando degradê…'
  try {
    const previewTarget = workingPreviewSize(beforeImage, beforeTransform)
    const result = await applyGradient(
      beforeImage,
      beforeTransform,
      geometry,
      config,
      gradientSelection,
      previewTarget.width,
      previewTarget.height,
      activeDocument.value.width,
      activeDocument.value.height,
      signal
    )
    signal.throwIfAborted()
    createdSource = URL.createObjectURL(result.blob)
    trackedObjectUrls.add(createdSource)
    createdPreviewUrl = result.previewBlob ? URL.createObjectURL(result.previewBlob) : undefined
    if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)

    const newAsset: ImageAsset = {
      width: result.width,
      height: result.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: result.blob.size,
      previewUrl: createdPreviewUrl,
      previewWidth: result.previewWidth,
      previewHeight: result.previewHeight
    }
    await preloadImage(newAsset.previewUrl ?? newAsset.sourceUrl, signal)
    signal.throwIfAborted()
    if (activeDocument.value.id !== documentId || !layers.value.includes(layer)) {
      throw new Error('A camada original não está mais disponível.')
    }

    const newTransform = gradientResultTransform(beforeTransform, beforeImage.width, beforeImage.height, result)
    layer.image = newAsset
    layer.transform = newTransform
    recordHistory('Degradê', {
      type: 'layer:patch',
      layerId: layer.id,
      before: { image: beforeImage, transform: beforeTransform },
      after: { image: { ...newAsset }, transform: { ...newTransform } }
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = 'Degradê aplicado'
    return true
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
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      showError(error, 'Não foi possível aplicar o degradê.')
    }
    return false
  } finally {
    isBusy.value = false
  }
}

function commitGradient(
  geometry: GradientGeometry,
  config: GradientStopsConfig,
  gradientSelection: SelectionRegion | null
) {
  if (rasterMutationBarrier.isPending) return
  const controller = new AbortController()
  pendingGradientCommit = controller
  const commit = rasterMutationBarrier.track(performGradient(
    geometry,
    config,
    cloneSelection(gradientSelection),
    controller.signal
  ))
  void commit.finally(() => {
    if (pendingGradientCommit === controller) pendingGradientCommit = undefined
  }).catch(() => undefined)
}

async function performPaintBucket(point: SelectionPoint | null, color: string, bucketSelection: SelectionRegion | null, signal: AbortSignal) {
  if (isBusy.value) return false
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if (!layer.visible || (layer.kind !== 'image' && layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) return false
  const documentId = activeDocument.value.id
  const beforeImage = { ...layer.image }
  const beforeTransform = { ...layer.transform }
  for (const source of [beforeImage.sourceUrl, beforeImage.previewUrl]) {
    if (source?.startsWith('blob:')) transientObjectUrls.add(source)
  }
  let createdSource: string | undefined
  let createdPreviewUrl: string | undefined
  isBusy.value = true
  errorText.value = ''
  const solidFill = point === null
  statusText.value = solidFill ? 'Preenchendo seleção…' : 'Preenchendo área…'
  try {
    const previewTarget = workingPreviewSize(beforeImage, beforeTransform)
    const result = solidFill
      ? await applySolidFill(
          beforeImage, beforeTransform, color, bucketSelection,
          previewTarget.width, previewTarget.height, signal
        )
      : await applyPaintBucket(
          beforeImage, beforeTransform, point, color, paintBucketTolerance.value, paintBucketContiguous.value,
          bucketSelection, previewTarget.width, previewTarget.height, signal
        )
    signal.throwIfAborted()
    if (result.changedPixelCount === 0) {
      transientObjectUrls.clear()
      statusText.value = solidFill ? 'A seleção já possui essa cor' : 'A área já possui essa cor'
      return false
    }
    if (!result.blob) throw new Error('O preenchimento não retornou a imagem processada.')
    createdSource = URL.createObjectURL(result.blob)
    trackedObjectUrls.add(createdSource)
    createdPreviewUrl = result.previewBlob ? URL.createObjectURL(result.previewBlob) : undefined
    if (createdPreviewUrl) trackedObjectUrls.add(createdPreviewUrl)
    const newAsset: ImageAsset = {
      width: beforeImage.width,
      height: beforeImage.height,
      mimeType: 'image/png',
      sourceUrl: createdSource,
      byteSize: result.blob.size,
      previewUrl: createdPreviewUrl,
      previewWidth: result.previewWidth,
      previewHeight: result.previewHeight
    }
    await preloadImage(newAsset.previewUrl ?? newAsset.sourceUrl, signal)
    signal.throwIfAborted()
    if (activeDocument.value.id !== documentId || !layers.value.includes(layer)) throw new Error('A camada original não está mais disponível.')
    layer.image = newAsset
    layer.transform = beforeTransform
    recordHistory(solidFill ? 'Preencher com cor' : 'Balde de Tinta', {
      type: 'layer:patch', layerId: layer.id,
      before: { image: beforeImage, transform: beforeTransform },
      after: { image: { ...newAsset }, transform: { ...beforeTransform } }
    })
    transientObjectUrls.clear()
    collectUnusedObjectUrls()
    statusText.value = `${result.changedPixelCount.toLocaleString('pt-BR')} pixels preenchidos`
    return true
  } catch (error) {
    layer.image = beforeImage
    layer.transform = beforeTransform
    if (createdSource) { URL.revokeObjectURL(createdSource); trackedObjectUrls.delete(createdSource) }
    if (createdPreviewUrl) { URL.revokeObjectURL(createdPreviewUrl); trackedObjectUrls.delete(createdPreviewUrl) }
    transientObjectUrls.clear()
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      showError(error, solidFill ? 'Não foi possível preencher com a cor.' : 'Não foi possível aplicar o Balde de Tinta.')
    }
    return false
  } finally {
    isBusy.value = false
  }
}

function commitPaintBucket(point: SelectionPoint, color: string, bucketSelection: SelectionRegion | null) {
  if (rasterMutationBarrier.isPending) return
  const controller = new AbortController()
  pendingPaintBucketCommit = controller
  const commit = rasterMutationBarrier.track(performPaintBucket(point, color, cloneSelection(bucketSelection), controller.signal))
  void commit.finally(() => {
    if (pendingPaintBucketCommit === controller) pendingPaintBucketCommit = undefined
  }).catch(() => undefined)
}

function commitSolidFill(color: string) {
  if (rasterMutationBarrier.isPending) return
  const controller = new AbortController()
  pendingPaintBucketCommit = controller
  const commit = rasterMutationBarrier.track(performPaintBucket(null, color, cloneSelection(selection.value), controller.signal))
  void commit.finally(() => {
    if (pendingPaintBucketCommit === controller) pendingPaintBucketCommit = undefined
  }).catch(() => undefined)
}

function preloadImage(url: string, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image()
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    const complete = () => {
      cleanup()
      resolve()
    }
    const cancel = () => {
      image.src = ''
      cleanup()
      reject(new DOMException('Carregamento cancelado.', 'AbortError'))
    }
    image.onload = complete
    image.onerror = complete
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) {
      cancel()
      return
    }
    image.src = url
  })
}

function confirmDiscardChanges() {
  if (!documentDirty.value) return Promise.resolve(true)
  if (discardChangesResolver) return Promise.resolve(false)
  showUnsavedChangesDialog.value = true
  return new Promise<boolean>((resolve) => {
    discardChangesResolver = resolve
  })
}

function resolveDiscardChanges(confirmed: boolean) {
  showUnsavedChangesDialog.value = false
  const resolve = discardChangesResolver
  discardChangesResolver = undefined
  resolve?.(confirmed)
}

async function saveBeforeDiscarding() {
  const saved = await saveProject()
  resolveDiscardChanges(saved)
}

async function refreshRecentProjects(showLoading = true) {
  const request = recentRefreshGate.begin()
  if (showLoading) recentProjectsLoading.value = true
  try {
    const projects = await listRecentProjects()
    if (request.isCurrent()) recentProjects.value = projects
  } catch (error) {
    if (request.isCurrent()) {
      showError(error, 'Não foi possível carregar os projetos recentes.')
    }
  } finally {
    if (request.isCurrent()) recentProjectsLoading.value = false
  }
}

function queueProjectThumbnail(path: string, document: DocumentSpec, projectLayers: LayerItem[]) {
  if (!path || !hasDesktopBackend()) return
  void thumbnailQueue.enqueue(path, async (isLatest) => {
    try {
      const thumbnail = await renderDocumentThumbnail(document, projectLayers)
      if (!thumbnail || !isLatest()) return
      await uploadRecentThumbnail(path, thumbnail)
      if (!isLatest()) return
      await refreshRecentProjects(false)
    } catch {
      // O cache visual nunca pode transformar um salvamento válido em erro.
    }
  })
}

async function registerRecentProject(
  path: string,
  document: DocumentSpec,
  projectLayers: LayerItem[],
  createThumbnail = true
) {
  if (!path || !hasDesktopBackend()) return
  await recordRecentProject(path, document.name, document.width, document.height)
  void refreshRecentProjects(false)
  if (createThumbnail) queueProjectThumbnail(path, document, projectLayers)
}

function showProjectHome() {
  if (isBusy.value) return
  if (activeSmartLayerEditSession.value) {
    statusText.value = 'Conclua ou cancele a edição da camada inteligente antes de sair.'
    return
  }
  appScreen.value = 'home'
  void refreshRecentProjects()
}

function returnToEditor() {
  if (!hasOpenDocument.value || isBusy.value) return
  appScreen.value = 'editor'
}

async function removeProjectFromRecents(path: string) {
  if (isBusy.value) return
  try {
    await removeRecentProject(path)
    await refreshRecentProjects(false)
  } catch (error) {
    showError(error, 'Não foi possível remover o projeto dos recentes.')
  }
}

async function clearProjectRecents() {
  if (isBusy.value || !recentProjects.value.length) return
  if (!window.confirm('Limpar a lista de projetos recentes? Nenhum arquivo será apagado.')) return
  try {
    await clearRecentProjects()
    recentRefreshGate.invalidate()
    recentProjects.value = []
    recentProjectsLoading.value = false
  } catch (error) {
    showError(error, 'Não foi possível limpar os projetos recentes.')
  }
}

async function requestNewDocument() {
  if (activeSmartLayerEditSession.value) {
    statusText.value = 'Conclua ou cancele a edição da camada inteligente antes de criar outro documento.'
    return
  }
  if (isBusy.value || !await confirmDiscardChanges()) return
  showNewDocumentDialog.value = true
}

function projectNameFromPath(path: string, fallback: string) {
  const filename = path.split(/[\\/]/).at(-1)?.replace(/\.axia$/i, '').trim()
  return filename || fallback.replace(/\.axia$/i, '').trim() || 'Sem título'
}

async function saveProject(saveAs = false) {
  if (activeSmartLayerEditSession.value) return finishSmartLayerEdit()
  if (isBusy.value || !hasOpenDocument.value) return false
  canvasViewport.value?.commitPendingTransform()
  if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição antes de salvar…'
  if (!await rasterMutationBarrier.wait()) return false
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Preparando projeto Axia…'
  try {
    const target = await prepareAxiaProjectSave(activeDocument.value.name, projectPath.value, saveAs)
    if (!target.token || !target.path) {
      statusText.value = 'Salvamento cancelado'
      return false
    }
    const projectName = projectNameFromPath(target.path, activeDocument.value.name)
    const documentSnapshot = { ...activeDocument.value, name: projectName }
    const layerSnapshot = layers.value.map(cloneLayerState)
    const { manifest, assetSources } = createAxiaProjectManifest({
      document: documentSnapshot,
      layers: layerSnapshot,
      guides: guides.value,
      view: {
        activeLayerId: activeLayerId.value,
        guideSnappingEnabled: guideSnappingEnabled.value,
        smartGuidesEnabled: smartGuidesEnabled.value,
        guidesLocked: guidesLocked.value,
        guidesVisible: guidesVisible.value,
        rulerOrigin: rulerOrigin.value,
        rulerUnit: rulerUnit.value,
        zoom: zoom.value
      }
    })
    statusText.value = assetSources.length
      ? `Salvando projeto e ${assetSources.length} asset${assetSources.length === 1 ? '' : 's'}…`
      : 'Salvando projeto…'
    const saved = await uploadAxiaProject(target.token, manifest, assetSources)
    activeDocument.value = { ...activeDocument.value, name: projectName }
    projectPath.value = saved.path || target.path
    savedHistoryRevision.value = historyRevision.value
    statusText.value = `Projeto salvo: ${projectPath.value}`
    try {
      await registerRecentProject(projectPath.value, documentSnapshot, layerSnapshot)
    } catch {
      statusText.value = `Projeto salvo, mas o histórico recente não pôde ser atualizado: ${projectPath.value}`
    }
    return true
  } catch (error) {
    showError(error, 'Não foi possível salvar o projeto Axia.')
    return false
  } finally {
    isBusy.value = false
  }
}

async function openProject(recentPath = '') {
  if (activeSmartLayerEditSession.value) {
    statusText.value = 'Conclua ou cancele a edição da camada inteligente antes de abrir outro projeto.'
    return
  }
  if (isBusy.value || !await confirmDiscardChanges()) return
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Abrindo projeto Axia…'
  previewLayerCountHint = 0
  let openedSessionID = ''
  try {
    const opened = recentPath ? await openRecentProject(recentPath) : await openAxiaProject()
    if (!opened.path) {
      statusText.value = 'Abertura cancelada'
      return
    }
    openedSessionID = opened.sessionId
    const assetUrls = Object.fromEntries(
      Object.entries(opened.assetUrls ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    const restored = restoreAxiaProject(opened.manifest, assetUrls)
    clearSmartLayerRenderCache()
    const smartLayers = restored.layers.filter((layer) => layer.kind === 'smart')
    for (const [index, layer] of smartLayers.entries()) {
      statusText.value = smartLayers.length === 1
        ? 'Renderizando camada inteligente…'
        : `Renderizando camada inteligente ${index + 1} de ${smartLayers.length}…`
      await refreshSmartLayerSource(layer, true)
    }
    const imageLayers = restored.layers.filter((layer) => layer.visible && layer.image && layer.transform)
    previewLayerCountHint = imageLayers.length
    zoom.value = restored.view.zoom
    await nextTick()
    if (previewRefreshTimer) {
      clearTimeout(previewRefreshTimer)
      previewRefreshTimer = undefined
    }
    for (const [index, layer] of imageLayers.entries()) {
      statusText.value = imageLayers.length === 1
        ? 'Otimizando imagem do projeto…'
        : `Otimizando imagem ${index + 1} de ${imageLayers.length}…`
      await refreshLayerPreview(layer, true, true, layer.id === restored.view.activeLayerId)
    }

    canvasViewport.value?.commitPendingTransform()
    if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição atual…'
    await rasterMutationBarrier.wait()
    const restoredObjectUrls = new Set(restored.layers.flatMap(layerObjectUrls))
    for (const source of restoredObjectUrls) trackedObjectUrls.delete(source)
    releaseAllEditorAssets(true)
    history.clear('Projeto aberto')
    previewGenerations.clear()
    selection.value = null
    selectionGeneration++
    activeDocument.value = restored.document
    guides.value = restored.guides
    guidesVisible.value = restored.view.guidesVisible
    guidesLocked.value = restored.view.guidesLocked
    guideSnappingEnabled.value = restored.view.guideSnappingEnabled
    smartGuidesEnabled.value = restored.view.smartGuidesEnabled
    rulerOrigin.value = restored.view.rulerOrigin
    rulerUnit.value = restored.view.rulerUnit
    layers.value = restored.layers
    trackLayerAssets(restored.layers)
    activeLayerId.value = restored.view.activeLayerId
    activeTool.value = 'move'
    projectPath.value = opened.path
    savedHistoryRevision.value = historyRevision.value
    hasOpenDocument.value = true
    appScreen.value = 'editor'
    previewLayerCountHint = 0
    statusText.value = 'Sincronizando projeto…'
    await nextTick()
    await canvasViewport.value?.waitForLayerImages(imageLayers.map((layer) => ({
      layerId: layer.id,
      source: layer.image?.previewUrl ?? layer.image!.sourceUrl
    })))
    await finalizeAxiaProjectOpen(openedSessionID, true)
    openedSessionID = ''
    statusText.value = `${activeDocument.value.name} — projeto aberto`
    try {
      await registerRecentProject(
        opened.path,
        { ...activeDocument.value },
        layers.value.map(cloneLayerState)
      )
    } catch {
      statusText.value = `${activeDocument.value.name} — aberto, mas não adicionado aos recentes`
    }
  } catch (error) {
    if (openedSessionID) await finalizeAxiaProjectOpen(openedSessionID, false).catch(() => undefined)
    collectUnusedObjectUrls()
    showError(error, 'Não foi possível abrir o projeto Axia.')
    if (recentPath) void refreshRecentProjects(false)
  } finally {
    previewLayerCountHint = 0
    isBusy.value = false
  }
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

let pdfImportController: AbortController | undefined

async function releasePDFSource() {
  const source = pdfImportSource.value
  pdfImportSource.value = null
  if (!source) return
  if (source.id) await releaseDesktopPDF(source.id).catch(() => undefined)
  else if (source.sourceUrl.startsWith('blob:')) URL.revokeObjectURL(source.sourceUrl)
}

async function importPDF() {
  if (isBusy.value || showImportPdfDialog.value) return
  errorText.value = ''
  if (!hasDesktopBackend()) {
    pdfFileInput.value?.click()
    return
  }
  isBusy.value = true
  statusText.value = 'Selecionando PDF…'
  try {
    const source = await selectDesktopPDF()
    if (!source) {
      statusText.value = 'Importação de PDF cancelada'
      return
    }
    await releasePDFSource()
    pdfImportSource.value = source
    showImportPdfDialog.value = true
    statusText.value = 'PDF pronto para importar'
  } catch (error) {
    showError(error, 'Não foi possível abrir o PDF.')
  } finally {
    isBusy.value = false
  }
}

async function handleNativeFileDrop(
  images: ImportedImage[],
  pdf: PDFImportSource | null,
  errors: string[]
) {
  if (isBusy.value || showImportPdfDialog.value) {
    if (pdf?.id) await releaseDesktopPDF(pdf.id).catch(() => undefined)
    return
  }
  errorText.value = ''
  try {
    if (images.length || errors.length) await addDroppedImages(images, errors)
    if (!pdf) return
    await releasePDFSource()
    pdfImportSource.value = pdf
    showImportPdfDialog.value = true
    statusText.value = 'PDF pronto para escolher a página'
  } catch (error) {
    if (pdf?.id) await releaseDesktopPDF(pdf.id).catch(() => undefined)
    showError(error, 'Não foi possível abrir os arquivos arrastados.')
  }
}

async function openLocalPDF(file: File) {
  if (file.size <= 0 || file.size > 512 * 1024 * 1024) {
    showError(new Error('O PDF deve ter no máximo 512 MB.'), 'Não foi possível abrir o PDF.')
    return
  }
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showError(new Error('Selecione um arquivo PDF.'), 'Não foi possível abrir o PDF.')
    return
  }
  await releasePDFSource()
  pdfImportSource.value = {
    id: '',
    name: file.name,
    sourceUrl: URL.createObjectURL(file),
    byteSize: file.size
  }
  showImportPdfDialog.value = true
  statusText.value = 'PDF pronto para importar'
}

async function readLocalPDF(input: HTMLInputElement) {
  const file = input.files?.[0]
  input.value = ''
  if (file) await openLocalPDF(file)
}

async function openDroppedPDF(file: File, errors: string[]) {
  if (isBusy.value || showImportPdfDialog.value) return
  await openLocalPDF(file)
  if (errors.length) errorText.value = errors.join('\n')
}

async function cancelPDFImport() {
  if (isBusy.value && pdfImportController) {
    pdfImportProgress.value = 'Cancelando importação…'
    pdfImportController.abort()
    return
  }
  if (isBusy.value) return
  showImportPdfDialog.value = false
  pdfImportProgress.value = ''
  await releasePDFSource()
  statusText.value = 'Importação de PDF cancelada'
}

async function performPDFImport(request: PDFRenderRequest) {
  if (isBusy.value) return
  isBusy.value = true
  errorText.value = ''
  pdfImportController = new AbortController()
  pdfImportProgress.value = 'Preparando a página…'
  statusText.value = 'Convertendo página do PDF…'
  try {
    const images = await renderPDFPages(request, pdfImportController.signal, (completed, count) => {
      pdfImportProgress.value = `Convertendo página ${completed} de ${count}…`
      statusText.value = pdfImportProgress.value
    })
    pdfImportProgress.value = 'Adicionando página ao documento…'
    await addImportedImages(images)
    showImportPdfDialog.value = false
    await releasePDFSource()
    statusText.value = 'Página do PDF importada'
  } catch (error) {
    showImportPdfDialog.value = false
    await releasePDFSource()
    if (error instanceof DOMException && error.name === 'AbortError') {
      statusText.value = 'Importação de PDF cancelada'
    } else {
      showError(error, 'Não foi possível importar a página do PDF.')
    }
  } finally {
    await closePDFImport(request.document).catch(() => undefined)
    pdfImportController = undefined
    pdfImportProgress.value = ''
    isBusy.value = false
  }
}

function exportDocument() {
  if (isBusy.value) return
  clearExportEstimate()
  showExportImageDialog.value = true
}

function exportSettingsKey(settings: ExportSettings) {
  return JSON.stringify(settings)
}

function clearExportEstimate() {
  exportEstimateGeneration += 1
  exportEstimateBusy.value = false
  exportEstimatedBytes.value = null
  preparedExport.value = null
}

async function createDocumentExportBlob(settings: ExportSettings) {
  if (!await settleRasterMutation('Finalizando edição antes de exportar…')) return null
  const documentId = activeDocument.value.id
  const exportLayers = layers.value.slice()
  for (const layer of exportLayers) {
    if (layer.visible && layer.kind === 'smart') await refreshSmartLayerSource(layer)
  }
  if (
    activeDocument.value.id !== documentId || layers.value.length !== exportLayers.length ||
    exportLayers.some((layer, index) => layers.value[index] !== layer)
  ) throw new Error('O documento foi alterado durante a exportação.')
  return renderDocumentExportBlob(activeDocument.value, exportLayers, settings)
}

async function estimateDocumentExport(settings: ExportSettings) {
  if (isBusy.value || exportEstimateBusy.value) return
  const generation = ++exportEstimateGeneration
  exportEstimateBusy.value = true
  errorText.value = ''
  try {
    const blob = await createDocumentExportBlob(settings)
    if (!blob || generation !== exportEstimateGeneration || !showExportImageDialog.value) return
    preparedExport.value = { key: exportSettingsKey(settings), blob }
    exportEstimatedBytes.value = blob.size
  } catch (error) {
    showError(error, 'Não foi possível calcular o tamanho do arquivo.')
  } finally {
    if (generation === exportEstimateGeneration) exportEstimateBusy.value = false
  }
}

async function performDocumentExport(settings: ExportSettings) {
  if (isBusy.value) return
  errorText.value = ''
  isBusy.value = true
  statusText.value = `Preparando ${settings.format.toUpperCase()}…`
  try {
    const key = exportSettingsKey(settings)
    const cached = preparedExport.value?.key === key ? preparedExport.value.blob : null
    const blob = cached ?? await createDocumentExportBlob(settings)
    if (!blob) return
    const cleanName = activeDocument.value.name.replace(/\.[^.]+$/, '').trim() || 'imagem'
    const path = await saveExportedImageBlob(cleanName, settings.format, blob)
    statusText.value = path
      ? `${settings.format.toUpperCase()} exportado (${(blob.size / (1024 * 1024)).toFixed(2)} MB): ${path}`
      : 'Exportação cancelada'
    showExportImageDialog.value = false
    clearExportEstimate()
  } catch (error) {
    showError(error, 'Não foi possível exportar o documento.')
  } finally {
    isBusy.value = false
  }
}

async function exportLayerPNG(layerId = activeLayerId.value) {
  if (isBusy.value) return
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer || !layerCanExportPNG(layer, activeDocument.value.background)) {
    showError(new Error('A camada não possui conteúdo visual exportável.'), 'Não foi possível exportar a camada.')
    return
  }

  isBusy.value = true
  errorText.value = ''
  statusText.value = `Preparando PNG de ${layer.name}…`
  try {
    if (!await settleRasterMutation('Finalizando edição antes de exportar…')) return
    const documentId = activeDocument.value.id
    if (layer.kind === 'smart') await refreshSmartLayerSource(layer)
    if (activeDocument.value.id !== documentId || !layers.value.includes(layer)) {
      throw new Error('A camada original não está mais disponível.')
    }
    const appearance = await renderLayerAppearance(activeDocument.value, layer, 'isolated-export')
    const filename = quickLayerExportName(activeDocument.value.name, layer.name)
    const pngBlob = await pngBlobWithResolution(appearance.blob, activeDocument.value.resolutionDpi)
    const path = await saveExportedImageBlob(filename, 'png', pngBlob)
    statusText.value = path ? `Camada exportada: ${path}` : 'Exportação cancelada'
  } catch (error) {
    showError(error, 'Não foi possível exportar a camada como PNG.')
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

function protectUnsavedDocument(event: BeforeUnloadEvent) {
  if (hasDesktopBackend() || !documentDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

function handleShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented) return

  const command = event.ctrlKey || event.metaKey
  if (modalOpen.value) {
    if (showUnsavedChangesDialog.value && event.key === 'Escape' && !isBusy.value) {
      event.preventDefault()
      resolveDiscardChanges(false)
    } else if (command) {
      event.preventDefault()
    }
    return
  }

  if (command && event.code === 'KeyN' && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    requestNewDocument()
    return
  }
  if (command && event.code === 'KeyO' && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    void openProject()
    return
  }
  if (appScreen.value === 'home') {
    if (event.key === 'Escape' && hasOpenDocument.value) {
      event.preventDefault()
      returnToEditor()
    }
    return
  }
  if (event.key === 'Escape' && activeSmartLayerEditSession.value) {
    event.preventDefault()
    void cancelSmartLayerEdit()
    return
  }
  if (command && event.code === 'KeyS' && !event.altKey) {
    event.preventDefault()
    void saveProject(event.shiftKey)
    return
  }
  if (command && event.code === 'KeyR' && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    rulersVisible.value = !rulersVisible.value
    statusText.value = rulersVisible.value ? 'Réguas visíveis' : 'Réguas ocultas'
    return
  }
  if (command && event.code === 'Semicolon' && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    guidesVisible.value = !guidesVisible.value
    statusText.value = guidesVisible.value ? 'Guias visíveis' : 'Guias ocultas'
    return
  }
  if (command && event.code === 'KeyZ') {
    event.preventDefault()
    if (event.shiftKey) void redoHistory()
    else void undoHistory()
    return
  }
  if (command && event.code === 'KeyY') {
    event.preventDefault()
    void redoHistory()
    return
  }

  const target = event.target as HTMLElement | null
  if (target?.closest('input, select, textarea, [contenteditable="true"]')) return

  if (event.code === 'Backspace' && !event.shiftKey) {
    if (event.altKey && !command) {
      event.preventDefault()
      commitSolidFill(brushColor.value)
      return
    }
    if (command && !event.altKey) {
      event.preventDefault()
      commitSolidFill(backgroundColor.value)
      return
    }
  }

  if ((event.key === 'Delete' || event.key === 'Backspace') && !selection.value) {
    event.preventDefault()
    deleteLayer(activeLayerId.value)
    return
  }

  if (command && event.code === 'KeyJ') {
    event.preventDefault()
    void duplicateSelectionOrLayer()
    return
  }

  if (command && event.code === 'KeyE' && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    void mergeSelectedLayers()
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return

  if (event.code === 'KeyM') {
    event.preventDefault()
    const current = isMarqueeSelectionMode(selectionMode.value)
      ? selectionMode.value
      : lastMarqueeMode.value
    setSelectionMode(event.shiftKey ? nextMarqueeSelectionMode(current) : current)
    activeTool.value = 'crop'
    return
  }

  if (event.code === 'KeyW') {
    event.preventDefault()
    const tool = event.shiftKey
      ? nextIntelligentSelectionTool(lastIntelligentSelectionTool.value)
      : availableIntelligentSelectionTool(lastIntelligentSelectionTool.value)
    lastIntelligentSelectionTool.value = tool
    activeTool.value = tool
    return
  }

  const toolsByKey: Record<string, EditorTool> = {
    v: 'move',
    b: 'brush',
    e: 'eraser',
    g: event.shiftKey ? 'paint-bucket' : 'gradient',
    i: 'eyedropper',
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

let unregisterNativeFileDrop: (() => void) | undefined

onMounted(async () => {
  window.addEventListener('wheel', blockBrowserWheelZoom, zoomEventOptions)
  window.addEventListener('keydown', handleShortcut)
  window.addEventListener('beforeunload', protectUnsavedDocument)
  unregisterNativeFileDrop = registerNativeFileDrop(handleNativeFileDrop)

  try {
    const [status] = await Promise.all([getEditorStatus(), refreshRecentProjects()])
    statusText.value = `${status.appName} — ${status.engine}`
  } catch (error) {
    showError(error, 'Editor iniciado com recursos locais.')
  }
})

onBeforeUnmount(() => {
  unregisterNativeFileDrop?.()
  pdfImportController?.abort()
  void releasePDFSource()
  if (previewRefreshTimer) clearTimeout(previewRefreshTimer)
  pendingBrushCommit?.controller.abort()
  pendingBrushCommit = undefined
  pendingGradientCommit?.abort()
  pendingGradientCommit = undefined
  pendingPaintBucketCommit?.abort()
  pendingPaintBucketCommit = undefined
  cancelMagicWandSelection()
  rasterMutationBarrier.discard()
  disposeSelectionEngine()
  disposeSelectionCombineEngine()
  disposeBrushEngine()
  disposeGradientEngine()
  disposePaintBucketEngine()
  disposeSelectionMoveEngine()
  disposeImagePreviewWorker()
  disposeLayerStyleCompositor()
  releaseAllEditorAssets()
  window.removeEventListener('wheel', blockBrowserWheelZoom, true)
  window.removeEventListener('keydown', handleShortcut)
  window.removeEventListener('beforeunload', protectUnsavedDocument)
})
</script>

<template>
  <main class="app-shell" :class="{ 'app-shell--busy': isBusy }" data-file-drop-target>
    <ProjectHome
      v-if="appScreen === 'home'"
      :inert="modalOpen || undefined"
      :busy="isBusy"
      :can-return-to-editor="hasOpenDocument"
      :loading="recentProjectsLoading"
      :projects="recentProjects"
      @clear="clearProjectRecents"
      @new-document="requestNewDocument"
      @open-project="openProject()"
      @open-recent="openProject"
      @remove-recent="removeProjectFromRecents"
      @return-to-editor="returnToEditor"
    />

    <TopMenu
      v-else-if="hasOpenDocument"
      :inert="modalOpen || undefined"
      :can-delete-layer="layers.length > 1"
      :can-convert-to-smart-layer="canConvertSelectedLayersToSmart"
      :can-duplicate-layer="Boolean(activeLayer.image || activeLayer.text)"
      :can-edit-smart-layer="activeLayer.kind === 'smart'"
      :can-fill-layer="activeLayer.visible && ['image', 'background', 'pixel'].includes(activeLayer.kind) && Boolean(activeLayer.image && activeLayer.transform)"
      :can-flatten-image="canFlattenImage"
      :can-merge-layers="selectedLayerIds.length > 1"
      :can-rasterize-layer="layerCanRasterize(activeLayer)"
      :can-redo="canRedo"
      :can-undo="canUndo"
      :document-dirty="documentDirty"
      :document-name="activeDocument.name"
      :has-selection="Boolean(selection)"
      :history-bytes="historyBytes"
      :history-items="historyItems"
      :history-position="historyPosition"
      :is-busy="isBusy"
      :redo-label="redoLabel"
      :status-text="statusText"
      :undo-label="undoLabel"
      @add-layer="addLayer"
      @clear-selection="updateSelection(null)"
      @convert-to-smart-layer="convertSelectedLayersToSmart"
      @delete-layer="deleteLayer(activeLayerId)"
      @delete-selection="deleteSelectedPixels"
      @duplicate-layer="duplicateLayer()"
      @edit-smart-layer="editSmartLayerContent()"
      @export-document="exportDocument"
      @fill-background="commitSolidFill(backgroundColor)"
      @fill-foreground="commitSolidFill(brushColor)"
      @flatten-image="requestFlattenImage"
      @history-jump="jumpHistory"
      @home="showProjectHome"
      @import-images="importImages"
      @import-pdf="importPDF"
      @merge-layers="mergeSelectedLayers"
      @new-document="requestNewDocument"
      @open-layer-styles="openLayerStyles(activeLayerId)"
      @open-project="openProject"
      @rasterize-layer="rasterizeLayer()"
      @redo="redoHistory"
      @save-project="saveProject()"
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
    <input
      ref="pdfFileInput"
      accept="application/pdf,.pdf"
      class="visually-hidden"
      type="file"
      @change="readLocalPDF($event.target as HTMLInputElement)"
    />

    <section
      v-if="hasOpenDocument"
      v-show="appScreen === 'editor'"
      class="workspace"
      :class="{ 'workspace--smart-edit': activeSmartLayerEditSession }"
      :inert="modalOpen || undefined"
    >
      <header v-if="activeSmartLayerEditSession" class="smart-edit-bar">
        <div class="smart-edit-context">
          <strong>Conteúdo inteligente</strong>
          <span aria-hidden="true">/</span>
          <span v-for="(name, index) in smartLayerEditBreadcrumb" :key="`${index}:${name}`">
            <span v-if="index" aria-hidden="true">/</span>
            {{ name }}
          </span>
        </div>
        <div class="smart-edit-actions">
          <button type="button" :disabled="isBusy" @click="cancelSmartLayerEdit">Cancelar</button>
          <button class="primary-button" type="button" :disabled="isBusy" @click="finishSmartLayerEdit">Concluir</button>
        </div>
      </header>

      <ToolBar
        v-model:active-tool="activeTool"
        v-model:background-color="backgroundColor"
        v-model:foreground-color="brushColor"
        :selection-mode="selectionMode"
        @tool-double-click="handleToolDoubleClick"
        @update-selection-mode="setSelectionMode"
      />

      <CanvasViewport
        ref="canvasViewport"
        :active-layer-id="activeLayerId"
        :selected-layer-ids="selectedLayerIds"
        :active-tool="activeTool"
        :auto-select-layer="autoSelectLayer"
        :brush-color="brushColor"
        :brush-size="brushSize"
        :foreground-color="brushColor"
        :background-color="backgroundColor"
        :gradient-config="gradientConfig"
        :document="activeDocument"
        :guides="guides"
        :guides-locked="guidesLocked"
        :guides-visible="guidesVisible"
        :guide-snapping-enabled="guideSnappingEnabled"
        :smart-guides-enabled="smartGuidesEnabled"
        :is-busy="isBusy"
        :layers="layers"
        :magic-wand-contiguous="magicWandContiguous"
        :magic-wand-tolerance="magicWandTolerance"
        :paint-bucket-contiguous="paintBucketContiguous"
        :paint-bucket-tolerance="paintBucketTolerance"
        :selection="selection"
        :selection-combine-mode="selectionCombineMode"
        :selection-move-anchor="selectionMoveAnchor"
        :selection-mode="selectionMode"
        :ruler-origin="rulerOrigin"
        :ruler-unit="rulerUnit"
        :rulers-visible="rulersVisible"
        :zoom="zoom"
        @create-guide="createGuide"
        @delete-guide="deleteGuide"
        @delete-selection="deleteSelectedPixels"
        @images-dropped="addDroppedImages"
        @pdf-dropped="openDroppedPDF"
        @magic-wand-select="selectWithMagicWand"
        @move-selection="commitSelectionMove"
        @paint-stroke="commitBrushStroke"
        @gradient-gesture="commitGradient"
        @paint-bucket="commitPaintBucket"
        @update:gradient-config="gradientConfig = $event"
        @update:brush-color="brushColor = $event"
        @update:brush-size="brushSize = $event"
        @sample-color="sampleColor"
        @update-guide="updateGuide"
        @create-text="addTextLayer"
        @select-layer="selectSingleLayer"
        @move-layers="moveLayerTransforms"
        @update:magic-wand-contiguous="magicWandContiguous = $event"
        @update:magic-wand-tolerance="magicWandTolerance = $event"
        @update:paint-bucket-contiguous="paintBucketContiguous = $event"
        @update:paint-bucket-tolerance="paintBucketTolerance = $event"
        @update:guides-locked="guidesLocked = $event"
        @update:guides-visible="guidesVisible = $event"
        @update:guide-snapping-enabled="guideSnappingEnabled = $event"
        @update:smart-guides-enabled="smartGuidesEnabled = $event"
        @update:ruler-origin="rulerOrigin = $event"
        @update:ruler-unit="rulerUnit = $event"
        @update:rulers-visible="rulersVisible = $event"
        @clear-guides="clearGuides"
        @update:selection="updateSelection"
        @update:selection-combine-mode="selectionCombineMode = $event"
        @update:selection-mode="setSelectionMode"
        @update-transform="updateLayerTransform"
        @update:auto-select-layer="autoSelectLayer = $event"
        @update:zoom="setZoom"
      />

      <aside class="side-panels" aria-label="Painéis do documento">
        <PropertiesPanel
          :active-layer="activeLayer"
          :active-tool="activeTool"
          :zoom="zoom"
          @update:text="updateTextLayer(activeLayer.id, $event)"
          @update:zoom="setZoom"
        />

        <LayersPanel
          :active-layer-id="activeLayerId"
          :document-background="activeDocument.background"
          :layers="layers"
          :layer-style-global-light="activeDocument.layerStyleGlobalLight"
          :selected-layer-ids="selectedLayerIds"
          @add-layer="addLayer"
          @convert-to-smart-layer="convertSelectedLayersToSmart"
          @delete-layer="deleteLayer"
          @duplicate-layer="duplicateLayer"
          @edit-smart-layer="editSmartLayerContent"
          @export-layer="exportLayerPNG"
          @move-layer="moveLayer"
          @merge-layers="mergeSelectedLayers"
          @open-layer-styles="openLayerStyles"
          @rasterize-layer="rasterizeLayer"
          @rename-layer="renameLayer"
          @reorder-layer="reorderLayer"
          @select-layer="selectLayerFromPanel"
          @toggle-layer="toggleLayer"
          @update:layer-blend-mode="updateLayerBlendMode"
          @update:layer-opacity="updateLayerOpacity"
        />
      </aside>
    </section>

    <NewDocumentDialog
      :busy="isBusy"
      :open="showNewDocumentDialog"
      @close="showNewDocumentDialog = false"
      @create="createDocument"
    />
    <ExportImageDialog
      :background="activeDocument.background"
      :busy="isBusy"
      :estimated-bytes="exportEstimatedBytes"
      :estimating="exportEstimateBusy"
      :height="activeDocument.height"
      :open="showExportImageDialog"
      :resolution-dpi="activeDocument.resolutionDpi"
      :width="activeDocument.width"
      @cancel="showExportImageDialog = false; clearExportEstimate()"
      @estimate="estimateDocumentExport"
      @export="performDocumentExport"
      @settings-change="clearExportEstimate"
    />
    <ImportPdfDialog
      :busy="isBusy"
      :open="showImportPdfDialog"
      :progress="pdfImportProgress"
      :source="pdfImportSource"
      @cancel="cancelPDFImport"
      @import="performPDFImport"
    />
    <LayerStyleDialog
      :layer-name="layerStyleDialogLayer?.name ?? ''"
      :open="Boolean(layerStyleDialog)"
      :raster-effects-available="Boolean(layerStyleDialogLayer?.image)"
      :styles="layerStyleDialog?.before ?? createLayerStyleConfig()"
      @apply="applyLayerStyles"
      @cancel="cancelLayerStyles"
      @preview="previewLayerStyles"
    />
    <FlattenImageDialog
      :busy="isBusy"
      :hidden-count="hiddenLayerCount"
      :open="showFlattenImageDialog"
      @cancel="cancelFlattenImage"
      @confirm="confirmFlattenImage"
    />
    <UnsavedChangesDialog
      :busy="isBusy"
      :document-name="activeDocument.name"
      :open="showUnsavedChangesDialog"
      @cancel="resolveDiscardChanges(false)"
      @discard="resolveDiscardChanges(true)"
      @save="saveBeforeDiscarding"
    />
  </main>
</template>

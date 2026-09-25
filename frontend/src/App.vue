<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import CanvasViewport from './components/CanvasViewport.vue'
import FlattenImageDialog from './components/FlattenImageDialog.vue'
import ImportPdfDialog from './components/ImportPdfDialog.vue'
import PDFRerenderDialog from './components/PDFRerenderDialog.vue'
import LayerStyleDialog from './components/LayerStyleDialog.vue'
import LayersPanel from './components/LayersPanel.vue'
import NewDocumentDialog from './components/NewDocumentDialog.vue'
import ExportImageDialog from './components/ExportImageDialog.vue'
import ProjectHome from './components/ProjectHome.vue'
import PropertiesPanel from './components/PropertiesPanel.vue'
import RasterizeLayerDialog from './components/RasterizeLayerDialog.vue'
import LayerStylesPanel from './components/LayerStylesPanel.vue'
import ScaleLayerEffectsDialog from './components/ScaleLayerEffectsDialog.vue'
import ToolBar from './components/ToolBar.vue'
import TopMenu from './components/TopMenu.vue'
import UnsavedChangesDialog from './components/UnsavedChangesDialog.vue'
import {
  createEditorDocument,
  finalizeAxiaProjectOpen,
  getEditorStatus,
  hasDesktopBackend,
  registerNativeFileDrop,
  releaseDesktopImageImports,
  releaseDesktopPDF,
  releaseAxiaProjectAssets,
  setNativeDocumentDirty,
  selectDesktopImages,
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
import { prepareImportedDocumentLayer as prepareImportedDocumentLayerAsset } from './services/importedDocumentLayer'
import {
  renderDocumentBlob,
  renderLayerAppearance,
  renderMergedLayers,
  sampleDocumentColor
} from './services/renderDocument'
import { closePDFImport, openPDFImport, renderPDFPages, type PDFImportSource, type PDFRenderRequest } from './services/pdfImport'
import { applyPreparedProject, prepareRestoredProject, selectAndRestoreAxiaProject } from './services/projectOpen'
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
import { useDocumentExport } from './composables/useDocumentExport'
import { useDocumentCreation } from './composables/useDocumentCreation'
import { useMediaDocumentOpen } from './composables/useMediaDocumentOpen'
import { useLayerImageImport } from './composables/useLayerImageImport'
import { usePDFImportSelection } from './composables/usePDFImportSelection'
import { useLayerActions } from './composables/useLayerActions'
import { useLayerStylePresets } from './composables/useLayerStylePresets'
import { useProjectLifecycle } from './composables/useProjectLifecycle'
import { useProjectPersistence } from './composables/useProjectPersistence'
import { clampZoom } from './editor/viewport'
import { maximumPDFImportDPI, normalizePDFDPI } from './editor/pdfImport'
import {
  createNativePixelLayer,
  createPlacedImageSmartLayer,
  createPlacedPDFSmartLayer,
  importedImageDocumentSettings,
  validateImportedImageDocument
} from './editor/mediaDocument'
import { readAutoSelectLayerPreference, writeAutoSelectLayerPreference } from './editor/preferences'
import { editorIsBlockedByModal } from './editor/interactionGuards'
import { layerCanRasterize, layerSupportsRotationBaking, rasterizedLayerPatch } from './editor/layerRasterization'
import { createFlattenedLayer, documentCanFlatten } from './editor/flattenImage'
import { updateLayerSelection, type LayerSelectionMode } from './editor/layerSelection'
import { cloneSmartLayerContent, createSmartLayer, layersCanConvertToSmart, smartLayerObjectLayers } from './editor/smartLayers'
import { replacePDFSmartLayerCache } from './editor/pdfSmartLayer'
import {
  createEditedSmartLayerContent,
  createSmartLayerEditDocument,
  smartLayerEditHasChanges
} from './editor/smartLayerEditing'
import type { EditorGuide, RulerOrigin, RulerUnit } from './editor/guides'
import {
  cloneLayerStyleConfig,
  createLayerStyleConfig,
  DEFAULT_LAYER_STYLE_GLOBAL_LIGHT,
  layerEffectLabel,
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
  intelligentSelectionToolForShortcut,
  isIntelligentSelectionTool,
  type IntelligentSelectionTool
} from './editor/intelligentSelectionTools'
import {
  createQuickSelection,
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
  openLayerStyleNativeWindow,
  registerLayerStyleWindowHost,
  sendLayerStyleWindowSession,
  type LayerStyleWindowChange,
  type LayerStyleWindowSession
} from './services/layerStyleWindow'
import {
  clearedLayerStyleChanges,
  copyLayerStyleConfig,
  layerCanPasteStyle,
  layerStyleCanClear,
  layerStylesCanScale,
  pastedLayerStyleChanges,
  scaledLayerStyleChange,
  scaledLayerStyleChanges,
  toggledLayerEffectVisibilityChange,
  toggledLayerStyleVisibilityChange,
  type LayerStyleTargetChange
} from './editor/layerStyleOperations'
import {
  type LayerStylePreset
} from './editor/layerStylePresets'
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
import { DEFAULT_SHAPE_CONFIG, normalizeShapeConfig, type ShapeGeometry, type ShapeKind, type ShapeToolConfig } from './editor/shape'
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
  LayerEffectType,
  LayerItem,
  LayerStyleConfig,
  LayerStyleGlobalLight,
  LayerTransform,
  RecentProject,
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
const shapeConfig = ref<ShapeToolConfig>({ ...DEFAULT_SHAPE_CONFIG, color: brushColor.value })
const shapeDraftEditing = ref(false)
const editableShapeLayerId = ref<string>()
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
const quickSelectionColorTolerance = ref(48)
const quickSelectionEdgeTolerance = ref(32)
const paintBucketTolerance = ref(32)
const paintBucketContiguous = ref(true)
const selection = shallowRef<SelectionRegion | null>(null)
const quickSelectionResultPreview = shallowRef<SelectionRegion | null>(null)
const statusText = ref('Inicializando…')
const errorText = ref('')
const isBusy = ref(false)
const activeLayerId = ref('layer-bg')
const selectedLayerIds = ref<string[]>(['layer-bg'])
const layerSelectionAnchorId = ref('layer-bg')
const showNewDocumentDialog = ref(false)
const showImportPdfDialog = ref(false)
const pdfImportSource = shallowRef<PDFImportSource | null>(null)
const pdfImportProgress = ref('')
const pdfImportDestination = ref<'document' | 'layer'>('layer')
const pdfRerenderLayerId = ref<string>()
const pdfRerenderError = ref('')
const pdfRerenderProgress = ref('')
const appScreen = ref<'home' | 'editor'>('home')
const hasOpenDocument = ref(false)
const recentProjects = ref<RecentProject[]>([])
const recentProjectsLoading = ref(true)
const showUnsavedChangesDialog = ref(false)
const showFlattenImageDialog = ref(false)
const rasterizeLayerRequest = ref<{ layerId: string; toolLabel: string }>()
const layerStylePresets = shallowRef<LayerStylePreset[]>([])
const inspectorTab = ref<'properties' | 'styles'>('styles')
const scaleLayerEffectsSession = shallowRef<{
  items: Array<{ layerId: string; before: LayerStyleConfig }>
}>()
const layerStyleDialog = shallowRef<{
  sessionId: string
  layerId: string
  before: LayerStyleConfig
  beforeGlobalLight: LayerStyleGlobalLight
  initialEffectType?: LayerEffectType
}>()
const nativeLayerStyleWindowEnabled = hasDesktopBackend()
const nativeLayerStyleDialogFallback = ref(false)
let nativeLayerStyleRevision = 0
const copiedLayerStyles = shallowRef<LayerStyleConfig>()
const fileInput = ref<HTMLInputElement | null>(null)
const documentImageInput = ref<HTMLInputElement | null>(null)
const pdfFileInput = ref<HTMLInputElement | null>(null)
const canvasViewport = ref<InstanceType<typeof CanvasViewport> | null>(null)
const projectPath = ref('')
const savedHistoryRevision = ref<number | null>(null)
interface ImagePlacementSession {
  currentLayerId: string
  pending: ImportedImage[]
  previousActiveLayerId: string
}
const imagePlacementSession = shallowRef<ImagePlacementSession>()
let cancellingImagePlacementQueue = false
const imagePlacementActive = computed(() => Boolean(imagePlacementSession.value))
const imagePlacementRemaining = computed(() => {
  const session = imagePlacementSession.value
  return session ? session.pending.length + (session.currentLayerId ? 1 : 0) : 0
})
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
const {
  clearExportEstimate,
  estimateDocumentExport,
  exportDocument,
  exportEstimatedBytes,
  exportEstimateBusy,
  exportLayerPNG,
  performDocumentExport,
  showExportImageDialog
} = useDocumentExport({
  activeDocument,
  activeLayerId,
  errorText,
  isBusy,
  layers,
  preparePDFSmartLayerForExport,
  refreshSmartLayerSource,
  settleRasterMutation,
  showError,
  statusText
})
const zoomEventOptions = { capture: true, passive: false }
const previewGenerations = new Map<string, number>()
const previewControllers = new Map<string, AbortController>()
const trackedObjectUrls = new Set<string>()
const trackedNativeImageIDs = new Set<string>()
const transientObjectUrls = new Set<string>()
let selectionGeneration = 0
let pendingSelectionTasks = 0
let previewRefreshTimer: ReturnType<typeof setTimeout> | undefined
let previewLayerCountHint = 0
let rasterPreparationPromise: Promise<void> | undefined
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
  if (imagePlacementActive.value) return true
  const session = activeSmartLayerEditSession.value
  if (session) return session.parentDirty || history.currentPosition.value > 0
  return savedHistoryRevision.value === null || historyRevision.value !== savedHistoryRevision.value
})
const {
  clearProjectRecents,
  confirmDiscardChanges,
  refreshRecentProjects,
  registerRecentProject,
  removeProjectFromRecents,
  resolveDiscardChanges,
  returnToEditor,
  saveBeforeDiscarding,
  showProjectHome
} = useProjectLifecycle({
  appScreen,
  documentDirty,
  hasActiveImagePlacement: () => imagePlacementActive.value,
  hasActiveSmartLayerEdit: () => Boolean(activeSmartLayerEditSession.value),
  hasOpenDocument,
  isBusy,
  recentProjects,
  recentProjectsLoading,
  saveCurrentProject: () => saveProject(),
  showError,
  showUnsavedChangesDialog,
  statusText
})
const { openImageAsDocument, readLocalImageDocument } = useMediaDocumentOpen({
  canOpenMediaDocument,
  documentImageInput,
  errorText,
  isBusy,
  releaseUnadoptedImage: releaseUnadoptedImportedImage,
  replaceDocumentWithImportedImage,
  showError,
  statusText
})
const { importImages, readLocalFiles } = useLayerImageImport({
  errorText,
  fileInput,
  isBusy,
  showError,
  startImagePlacementQueue,
  statusText
})
const { importPDF, openPDFAsDocument } = usePDFImportSelection({
  canOpenMediaDocument,
  errorText,
  isBusy,
  pdfFileInput,
  pdfImportDestination,
  pdfImportSource,
  releasePDFSource,
  showError,
  showImportPdfDialog,
  statusText
})
const { saveProject } = useProjectPersistence({
  activeDocument,
  activeLayerId,
  activeSmartLayerEdit: () => Boolean(activeSmartLayerEditSession.value),
  commitPendingTransform: () => canvasViewport.value?.commitPendingTransform(),
  errorText,
  finishSmartLayerEdit,
  guideSnappingEnabled,
  guides,
  guidesLocked,
  guidesVisible,
  hasOpenDocument,
  historyRevision,
  isBusy,
  layers,
  projectPath,
  registerRecentProject,
  rulerOrigin,
  rulerUnit,
  savedHistoryRevision,
  settleRasterMutation,
  showError,
  smartGuidesEnabled,
  statusText,
  zoom
})
const { createDocument } = useDocumentCreation({
  activeDocument,
  activeLayerId,
  activeTool,
  appScreen,
  createBackgroundLayer,
  ensureRasterLayerPaintable,
  errorText,
  guides,
  hasOpenDocument,
  historyClear: (label) => history.clear(label),
  isBusy,
  layerSelectionAnchorId,
  layers,
  materializeRasterLayer,
  previewGenerations,
  projectPath,
  refreshLayerPreview,
  releaseAllEditorAssets,
  rulerOrigin,
  savedHistoryRevision,
  selectedLayerIds,
  selection,
  selectionGeneration: () => { selectionGeneration++ },
  showNewDocumentDialog,
  showError,
  statusText,
  zoom
})
const modalOpen = computed(() => editorIsBlockedByModal(
  showNewDocumentDialog.value || showExportImageDialog.value || showImportPdfDialog.value || Boolean(pdfRerenderLayerId.value),
  showUnsavedChangesDialog.value,
  Boolean(layerStyleDialog.value) || showFlattenImageDialog.value || Boolean(scaleLayerEffectsSession.value) || Boolean(rasterizeLayerRequest.value)
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
const {
  addLayer,
  addTextLayer,
  deleteLayer,
  duplicateLayer,
  moveLayer,
  renameLayer,
  reorderLayer,
  toggleLayer,
  updateLayerBlendMode,
  updateLayerOpacity,
  updateTextLayer
} = useLayerActions({
  activeDocument,
  activeLayer,
  activeLayerId,
  cancelLayerPreview: (layerId) => {
    previewControllers.get(layerId)?.abort()
    previewControllers.delete(layerId)
    previewGenerations.set(layerId, (previewGenerations.get(layerId) ?? 0) + 1)
  },
  errorText,
  layers,
  recordHistory,
  refreshLayerPreview,
  statusText
})
const {
  applySavedLayerStylePreset,
  deleteSavedLayerStylePreset,
  openLayerStylePresets,
  refreshLayerStylePresets,
  saveCurrentLayerStylePreset
} = useLayerStylePresets({
  activeLayer,
  activeLayerId,
  commitLayerStyleChanges,
  hasLayer: (layerId) => layers.value.some((layer) => layer.id === layerId),
  inspectorTab,
  isBusy,
  layerStylePresets,
  modalOpen,
  selectSingleLayer,
  selectedLayerIds,
  showError,
  statusText,
  styleTargetLayers
})
const selectedLayerItems = computed(() => {
  const selected = new Set(selectedLayerIds.value)
  return layers.value
    .map((layer, index) => ({ index, layer }))
    .filter((item) => selected.has(item.layer.id))
})
function styleTargetLayers(anchorId = activeLayerId.value) {
  const anchor = layers.value.find((layer) => layer.id === anchorId)
  if (!anchor) return []
  if (!selectedLayerIds.value.includes(anchorId)) return [anchor]
  return selectedLayerItems.value.map((item) => item.layer)
}

const activeStyleTargetLayers = computed(() => styleTargetLayers())
const scaleLayerEffectsLayers = computed(() => {
  const ids = new Set(scaleLayerEffectsSession.value?.items.map((item) => item.layerId) ?? [])
  return layers.value.filter((layer) => ids.has(layer.id))
})
const scaleLayerEffectsLabel = computed(() => scaleLayerEffectsLayers.value.length === 1
  ? scaleLayerEffectsLayers.value[0]?.name
  : `${scaleLayerEffectsLayers.value.length} camadas`)
const layerStylePresetsTargetCount = computed(() => styleTargetLayers().length)
const canConvertSelectedLayersToSmart = computed(() => layersCanConvertToSmart(selectedLayerItems.value))
const canFlattenImage = computed(() => documentCanFlatten(activeDocument.value, layers.value))
const canClearActiveLayerStyles = computed(() => activeStyleTargetLayers.value.some((layer) => layerStyleCanClear(layer.styles)))
const canScaleActiveLayerEffects = computed(() => activeStyleTargetLayers.value.some((layer) => layerStylesCanScale(layer.styles)))
const canPasteActiveLayerStyles = computed(() => Boolean(
  copiedLayerStyles.value && activeStyleTargetLayers.value.length &&
  activeStyleTargetLayers.value.every((layer) => layerCanPasteStyle(layer, copiedLayerStyles.value))
))
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
let pendingQuickSelection: AbortController | undefined

function cancelMagicWandSelection() {
  if (!pendingMagicWandSelection) return
  const controller = pendingMagicWandSelection
  pendingMagicWandSelection = undefined
  selectionGeneration++
  controller.abort()
}

function cancelQuickSelection() {
  quickSelectionResultPreview.value = null
  if (!pendingQuickSelection) return
  const controller = pendingQuickSelection
  pendingQuickSelection = undefined
  selectionGeneration++
  controller.abort()
}

function cancelIntelligentSelection() {
  cancelMagicWandSelection()
  cancelQuickSelection()
}

watch(
  [activeTool, activeLayerId, () => activeDocument.value.id],
  () => {
    cancelMagicWandSelection()
    cancelQuickSelection()
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
  shapeConfig.value = { ...shapeConfig.value, color: foreground }
})

function updateShapeConfig(config: ShapeToolConfig) {
  const normalized = normalizeShapeConfig(config)
  shapeConfig.value = normalized
  brushColor.value = shapeConfig.value.color
  const layer = activeLayer.value
  if (
    shapeDraftEditing.value || editableShapeLayerId.value !== layer.id ||
    layer.kind !== 'shape' || !layer.shape
  ) return
  const before = { shape: { ...layer.shape } }
  const after = { shape: { ...layer.shape, ...normalized } }
  if (JSON.stringify(before.shape) === JSON.stringify(after.shape)) return
  layer.shape = after.shape
  recordHistory('Editar forma', {
    type: 'layer:patch',
    layerId: layer.id,
    before,
    after
  }, { mergeKey: `shape:${layer.id}`, mergeWindowMs: 800 })
}

function updateShapeKind(kind: ShapeKind) {
  editableShapeLayerId.value = undefined
  shapeConfig.value = normalizeShapeConfig({ ...shapeConfig.value, kind })
}

watch([activeLayerId, activeTool], () => {
  const layer = activeLayer.value
  if (activeTool.value === 'shape' && layer.kind === 'shape' && layer.shape) {
    shapeConfig.value = normalizeShapeConfig(layer.shape)
    editableShapeLayerId.value = layer.id
  } else {
    editableShapeLayerId.value = undefined
  }
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
    item.smart?.pdf?.sourceUrl,
    ...layerStylePatternAssets(item.styles).map((asset) => asset.sourceUrl)
  ]).filter(
    (source): source is string => Boolean(source?.startsWith('blob:'))
  )
}

function layerNativeImageIDs(layer: LayerItem) {
  return smartLayerObjectLayers(layer).flatMap((item) => [
    item.image?.sourceUrl,
    ...layerStylePatternAssets(item.styles).map((asset) => asset.sourceUrl)
  ]).flatMap((source) => source?.startsWith('/__axia_asset/')
    ? [source.slice('/__axia_asset/'.length).split('?')[0]!]
    : [])
}

function trackLayerAssets(items: LayerItem[]) {
  for (const layer of items) {
    for (const source of layerObjectUrls(layer)) trackedObjectUrls.add(source)
    for (const id of layerNativeImageIDs(layer)) trackedNativeImageIDs.add(id)
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
  for (const asset of layerStylePatternAssets(copiedLayerStyles.value)) {
    if (asset.sourceUrl.startsWith('blob:')) retainedUrls.add(asset.sourceUrl)
  }
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

  // Assets nativos são referências leves para arquivos mantidos pelo backend.
  // Conservá-los até o fechamento do documento evita liberar uma imagem no
  // intervalo entre remover uma camada e registrar seu snapshot no histórico.
}

function releaseAllEditorAssets(preserveSmartCache = false) {
  for (const controller of previewControllers.values()) controller.abort()
  previewControllers.clear()
  floatingSelectionSession.value = null
  clearPreparedImageCache()
  clearLayerStyleRenderCache()
  if (!preserveSmartCache) clearSmartLayerRenderCache()
  const releasedLayers = [...layers.value, ...retainedHistoryLayers()]
  copiedLayerStyles.value = undefined
  const nativeImageIDs = new Set([
    ...trackedNativeImageIDs,
    ...releasedLayers.flatMap(layerNativeImageIDs)
  ])
  releaseLayerAssets(releasedLayers)
  void releaseDesktopImageImports([...nativeImageIDs])
  for (const source of trackedObjectUrls) URL.revokeObjectURL(source)
  trackedObjectUrls.clear()
  trackedNativeImageIDs.clear()
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
    if (delta.type === 'layer-styles:change') {
      activeDocument.value.layerStyleGlobalLight = normalizeLayerStyleGlobalLight(
        direction === 'redo' ? delta.globalLightAfter : delta.globalLightBefore
      )
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
  if ((source.kind !== 'background' && source.kind !== 'pixel') || !source.image || !source.transform) {
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
      kind: 'pixel',
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
      shape: layer.shape,
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
      kind: includesBackground ? 'background' : 'pixel',
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
    // Prepara a fonte visual enquanto as camadas de origem ainda pertencem ao
    // documento. Assim a troca abaixo é atômica e não disputa duas gerações de
    // preview disparadas pela mudança da camada ativa.
    await refreshLayerPreview(merged, true, true, true)

    const remaining = layers.value.filter((layer) => !selected.has(layer.id))
    const firstSelectedIndex = selectedItems[0]!.index
    const insertionIndex = includesBackground
      ? remaining.length
      : layers.value.slice(0, firstSelectedIndex).filter((layer) => !selected.has(layer.id)).length
    remaining.splice(insertionIndex, 0, merged)
    layers.value = remaining
    trackLayerAssets([merged])
    selectSingleLayer(merged.id)

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

function currentLayerStyleWindowSession(): LayerStyleWindowSession | null {
  const session = layerStyleDialog.value
  const layer = layerStyleDialogLayer.value
  if (!session || !layer) return null
  return {
    globalLight: { ...session.beforeGlobalLight },
    initialEffectType: session.initialEffectType,
    layerName: layer.name,
    rasterEffectsAvailable: Boolean(layer.image),
    sessionId: session.sessionId,
    styles: cloneLayerStyleConfig(session.before)
  }
}

function openLayerStyles(layerId: string, initialEffectType?: LayerEffectType) {
  if (isBusy.value || layerStyleDialog.value) return
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) return
  selectSingleLayer(layerId)
  layerStyleDialog.value = {
    sessionId: crypto.randomUUID(),
    layerId,
    before: cloneLayerStyleConfig(layer.styles),
    beforeGlobalLight: { ...activeDocument.value.layerStyleGlobalLight },
    initialEffectType
  }
  nativeLayerStyleRevision = 0
  nativeLayerStyleDialogFallback.value = false
  if (!nativeLayerStyleWindowEnabled) return
  const session = currentLayerStyleWindowSession()
  if (!session) return
  void openLayerStyleNativeWindow(session).catch((error) => {
    nativeLayerStyleDialogFallback.value = true
    showError(error, 'As opções de mesclagem foram abertas dentro do editor.')
  })
}

function previewLayerStyles(styles: LayerStyleConfig, globalLight: LayerStyleGlobalLight) {
  const layer = layerStyleDialogLayer.value
  if (!layer) return
  layer.styles = cloneLayerStyleConfig(styles)
  activeDocument.value.layerStyleGlobalLight = normalizeLayerStyleGlobalLight(globalLight)
}

function cancelLayerStyles() {
  const session = layerStyleDialog.value
  const layer = layerStyleDialogLayer.value
  if (session && layer) {
    layer.styles = cloneLayerStyleConfig(session.before)
    activeDocument.value.layerStyleGlobalLight = { ...session.beforeGlobalLight }
  }
  layerStyleDialog.value = undefined
}

function applyLayerStyles(styles: LayerStyleConfig, globalLight: LayerStyleGlobalLight) {
  const session = layerStyleDialog.value
  const layer = layerStyleDialogLayer.value
  if (!session || !layer) {
    layerStyleDialog.value = undefined
    return
  }

  const before = cloneLayerStyleConfig(session.before)
  const after = cloneLayerStyleConfig(styles)
  const globalLightBefore = { ...session.beforeGlobalLight }
  const globalLightAfter = normalizeLayerStyleGlobalLight(globalLight)
  layer.styles = after
  activeDocument.value.layerStyleGlobalLight = globalLightAfter
  layerStyleDialog.value = undefined
  if (JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(globalLightBefore) === JSON.stringify(globalLightAfter)) return
  recordHistory('Alterar estilos de camada', {
    type: 'layer-styles:change',
    layerId: layer.id,
    before,
    after,
    globalLightBefore,
    globalLightAfter
  })
  statusText.value = 'Estilos de camada atualizados'
}

function acceptNativeLayerStyleChange(change: LayerStyleWindowChange) {
  const session = layerStyleDialog.value
  if (!session || change.sessionId !== session.sessionId || change.revision <= nativeLayerStyleRevision) return false
  nativeLayerStyleRevision = change.revision
  return true
}

function previewNativeLayerStyles(change: LayerStyleWindowChange) {
  if (!acceptNativeLayerStyleChange(change)) return
  previewLayerStyles(change.styles, change.globalLight)
}

function applyNativeLayerStyles(change: LayerStyleWindowChange) {
  if (!acceptNativeLayerStyleChange(change)) return
  applyLayerStyles(change.styles, change.globalLight)
}

function cancelNativeLayerStyles(sessionId: string) {
  if (layerStyleDialog.value?.sessionId === sessionId) cancelLayerStyles()
}

function resendLayerStyleWindowSession() {
  const session = currentLayerStyleWindowSession()
  if (session) void sendLayerStyleWindowSession(session)
}

function copyLayerStyles(layerId = activeLayerId.value) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) return
  copiedLayerStyles.value = copyLayerStyleConfig(layer.styles)
  for (const asset of layerStylePatternAssets(copiedLayerStyles.value)) {
    if (asset.sourceUrl.startsWith('blob:')) trackedObjectUrls.add(asset.sourceUrl)
  }
  collectUnusedObjectUrls()
  statusText.value = `Estilo de “${layer.name}” copiado`
}

function commitLayerStyleChanges(label: string, changes: LayerStyleTargetChange[]) {
  if (!changes.length) return false
  const changedLayers: LayerItem[] = []
  for (const change of changes) {
    const layer = layers.value.find((item) => item.id === change.layerId)
    if (!layer) continue
    layer.styles = cloneLayerStyleConfig(change.after)
    changedLayers.push(layer)
  }
  if (!changedLayers.length) return false
  const changedIds = new Set(changedLayers.map((layer) => layer.id))
  trackLayerAssets(changedLayers)
  recordHistory(label, {
    type: 'layers:styles',
    items: changes
      .filter((change) => changedIds.has(change.layerId))
      .map((change) => ({
        layerId: change.layerId,
        before: cloneLayerStyleConfig(change.before),
        after: cloneLayerStyleConfig(change.after)
      }))
  })
  return true
}

function pasteLayerStyles(layerId = activeLayerId.value) {
  const clipboard = copiedLayerStyles.value
  const targets = styleTargetLayers(layerId)
  if (!targets.length || !clipboard) return
  if (targets.some((layer) => !layerCanPasteStyle(layer, clipboard))) {
    showError(
      new Error('Rasterize as camadas incompatíveis antes de colar efeitos de camada.'),
      'Uma ou mais camadas selecionadas aceitam somente a opacidade de preenchimento.'
    )
    return
  }
  const changes = pastedLayerStyleChanges(targets, clipboard)
  if (!commitLayerStyleChanges(targets.length === 1 ? 'Colar estilo de camada' : 'Colar estilo em camadas', changes)) {
    statusText.value = targets.length === 1 ? 'A camada já possui esse estilo' : 'As camadas já possuem esse estilo'
    return
  }
  statusText.value = changes.length === 1
    ? `Estilo colado em “${targets.find((layer) => layer.id === changes[0]!.layerId)?.name}”`
    : `Estilo colado em ${changes.length} camadas`
}

function clearLayerStyles(layerId = activeLayerId.value) {
  const targets = styleTargetLayers(layerId)
  const changes = clearedLayerStyleChanges(targets)
  if (!commitLayerStyleChanges(targets.length === 1 ? 'Limpar estilo de camada' : 'Limpar estilos de camadas', changes)) return
  collectUnusedObjectUrls()
  statusText.value = changes.length === 1
    ? `Estilo removido de “${targets.find((layer) => layer.id === changes[0]!.layerId)?.name}”`
    : `Estilos removidos de ${changes.length} camadas`
}

function toggleLayerStyleVisibility(layerId: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) return
  const change = toggledLayerStyleVisibilityChange(layer)
  if (!change || !commitLayerStyleChanges('Alternar visibilidade dos efeitos', [{ layerId, ...change }])) return
  statusText.value = change.after.enabled ? 'Efeitos da camada ativados' : 'Efeitos da camada ocultos'
}

function toggleLayerEffectVisibility(layerId: string, effectId: string) {
  const layer = layers.value.find((item) => item.id === layerId)
  if (!layer) return
  const change = toggledLayerEffectVisibilityChange(layer, effectId)
  if (!change || !commitLayerStyleChanges('Alternar visibilidade do efeito', [{ layerId, ...change }])) return
  const effect = change.after.effects.find((item) => item.id === effectId)
  statusText.value = effect
    ? `${layerEffectLabel(effect.type)} ${effect.enabled ? 'ativado' : 'oculto'}`
    : 'Visibilidade do efeito atualizada'
}

function openScaleLayerEffects(layerId = activeLayerId.value) {
  if (isBusy.value || modalOpen.value) return
  const targets = styleTargetLayers(layerId).filter((layer) => layerStylesCanScale(layer.styles))
  if (!targets.length) {
    statusText.value = 'As camadas selecionadas não possuem efeitos dimensionáveis'
    return
  }
  scaleLayerEffectsSession.value = {
    items: targets.map((layer) => ({ layerId: layer.id, before: cloneLayerStyleConfig(layer.styles) }))
  }
}

function cancelScaleLayerEffects() {
  if (isBusy.value) return
  const session = scaleLayerEffectsSession.value
  for (const item of session?.items ?? []) {
    const layer = layers.value.find((candidate) => candidate.id === item.layerId)
    if (layer) layer.styles = cloneLayerStyleConfig(item.before)
  }
  scaleLayerEffectsSession.value = undefined
}

function previewScaleLayerEffects(percentage: number) {
  const session = scaleLayerEffectsSession.value
  if (!session || isBusy.value) return
  for (const item of session.items) {
    const layer = layers.value.find((candidate) => candidate.id === item.layerId)
    if (!layer) continue
    const change = scaledLayerStyleChange({ ...layer, styles: item.before }, percentage)
    layer.styles = change?.after ?? cloneLayerStyleConfig(item.before)
  }
}

function applyScaleLayerEffects(percentage: number) {
  const session = scaleLayerEffectsSession.value
  scaleLayerEffectsSession.value = undefined
  if (!session || isBusy.value) return
  const targets = session.items.flatMap((item) => {
    const layer = layers.value.find((candidate) => candidate.id === item.layerId)
    return layer ? [{ ...layer, styles: item.before }] : []
  })
  const changes = scaledLayerStyleChanges(targets, percentage)
  if (!commitLayerStyleChanges(targets.length === 1 ? 'Escalar efeitos da camada' : 'Escalar efeitos das camadas', changes)) {
    for (const item of session.items) {
      const layer = layers.value.find((candidate) => candidate.id === item.layerId)
      if (layer) layer.styles = cloneLayerStyleConfig(item.before)
    }
    statusText.value = percentage === 100 ? 'A escala dos efeitos não foi alterada' : 'Os efeitos já estão no limite dessa escala'
    return
  }
  statusText.value = changes.length === 1
    ? `Efeitos de “${targets.find((layer) => layer.id === changes[0]!.layerId)?.name}” escalados para ${percentage}%`
    : `Efeitos de ${changes.length} camadas escalados para ${percentage}%`
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

  if (imagePlacementSession.value?.currentLayerId === layerId) {
    const sizeChanged = previous?.width !== transform.width || previous?.height !== transform.height
    layer.transform = { ...transform }
    if (sizeChanged) void refreshLayerPreview(layer)
    return
  }

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

  const placementLayerId = imagePlacementSession.value?.currentLayerId
  if (placementLayerId && items.length === 1 && items[0]!.layerId === placementLayerId) {
    const layer = layers.value.find((candidate) => candidate.id === placementLayerId)
    if (layer) layer.transform = { ...items[0]!.after }
    return
  }

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

function releaseUnadoptedImportedImage(image: ImportedImage | null | undefined) {
  if (!image) return
  if (image.sourceUrl.startsWith('blob:')) URL.revokeObjectURL(image.sourceUrl)
  else if (image.sourceUrl.startsWith('/__axia_asset/')) void releaseDesktopImageImports([image.id])
}

async function replaceDocumentWithImportedImage(
  image: ImportedImage,
  documentName = image.name,
  baselineLabel = 'Mídia aberta',
  background: DocumentSpec['background'] = 'transparent'
) {
  const validationError = validateImportedImageDocument(image)
  if (validationError) throw new Error(validationError)

  const settings = importedImageDocumentSettings(image, documentName, background)
  const document = await createEditorDocument(settings, image.width, image.height)
  const layer = createNativePixelLayer(image)
  let documentAdopted = false

  try {
    // Prepare the exact visual source before releasing anything owned by the current document.
    await prepareImportedDocumentLayerAsset(layer, ACTIVE_PREVIEW_PIXELS)
    canvasViewport.value?.commitPendingTransform()
    if (rasterMutationBarrier.isPending && !await rasterMutationBarrier.wait()) {
      throw new Error('Não foi possível concluir a edição atual antes de abrir a mídia.')
    }
    await releaseAxiaProjectAssets()

    releaseAllEditorAssets()
    history.clear(baselineLabel)
    previewGenerations.clear()
    selection.value = null
    selectionGeneration++
    activeDocument.value = document
    guides.value = []
    rulerOrigin.value = { x: 0, y: 0 }
    rulerUnit.value = 'px'
    layers.value = [layer]
    trackLayerAssets([layer])
    documentAdopted = true
    activeLayerId.value = layer.id
    selectedLayerIds.value = [layer.id]
    layerSelectionAnchorId.value = layer.id
    activeTool.value = 'move'
    zoom.value = 100
    projectPath.value = ''
    savedHistoryRevision.value = historyRevision.value
    hasOpenDocument.value = true
    appScreen.value = 'editor'
    previewLayerCountHint = 1
    statusText.value = 'Preparando imagem para edição…'
    await nextTick()
    previewLayerCountHint = 0
    await canvasViewport.value?.waitForLayerImages([{
      layerId: layer.id,
      source: layer.image?.previewUrl ?? layer.image!.sourceUrl
    }])
    statusText.value = `${document.name} — ${document.width} × ${document.height} px`
  } finally {
    previewLayerCountHint = 0
    if (!documentAdopted && layer.image?.previewUrl?.startsWith('blob:')) {
      releasePreparedImage(layer.image.previewUrl)
      URL.revokeObjectURL(layer.image.previewUrl)
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

async function addImportedImages(
  images: ImportedImage[],
  errors: string[] = [],
  makeLayer: (image: ImportedImage) => LayerItem = (image) => createPlacedImageSmartLayer(
    image,
    activeDocument.value,
    imageTransform(image)
  )
) {
  if (images.length) {
    const placedLayers = images.map(makeLayer)
    const importedIds = new Set(placedLayers.map((layer) => layer.id))
    const activeBefore = activeLayerId.value
    const toolBefore = activeTool.value
    const selectionBefore = selection.value
    let inserted = false
    trackLayerAssets(placedLayers)
    previewLayerCountHint = placedLayers.length + layers.value.filter((layer) => layer.visible && layer.image).length
    try {
      for (const [index, layer] of placedLayers.entries()) {
        statusText.value =
          placedLayers.length === 1
            ? 'Otimizando imagem para edição…'
            : `Otimizando imagem ${index + 1} de ${placedLayers.length}…`
        await refreshLayerPreview(layer, true, true, index === 0)
      }

      layers.value = [...placedLayers, ...layers.value]
      inserted = true
      previewLayerCountHint = 0
      activeLayerId.value = placedLayers[0]!.id
      activeTool.value = 'move'
      selection.value = null
      selectionGeneration++
      statusText.value = images.length === 1 ? 'Sincronizando preview…' : 'Sincronizando previews…'
      await nextTick()
      await canvasViewport.value?.waitForLayerImages(placedLayers.map((layer) => ({
        layerId: layer.id,
        source: layer.image?.previewUrl ?? layer.image!.sourceUrl
      })))
      recordHistory(images.length === 1 ? 'Importar imagem' : 'Importar imagens', {
        type: 'layers:add',
        items: placedLayers.map((layer, index) => ({ index, layer: cloneLayerHistoryState(layer) })),
        activeBefore,
        activeAfter: activeLayerId.value
      })
      statusText.value = images.length === 1 ? 'Imagem importada' : `${images.length} imagens importadas`
    } catch (error) {
      previewLayerCountHint = 0
      for (const layer of placedLayers) previewControllers.get(layer.id)?.abort()
      if (inserted) {
        layers.value = layers.value.filter((layer) => !importedIds.has(layer.id))
        activeLayerId.value = activeBefore
        activeTool.value = toolBefore
        selection.value = selectionBefore
        selectionGeneration++
        await nextTick()
      }
      for (const layer of placedLayers) {
        for (const source of [layer.image?.previewUrl, layer.image?.sourceUrl]) {
          if (source) releasePreparedImage(source)
        }
      }
      const failedNativeImageIDs = placedLayers.flatMap(layerNativeImageIDs)
      for (const id of failedNativeImageIDs) trackedNativeImageIDs.delete(id)
      void releaseDesktopImageImports(failedNativeImageIDs)
      collectUnusedObjectUrls()
      throw error
    }
  }

  errorText.value = errors.join('\n')
}

async function addDroppedImages(images: ImportedImage[], errors: string[]) {
  if (imagePlacementActive.value) {
    for (const image of images) releaseUnadoptedImportedImage(image)
    errorText.value = 'Conclua ou cancele o posicionamento das imagens antes de adicionar outros arquivos.'
    return
  }
  if (isBusy.value) {
    for (const image of images) releaseUnadoptedImportedImage(image)
    return
  }
  statusText.value = 'Preparando imagens para posicionamento…'
  await startImagePlacementQueue(images, errors)
}

async function selectWithMagicWand(point: SelectionPoint, combineMode: SelectionCombineMode) {
  if (isBusy.value) return
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if (!layer.visible) {
    showError(new Error('Torne a camada ativa visível antes de usar a Varinha Mágica.'), 'Seleção indisponível.')
    return
  }
  if ((layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) {
    if (layerCanRasterize(layer)) requestLayerRasterization('magic-wand', layer.id)
    else showError(new Error('A varinha mágica precisa de uma camada de imagem ativa.'), 'Seleção indisponível.')
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

async function selectWithQuickSelection(points: SelectionPoint[], combineMode: SelectionCombineMode) {
  if (isBusy.value || !points.length) return
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if (!layer.visible) {
    showError(new Error('Torne a camada ativa visível antes de usar a Seleção Rápida.'), 'Seleção indisponível.')
    return
  }
  if ((layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) {
    if (layerCanRasterize(layer)) requestLayerRasterization('quick-selection', layer.id)
    else showError(new Error('A Seleção Rápida precisa de uma camada rasterizada ativa.'), 'Seleção indisponível.')
    return
  }

  const generation = ++selectionGeneration
  const controller = new AbortController()
  pendingQuickSelection = controller
  const parentSelection = cloneSelection(selection.value)
  const document = { width: activeDocument.value.width, height: activeDocument.value.height }
  pendingSelectionTasks++
  isBusy.value = true
  errorText.value = ''
  statusText.value = 'Analisando o traço e as bordas…'
  try {
    const result = await createQuickSelection(
      layer.id,
      layer.image,
      layer.transform,
      {
        positiveSeeds: points,
        colorTolerance: quickSelectionColorTolerance.value,
        edgeTolerance: quickSelectionEdgeTolerance.value
      },
      controller.signal
    )
    if (generation !== selectionGeneration) return
    quickSelectionResultPreview.value = result
    statusText.value = 'Máscara encontrada · ajustando a seleção…'
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    controller.signal.throwIfAborted()
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
    ) showError(error, 'Não foi possível criar a seleção rápida.')
  } finally {
    if (generation === selectionGeneration) quickSelectionResultPreview.value = null
    if (pendingQuickSelection === controller) pendingQuickSelection = undefined
    pendingSelectionTasks--
    if (pendingSelectionTasks === 0) isBusy.value = false
  }
}

const rasterRequiredToolLabels: Partial<Record<EditorTool, string>> = {
  crop: 'Seleção',
  move: 'Mover pixels',
  brush: 'Pincel',
  eraser: 'Borracha',
  gradient: 'Degradê',
  'paint-bucket': 'Balde de Tinta',
  'magic-wand': 'Varinha Mágica',
  'quick-selection': 'Seleção Rápida'
}

function requestLayerRasterization(tool: EditorTool, layerId = activeLayerId.value) {
  if (isBusy.value || modalOpen.value) return
  const layer = layers.value.find((item) => item.id === layerId)
  const toolLabel = rasterRequiredToolLabels[tool] ?? tool
  if (layer && layerCanRasterize(layer)) rasterizeLayerRequest.value = { layerId: layer.id, toolLabel }
}

function cancelLayerRasterization() {
  if (!isBusy.value) rasterizeLayerRequest.value = undefined
}

async function confirmLayerRasterization() {
  const layerId = rasterizeLayerRequest.value?.layerId
  rasterizeLayerRequest.value = undefined
  if (layerId) await rasterizeLayer(layerId)
}

function setSelectionMode(mode: SelectionMode) {
  cancelMagicWandSelection()
  cancelQuickSelection()
  selectionGeneration++
  selectionMode.value = mode
  if (isMarqueeSelectionMode(mode)) lastMarqueeMode.value = mode
}

function updateSelection(value: SelectionRegion | null) {
  cancelMagicWandSelection()
  cancelQuickSelection()
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
  if ((layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) {
    if (layerCanRasterize(layer)) requestLayerRasterization(activeTool.value, layer.id)
    else showError(new Error('Selecione uma camada de imagem para apagar pixels.'), 'Não foi possível apagar a seleção.')
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
  if ((layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) {
    if (layerCanRasterize(layer)) requestLayerRasterization(activeTool.value, layer.id)
    else showError(new Error('Selecione uma camada de imagem para mover pixels.'), 'Não foi possível mover a seleção.')
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
  if ((layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform || points.length === 0) {
    if (layerCanRasterize(layer)) requestLayerRasterization(operation === 'erase' ? 'eraser' : 'brush', layer.id)
    return false
  }

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
    (layer.kind !== 'background' && layer.kind !== 'pixel') ||
    !layer.image ||
    !layer.transform
  ) {
    if (layerCanRasterize(layer)) requestLayerRasterization('gradient', layer.id)
    return false
  }

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

function commitShape(
  insertionAnchorId: string | undefined,
  geometry: ShapeGeometry,
  config: ShapeToolConfig
) {
  if (isBusy.value) return
  clearFloatingSelectionSession()
  const normalized = normalizeShapeConfig(config)
  const id = crypto.randomUUID()
  const activeBefore = activeLayerId.value
  const selectedBefore = [...selectedLayerIds.value]
  const anchorIndex = insertionAnchorId
    ? layers.value.findIndex((layer) => layer.id === insertionAnchorId)
    : -1
  const insertionIndex = anchorIndex < 0 ? 0 : anchorIndex
  const names: Record<ShapeKind, string> = {
    rectangle: 'Retângulo',
    ellipse: 'Elipse',
    triangle: 'Triângulo',
    star: 'Estrela'
  }
  const layer: LayerItem = {
    id,
    name: names[normalized.kind],
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind: 'shape',
    styles: createLayerStyleConfig(),
    shape: { ...normalized, baseWidth: geometry.width, baseHeight: geometry.height },
    transform: { ...geometry, rotation: 0 }
  }
  layers.value.splice(insertionIndex, 0, layer)
  selectSingleLayer(id)
  editableShapeLayerId.value = id
  recordHistory('Criar forma', {
    type: 'layers:add',
    items: [{ index: insertionIndex, layer: cloneLayerHistoryState(layer) }],
    activeBefore,
    activeAfter: id,
    selectedBefore,
    selectedAfter: [id]
  })
  statusText.value = `${names[normalized.kind]} criado em uma nova camada de forma`
}

async function performPaintBucket(point: SelectionPoint | null, color: string, bucketSelection: SelectionRegion | null, signal: AbortSignal) {
  if (isBusy.value) return false
  clearFloatingSelectionSession()
  const layer = activeLayer.value
  if (!layer.visible || (layer.kind !== 'background' && layer.kind !== 'pixel') || !layer.image || !layer.transform) {
    if (layerCanRasterize(layer)) requestLayerRasterization('paint-bucket', layer.id)
    return false
  }
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

function activateCurrentImagePlacement(session: ImagePlacementSession) {
  let attempts = 0
  const activate = async () => {
    if (imagePlacementSession.value !== session) return
    if (isBusy.value) {
      window.setTimeout(activate, 0)
      return
    }
    await nextTick()
    if (imagePlacementSession.value !== session) return
    const started = canvasViewport.value?.startFreeTransform() ?? false
    if (!started && attempts++ < 10) {
      window.setTimeout(activate, 50)
      return
    }
    if (!started) {
      showError(new Error('A caixa de transformação não pôde ser iniciada.'), 'Não foi possível posicionar a imagem.')
      cancelCurrentImagePlacement()
      return
    }
    statusText.value = `Posicione a imagem e pressione Enter — ${imagePlacementRemaining.value} restante${imagePlacementRemaining.value === 1 ? '' : 's'}`
  }
  window.setTimeout(activate, 0)
}

function releasePlacementLayer(layer: LayerItem) {
  previewControllers.get(layer.id)?.abort()
  previewControllers.delete(layer.id)
  layers.value = layers.value.filter((candidate) => candidate.id !== layer.id)
  for (const source of [layer.image?.sourceUrl, layer.image?.previewUrl]) {
    if (source) releasePreparedImage(source)
  }
  collectUnusedObjectUrls()
}

async function stageNextImagePlacement() {
  const previous = imagePlacementSession.value
  if (!previous) return
  const [image, ...pending] = previous.pending
  if (!image) {
    imagePlacementSession.value = undefined
    statusText.value = 'Todas as imagens foram posicionadas'
    return
  }

  // Remove o item em preparação da lista pendente imediatamente. Assim,
  // Cancelar todas não libera sua fonte enquanto a prévia ainda a decodifica.
  const stagingSession: ImagePlacementSession = {
    ...previous,
    currentLayerId: image.id,
    pending
  }
  imagePlacementSession.value = stagingSession

  isBusy.value = true
  statusText.value = 'Preparando próxima imagem…'
  let layer: LayerItem | undefined
  try {
    layer = createPlacedImageSmartLayer(image, activeDocument.value, imageTransform(image))
    await prepareImportedDocumentLayerAsset(layer, ACTIVE_PREVIEW_PIXELS)
    if (imagePlacementSession.value !== stagingSession) {
      if (layer.image?.previewUrl?.startsWith('blob:')) {
        releasePreparedImage(layer.image.previewUrl)
        URL.revokeObjectURL(layer.image.previewUrl)
      }
      releaseUnadoptedImportedImage(image)
      return
    }
    const session: ImagePlacementSession = {
      currentLayerId: layer.id,
      pending,
      previousActiveLayerId: activeLayerId.value
    }
    layers.value = [layer, ...layers.value]
    trackLayerAssets([layer])
    activeLayerId.value = layer.id
    selectedLayerIds.value = [layer.id]
    layerSelectionAnchorId.value = layer.id
    activeTool.value = 'move'
    imagePlacementSession.value = session
    await nextTick()
    await canvasViewport.value?.waitForLayerImages([{
      layerId: layer.id,
      source: layer.image?.previewUrl ?? layer.image!.sourceUrl
    }])
    activateCurrentImagePlacement(session)
  } catch (error) {
    if (layer?.image?.previewUrl?.startsWith('blob:')) {
      releasePreparedImage(layer.image.previewUrl)
      URL.revokeObjectURL(layer.image.previewUrl)
    }
    releaseUnadoptedImportedImage(image)
    if (imagePlacementSession.value !== stagingSession) return
    showError(error, `Não foi possível preparar ${image.name}. A fila continuará.`)
    imagePlacementSession.value = { ...stagingSession, currentLayerId: '', pending }
    window.setTimeout(() => void stageNextImagePlacement(), 0)
  } finally {
    isBusy.value = false
  }
}

async function startImagePlacementQueue(images: ImportedImage[], errors: string[] = []) {
  errorText.value = errors.join('\n')
  if (!images.length) {
    statusText.value = errors.length ? 'Nenhuma imagem pôde ser adicionada' : 'Adição de imagens cancelada'
    return
  }
  selection.value = null
  selectionGeneration++
  imagePlacementSession.value = {
    currentLayerId: '',
    pending: images,
    previousActiveLayerId: activeLayerId.value
  }
  await stageNextImagePlacement()
}

function confirmCurrentImagePlacement() {
  if (cancellingImagePlacementQueue) return
  const session = imagePlacementSession.value
  if (!session) return
  const layer = layers.value.find((candidate) => candidate.id === session.currentLayerId)
  if (layer?.transform) {
    recordHistory('Posicionar imagem', {
      type: 'layers:add',
      items: [{ index: 0, layer: cloneLayerHistoryState(layer) }],
      activeBefore: session.previousActiveLayerId,
      activeAfter: layer.id
    })
  }
  imagePlacementSession.value = { ...session, currentLayerId: '', pending: session.pending }
  void stageNextImagePlacement()
}

function cancelCurrentImagePlacement() {
  if (cancellingImagePlacementQueue) return
  const session = imagePlacementSession.value
  if (!session) return
  const layer = layers.value.find((candidate) => candidate.id === session.currentLayerId)
  if (layer) releasePlacementLayer(layer)
  activeLayerId.value = layers.value.some((candidate) => candidate.id === session.previousActiveLayerId)
    ? session.previousActiveLayerId
    : layers.value[0]!.id
  selectedLayerIds.value = [activeLayerId.value]
  layerSelectionAnchorId.value = activeLayerId.value
  imagePlacementSession.value = { ...session, currentLayerId: '', pending: session.pending }
  void stageNextImagePlacement()
}

function cancelImagePlacementQueue() {
  const session = imagePlacementSession.value
  if (!session) return
  cancellingImagePlacementQueue = true
  canvasViewport.value?.cancelPendingTransform()
  cancellingImagePlacementQueue = false
  const current = layers.value.find((candidate) => candidate.id === session.currentLayerId)
  if (current) releasePlacementLayer(current)
  for (const image of session.pending) releaseUnadoptedImportedImage(image)
  activeLayerId.value = layers.value.some((candidate) => candidate.id === session.previousActiveLayerId)
    ? session.previousActiveLayerId
    : layers.value[0]!.id
  selectedLayerIds.value = [activeLayerId.value]
  layerSelectionAnchorId.value = activeLayerId.value
  imagePlacementSession.value = undefined
  isBusy.value = false
  statusText.value = 'Fila de posicionamento cancelada'
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

async function requestNewDocument() {
  if (activeSmartLayerEditSession.value) {
    statusText.value = 'Conclua ou cancele a edição da camada inteligente antes de criar outro documento.'
    return
  }
  if (isBusy.value || !await confirmDiscardChanges()) return
  showNewDocumentDialog.value = true
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
    const result = await selectAndRestoreAxiaProject(recentPath)
    if (!result) {
      statusText.value = 'Abertura cancelada'
      return
    }
    const { opened, restored } = result
    openedSessionID = opened.sessionId
    clearSmartLayerRenderCache()
    const restoredImageLayers = restored.layers.filter((layer) => layer.visible && layer.image && layer.transform)
    previewLayerCountHint = restoredImageLayers.length
    zoom.value = restored.view.zoom
    await nextTick()
    if (previewRefreshTimer) {
      clearTimeout(previewRefreshTimer)
      previewRefreshTimer = undefined
    }
    const imageLayers = await prepareRestoredProject(
      restored.layers,
      restored.view.activeLayerId,
      (layer) => refreshSmartLayerSource(layer, true),
      (layer, prioritize) => refreshLayerPreview(layer, true, true, prioritize),
      (status) => { statusText.value = status }
    )
    canvasViewport.value?.commitPendingTransform()
    if (rasterMutationBarrier.isPending) statusText.value = 'Finalizando edição atual…'
    await rasterMutationBarrier.wait()
    await applyPreparedProject(() => {
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
    }, async () => {
      await nextTick()
      await canvasViewport.value?.waitForLayerImages(imageLayers.map((layer) => ({
        layerId: layer.id,
        source: layer.image?.previewUrl ?? layer.image!.sourceUrl
      })))
    })
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

async function canOpenMediaDocument(mediaLabel: string) {
  if (activeSmartLayerEditSession.value) {
    statusText.value = `Conclua ou cancele a edição da camada inteligente antes de abrir ${mediaLabel}.`
    return false
  }
  return !isBusy.value && await confirmDiscardChanges()
}

let pdfImportController: AbortController | undefined
let pdfRerenderController: AbortController | undefined

async function releasePDFSource() {
  const source = pdfImportSource.value
  pdfImportSource.value = null
  if (!source) return
  if (source.id) await releaseDesktopPDF(source.id).catch(() => undefined)
  else if (source.sourceUrl.startsWith('blob:')) URL.revokeObjectURL(source.sourceUrl)
}

/**
 * Transfers the original PDF to a smart layer. Desktop URLs are short-lived,
 * so they are copied to a browser Blob before their native registration is
 * released. Browser-picked files already are Blob URLs and can be adopted.
 */
async function adoptPDFSource(source: PDFImportSource, request: PDFRenderRequest) {
  const pageNumber = request.pages[0]
  const page = pageNumber ? request.pageSizes[pageNumber - 1] : undefined
  if (!page) throw new Error('A página selecionada não está disponível.')

  let sourceUrl = source.sourceUrl
  if (source.id) {
    const response = await fetch(sourceUrl)
    if (!response.ok) throw new Error('Não foi possível preservar o PDF original.')
    const blob = await response.blob()
    sourceUrl = URL.createObjectURL(blob)
    trackedObjectUrls.add(sourceUrl)
  } else {
    // The dialog owns this Blob URL until import succeeds; ownership now moves
    // to the layer so releasePDFSource must not revoke it.
    pdfImportSource.value = null
    trackedObjectUrls.add(sourceUrl)
  }

  return {
    name: source.name,
    sourceUrl,
    byteSize: source.byteSize,
    pageNumber,
    widthPoints: page.widthPoints,
    heightPoints: page.heightPoints,
    background: request.background
  } as const
}

async function handleNativeFileDrop(
  images: ImportedImage[],
  pdf: PDFImportSource | null,
  errors: string[]
) {
  if (isBusy.value || showImportPdfDialog.value || imagePlacementActive.value) {
    for (const image of images) releaseUnadoptedImportedImage(image)
    if (pdf?.id) await releaseDesktopPDF(pdf.id).catch(() => undefined)
    return
  }
  errorText.value = ''
  try {
    if (appScreen.value === 'home') {
      if (!await canOpenMediaDocument('outra mídia')) {
        for (const image of images) releaseUnadoptedImportedImage(image)
        if (pdf?.id) await releaseDesktopPDF(pdf.id).catch(() => undefined)
        return
      }
      if (pdf) {
        pdfImportDestination.value = 'document'
        await releasePDFSource()
        pdfImportSource.value = pdf
        showImportPdfDialog.value = true
        errorText.value = [
          ...errors,
          ...images.map((image) => `${image.name}: abra imagens separadamente do PDF`)
        ].join('\n')
        for (const image of images) releaseUnadoptedImportedImage(image)
        statusText.value = 'PDF pronto para escolher a página'
        return
      }
      const image = images[0]
      if (!image) {
        errorText.value = errors.join('\n')
        return
      }
      isBusy.value = true
      let adopted = false
      try {
        await replaceDocumentWithImportedImage(image, image.name, 'Imagem aberta')
        adopted = true
        const ignored = images.slice(1)
        for (const candidate of ignored) releaseUnadoptedImportedImage(candidate)
        errorText.value = [
          ...errors,
          ...ignored.map((candidate) => `${candidate.name}: abra somente uma imagem por vez na tela inicial`)
        ].join('\n')
      } finally {
        if (!adopted) for (const candidate of images) releaseUnadoptedImportedImage(candidate)
        isBusy.value = false
      }
      return
    }
    if (images.length || errors.length) {
      await addDroppedImages(images, [
        ...errors,
        ...(pdf ? [`${pdf.name}: adicione PDFs separadamente das imagens`] : [])
      ])
      if (pdf?.id) await releaseDesktopPDF(pdf.id).catch(() => undefined)
      return
    }
    if (!pdf) return
    pdfImportDestination.value = 'layer'
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
  statusText.value = pdfImportDestination.value === 'document' ? 'PDF pronto para abrir' : 'PDF pronto para adicionar'
}

async function readLocalPDF(input: HTMLInputElement) {
  const file = input.files?.[0]
  input.value = ''
  if (file) await openLocalPDF(file)
}

async function openDroppedPDF(file: File, errors: string[]) {
  if (isBusy.value || showImportPdfDialog.value) return
  if (imagePlacementActive.value) {
    errorText.value = 'Conclua ou cancele o posicionamento das imagens antes de adicionar um PDF.'
    return
  }
  pdfImportDestination.value = 'layer'
  await openLocalPDF(file)
  if (errors.length) errorText.value = errors.join('\n')
}

async function openHomeDroppedFiles(files: File[]) {
  if (!files.length || !await canOpenMediaDocument('outra mídia')) return
  const pdfs = files.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
  if (pdfs.length) {
    pdfImportDestination.value = 'document'
    await openLocalPDF(pdfs[0]!)
    errorText.value = [
      ...pdfs.slice(1).map((file) => `${file.name}: abra somente um PDF por vez`),
      ...files.filter((file) => !pdfs.includes(file)).map((file) => `${file.name}: abra imagens separadamente do PDF`)
    ].join('\n')
    return
  }

  isBusy.value = true
  statusText.value = 'Abrindo imagem como documento…'
  let image: ImportedImage | undefined
  let adopted = false
  try {
    const result = await readBrowserImages([files[0]!])
    image = result.images[0]
    if (!image) throw new Error(result.errors[0] || 'A imagem não pôde ser lida.')
    await replaceDocumentWithImportedImage(image, image.name, 'Imagem aberta')
    adopted = true
    errorText.value = [
      ...result.errors,
      ...files.slice(1).map((candidate) => `${candidate.name}: abra somente uma imagem por vez na tela inicial`)
    ].join('\n')
  } catch (error) {
    showError(error, 'Não foi possível abrir a imagem como documento.')
  } finally {
    if (!adopted) releaseUnadoptedImportedImage(image)
    isBusy.value = false
  }
}

async function cancelPDFImport() {
  if (isBusy.value && pdfImportController) {
    pdfImportProgress.value = 'Cancelando processamento…'
    pdfImportController.abort()
    return
  }
  if (isBusy.value) return
  const wasOpeningDocument = pdfImportDestination.value === 'document'
  showImportPdfDialog.value = false
  pdfImportProgress.value = ''
  await releasePDFSource()
  pdfImportDestination.value = 'layer'
  statusText.value = wasOpeningDocument ? 'Abertura de PDF cancelada' : 'Adição de PDF cancelada'
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
    if (pdfImportDestination.value === 'document') {
      const image = images[0]
      if (!image) throw new Error('A página selecionada não gerou uma imagem.')
      pdfImportProgress.value = 'Criando documento com a página…'
      let adopted = false
      try {
        await replaceDocumentWithImportedImage(
          image,
          pdfImportSource.value?.name ?? request.name,
          'PDF aberto',
          request.background
        )
        adopted = true
      } finally {
        if (!adopted) releaseUnadoptedImportedImage(image)
      }
    } else {
      pdfImportProgress.value = 'Adicionando página ao documento…'
      const source = pdfImportSource.value
      if (!source) throw new Error('O arquivo PDF original não está mais disponível.')
      const pdf = await adoptPDFSource(source, request)
      await addImportedImages(images, [], (image) => createPlacedPDFSmartLayer(
        image,
        pdf,
        activeDocument.value,
        imageTransform(image)
      ))
    }
    showImportPdfDialog.value = false
    await releasePDFSource()
    statusText.value = pdfImportDestination.value === 'document'
      ? 'PDF aberto como documento'
      : 'Página do PDF importada como camada inteligente'
  } catch (error) {
    showImportPdfDialog.value = false
    await releasePDFSource()
    if (error instanceof DOMException && error.name === 'AbortError') {
      statusText.value = pdfImportDestination.value === 'document' ? 'Abertura de PDF cancelada' : 'Adição de PDF cancelada'
    } else {
      showError(
        error,
        pdfImportDestination.value === 'document'
          ? 'Não foi possível abrir a página do PDF como documento.'
          : 'Não foi possível adicionar a página do PDF.'
      )
    }
  } finally {
    await closePDFImport(request.document).catch(() => undefined)
    pdfImportController = undefined
    pdfImportProgress.value = ''
    pdfImportDestination.value = 'layer'
    isBusy.value = false
  }
}

function openPDFRerenderDialog() {
  if (isBusy.value || modalOpen.value) return
  const layer = activeLayer.value
  if (layer.kind !== 'smart' || !layer.smart?.pdf) {
    errorText.value = 'Selecione uma camada inteligente criada a partir de um PDF.'
    return
  }
  pdfRerenderError.value = ''
  pdfRerenderProgress.value = ''
  pdfRerenderLayerId.value = layer.id
}

function cancelPDFRerender() {
  if (isBusy.value && pdfRerenderController) {
    pdfRerenderProgress.value = 'Cancelando processamento…'
    pdfRerenderController.abort()
    return
  }
  if (isBusy.value) return
  pdfRerenderLayerId.value = undefined
  pdfRerenderError.value = ''
  pdfRerenderProgress.value = ''
}

async function performPDFRerender(request: { dpi: number; password: string }) {
  const layerId = pdfRerenderLayerId.value
  const layer = layers.value.find((item) => item.id === layerId)
  if (isBusy.value || !layer || layer.kind !== 'smart' || !layer.smart?.pdf) return

  const before = cloneSmartLayerContent(layer.smart)
  if (!before?.pdf) return
  let document: Awaited<ReturnType<typeof openPDFImport>>['document'] | undefined
  let cacheImage: ImportedImage | undefined
  let applied = false
  isBusy.value = true
  errorText.value = ''
  pdfRerenderError.value = ''
  pdfRerenderProgress.value = 'Abrindo o PDF original…'
  statusText.value = pdfRerenderProgress.value
  pdfRerenderController = new AbortController()
  try {
    const opened = await openPDFImport(before.pdf.sourceUrl, request.password, pdfRerenderController.signal)
    document = opened.document
    const page = opened.pages.find((item) => item.pageNumber === before.pdf!.pageNumber)
    if (!page) throw new Error(`A página ${before.pdf.pageNumber} não está disponível no PDF original.`)

    pdfRerenderProgress.value = `Renderizando página em ${request.dpi} DPI…`
    statusText.value = pdfRerenderProgress.value
    const images = await renderPDFPages({
      background: before.pdf.background,
      document,
      dpi: request.dpi,
      name: before.pdf.name,
      pages: [before.pdf.pageNumber],
      pageSizes: opened.pages
    }, pdfRerenderController.signal)
    cacheImage = images[0]
    if (!cacheImage) throw new Error('A página do PDF não gerou uma imagem.')
    if (!layers.value.includes(layer)) throw new Error('A camada não está mais disponível.')

    layer.smart = replacePDFSmartLayerCache(before, cacheImage)
    layer.image = undefined
    applied = true
    trackLayerAssets([layer])
    pdfRerenderProgress.value = 'Atualizando a visualização da camada…'
    statusText.value = pdfRerenderProgress.value
    await refreshSmartLayerSource(layer)
    recordHistory(`Re-renderizar PDF em ${request.dpi} DPI`, {
      type: 'layer:patch',
      layerId: layer.id,
      before: cloneLayerPatch({ smart: before }),
      after: cloneLayerPatch({ smart: layer.smart })
    })
    cacheImage = undefined
    pdfRerenderLayerId.value = undefined
    statusText.value = `PDF re-renderizado em ${request.dpi} DPI`
  } catch (error) {
    if (applied) {
      layer.smart = before
      layer.image = undefined
      try { await refreshSmartLayerSource(layer) } catch { /* mantém o cache anterior se possível */ }
    }
    if (cacheImage) {
      releaseUnadoptedImportedImage(cacheImage)
      trackedObjectUrls.delete(cacheImage.sourceUrl)
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      pdfRerenderLayerId.value = undefined
      statusText.value = 'Re-renderização do PDF cancelada'
    } else {
      pdfRerenderError.value = error instanceof Error && error.message
        ? error.message
        : 'Não foi possível re-renderizar a página do PDF.'
      statusText.value = 'Não foi possível re-renderizar o PDF'
    }
  } finally {
    if (document) await closePDFImport(document).catch(() => undefined)
    pdfRerenderController = undefined
    pdfRerenderProgress.value = ''
    isBusy.value = false
  }
}

/**
 * Cria uma versão temporária de alta resolução para a exportação. Não toca no
 * cache de trabalho nem no histórico: ao terminar, todos os URLs temporários
 * são liberados e a camada exibida continua exatamente como estava.
 */
async function preparePDFSmartLayerForExport(layer: LayerItem, outputScale: number) {
  const content = cloneSmartLayerContent(layer.smart)
  if (layer.kind !== 'smart' || !content?.pdf) {
    throw new Error('A camada PDF não possui a origem necessária para exportação.')
  }

  const pdf = content.pdf
  const pageDescriptor = {
    pageNumber: pdf.pageNumber,
    widthPoints: pdf.widthPoints,
    heightPoints: pdf.heightPoints
  }
  const maximumDpi = maximumPDFImportDPI(pageDescriptor)
  if (!maximumDpi) {
    throw new Error('A página PDF excede o limite seguro mesmo na menor resolução de exportação.')
  }
  const sourceDpi = Math.max(1, Math.round(content.resolutionDpi))
  const requestedDpi = normalizePDFDPI(sourceDpi * Math.max(1, outputScale))
  // O limite protege o pico de memória de um canvas único. Enquanto mosaicos
  // não existem, a melhor saída é usar o maior raster seguro do PDF, em vez de
  // voltar ao cache de baixa resolução ou falhar a exportação inteira.
  const exportDpi = Math.min(requestedDpi, maximumDpi)

  let document: Awaited<ReturnType<typeof openPDFImport>>['document'] | undefined
  let cacheImage: ImportedImage | undefined
  let sourceUrl: string | undefined
  try {
    statusText.value = `Renderizando “${layer.name}” a partir do PDF original…`
    const opened = await openPDFImport(pdf.sourceUrl)
    document = opened.document
    if (!opened.pages.some((page) => page.pageNumber === pdf.pageNumber)) {
      throw new Error(`A página ${pdf.pageNumber} não está disponível no PDF original.`)
    }
    const images = await renderPDFPages({
      background: pdf.background,
      document,
      dpi: exportDpi,
      name: pdf.name,
      pages: [pdf.pageNumber],
      pageSizes: opened.pages
    }, new AbortController().signal)
    cacheImage = images[0]
    if (!cacheImage) throw new Error('A página do PDF não gerou uma imagem para exportação.')

    const exportContent = replacePDFSmartLayerCache(content, cacheImage)
    const rendered = await renderSmartLayer({
      consumerId: `export-pdf:${activeDocument.value.id}:${layer.id}`,
      content: exportContent,
      quality: 'final'
    })
    sourceUrl = URL.createObjectURL(rendered.blob)
    const exportedLayer = cloneLayerState(layer)
    exportedLayer.smart = exportContent
    exportedLayer.image = {
      width: rendered.width,
      height: rendered.height,
      mimeType: 'image/png',
      sourceUrl,
      byteSize: rendered.blob.size,
      editToken: rendered.cacheKey
    }
    releasePreparedImage(cacheImage.sourceUrl)
    URL.revokeObjectURL(cacheImage.sourceUrl)
    cacheImage = undefined

    return {
      layer: exportedLayer,
      dispose: () => {
        if (!sourceUrl) return
        releasePreparedImage(sourceUrl)
        URL.revokeObjectURL(sourceUrl)
      }
    }
  } finally {
    if (cacheImage) {
      releasePreparedImage(cacheImage.sourceUrl)
      URL.revokeObjectURL(cacheImage.sourceUrl)
    }
    if (document) await closePDFImport(document).catch(() => undefined)
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

  // A fila usa Enter/Esc dentro do Canvas para confirmar ou cancelar o item
  // atual. Todos os demais atalhos ficam suspensos para que nenhuma ação
  // altere o documento enquanto a camada ainda não pertence ao histórico.
  if (imagePlacementActive.value) {
    if (event.key !== 'Enter' && event.key !== 'Escape') event.preventDefault()
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
    const tool = intelligentSelectionToolForShortcut(event.shiftKey)
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
    u: 'shape',
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
let unregisterLayerStyleWindowHost: (() => void) | undefined

onMounted(async () => {
  window.addEventListener('wheel', blockBrowserWheelZoom, zoomEventOptions)
  window.addEventListener('keydown', handleShortcut)
  window.addEventListener('beforeunload', protectUnsavedDocument)
  unregisterNativeFileDrop = registerNativeFileDrop(handleNativeFileDrop)
  if (nativeLayerStyleWindowEnabled) {
    unregisterLayerStyleWindowHost = registerLayerStyleWindowHost({
      apply: applyNativeLayerStyles,
      cancel: cancelNativeLayerStyles,
      closed: cancelLayerStyles,
      preview: previewNativeLayerStyles,
      ready: resendLayerStyleWindowSession
    })
  }

  void refreshLayerStylePresets().catch(() => {
    layerStylePresets.value = []
  })
  try {
    const [status] = await Promise.all([getEditorStatus(), refreshRecentProjects()])
    statusText.value = `${status.appName} — ${status.engine}`
  } catch (error) {
    showError(error, 'Editor iniciado com recursos locais.')
  }
})

onBeforeUnmount(() => {
  unregisterNativeFileDrop?.()
  unregisterLayerStyleWindowHost?.()
  pdfImportController?.abort()
  pdfRerenderController?.abort()
  void releasePDFSource()
  if (previewRefreshTimer) clearTimeout(previewRefreshTimer)
  pendingBrushCommit?.controller.abort()
  pendingBrushCommit = undefined
  pendingGradientCommit?.abort()
  pendingGradientCommit = undefined
  pendingPaintBucketCommit?.abort()
  pendingPaintBucketCommit = undefined
  cancelMagicWandSelection()
  cancelQuickSelection()
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
      @files-dropped="openHomeDroppedFiles"
      @new-document="requestNewDocument"
      @open-image-document="openImageAsDocument"
      @open-pdf-document="openPDFAsDocument"
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
      :can-clear-layer-styles="canClearActiveLayerStyles"
      :can-duplicate-layer="Boolean(activeLayer.image || activeLayer.text || activeLayer.shape)"
      :can-edit-smart-layer="activeLayer.kind === 'smart'"
      :can-fill-layer="activeLayer.visible && ['background', 'pixel'].includes(activeLayer.kind) && Boolean(activeLayer.image && activeLayer.transform)"
      :can-flatten-image="canFlattenImage"
      :can-merge-layers="selectedLayerIds.length > 1"
      :can-paste-layer-styles="canPasteActiveLayerStyles"
      :can-rasterize-layer="layerCanRasterize(activeLayer)"
      :can-rerender-pdf-layer="activeLayer.kind === 'smart' && Boolean(activeLayer.smart?.pdf)"
      :can-scale-layer-effects="canScaleActiveLayerEffects"
      :can-redo="canRedo"
      :can-undo="canUndo"
      :document-dirty="documentDirty"
      :document-name="activeDocument.name"
      :has-selection="Boolean(selection)"
      :history-bytes="historyBytes"
      :history-items="historyItems"
      :history-position="historyPosition"
      :is-busy="isBusy || imagePlacementActive"
      :redo-label="redoLabel"
      :status-text="statusText"
      :style-target-count="activeStyleTargetLayers.length"
      :undo-label="undoLabel"
      @add-layer="addLayer"
      @clear-selection="updateSelection(null)"
      @clear-layer-styles="clearLayerStyles()"
      @convert-to-smart-layer="convertSelectedLayersToSmart"
      @copy-layer-styles="copyLayerStyles()"
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
      @open-style-presets="openLayerStylePresets()"
      @open-image-document="openImageAsDocument"
      @open-pdf-document="openPDFAsDocument"
      @open-project="openProject"
      @paste-layer-styles="pasteLayerStyles()"
      @rasterize-layer="rasterizeLayer()"
      @rerender-pdf-layer="openPDFRerenderDialog"
      @scale-layer-effects="openScaleLayerEffects()"
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
      ref="documentImageInput"
      accept="image/png,image/jpeg,image/gif"
      class="visually-hidden"
      type="file"
      @change="readLocalImageDocument($event.target as HTMLInputElement)"
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
      <div v-if="imagePlacementActive" class="image-placement-banner" role="status">
        <span>Posicionando imagens · {{ imagePlacementRemaining }} restante{{ imagePlacementRemaining === 1 ? '' : 's' }}</span>
        <button type="button" @click="cancelImagePlacementQueue">Cancelar todas</button>
      </div>
      <header v-if="activeSmartLayerEditSession" class="smart-edit-bar">
        <div class="smart-edit-context">
          <strong>Objeto inteligente</strong>
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
        :inert="imagePlacementActive || undefined"
        v-model:active-tool="activeTool"
        v-model:background-color="backgroundColor"
        v-model:foreground-color="brushColor"
        :selection-mode="selectionMode"
        :shape-kind="shapeConfig.kind"
        @tool-double-click="handleToolDoubleClick"
        @update-selection-mode="setSelectionMode"
        @update-shape-kind="updateShapeKind"
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
        :shape-config="shapeConfig"
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
        :quick-selection-color-tolerance="quickSelectionColorTolerance"
        :quick-selection-edge-tolerance="quickSelectionEdgeTolerance"
        :paint-bucket-contiguous="paintBucketContiguous"
        :paint-bucket-tolerance="paintBucketTolerance"
        :quick-selection-result-preview="quickSelectionResultPreview"
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
        @quick-selection="selectWithQuickSelection"
        @cancel-intelligent-selection="cancelIntelligentSelection"
        @move-selection="commitSelectionMove"
        @paint-stroke="commitBrushStroke"
        @gradient-gesture="commitGradient"
        @shape-gesture="commitShape"
        @paint-bucket="commitPaintBucket"
        @request-layer-rasterization="requestLayerRasterization"
        @update:gradient-config="gradientConfig = $event"
        @update:shape-config="updateShapeConfig"
        @update:shape-editing="shapeDraftEditing = $event"
        @update:brush-color="brushColor = $event"
        @update:brush-size="brushSize = $event"
        @sample-color="sampleColor"
        @update-guide="updateGuide"
        @create-text="addTextLayer($event.point, $event.paragraphWidth)"
        @commit-text-edit="updateTextLayer($event.layerId, { content: $event.content })"
        @select-layer="selectSingleLayer"
        @move-layers="moveLayerTransforms"
        @transform-cancelled="cancelCurrentImagePlacement"
        @transform-committed="confirmCurrentImagePlacement"
        @update:magic-wand-contiguous="magicWandContiguous = $event"
        @update:magic-wand-tolerance="magicWandTolerance = $event"
        @update:quick-selection-color-tolerance="quickSelectionColorTolerance = $event"
        @update:quick-selection-edge-tolerance="quickSelectionEdgeTolerance = $event"
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

      <aside class="side-panels" :inert="imagePlacementActive || undefined" aria-label="Painéis do documento">
        <PropertiesPanel
          :active-layer="activeLayer"
          :active-tool="activeTool"
          :active-tab="inspectorTab"
          :zoom="zoom"
          @update:active-tab="inspectorTab = $event"
          @update:text="updateTextLayer(activeLayer.id, $event)"
          @update:zoom="setZoom"
        >
          <template #styles>
            <LayerStylesPanel
              :busy="isBusy"
              :layer-name="activeLayer.name"
              :presets="layerStylePresets"
              :target-count="layerStylePresetsTargetCount"
              @apply="applySavedLayerStylePreset"
              @delete="deleteSavedLayerStylePreset"
              @save="saveCurrentLayerStylePreset"
            />
          </template>
        </PropertiesPanel>

        <LayersPanel
          :active-layer-id="activeLayerId"
          :copied-layer-styles="copiedLayerStyles"
          :document-background="activeDocument.background"
          :layers="layers"
          :layer-style-global-light="activeDocument.layerStyleGlobalLight"
          :selected-layer-ids="selectedLayerIds"
          @add-layer="addLayer"
          @convert-to-smart-layer="convertSelectedLayersToSmart"
          @clear-layer-styles="clearLayerStyles"
          @copy-layer-styles="copyLayerStyles"
          @delete-layer="deleteLayer"
          @duplicate-layer="duplicateLayer"
          @edit-smart-layer="editSmartLayerContent"
          @export-layer="exportLayerPNG"
          @move-layer="moveLayer"
          @merge-layers="mergeSelectedLayers"
          @open-layer-styles="openLayerStyles"
          @open-layer-style-effect="openLayerStyles"
          @open-style-presets="openLayerStylePresets"
          @paste-layer-styles="pasteLayerStyles"
          @rasterize-layer="rasterizeLayer"
          @scale-layer-effects="openScaleLayerEffects"
          @rename-layer="renameLayer"
          @reorder-layer="reorderLayer"
          @select-layer="selectLayerFromPanel"
          @toggle-layer="toggleLayer"
          @toggle-layer-effect="toggleLayerEffectVisibility"
          @toggle-layer-style="toggleLayerStyleVisibility"
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
      :destination="pdfImportDestination"
      :open="showImportPdfDialog"
      :progress="pdfImportProgress"
      :source="pdfImportSource"
      @cancel="cancelPDFImport"
      @import="performPDFImport"
    />
    <PDFRerenderDialog
      :busy="isBusy"
      :error="pdfRerenderError"
      :open="Boolean(pdfRerenderLayerId)"
      :progress="pdfRerenderProgress"
      :source="layers.find((layer) => layer.id === pdfRerenderLayerId)?.smart?.pdf"
      @cancel="cancelPDFRerender"
      @rerender="performPDFRerender"
    />
    <LayerStyleDialog
      v-if="!nativeLayerStyleWindowEnabled || nativeLayerStyleDialogFallback"
      :global-light="layerStyleDialog?.beforeGlobalLight ?? activeDocument.layerStyleGlobalLight"
      :initial-category="layerStyleDialog?.initialEffectType"
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
    <RasterizeLayerDialog
      :busy="isBusy"
      :layer-name="layers.find((layer) => layer.id === rasterizeLayerRequest?.layerId)?.name ?? ''"
      :open="Boolean(rasterizeLayerRequest)"
      :tool-label="rasterizeLayerRequest?.toolLabel ?? ''"
      @cancel="cancelLayerRasterization"
      @confirm="confirmLayerRasterization"
    />
    <ScaleLayerEffectsDialog
      :busy="isBusy"
      :layer-name="scaleLayerEffectsLabel"
      :open="Boolean(scaleLayerEffectsSession)"
      @cancel="cancelScaleLayerEffects"
      @confirm="applyScaleLayerEffects"
      @preview="previewScaleLayerEffects"
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

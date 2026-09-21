import type { Ref } from 'vue'
import { createEditorDocument, releaseAxiaProjectAssets } from '../services/backend'
import { documentPixelSize } from '../editor/document'
import { canCreateDocument } from '../editor/interactionGuards'
import type { EditorGuide, RulerOrigin } from '../editor/guides'
import type { DocumentSpec, EditorTool, LayerItem, NewDocumentSettings } from '../types/editor'
import type { SelectionRegion } from '../editor/selection'

interface DocumentCreationOptions {
  activeDocument: Ref<DocumentSpec>
  activeLayerId: Ref<string>
  activeTool: Ref<EditorTool>
  appScreen: Ref<'home' | 'editor'>
  createBackgroundLayer: () => LayerItem
  ensureRasterLayerPaintable: () => Promise<void>
  errorText: Ref<string>
  guides: Ref<EditorGuide[]>
  hasOpenDocument: Ref<boolean>
  historyClear: (label: string) => void
  isBusy: Ref<boolean>
  layerSelectionAnchorId: Ref<string>
  layers: Ref<LayerItem[]>
  materializeRasterLayer: (layer: LayerItem, width: number, height: number, background: DocumentSpec['background']) => Promise<unknown>
  previewGenerations: Map<string, number>
  projectPath: Ref<string>
  refreshLayerPreview: (layer: LayerItem, force?: boolean, allowDeferred?: boolean, immediate?: boolean) => Promise<void>
  releaseAllEditorAssets: () => void
  rulerOrigin: Ref<RulerOrigin>
  savedHistoryRevision: Ref<number | null>
  selectedLayerIds: Ref<string[]>
  selection: Ref<SelectionRegion | null>
  selectionGeneration: () => void
  showNewDocumentDialog: Ref<boolean>
  showError: (error: unknown, fallback: string) => void
  statusText: Ref<string>
  zoom: Ref<number>
}

/** Creates a fresh document and replaces the current editor state atomically. */
export function useDocumentCreation(options: DocumentCreationOptions) {
  async function createDocument(settings: NewDocumentSettings) {
    if (!canCreateDocument(options.isBusy.value)) return
    options.errorText.value = ''
    options.isBusy.value = true
    try {
      const pixels = documentPixelSize(settings)
      const document = await createEditorDocument(settings, pixels.width, pixels.height)
      options.releaseAllEditorAssets()
      await releaseAxiaProjectAssets()
      options.historyClear('Documento criado')
      options.previewGenerations.clear()
      options.selection.value = null
      options.selectionGeneration()
      options.activeDocument.value = document
      options.guides.value = []
      options.rulerOrigin.value = { x: 0, y: 0 }
      const baseLayer = options.createBackgroundLayer()
      options.layers.value = [baseLayer]
      options.activeLayerId.value = 'layer-bg'
      options.selectedLayerIds.value = ['layer-bg']
      options.layerSelectionAnchorId.value = 'layer-bg'
      options.zoom.value = 100
      await options.materializeRasterLayer(baseLayer, document.width, document.height, document.background)
      await options.refreshLayerPreview(baseLayer, true, false, true)
      options.projectPath.value = ''
      options.savedHistoryRevision.value = null
      options.showNewDocumentDialog.value = false
      options.hasOpenDocument.value = true
      options.appScreen.value = 'editor'
      options.statusText.value = `${document.name} — ${document.width} × ${document.height} px`
    } catch (error) {
      options.showError(error, 'Não foi possível criar o documento.')
    } finally {
      options.isBusy.value = false
      if (['brush', 'eraser', 'gradient', 'paint-bucket'].includes(options.activeTool.value)) {
        void options.ensureRasterLayerPaintable()
      }
    }
  }

  return { createDocument }
}

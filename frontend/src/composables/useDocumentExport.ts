import { ref, shallowRef, type Ref } from 'vue'
import { layerCanExportPNG, quickLayerExportName } from '../editor/layerExport'
import type { ExportSettings } from '../editor/exportSettings'
import { saveExportedImageBlob } from '../services/backend'
import { pngBlobWithResolution } from '../services/pngMetadata'
import { renderDocumentExportBlob, renderLayerAppearance } from '../services/renderDocument'
import type { DocumentSpec, LayerItem } from '../types/editor'

interface DocumentExportOptions {
  activeDocument: Ref<DocumentSpec>
  activeLayerId: Ref<string>
  errorText: Ref<string>
  isBusy: Ref<boolean>
  layers: Ref<LayerItem[]>
  refreshSmartLayerSource: (layer: LayerItem) => Promise<void>
  settleRasterMutation: (status: string) => Promise<boolean>
  showError: (error: unknown, fallback: string) => void
  statusText: Ref<string>
}

/** Owns the export dialog and export-only transient state for the current document. */
export function useDocumentExport(options: DocumentExportOptions) {
  const showExportImageDialog = ref(false)
  const exportEstimateBusy = ref(false)
  const exportEstimatedBytes = ref<number | null>(null)
  const preparedExport = shallowRef<{ key: string; blob: Blob } | null>(null)
  let exportEstimateGeneration = 0

  function exportSettingsKey(settings: ExportSettings) {
    return JSON.stringify(settings)
  }

  function clearExportEstimate() {
    exportEstimateGeneration += 1
    exportEstimateBusy.value = false
    exportEstimatedBytes.value = null
    preparedExport.value = null
  }

  function exportDocument() {
    if (options.isBusy.value) return
    clearExportEstimate()
    showExportImageDialog.value = true
  }

  async function createDocumentExportBlob(settings: ExportSettings) {
    if (!await options.settleRasterMutation('Finalizando edição antes de exportar…')) return null
    const documentId = options.activeDocument.value.id
    const exportLayers = options.layers.value.slice()
    for (const layer of exportLayers) {
      if (layer.visible && layer.kind === 'smart') await options.refreshSmartLayerSource(layer)
    }
    if (
      options.activeDocument.value.id !== documentId || options.layers.value.length !== exportLayers.length ||
      exportLayers.some((layer, index) => options.layers.value[index] !== layer)
    ) throw new Error('O documento foi alterado durante a exportação.')
    return renderDocumentExportBlob(options.activeDocument.value, exportLayers, settings)
  }

  async function estimateDocumentExport(settings: ExportSettings) {
    if (options.isBusy.value || exportEstimateBusy.value) return
    const generation = ++exportEstimateGeneration
    exportEstimateBusy.value = true
    options.errorText.value = ''
    try {
      const blob = await createDocumentExportBlob(settings)
      if (!blob || generation !== exportEstimateGeneration || !showExportImageDialog.value) return
      preparedExport.value = { key: exportSettingsKey(settings), blob }
      exportEstimatedBytes.value = blob.size
    } catch (error) {
      options.showError(error, 'Não foi possível calcular o tamanho do arquivo.')
    } finally {
      if (generation === exportEstimateGeneration) exportEstimateBusy.value = false
    }
  }

  async function performDocumentExport(settings: ExportSettings) {
    if (options.isBusy.value) return
    options.errorText.value = ''
    options.isBusy.value = true
    options.statusText.value = `Preparando ${settings.format.toUpperCase()}…`
    try {
      const key = exportSettingsKey(settings)
      const cached = preparedExport.value?.key === key ? preparedExport.value.blob : null
      const blob = cached ?? await createDocumentExportBlob(settings)
      if (!blob) return
      const cleanName = options.activeDocument.value.name.replace(/\.[^.]+$/, '').trim() || 'imagem'
      const path = await saveExportedImageBlob(cleanName, settings.format, blob)
      options.statusText.value = path
        ? `${settings.format.toUpperCase()} exportado (${(blob.size / (1024 * 1024)).toFixed(2)} MB): ${path}`
        : 'Exportação cancelada'
      showExportImageDialog.value = false
      clearExportEstimate()
    } catch (error) {
      options.showError(error, 'Não foi possível exportar o documento.')
    } finally {
      options.isBusy.value = false
    }
  }

  async function exportLayerPNG(layerId = options.activeLayerId.value) {
    if (options.isBusy.value) return
    const layer = options.layers.value.find((item) => item.id === layerId)
    if (!layer || !layerCanExportPNG(layer, options.activeDocument.value.background)) {
      options.showError(new Error('A camada não possui conteúdo visual exportável.'), 'Não foi possível exportar a camada.')
      return
    }

    options.isBusy.value = true
    options.errorText.value = ''
    options.statusText.value = `Preparando PNG de ${layer.name}…`
    try {
      if (!await options.settleRasterMutation('Finalizando edição antes de exportar…')) return
      const documentId = options.activeDocument.value.id
      if (layer.kind === 'smart') await options.refreshSmartLayerSource(layer)
      if (options.activeDocument.value.id !== documentId || !options.layers.value.includes(layer)) {
        throw new Error('A camada original não está mais disponível.')
      }
      const appearance = await renderLayerAppearance(options.activeDocument.value, layer, 'isolated-export')
      const filename = quickLayerExportName(options.activeDocument.value.name, layer.name)
      const pngBlob = await pngBlobWithResolution(appearance.blob, options.activeDocument.value.resolutionDpi)
      const path = await saveExportedImageBlob(filename, 'png', pngBlob)
      options.statusText.value = path ? `Camada exportada: ${path}` : 'Exportação cancelada'
    } catch (error) {
      options.showError(error, 'Não foi possível exportar a camada como PNG.')
    } finally {
      options.isBusy.value = false
    }
  }

  return {
    clearExportEstimate,
    estimateDocumentExport,
    exportDocument,
    exportEstimatedBytes,
    exportEstimateBusy,
    exportLayerPNG,
    performDocumentExport,
    showExportImageDialog
  }
}

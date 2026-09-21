import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { layerCanPasteStyle, pastedLayerStyleChanges, type LayerStyleTargetChange } from '../editor/layerStyleOperations'
import {
  deleteLayerStylePreset,
  listLayerStylePresets,
  presetStyles,
  saveLayerStylePreset as persistLayerStylePreset,
  type LayerStylePreset
} from '../editor/layerStylePresets'
import type { LayerItem } from '../types/editor'

interface LayerStylePresetActionsOptions {
  activeLayer: ComputedRef<LayerItem>
  activeLayerId: Ref<string>
  commitLayerStyleChanges: (label: string, changes: LayerStyleTargetChange[]) => boolean
  hasLayer: (layerId: string) => boolean
  isBusy: Ref<boolean>
  inspectorTab: Ref<'properties' | 'styles'>
  layerStylePresets: ShallowRef<LayerStylePreset[]>
  modalOpen: ComputedRef<boolean>
  selectSingleLayer: (layerId: string) => void
  selectedLayerIds: Ref<string[]>
  showError: (error: unknown, fallback: string) => void
  statusText: Ref<string>
  styleTargetLayers: (layerId?: string) => LayerItem[]
}

/** Persists and applies reusable layer-style presets without owning style editing state. */
export function useLayerStylePresets(options: LayerStylePresetActionsOptions) {
  async function refreshLayerStylePresets() {
    options.layerStylePresets.value = await listLayerStylePresets()
  }

  function openLayerStylePresets(layerId = options.activeLayerId.value) {
    if (options.isBusy.value || options.modalOpen.value) return
    if (!options.hasLayer(layerId)) return
    if (!options.selectedLayerIds.value.includes(layerId)) options.selectSingleLayer(layerId)
    else options.activeLayerId.value = layerId
    options.inspectorTab.value = 'styles'
  }

  async function saveCurrentLayerStylePreset(name: string) {
    const layer = options.activeLayer.value
    if (!layer || options.isBusy.value) return
    options.isBusy.value = true
    try {
      await persistLayerStylePreset(name, layer.styles)
      await refreshLayerStylePresets()
      options.statusText.value = `Estilo “${name.trim()}” salvo`
    } catch (error) {
      options.showError(error, 'Não foi possível salvar o estilo.')
    } finally {
      options.isBusy.value = false
    }
  }

  async function applySavedLayerStylePreset(id: string) {
    const targets = options.styleTargetLayers()
    const preset = options.layerStylePresets.value.find((item) => item.id === id)
    if (!targets.length || !preset || options.isBusy.value) return
    const styles = presetStyles(preset)
    if (targets.some((layer) => !layerCanPasteStyle(layer, styles))) {
      options.showError(
        new Error('Rasterize as camadas incompatíveis antes de aplicar este estilo.'),
        'Uma ou mais camadas selecionadas não aceitam este estilo.'
      )
      return
    }
    const changes = pastedLayerStyleChanges(targets, styles)
    if (!options.commitLayerStyleChanges(targets.length === 1 ? 'Aplicar estilo salvo' : 'Aplicar estilo nas camadas', changes)) {
      options.statusText.value = targets.length === 1 ? 'A camada já possui esse estilo' : 'As camadas já possuem esse estilo'
      return
    }
    options.statusText.value = changes.length === 1
      ? `Estilo “${preset.name}” aplicado`
      : `Estilo “${preset.name}” aplicado em ${changes.length} camadas`
  }

  async function deleteSavedLayerStylePreset(id: string) {
    if (options.isBusy.value) return
    options.isBusy.value = true
    try {
      await deleteLayerStylePreset(id)
      await refreshLayerStylePresets()
      options.statusText.value = 'Estilo excluído'
    } catch (error) {
      options.showError(error, 'Não foi possível excluir o estilo.')
    } finally {
      options.isBusy.value = false
    }
  }

  return {
    applySavedLayerStylePreset,
    deleteSavedLayerStylePreset,
    openLayerStylePresets,
    refreshLayerStylePresets,
    saveCurrentLayerStylePreset
  }
}

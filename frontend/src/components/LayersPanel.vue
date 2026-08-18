<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import LayerCompositionControls from './LayerCompositionControls.vue'
import LayerRow from './LayerRow.vue'
import type { DocumentBackground, LayerBlendMode, LayerItem, LayerStyleGlobalLight } from '../types/editor'
import addLayerIcon from '../assets/icons/add-layer.svg'
import { layerCanRasterize } from '../editor/layerRasterization'
import { layerCanExportPNG } from '../editor/layerExport'
import { layersCanConvertToSmart } from '../editor/smartLayers'
import { layerStyleFillOpacity } from '../editor/layerStyles'
import type { LayerSelectionMode } from '../editor/layerSelection'

const props = defineProps<{
  activeLayerId: string
  documentBackground: DocumentBackground
  selectedLayerIds: string[]
  layers: LayerItem[]
  layerStyleGlobalLight: LayerStyleGlobalLight
}>()

const emit = defineEmits<{
  (event: 'addLayer'): void
  (event: 'convertToSmartLayer'): void
  (event: 'deleteLayer', layerId: string): void
  (event: 'duplicateLayer', layerId: string): void
  (event: 'editSmartLayer', layerId: string): void
  (event: 'exportLayer', layerId: string): void
  (event: 'moveLayer', layerId: string, direction: -1 | 1): void
  (event: 'renameLayer', layerId: string, name: string): void
  (event: 'reorderLayer', layerId: string, targetId: string, position: 'before' | 'after'): void
  (event: 'mergeLayers'): void
  (event: 'openLayerStyles', layerId: string): void
  (event: 'rasterizeLayer', layerId: string): void
  (event: 'selectLayer', layerId: string, mode: LayerSelectionMode): void
  (event: 'toggleLayer', layerId: string): void
  (event: 'update:layerBlendMode', value: LayerBlendMode): void
  (event: 'update:layerOpacity', value: number): void
}>()

const editingLayerId = ref<string>()
const draggedLayerId = ref<string>()
const dropTarget = ref<{ layerId: string; position: 'before' | 'after' }>()
const layerList = ref<HTMLOListElement | null>(null)
const dragPreview = ref<HTMLDivElement | null>(null)
const contextMenuButton = ref<HTMLButtonElement | null>(null)
const contextMenu = ref<{ layerId: string; x: number; y: number }>()
let dragFrame = 0
let pendingDragPoint: { clientX: number; clientY: number } | undefined

const activeIndex = computed(() => props.layers.findIndex((layer) => layer.id === props.activeLayerId))
const activeLayer = computed(() => props.layers[activeIndex.value])
const contextLayer = computed(() => props.layers.find((layer) => layer.id === contextMenu.value?.layerId))
const selectedIdSet = computed(() => new Set(props.selectedLayerIds))
const selectedCount = computed(() => props.layers.reduce(
  (count, layer) => count + Number(selectedIdSet.value.has(layer.id)),
  0
))
const selectedItems = computed(() => props.layers
  .map((layer, index) => ({ index, layer }))
  .filter(({ layer }) => selectedIdSet.value.has(layer.id)))
const contextSelectedItems = computed(() => {
  const layer = contextLayer.value
  if (!layer) return []
  if (selectedIdSet.value.has(layer.id)) return selectedItems.value
  return [{ index: props.layers.indexOf(layer), layer }]
})
const contextCanConvertToSmart = computed(() => layersCanConvertToSmart(contextSelectedItems.value))
const contextCanEditSmart = computed(() => contextLayer.value?.kind === 'smart' && Boolean(contextLayer.value.smart))
const contextCanExport = computed(() => layerCanExportPNG(contextLayer.value, props.documentBackground))
const contextCanRasterize = computed(() => layerCanRasterize(contextLayer.value))
const draggedLayer = computed(() => props.layers.find((layer) => layer.id === draggedLayerId.value))
const draggedLayerFillStyle = computed(() => ({
  '--layer-fill-opacity': String(layerStyleFillOpacity(draggedLayer.value?.styles))
}))
const canManipulate = computed(() => Boolean(activeLayer.value))
const canDuplicate = computed(() => Boolean(activeLayer.value?.image || activeLayer.value?.text))
const canMoveUp = computed(() => canManipulate.value && activeIndex.value > 0)
const canMoveDown = computed(() => {
  if (!canManipulate.value || activeIndex.value < 0) return false
  return activeIndex.value < props.layers.length - 1
})

function requestRename(layerId: string) {
  editingLayerId.value = layerId
}

function renameLayer(layerId: string, name: string) {
  editingLayerId.value = undefined
  emit('renameLayer', layerId, name)
}

function startDrag(layerId: string) {
  closeContextMenu()
  draggedLayerId.value = layerId
  editingLayerId.value = undefined
  emit('selectLayer', layerId, 'replace')
}

function closeContextMenu() {
  contextMenu.value = undefined
  window.removeEventListener('pointerdown', closeContextMenu)
  window.removeEventListener('blur', closeContextMenu)
  window.removeEventListener('resize', closeContextMenu)
  window.removeEventListener('scroll', closeContextMenu, true)
  window.removeEventListener('keydown', handleContextMenuKeydown)
}

function handleContextMenuKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  closeContextMenu()
}

async function openContextMenu(layerId: string, clientX: number, clientY: number) {
  closeContextMenu()
  const layer = props.layers.find((item) => item.id === layerId)
  if (!layer) return
  const contextualItems = selectedIdSet.value.has(layerId)
    ? selectedItems.value
    : [{ index: props.layers.indexOf(layer), layer }]
  if (!selectedIdSet.value.has(layerId)) emit('selectLayer', layerId, 'replace')
  const menuWidth = 224
  const menuHeight = 120 + 32 * (
    Number(layersCanConvertToSmart(contextualItems)) +
    Number(layer.kind === 'smart' && Boolean(layer.smart)) +
    Number(layerCanRasterize(layer))
  )
  contextMenu.value = {
    layerId,
    x: Math.max(8, Math.min(clientX, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - menuHeight - 8))
  }
  window.addEventListener('pointerdown', closeContextMenu)
  window.addEventListener('blur', closeContextMenu)
  window.addEventListener('resize', closeContextMenu)
  window.addEventListener('scroll', closeContextMenu, true)
  window.addEventListener('keydown', handleContextMenuKeydown)
  await nextTick()
  contextMenuButton.value?.focus({ preventScroll: true })
}

function mergeFromContextMenu() {
  if (selectedCount.value < 2) return
  closeContextMenu()
  emit('mergeLayers')
}

function openStylesFromContextMenu() {
  const layerId = contextMenu.value?.layerId
  if (!layerId) return
  closeContextMenu()
  emit('openLayerStyles', layerId)
}

function rasterizeFromContextMenu() {
  const layerId = contextMenu.value?.layerId
  if (!layerId || !layerCanRasterize(contextLayer.value)) return
  closeContextMenu()
  emit('rasterizeLayer', layerId)
}

function convertToSmartFromContextMenu() {
  if (!contextCanConvertToSmart.value) return
  closeContextMenu()
  emit('convertToSmartLayer')
}

function editSmartFromContextMenu() {
  const layerId = contextMenu.value?.layerId
  if (!layerId || !contextCanEditSmart.value) return
  closeContextMenu()
  emit('editSmartLayer', layerId)
}

function exportFromContextMenu() {
  const layerId = contextMenu.value?.layerId
  if (!layerId || !contextCanExport.value) return
  closeContextMenu()
  emit('exportLayer', layerId)
}

function setDropTarget(target?: { layerId: string; position: 'before' | 'after' }) {
  const current = dropTarget.value
  if (current?.layerId === target?.layerId && current?.position === target?.position) return
  dropTarget.value = target
}

function updateDragTarget(allowAutoScroll = true) {
  dragFrame = 0
  const point = pendingDragPoint
  const sourceId = draggedLayerId.value
  if (!point || !sourceId) return

  const row = document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>('.layer-row')
  const targetId = row?.dataset.layerId
  if (!row || !targetId || targetId === sourceId) {
    setDropTarget()
  } else {
    const bounds = row.getBoundingClientRect()
    const position = point.clientY < bounds.top + bounds.height / 2
      ? 'before'
      : 'after'
    setDropTarget({ layerId: targetId, position })
  }

  if (dragPreview.value) {
    dragPreview.value.style.transform = `translate3d(${Math.round(point.clientX + 14)}px, ${Math.round(point.clientY + 14)}px, 0)`
  }

  const list = layerList.value
  if (!list || !allowAutoScroll) return
  const listBounds = list.getBoundingClientRect()
  const edgeSize = 28
  const previousScroll = list.scrollTop
  if (point.clientY < listBounds.top + edgeSize) list.scrollTop -= 12
  else if (point.clientY > listBounds.bottom - edgeSize) list.scrollTop += 12

  if (list.scrollTop !== previousScroll) dragFrame = requestAnimationFrame(() => updateDragTarget())
}

function moveDrag(clientX: number, clientY: number) {
  pendingDragPoint = { clientX, clientY }
  if (!dragFrame) dragFrame = requestAnimationFrame(() => updateDragTarget())
}

function finishDrag() {
  if (dragFrame) cancelAnimationFrame(dragFrame)
  dragFrame = 0
  if (pendingDragPoint) updateDragTarget(false)

  const sourceId = draggedLayerId.value
  const target = dropTarget.value
  clearDrag()
  if (sourceId && target && sourceId !== target.layerId) {
    emit('reorderLayer', sourceId, target.layerId, target.position)
  }
}

function clearDrag() {
  cancelAnimationFrame(dragFrame)
  dragFrame = 0
  pendingDragPoint = undefined
  draggedLayerId.value = undefined
  dropTarget.value = undefined
}

function handlePanelKeydown(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement || !activeLayer.value) return

  if (event.key === 'F2' && canManipulate.value) {
    event.preventDefault()
    requestRename(activeLayer.value.id)
    return
  }

  if (event.key === 'Delete') {
    event.preventDefault()
    emit('deleteLayer', activeLayer.value.id)
    return
  }

  if (event.altKey && event.key === 'ArrowUp' && canMoveUp.value) {
    event.preventDefault()
    emit('moveLayer', activeLayer.value.id, -1)
  } else if (event.altKey && event.key === 'ArrowDown' && canMoveDown.value) {
    event.preventDefault()
    emit('moveLayer', activeLayer.value.id, 1)
  }
}

onBeforeUnmount(() => {
  clearDrag()
  closeContextMenu()
})
</script>

<template>
  <section class="panel layers-panel" @keydown="handlePanelKeydown">
    <div class="panel-title layers-panel-title">
      <div class="layers-heading">
        <h2>Camadas</h2>
        <span class="layer-count">{{ layers.length }}</span>
      </div>
      <button type="button" title="Adicionar camada" aria-label="Adicionar camada" @click="emit('addLayer')">
        <img alt="" :src="addLayerIcon" />
      </button>
    </div>

    <LayerCompositionControls
      :active-layer="activeLayer"
      @update:blend-mode="emit('update:layerBlendMode', $event)"
      @update:opacity="emit('update:layerOpacity', $event)"
    />

    <ol ref="layerList" class="layer-list" aria-label="Camadas">
      <LayerRow
        v-for="layer in layers"
        :key="layer.id"
        :active="layer.id === activeLayerId"
        :selected="selectedIdSet.has(layer.id)"
        :drop-position="dropTarget?.layerId === layer.id ? dropTarget.position : undefined"
        :dragging="draggedLayerId === layer.id"
        :editing="editingLayerId === layer.id"
        :layer="layer"
        :layer-style-global-light="layerStyleGlobalLight"
        @cancel-rename="editingLayerId = undefined"
        @drag-cancel="clearDrag"
        @drag-end="finishDrag"
        @drag-move="moveDrag"
        @drag-start="startDrag"
        @edit-smart-layer="emit('editSmartLayer', $event)"
        @rename="renameLayer"
        @open-context-menu="openContextMenu"
        @open-layer-styles="emit('openLayerStyles', $event)"
        @request-rename="requestRename"
        @select="(layerId, mode) => emit('selectLayer', layerId, mode)"
        @toggle="emit('toggleLayer', $event)"
      />
    </ol>

    <Teleport to="body">
      <div
        ref="dragPreview"
        class="layer-drag-preview"
        :class="{ 'layer-drag-preview--visible': draggedLayer }"
        aria-hidden="true"
      >
        <span
          class="layer-thumb"
          :class="{ 'layer-thumb--transparent': !draggedLayer?.image }"
          :style="draggedLayerFillStyle"
        >
          <img
            v-if="draggedLayer?.image"
            alt=""
            draggable="false"
            :src="draggedLayer.image.previewUrl ?? draggedLayer.image.sourceUrl"
          />
          <span v-else-if="draggedLayer?.kind === 'text'" class="layer-thumb-text">T</span>
        </span>
        <span class="layer-drag-preview-copy">
          <strong>{{ draggedLayer?.name }}</strong>
          <small>Solte para reordenar</small>
        </span>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="layer-context-menu"
        role="menu"
        aria-label="Ações das camadas"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @contextmenu.prevent
        @pointerdown.stop
      >
        <button
          ref="contextMenuButton"
          type="button"
          role="menuitem"
          @click="openStylesFromContextMenu"
        >
          <span>Opções de mesclagem…</span>
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="!contextCanExport"
          @click="exportFromContextMenu"
        >
          <span>Exportar rapidamente como PNG</span>
        </button>
        <button
          v-if="contextCanConvertToSmart"
          type="button"
          role="menuitem"
          @click="convertToSmartFromContextMenu"
        >
          <span>Converter em camada inteligente</span>
        </button>
        <button
          v-if="contextCanEditSmart"
          type="button"
          role="menuitem"
          @click="editSmartFromContextMenu"
        >
          <span>Editar conteúdo</span>
        </button>
        <button
          v-if="contextCanRasterize"
          type="button"
          role="menuitem"
          @click="rasterizeFromContextMenu"
        >
          <span>Rasterizar camada</span>
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="selectedCount < 2"
          @click="mergeFromContextMenu"
        >
          <span>Mesclar camadas</span>
          <kbd>Ctrl+E</kbd>
        </button>
      </div>
    </Teleport>

    <div class="layer-actions" aria-label="Ações da camada selecionada">
      <button
        class="layer-action--fx"
        type="button"
        title="Opções de mesclagem"
        :disabled="!activeLayer"
        @click="activeLayer && emit('openLayerStyles', activeLayer.id)"
      >
        <span aria-hidden="true">fx</span>
      </button>
      <button
        type="button"
        title="Mesclar camadas selecionadas (Ctrl+E)"
        :disabled="selectedCount < 2"
        @click="emit('mergeLayers')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 8 8-4 8 4-8 4-8-4Zm0 4 8 4 8-4M4 16l8 4 8-4" /></svg>
      </button>
      <button
        type="button"
        title="Renomear camada (F2)"
        :disabled="!canManipulate"
        @click="activeLayer && requestRename(activeLayer.id)"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3" /></svg>
      </button>
      <button
        type="button"
        title="Duplicar camada (Ctrl+J)"
        :disabled="!canDuplicate"
        @click="activeLayer && emit('duplicateLayer', activeLayer.id)"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="1" /><path d="M16 8V5H5v11h3" /></svg>
      </button>
      <button
        type="button"
        title="Elevar camada (Alt+↑)"
        :disabled="!canMoveUp"
        @click="activeLayer && emit('moveLayer', activeLayer.id, -1)"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 14 5-5 5 5M7 19h10" /></svg>
      </button>
      <button
        type="button"
        title="Abaixar camada (Alt+↓)"
        :disabled="!canMoveDown"
        @click="activeLayer && emit('moveLayer', activeLayer.id, 1)"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5M7 5h10" /></svg>
      </button>
      <button
        class="layer-action--danger"
        type="button"
        title="Excluir camada (Delete)"
        :disabled="!activeLayer"
        @click="activeLayer && emit('deleteLayer', activeLayer.id)"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" /></svg>
      </button>
    </div>
  </section>
</template>

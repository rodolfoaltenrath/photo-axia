<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import LayerRow from './LayerRow.vue'
import type { LayerItem } from '../types/editor'
import addLayerIcon from '../assets/icons/add-layer.svg'

const props = defineProps<{
  activeLayerId: string
  layers: LayerItem[]
}>()

const emit = defineEmits<{
  (event: 'addLayer'): void
  (event: 'deleteLayer', layerId: string): void
  (event: 'duplicateLayer', layerId: string): void
  (event: 'moveLayer', layerId: string, direction: -1 | 1): void
  (event: 'renameLayer', layerId: string, name: string): void
  (event: 'reorderLayer', layerId: string, targetId: string, position: 'before' | 'after'): void
  (event: 'selectLayer', layerId: string): void
  (event: 'toggleLayer', layerId: string): void
}>()

const editingLayerId = ref<string>()
const draggedLayerId = ref<string>()
const dropTarget = ref<{ layerId: string; position: 'before' | 'after' }>()
const layerList = ref<HTMLOListElement | null>(null)
const dragPreview = ref<HTMLDivElement | null>(null)
let dragFrame = 0
let pendingDragPoint: { clientX: number; clientY: number } | undefined

const activeIndex = computed(() => props.layers.findIndex((layer) => layer.id === props.activeLayerId))
const activeLayer = computed(() => props.layers[activeIndex.value])
const draggedLayer = computed(() => props.layers.find((layer) => layer.id === draggedLayerId.value))
const canManipulate = computed(() => Boolean(activeLayer.value && activeLayer.value.kind !== 'background'))
const canMoveUp = computed(() => canManipulate.value && activeIndex.value > 0)
const canMoveDown = computed(() => {
  if (!canManipulate.value || activeIndex.value < 0) return false
  return props.layers[activeIndex.value + 1]?.kind !== 'background' && activeIndex.value < props.layers.length - 1
})

function requestRename(layerId: string) {
  if (props.layers.find((layer) => layer.id === layerId)?.kind === 'background') return
  editingLayerId.value = layerId
}

function renameLayer(layerId: string, name: string) {
  editingLayerId.value = undefined
  emit('renameLayer', layerId, name)
}

function startDrag(layerId: string) {
  draggedLayerId.value = layerId
  editingLayerId.value = undefined
  emit('selectLayer', layerId)
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
    const position = row.dataset.layerKind === 'background' || point.clientY < bounds.top + bounds.height / 2
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

onBeforeUnmount(clearDrag)
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

    <ol ref="layerList" class="layer-list">
      <LayerRow
        v-for="layer in layers"
        :key="layer.id"
        :active="layer.id === activeLayerId"
        :drop-position="dropTarget?.layerId === layer.id ? dropTarget.position : undefined"
        :dragging="draggedLayerId === layer.id"
        :editing="editingLayerId === layer.id"
        :layer="layer"
        @cancel-rename="editingLayerId = undefined"
        @drag-cancel="clearDrag"
        @drag-end="finishDrag"
        @drag-move="moveDrag"
        @drag-start="startDrag"
        @rename="renameLayer"
        @request-rename="requestRename"
        @select="emit('selectLayer', $event)"
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
        <span class="layer-thumb" :class="{ 'layer-thumb--transparent': !draggedLayer?.image }">
          <img v-if="draggedLayer?.image" alt="" draggable="false" :src="draggedLayer.image.sourceUrl" />
        </span>
        <span class="layer-drag-preview-copy">
          <strong>{{ draggedLayer?.name }}</strong>
          <small>Solte para reordenar</small>
        </span>
      </div>
    </Teleport>

    <div class="layer-actions" aria-label="Ações da camada selecionada">
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
        :disabled="!canManipulate"
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

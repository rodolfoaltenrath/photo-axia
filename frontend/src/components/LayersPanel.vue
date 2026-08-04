<script setup lang="ts">
import { computed, ref } from 'vue'
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

const activeIndex = computed(() => props.layers.findIndex((layer) => layer.id === props.activeLayerId))
const activeLayer = computed(() => props.layers[activeIndex.value])
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

function dragOver(layerId: string, position: 'before' | 'after') {
  if (!draggedLayerId.value || draggedLayerId.value === layerId) {
    dropTarget.value = undefined
    return
  }
  dropTarget.value = { layerId, position }
}

function dropLayer(targetId: string, position: 'before' | 'after') {
  const sourceId = draggedLayerId.value
  clearDrag()
  if (sourceId && sourceId !== targetId) emit('reorderLayer', sourceId, targetId, position)
}

function clearDrag() {
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

  if (event.key === 'Delete' && canManipulate.value) {
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

    <ol class="layer-list" @dragleave.self="clearDrag">
      <LayerRow
        v-for="layer in layers"
        :key="layer.id"
        :active="layer.id === activeLayerId"
        :drop-position="dropTarget?.layerId === layer.id ? dropTarget.position : undefined"
        :dragging="draggedLayerId === layer.id"
        :editing="editingLayerId === layer.id"
        :layer="layer"
        @cancel-rename="editingLayerId = undefined"
        @drag-end="clearDrag"
        @drag-over="dragOver"
        @drag-start="startDrag"
        @drop="dropLayer"
        @rename="renameLayer"
        @request-rename="requestRename"
        @select="emit('selectLayer', $event)"
        @toggle="emit('toggleLayer', $event)"
      />
    </ol>

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
        :disabled="!canManipulate"
        @click="activeLayer && emit('deleteLayer', activeLayer.id)"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" /></svg>
      </button>
    </div>
  </section>
</template>

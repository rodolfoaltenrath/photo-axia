<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LayerItem } from '../types/editor'
import visibleIcon from '../assets/icons/visible.svg'

const props = defineProps<{
  active: boolean
  dragging: boolean
  editing: boolean
  layer: LayerItem
  dropPosition?: 'before' | 'after'
}>()

const emit = defineEmits<{
  (event: 'cancelRename'): void
  (event: 'dragEnd'): void
  (event: 'dragOver', layerId: string, position: 'before' | 'after'): void
  (event: 'dragStart', layerId: string): void
  (event: 'drop', layerId: string, position: 'before' | 'after'): void
  (event: 'rename', layerId: string, name: string): void
  (event: 'requestRename', layerId: string): void
  (event: 'select', layerId: string): void
  (event: 'toggle', layerId: string): void
}>()

const nameInput = ref<HTMLInputElement | null>(null)
const draftName = ref(props.layer.name)

const kindLabels: Record<LayerItem['kind'], string> = {
  pixel: 'Pixels',
  image: 'Imagem',
  adjustment: 'Ajuste',
  background: 'Fundo'
}

watch(
  () => props.editing,
  async (editing) => {
    if (!editing) return
    draftName.value = props.layer.name
    await nextTick()
    nameInput.value?.focus()
    nameInput.value?.select()
  }
)

function commitRename() {
  const name = draftName.value.trim()
  if (name && name !== props.layer.name) emit('rename', props.layer.id, name)
  else emit('cancelRename')
}

function cancelRename() {
  draftName.value = props.layer.name
  emit('cancelRename')
}

function resolveDropPosition(event: DragEvent) {
  if (props.layer.kind === 'background') return 'before'
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return event.clientY >= bounds.top + bounds.height / 2 ? 'after' : 'before'
}

function handleDragStart(event: DragEvent) {
  if (props.layer.kind === 'background') {
    event.preventDefault()
    return
  }

  event.dataTransfer?.setData('text/plain', props.layer.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  emit('dragStart', props.layer.id)
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  emit('dragOver', props.layer.id, resolveDropPosition(event))
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  emit('drop', props.layer.id, resolveDropPosition(event))
}
</script>

<template>
  <li
    class="layer-row"
    :class="{
      'layer-row--active': active,
      'layer-row--background': layer.kind === 'background',
      'layer-row--dragging': dragging,
      'layer-row--drop-after': dropPosition === 'after',
      'layer-row--drop-before': dropPosition === 'before'
    }"
    :draggable="layer.kind !== 'background' && !editing"
    @dragend="emit('dragEnd')"
    @dragover="handleDragOver"
    @dragstart="handleDragStart"
    @drop="handleDrop"
  >
    <button
      class="visibility-button"
      type="button"
      :aria-label="layer.visible ? `Ocultar ${layer.name}` : `Mostrar ${layer.name}`"
      :title="layer.visible ? 'Ocultar camada' : 'Mostrar camada'"
      @click="emit('toggle', layer.id)"
    >
      <img alt="" :class="{ 'visibility-icon--hidden': !layer.visible }" :src="visibleIcon" />
    </button>

    <div
      class="layer-button"
      role="button"
      tabindex="0"
      :aria-current="active ? 'true' : undefined"
      @click="emit('select', layer.id)"
      @dblclick="emit('requestRename', layer.id)"
      @keydown.enter.self.prevent="emit('select', layer.id)"
      @keydown.space.self.prevent="emit('select', layer.id)"
    >
      <span class="layer-drag-handle" aria-hidden="true">⠿</span>
      <span class="layer-thumb" :class="{ 'layer-thumb--transparent': !layer.image }">
        <img v-if="layer.image" alt="" decoding="async" :src="layer.image.sourceUrl" />
      </span>
      <span class="layer-copy">
        <input
          v-if="editing"
          ref="nameInput"
          v-model="draftName"
          class="layer-name-input"
          maxlength="80"
          type="text"
          @blur="commitRename"
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
        />
        <strong v-else>{{ layer.name }}</strong>
        <small>{{ kindLabels[layer.kind] }} · {{ layer.opacity }}%</small>
      </span>
    </div>
  </li>
</template>

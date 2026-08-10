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
  (event: 'dragCancel'): void
  (event: 'dragEnd'): void
  (event: 'dragMove', clientX: number, clientY: number): void
  (event: 'dragStart', layerId: string): void
  (event: 'rename', layerId: string, name: string): void
  (event: 'requestRename', layerId: string): void
  (event: 'select', layerId: string): void
  (event: 'toggle', layerId: string): void
}>()

const nameInput = ref<HTMLInputElement | null>(null)
const draftName = ref(props.layer.name)
let dragPointerId = -1
let dragStartX = 0
let dragStartY = 0
let pointerDragging = false
let ignoreClickUntil = 0

const kindLabels: Record<LayerItem['kind'], string> = {
  pixel: 'Pixels',
  image: 'Imagem',
  text: 'Texto',
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

function startPointerDrag(event: PointerEvent) {
  if (event.button !== 0 || props.editing || props.layer.kind === 'background') return
  dragPointerId = event.pointerId
  dragStartX = event.clientX
  dragStartY = event.clientY
  pointerDragging = false
  const row = event.currentTarget as HTMLElement
  row.setPointerCapture(event.pointerId)
}

function movePointerDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointerId) return
  if (!pointerDragging && Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) < 5) return

  if (!pointerDragging) {
    pointerDragging = true
    ignoreClickUntil = performance.now() + 250
    emit('dragStart', props.layer.id)
  }

  event.preventDefault()
  emit('dragMove', event.clientX, event.clientY)
}

function endPointerDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointerId) return
  if (pointerDragging) emit('dragEnd')
  dragPointerId = -1
  pointerDragging = false
}

function cancelPointerDrag(event: PointerEvent) {
  if (event.pointerId !== dragPointerId) return
  if (pointerDragging) emit('dragCancel')
  dragPointerId = -1
  pointerDragging = false
}

function selectLayer(event: MouseEvent) {
  if (performance.now() < ignoreClickUntil) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  const row = event.currentTarget as HTMLElement
  row.focus({ preventScroll: true })
  emit('select', props.layer.id)
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
    :data-layer-id="layer.id"
    :data-layer-kind="layer.kind"
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
      @click="selectLayer"
      @dblclick="emit('requestRename', layer.id)"
      @keydown.enter.self.prevent="emit('select', layer.id)"
      @keydown.space.self.prevent="emit('select', layer.id)"
      @lostpointercapture="cancelPointerDrag"
      @pointercancel="cancelPointerDrag"
      @pointerdown="startPointerDrag"
      @pointermove="movePointerDrag"
      @pointerup="endPointerDrag"
    >
      <span class="layer-drag-handle" aria-hidden="true">⠿</span>
      <span class="layer-thumb" :class="{ 'layer-thumb--transparent': !layer.image }">
        <img
          v-if="layer.image"
          alt=""
          decoding="async"
          draggable="false"
          loading="lazy"
          :src="layer.image.previewUrl ?? layer.image.sourceUrl"
        />
        <span v-else-if="layer.kind === 'text'" class="layer-thumb-text" aria-hidden="true">T</span>
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

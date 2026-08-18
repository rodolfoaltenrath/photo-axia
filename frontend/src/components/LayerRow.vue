<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { LayerItem, LayerStyleGlobalLight } from '../types/editor'
import visibleIcon from '../assets/icons/visible.svg'
import { blendModeLabel } from '../editor/blendModes'
import { layerStyleNeedsCompositing } from '../editor/layerStyleCompositor'
import { layerStyleFillOpacity } from '../editor/layerStyles'
import type { LayerSelectionMode } from '../editor/layerSelection'
import { useLayerStyleRaster } from './canvas/composables/useLayerStyleRaster'

const props = defineProps<{
  active: boolean
  selected: boolean
  dragging: boolean
  editing: boolean
  layer: LayerItem
  layerStyleGlobalLight: LayerStyleGlobalLight
  dropPosition?: 'before' | 'after'
}>()

const emit = defineEmits<{
  (event: 'cancelRename'): void
  (event: 'dragCancel'): void
  (event: 'dragEnd'): void
  (event: 'dragMove', clientX: number, clientY: number): void
  (event: 'dragStart', layerId: string): void
  (event: 'editSmartLayer', layerId: string): void
  (event: 'openContextMenu', layerId: string, clientX: number, clientY: number): void
  (event: 'openLayerStyles', layerId: string): void
  (event: 'rename', layerId: string, name: string): void
  (event: 'requestRename', layerId: string): void
  (event: 'select', layerId: string, mode: LayerSelectionMode): void
  (event: 'toggle', layerId: string): void
}>()

const nameInput = ref<HTMLInputElement | null>(null)
const draftName = ref(props.layer.name)
const {
  desiredImageSource,
  geometryForSource,
  releaseSource
} = useLayerStyleRaster({
  consumer: 'thumbnail',
  globalLight: () => props.layerStyleGlobalLight,
  layer: () => props.layer,
  transform: () => props.layer.transform ?? { x: 0, y: 0, width: 1, height: 1 }
})
const desiredThumbnailSource = computed(() => desiredImageSource.value)
const thumbnailSources = ref<[string | null, string | null]>([desiredThumbnailSource.value, null])
const thumbnailReady = ref<[boolean, boolean]>([false, false])
const activeThumbnailSlot = ref<0 | 1>(0)
const thumbnailStyle = computed(() => ({ '--layer-fill-opacity': String(layerStyleFillOpacity(props.layer.styles)) }))
const hasLayerStyle = computed(() => layerStyleNeedsCompositing(props.layer.styles))
let releaseThumbnailFrame = 0
let dragPointerId = -1
let dragStartX = 0
let dragStartY = 0
let pointerDragging = false
let ignoreClickUntil = 0

function activateThumbnail(slot: 0 | 1, source: string) {
  if (thumbnailSources.value[slot] !== source || desiredThumbnailSource.value !== source) return
  activeThumbnailSlot.value = slot
  cancelAnimationFrame(releaseThumbnailFrame)
  releaseThumbnailFrame = requestAnimationFrame(() => {
    releaseThumbnailFrame = 0
    if (activeThumbnailSlot.value !== slot || desiredThumbnailSource.value !== source) return
    const inactiveSlot: 0 | 1 = slot === 0 ? 1 : 0
    if (!thumbnailSources.value[inactiveSlot]) return
    const sources = [...thumbnailSources.value] as [string | null, string | null]
    const readiness = [...thumbnailReady.value] as [boolean, boolean]
    const releasedSource = sources[inactiveSlot]
    sources[inactiveSlot] = null
    readiness[inactiveSlot] = false
    thumbnailSources.value = sources
    thumbnailReady.value = readiness
    if (releasedSource) releaseSource(releasedSource)
  })
}

function loadThumbnail(slot: 0 | 1, event: Event) {
  const source = thumbnailSources.value[slot]
  if (!source) return
  const image = event.currentTarget as HTMLImageElement
  if (!image.complete || image.naturalWidth === 0) return
  if (thumbnailSources.value[slot] !== source) return
  const readiness = [...thumbnailReady.value] as [boolean, boolean]
  readiness[slot] = true
  thumbnailReady.value = readiness
  if (source === desiredThumbnailSource.value) activateThumbnail(slot, source)
}

watch(desiredThumbnailSource, (source) => {
  if (!source || thumbnailSources.value[activeThumbnailSlot.value] === source) return
  const targetSlot: 0 | 1 = activeThumbnailSlot.value === 0 ? 1 : 0
  if (thumbnailSources.value[targetSlot] === source && thumbnailReady.value[targetSlot]) {
    activateThumbnail(targetSlot, source)
    return
  }
  const sources = [...thumbnailSources.value] as [string | null, string | null]
  const readiness = [...thumbnailReady.value] as [boolean, boolean]
  const replacedSource = sources[targetSlot]
  sources[targetSlot] = source
  readiness[targetSlot] = false
  thumbnailSources.value = sources
  thumbnailReady.value = readiness
  if (replacedSource && replacedSource !== source) releaseSource(replacedSource)
})

const kindLabels: Record<LayerItem['kind'], string> = {
  pixel: 'Pixels',
  image: 'Imagem',
  text: 'Texto',
  smart: 'Inteligente',
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

onBeforeUnmount(() => cancelAnimationFrame(releaseThumbnailFrame))

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
  if (event.button !== 0 || props.editing) return
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
  const mode: LayerSelectionMode = event.shiftKey
    ? 'range'
    : event.ctrlKey || event.metaKey
      ? 'toggle'
      : 'replace'
  emit('select', props.layer.id, mode)
}

function openContextMenu(event: MouseEvent) {
  event.preventDefault()
  emit('openContextMenu', props.layer.id, event.clientX, event.clientY)
}

function openThumbnailAction() {
  if (props.layer.kind === 'smart') emit('editSmartLayer', props.layer.id)
  else emit('openLayerStyles', props.layer.id)
}
</script>

<template>
  <li
    class="layer-row"
    :class="{
      'layer-row--active': active,
      'layer-row--selected': selected,
      'layer-row--dragging': dragging,
      'layer-row--drop-after': dropPosition === 'after',
      'layer-row--drop-before': dropPosition === 'before'
    }"
    :data-layer-id="layer.id"
    :data-layer-kind="layer.kind"
    @contextmenu="openContextMenu"
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
      :aria-pressed="selected"
      @click="selectLayer"
      @dblclick="emit('requestRename', layer.id)"
      @keydown.enter.self.prevent="emit('select', layer.id, 'replace')"
      @keydown.space.self.prevent="emit('select', layer.id, 'replace')"
      @lostpointercapture="cancelPointerDrag"
      @pointercancel="cancelPointerDrag"
      @pointerdown="startPointerDrag"
      @pointermove="movePointerDrag"
      @pointerup="endPointerDrag"
    >
      <span class="layer-drag-handle" aria-hidden="true">⠿</span>
      <span
        class="layer-thumb"
        :class="{ 'layer-thumb--transparent': !layer.image }"
        :style="thumbnailStyle"
        :title="layer.kind === 'smart' ? 'Editar conteúdo inteligente' : 'Abrir opções de mesclagem'"
        @dblclick.stop="openThumbnailAction"
      >
        <template v-if="layer.image">
          <img
            v-for="(source, slot) in thumbnailSources"
            v-show="source"
            :key="slot"
            alt=""
            class="layer-thumb-buffer"
            :class="{
              'layer-thumb-buffer--active': activeThumbnailSlot === slot,
              'layer-thumb-buffer--styled': Boolean(geometryForSource(source))
            }"
            decoding="async"
            fetchpriority="low"
            loading="lazy"
            draggable="false"
            :src="source ?? undefined"
            @load="loadThumbnail(slot as 0 | 1, $event)"
          />
        </template>
        <span v-else-if="layer.kind === 'text'" class="layer-thumb-text" aria-hidden="true">T</span>
        <span v-if="layer.kind === 'smart'" class="layer-thumb-smart" aria-label="Camada inteligente" title="Camada inteligente">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 10.5h5M8 8v5" /></svg>
        </span>
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
        <span v-else class="layer-name-line">
          <strong>{{ layer.name }}</strong>
          <span v-if="hasLayerStyle" class="layer-style-indicator" title="Estilo de camada ativo">fx</span>
        </span>
        <small>
          {{ kindLabels[layer.kind] }} · {{ layer.opacity }}%
          <template v-if="layer.blendMode !== 'normal'"> · {{ blendModeLabel(layer.blendMode) }}</template>
        </small>
      </span>
    </div>
  </li>
</template>

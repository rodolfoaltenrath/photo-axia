<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createGradientInterpolator, type GradientStopsConfig } from '../editor/gradient'
import {
  addGradientColorPoint,
  duplicateGradientColorPoint,
  gradientStripBackground,
  moveGradientColorPoint,
  removeGradientColorPoint,
  updateGradientColorPointOpacity,
  updateGradientStopValue,
  visualGradientStopPosition
} from '../editor/gradientEditor'

const props = defineProps<{ config: GradientStopsConfig }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'update:config', config: GradientStopsConfig): void
}>()

const root = ref<HTMLElement | null>(null)
const valueInput = ref<HTMLInputElement | null>(null)
const selectedColorStopId = ref(props.config.colorStops[0]?.id ?? '')
const drag = ref<{
  pointerId: number
  colorStopId: string
  trackLeft: number
  trackWidth: number
  workingConfig: GradientStopsConfig
} | null>(null)
let dragFrame = 0
let pendingDragPosition: number | undefined
const activeStop = computed(() => props.config.colorStops.find((stop) => stop.id === selectedColorStopId.value))
const stopOpacities = computed(() => {
  const interpolate = createGradientInterpolator(props.config)
  return new Map(props.config.colorStops.map((stop) => [
    stop.id,
    Math.round(interpolate(visualGradientStopPosition(props.config, stop.position))[3] * 100 / 255)
  ]))
})
const stopOpacity = (id: string) => stopOpacities.value.get(id) ?? 100
const activeOpacity = computed(() => stopOpacity(selectedColorStopId.value))
const canRemove = computed(() => props.config.colorStops.length > 2)
const stripStyle = computed(() => ({ backgroundImage: gradientStripBackground(props.config) }))
const visualPosition = computed(() => activeStop.value
  ? Math.round(visualGradientStopPosition(props.config, activeStop.value.position) * 100)
  : 0)

watch(() => props.config, (config) => {
  if (config.colorStops.some((stop) => stop.id === selectedColorStopId.value)) return
  const fallback = config.colorStops[0]
  if (fallback) selectedColorStopId.value = fallback.id
})

function pointerPosition(event: PointerEvent, target: HTMLElement) {
  const bounds = target.getBoundingClientRect()
  return Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)))
}

function add(event: PointerEvent) {
  if (event.target !== event.currentTarget) return
  addAt(event, event.currentTarget as HTMLElement)
}

function addFromStrip(event: PointerEvent) {
  addAt(event, event.currentTarget as HTMLElement)
}

function addAt(event: PointerEvent, target: HTMLElement) {
  const result = addGradientColorPoint(props.config, pointerPosition(event, target))
  if (!result.colorStopId) return
  selectedColorStopId.value = result.colorStopId
  emit('update:config', result.config)
}

function startDrag(event: PointerEvent, id: string) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  let colorStopId = id
  let workingConfig = props.config
  if (event.altKey) {
    const duplicated = duplicateGradientColorPoint(props.config, id)
    if (duplicated.colorStopId) {
      colorStopId = duplicated.colorStopId
      workingConfig = duplicated.config
      emit('update:config', duplicated.config)
    }
  }
  selectedColorStopId.value = colorStopId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  const track = root.value?.querySelector<HTMLElement>('.gradient-stop-track--color')
  if (!track) return
  const bounds = track.getBoundingClientRect()
  drag.value = {
    pointerId: event.pointerId,
    colorStopId,
    trackLeft: bounds.left,
    trackWidth: Math.max(1, bounds.width),
    workingConfig
  }
}

function flushDragPosition() {
  dragFrame = 0
  const position = pendingDragPosition
  pendingDragPosition = undefined
  const current = drag.value
  if (position === undefined || !current) return
  current.workingConfig = moveGradientColorPoint(current.workingConfig, current.colorStopId, position)
  emit('update:config', current.workingConfig)
}

function moveDrag(event: PointerEvent) {
  const current = drag.value
  if (!current || current.pointerId !== event.pointerId) return
  pendingDragPosition = Math.min(
    1,
    Math.max(0, (event.clientX - current.trackLeft) / current.trackWidth)
  )
  if (!dragFrame) dragFrame = requestAnimationFrame(flushDragPosition)
}

function stopDrag(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId) return
  if (dragFrame) cancelAnimationFrame(dragFrame)
  flushDragPosition()
  drag.value = null
}

function updatePosition(percent: number) {
  emit('update:config', moveGradientColorPoint(props.config, selectedColorStopId.value, percent / 100))
}

function updateColor(value: string) {
  emit('update:config', updateGradientStopValue(
    props.config,
    { kind: 'color', id: selectedColorStopId.value },
    value
  ))
}

function updateOpacity(value: number) {
  emit('update:config', updateGradientColorPointOpacity(props.config, selectedColorStopId.value, value))
}

function toggleTransparent() {
  updateOpacity(activeOpacity.value === 0 ? 100 : 0)
}

function removeActive() {
  if (!canRemove.value) return
  const config = removeGradientColorPoint(props.config, selectedColorStopId.value)
  const fallback = config.colorStops[0]
  if (fallback) selectedColorStopId.value = fallback.id
  emit('update:config', config)
}

function markerKeydown(event: KeyboardEvent) {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    removeActive()
    return
  }
  let position: number | undefined
  if (event.key === 'Home') position = 0
  else if (event.key === 'End') position = 1
  else if (event.key === 'ArrowLeft') position = visualPosition.value / 100 - (event.shiftKey ? 0.1 : 0.01)
  else if (event.key === 'ArrowRight') position = visualPosition.value / 100 + (event.shiftKey ? 0.1 : 0.01)
  if (position === undefined) return
  event.preventDefault()
  emit('update:config', moveGradientColorPoint(props.config, selectedColorStopId.value, position))
}

function editMarker(id: string) {
  selectedColorStopId.value = id
  void nextTick(() => valueInput.value?.focus())
}

function outsidePointer(event: PointerEvent) {
  const boundary = root.value?.parentElement
  if (!boundary?.contains(event.target as Node)) emit('close')
}

function globalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', outsidePointer, true)
  document.addEventListener('keydown', globalKeydown, true)
})
onBeforeUnmount(() => {
  if (dragFrame) cancelAnimationFrame(dragFrame)
  document.removeEventListener('pointerdown', outsidePointer, true)
  document.removeEventListener('keydown', globalKeydown, true)
})
</script>

<template>
  <section
    ref="root"
    class="gradient-stops-editor"
    aria-label="Editor de pontos do degradê"
    @pointermove="moveDrag"
    @pointerup="stopDrag"
    @pointercancel="stopDrag"
  >
    <header>
      <div>
        <strong>Pontos do degradê</strong>
        <span>Clique na faixa para adicionar outra cor</span>
      </div>
      <button type="button" aria-label="Fechar editor de degradê" @click="emit('close')">×</button>
    </header>

    <div class="gradient-stop-stage">
      <div class="gradient-track-heading">
        <strong>Cores e transparência</strong>
        <span>Alt + arrastar duplica</span>
      </div>
      <div class="gradient-strip-checker" @pointerdown="addFromStrip">
        <div class="gradient-strip-color" :style="stripStyle"></div>
      </div>
      <div
        class="gradient-stop-track gradient-stop-track--color"
        aria-label="Pontos de cor e transparência"
        @pointerdown="add"
      >
        <button
          v-for="stop in config.colorStops"
          :key="stop.id"
          class="gradient-stop-marker gradient-stop-marker--color"
          :class="{ active: selectedColorStopId === stop.id, transparent: stopOpacity(stop.id) === 0 }"
          :style="{ left: `${visualGradientStopPosition(config, stop.position) * 100}%` }"
          type="button"
          :aria-label="`Cor ${stop.color}, visibilidade ${stopOpacity(stop.id)}%, posição ${Math.round(visualGradientStopPosition(config, stop.position) * 100)}%`"
          @dblclick="editMarker(stop.id)"
          @keydown="markerKeydown"
          @pointerdown="startDrag($event, stop.id)"
        ><span :style="{ background: stop.color, opacity: stopOpacity(stop.id) / 100 }"></span></button>
      </div>
    </div>

    <div v-if="activeStop" class="gradient-stop-properties">
      <strong class="gradient-active-editor">Ponto selecionado</strong>
      <label>
        <span>Cor</span>
        <input
          ref="valueInput"
          :value="activeStop.color"
          type="color"
          @input="updateColor(($event.target as HTMLInputElement).value)"
        />
      </label>
      <button
        class="gradient-transparent-toggle"
        :class="{ active: activeOpacity === 0 }"
        type="button"
        :aria-pressed="activeOpacity === 0"
        @click="toggleTransparent"
      >Sem cor (transparente)</button>
      <label class="gradient-opacity-property">
        <span>Visibilidade</span>
        <input
          :value="activeOpacity"
          min="0"
          max="100"
          type="range"
          @input="updateOpacity(Number(($event.target as HTMLInputElement).value))"
        />
        <input
          :value="activeOpacity"
          min="0"
          max="100"
          type="number"
          @change="updateOpacity(Number(($event.target as HTMLInputElement).value))"
        />
        <span>%</span>
      </label>
      <label>
        <span>Posição</span>
        <input
          :value="visualPosition"
          min="0"
          max="100"
          type="number"
          @change="updatePosition(Number(($event.target as HTMLInputElement).value))"
        />
        <span>%</span>
      </label>
      <button type="button" :disabled="!canRemove" @click="removeActive">Remover ponto</button>
    </div>
    <p>Clique: nova cor · Alt + arrastar: duplicar · Setas: mover · Delete: remover</p>
  </section>
</template>

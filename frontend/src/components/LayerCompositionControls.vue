<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { blendModeLabel, LAYER_BLEND_MODES } from '../editor/blendModes'
import type { LayerBlendMode, LayerItem } from '../types/editor'

const props = defineProps<{
  activeLayer?: LayerItem
}>()

const emit = defineEmits<{
  (event: 'update:blendMode', value: LayerBlendMode): void
  (event: 'update:opacity', value: number): void
}>()

const blendButton = ref<HTMLButtonElement | null>(null)
const opacityButton = ref<HTMLButtonElement | null>(null)
const popover = ref<HTMLElement | null>(null)
const openControl = ref<'blend' | 'opacity'>()
const popoverRect = ref({ left: 0, top: 0, width: 180 })

const currentBlendModeLabel = computed(() => (
  props.activeLayer ? blendModeLabel(props.activeLayer.blendMode) : 'Normal'
))
const popoverStyle = computed(() => ({
  left: `${popoverRect.value.left}px`,
  top: `${popoverRect.value.top}px`,
  width: `${popoverRect.value.width}px`
}))

function removePopoverListeners() {
  window.removeEventListener('pointerdown', handleOutsidePointerDown)
  window.removeEventListener('keydown', handlePopoverKeydown)
  window.removeEventListener('resize', dismissControl)
  window.removeEventListener('scroll', dismissControl, true)
}

function closeControl(restoreFocus = false) {
  const control = openControl.value
  openControl.value = undefined
  removePopoverListeners()
  if (restoreFocus) {
    nextTick(() => (control === 'blend' ? blendButton.value : opacityButton.value)?.focus({ preventScroll: true }))
  }
}

function dismissControl() {
  closeControl()
}

function handleOutsidePointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (popover.value?.contains(target) || blendButton.value?.contains(target) || opacityButton.value?.contains(target)) return
  closeControl()
}

function handlePopoverKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  closeControl(true)
}

function positionPopover(control: 'blend' | 'opacity') {
  const anchor = control === 'blend' ? blendButton.value : opacityButton.value
  if (!anchor) return
  const bounds = anchor.getBoundingClientRect()
  const width = control === 'blend' ? Math.max(176, bounds.width) : 62
  const height = control === 'blend' ? 202 : 190
  const margin = 8
  const gap = 4
  const top = window.innerHeight - bounds.bottom >= height + gap || bounds.top < height + gap
    ? bounds.bottom + gap
    : bounds.top - height - gap
  const preferredLeft = control === 'blend' ? bounds.left : bounds.right - width
  popoverRect.value = {
    left: Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
    width
  }
}

async function toggleControl(control: 'blend' | 'opacity') {
  if (!props.activeLayer) return
  if (openControl.value === control) {
    closeControl()
    return
  }
  closeControl()
  positionPopover(control)
  openControl.value = control
  await nextTick()
  window.addEventListener('pointerdown', handleOutsidePointerDown)
  window.addEventListener('keydown', handlePopoverKeydown)
  window.addEventListener('resize', dismissControl)
  window.addEventListener('scroll', dismissControl, true)
  const focusTarget = control === 'blend'
    ? popover.value?.querySelector<HTMLElement>('[aria-selected="true"]')
    : popover.value?.querySelector<HTMLElement>('input[type="range"]')
  focusTarget?.focus({ preventScroll: true })
}

function selectBlendMode(value: LayerBlendMode) {
  emit('update:blendMode', value)
  closeControl(true)
}

function updateOpacity(value: number) {
  if (!Number.isFinite(value)) return
  emit('update:opacity', Math.min(100, Math.max(0, Math.round(value))))
}

function updateInlineOpacity(event: Event) {
  updateOpacity((event.currentTarget as HTMLInputElement).valueAsNumber)
}

function normalizeInlineOpacity(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  input.value = String(props.activeLayer?.opacity ?? 100)
}

watch(() => props.activeLayer?.id, () => closeControl())
onBeforeUnmount(() => closeControl())
</script>

<template>
  <div class="layer-composition-controls" aria-label="Composição da camada selecionada">
    <button
      ref="blendButton"
      class="property-select-button layer-blend-button"
      type="button"
      aria-label="Modo de mesclagem"
      aria-haspopup="listbox"
      :aria-expanded="openControl === 'blend'"
      :disabled="!activeLayer"
      @click="toggleControl('blend')"
      @keydown.down.prevent="toggleControl('blend')"
    >
      <span>{{ currentBlendModeLabel }}</span>
      <span aria-hidden="true">&#9662;</span>
    </button>

    <span class="layer-opacity-label">Opacidade:</span>
    <div class="layer-opacity-control" :class="{ 'layer-opacity-control--open': openControl === 'opacity' }">
      <input
        :value="activeLayer?.opacity ?? 100"
        aria-label="Opacidade da camada"
        :disabled="!activeLayer"
        max="100"
        min="0"
        type="number"
        @blur="normalizeInlineOpacity"
        @input="updateInlineOpacity"
        @keydown.enter.prevent="($event.currentTarget as HTMLInputElement).blur()"
      />
      <span aria-hidden="true">%</span>
      <button
        ref="opacityButton"
        type="button"
        aria-label="Abrir medidor de opacidade"
        aria-haspopup="dialog"
        :aria-expanded="openControl === 'opacity'"
        :disabled="!activeLayer"
        @click="toggleControl('opacity')"
        @keydown.down.prevent="toggleControl('opacity')"
      >
        <span aria-hidden="true">&#9662;</span>
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="openControl && activeLayer"
      ref="popover"
      class="property-control-popover"
      :class="`property-control-popover--${openControl}`"
      :style="popoverStyle"
      @pointerdown.stop
    >
      <div v-if="openControl === 'blend'" class="property-blend-options" role="listbox" aria-label="Modo de mesclagem">
        <button
          v-for="mode in LAYER_BLEND_MODES"
          :key="mode.value"
          class="property-blend-option"
          :class="{ 'property-blend-option--selected': mode.value === activeLayer.blendMode }"
          type="button"
          role="option"
          :aria-selected="mode.value === activeLayer.blendMode"
          @click="selectBlendMode(mode.value)"
        >
          <span class="property-option-marker" aria-hidden="true">&#10003;</span>
          <span>{{ mode.label }}</span>
        </button>
      </div>

      <div v-else class="property-opacity-meter" role="dialog" aria-label="Opacidade da camada">
        <div class="property-opacity-scale">
          <span>100</span>
          <input
            :value="activeLayer.opacity"
            aria-label="Opacidade"
            max="100"
            min="0"
            orient="vertical"
            type="range"
            @input="updateOpacity(Number(($event.target as HTMLInputElement).value))"
          />
          <span>0</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

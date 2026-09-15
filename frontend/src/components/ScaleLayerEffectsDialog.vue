<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import {
  MAX_LAYER_EFFECT_SCALE,
  MIN_LAYER_EFFECT_SCALE,
  normalizeLayerEffectScale
} from '../editor/layerStyleOperations'

const props = defineProps<{
  busy: boolean
  layerName?: string
  open: boolean
}>()

const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'confirm', percentage: number): void
  (event: 'preview', percentage: number): void
}>()

const dialog = ref<HTMLElement | null>(null)
const percentageInput = ref<HTMLInputElement | null>(null)
const percentage = ref(100)

function cancelDialog() {
  if (!props.busy) emit('cancel')
}

function updatePercentage(value: string | number) {
  percentage.value = normalizeLayerEffectScale(value)
  emit('preview', percentage.value)
}

function confirmDialog() {
  if (!props.busy) emit('confirm', normalizeLayerEffectScale(percentage.value))
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelDialog()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    confirmDialog()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = Array.from(dialog.value.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'))
  const first = controls[0]
  const last = controls.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (!open) return
  percentage.value = 100
  await nextTick()
  percentageInput.value?.focus()
  percentageInput.value?.select()
})
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="cancelDialog">
    <section
      ref="dialog"
      class="unsaved-dialog scale-effects-dialog"
      :aria-busy="busy"
      aria-modal="true"
      role="dialog"
      aria-labelledby="scale-effects-title"
      @keydown="handleKeydown"
    >
      <h2 id="scale-effects-title">Escalar efeitos</h2>
      <p v-if="layerName">Ajuste o tamanho dos efeitos aplicados em “{{ layerName }}”.</p>
      <label class="scale-effects-control">
        <span>Escala</span>
        <input
          :value="percentage"
          :min="MIN_LAYER_EFFECT_SCALE"
          :max="MAX_LAYER_EFFECT_SCALE"
          type="range"
          @input="updatePercentage(($event.target as HTMLInputElement).value)"
        />
        <input
          ref="percentageInput"
          :value="percentage"
          :min="MIN_LAYER_EFFECT_SCALE"
          :max="MAX_LAYER_EFFECT_SCALE"
          inputmode="numeric"
          type="number"
          @input="updatePercentage(($event.target as HTMLInputElement).value)"
        />
        <span>%</span>
      </label>
      <small>Dimensiona sombras, brilhos, traçados, acetinado e bisel. Cores e opacidades não mudam.</small>
      <div class="dialog-actions">
        <button :disabled="busy" type="button" @click="cancelDialog">Cancelar</button>
        <button class="primary-button" :disabled="busy" type="button" @click="confirmDialog">Aplicar</button>
      </div>
    </section>
  </div>
</template>

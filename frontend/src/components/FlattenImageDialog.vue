<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  busy: boolean
  hiddenCount: number
  open: boolean
}>()

const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'confirm'): void
}>()

const dialog = ref<HTMLElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)

function cancelDialog() {
  if (!props.busy) emit('cancel')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelDialog()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const buttons = Array.from(dialog.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  const first = buttons[0]
  const last = buttons.at(-1)
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
  await nextTick()
  confirmButton.value?.focus()
})
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="cancelDialog">
    <section
      ref="dialog"
      class="unsaved-dialog flatten-image-dialog"
      :aria-busy="busy"
      aria-modal="true"
      role="alertdialog"
      aria-labelledby="flatten-image-title"
      @keydown="handleKeydown"
    >
      <h2 id="flatten-image-title">Achatar imagem?</h2>
      <p>
        {{ hiddenCount === 1 ? 'Uma camada oculta será removida' : `${hiddenCount} camadas ocultas serão removidas` }}
        do documento. A operação poderá ser desfeita pelo histórico.
      </p>
      <div class="dialog-actions">
        <button :disabled="busy" type="button" @click="cancelDialog">Cancelar</button>
        <button ref="confirmButton" class="primary-button" :disabled="busy" type="button" @click="emit('confirm')">
          Achatar
        </button>
      </div>
    </section>
  </div>
</template>

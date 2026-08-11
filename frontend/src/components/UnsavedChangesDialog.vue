<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  busy: boolean
  documentName: string
  open: boolean
}>()

const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'discard'): void
  (event: 'save'): void
}>()

const dialog = ref<HTMLElement | null>(null)
const saveButton = ref<HTMLButtonElement | null>(null)

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
  saveButton.value?.focus()
})
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="cancelDialog">
    <section ref="dialog" class="unsaved-dialog" :aria-busy="busy" aria-modal="true" role="alertdialog" aria-labelledby="unsaved-title" @keydown="handleKeydown">
      <h2 id="unsaved-title">Salvar alterações?</h2>
      <p>O projeto <strong>{{ documentName }}</strong> possui alterações que ainda não foram salvas.</p>
      <div class="dialog-actions">
        <button :disabled="busy" type="button" @click="emit('discard')">Descartar</button>
        <button :disabled="busy" type="button" @click="cancelDialog">Cancelar</button>
        <button ref="saveButton" class="primary-button" :disabled="busy" type="button" @click="emit('save')">Salvar</button>
      </div>
    </section>
  </div>
</template>

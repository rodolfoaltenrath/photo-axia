<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { DocumentBackground, DocumentUnit, NewDocumentSettings } from '../types/editor'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'create', settings: NewDocumentSettings): void
}>()

const presets = [
  { label: 'Full HD', unit: 'px' as DocumentUnit, width: 1920, height: 1080, dpi: 72 },
  { label: 'Quadrado', unit: 'px' as DocumentUnit, width: 1080, height: 1080, dpi: 72 },
  { label: 'A4', unit: 'cm' as DocumentUnit, width: 21, height: 29.7, dpi: 300 },
  { label: 'Foto 10x15', unit: 'cm' as DocumentUnit, width: 10, height: 15, dpi: 300 }
]

const form = reactive({
  name: 'Sem titulo',
  unit: 'px' as DocumentUnit,
  width: 1920,
  height: 1080,
  resolutionDpi: 72,
  background: 'transparent' as DocumentBackground
})

const pixelSize = computed(() => {
  if (form.unit === 'px') {
    return {
      width: Math.max(1, Math.round(form.width)),
      height: Math.max(1, Math.round(form.height))
    }
  }

  return {
    width: Math.max(1, Math.round((form.width / 2.54) * form.resolutionDpi)),
    height: Math.max(1, Math.round((form.height / 2.54) * form.resolutionDpi))
  }
})

const validationError = computed(() => {
  if (!Number.isFinite(pixelSize.value.width) || !Number.isFinite(pixelSize.value.height)) {
    return 'Informe dimensões válidas.'
  }
  if (pixelSize.value.width > 16384 || pixelSize.value.height > 16384) {
    return 'Cada dimensão pode ter no máximo 16.384 px.'
  }
  if (pixelSize.value.width * pixelSize.value.height > 64_000_000) {
    return 'O documento pode ter no máximo 64 megapixels.'
  }
  return ''
})

watch(
  () => form.unit,
  (unit) => {
    if (unit === 'px' && form.resolutionDpi === 300) {
      form.resolutionDpi = 72
    }
    if (unit === 'cm' && form.resolutionDpi === 72) {
      form.resolutionDpi = 300
    }
  }
)

function applyPreset(index: number) {
  const preset = presets[index]
  form.unit = preset.unit
  form.width = preset.width
  form.height = preset.height
  form.resolutionDpi = preset.dpi
}

function createDocument() {
  if (validationError.value) return
  emit('create', {
    name: form.name.trim() || 'Sem titulo',
    unit: form.unit,
    width: form.width,
    height: form.height,
    resolutionDpi: form.resolutionDpi,
    background: form.background
  })
}
</script>

<template>
  <div v-if="props.open" class="dialog-backdrop" role="presentation" @click.self="emit('close')">
    <section class="new-document-dialog" aria-modal="true" role="dialog" aria-labelledby="new-doc-title">
      <header class="dialog-header">
        <div>
          <h2 id="new-doc-title">Novo documento</h2>
          <span>{{ pixelSize.width }} x {{ pixelSize.height }} px</span>
        </div>
        <button type="button" title="Fechar" @click="emit('close')">x</button>
      </header>

      <div class="preset-row" aria-label="Predefinições">
        <button
          v-for="(preset, index) in presets"
          :key="preset.label"
          type="button"
          @click="applyPreset(index)"
        >
          {{ preset.label }}
        </button>
      </div>

      <form class="document-form" @submit.prevent="createDocument">
        <label class="field-full">
          Nome
          <input v-model="form.name" type="text" />
        </label>

        <label>
          Unidade
          <select v-model="form.unit">
            <option value="px">Pixels</option>
            <option value="cm">Centímetros</option>
          </select>
        </label>

        <label>
          Resolução
          <input v-model.number="form.resolutionDpi" min="1" step="1" type="number" />
        </label>

        <label>
          Largura
          <input v-model.number="form.width" min="0.1" step="0.1" type="number" />
        </label>

        <label>
          Altura
          <input v-model.number="form.height" min="0.1" step="0.1" type="number" />
        </label>

        <label class="field-full">
          Fundo
          <select v-model="form.background">
            <option value="transparent">Transparente</option>
            <option value="white">Branco</option>
            <option value="black">Preto</option>
          </select>
        </label>

        <p v-if="validationError" class="form-error" role="alert">{{ validationError }}</p>

        <footer class="dialog-actions">
          <button type="button" @click="emit('close')">Cancelar</button>
          <button class="primary-button" :disabled="Boolean(validationError)" type="submit">Criar</button>
        </footer>
      </form>
    </section>
  </div>
</template>

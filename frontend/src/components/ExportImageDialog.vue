<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  EXPORT_FORMAT_CAPABILITIES,
  normalizeExportSettings,
  type ExportFormat,
  type ExportSettings
} from '../editor/exportSettings'

const props = defineProps<{
  background: 'transparent' | 'white' | 'black'
  busy: boolean
  estimatedBytes: number | null
  estimating: boolean
  height: number
  open: boolean
  resolutionDpi: number
  width: number
}>()

const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'estimate', settings: ExportSettings): void
  (event: 'export', settings: ExportSettings): void
  (event: 'settings-change'): void
}>()

const dialog = ref<HTMLElement | null>(null)
const formatInput = ref<HTMLSelectElement | null>(null)
const form = reactive({
  format: 'png' as ExportFormat,
  qualityPercent: 90,
  matteColor: '#ffffff'
})
const capabilities = computed(() => EXPORT_FORMAT_CAPABILITIES[form.format])
const hasTransparency = computed(() => props.background === 'transparent')
const formatHelp = computed(() => ({
  png: 'Mantém a melhor nitidez e o fundo transparente. Pode ficar maior em fotos.',
  jpeg: 'Cria arquivos menores para fotos. Não mantém fundo transparente.',
  webp: 'Boa opção para sites: costuma ficar pequeno e pode manter transparência.'
}[form.format]))
const controlsBusy = computed(() => props.busy || props.estimating)
const estimatedSize = computed(() => {
  if (props.estimatedBytes === null) return ''
  const units = ['bytes', 'KB', 'MB', 'GB']
  let value = props.estimatedBytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`
})

function currentSettings() {
  return normalizeExportSettings({
    format: form.format,
    quality: form.qualityPercent / 100,
    resolutionDpi: props.resolutionDpi,
    preserveMetadata: form.format === 'png',
    matteColor: form.matteColor
  })
}

function cancel() {
  if (!controlsBusy.value) emit('cancel')
}

function confirm() {
  if (controlsBusy.value) return
  emit('export', currentSettings())
}

function estimate() {
  if (controlsBusy.value) return
  emit('estimate', currentSettings())
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = Array.from(dialog.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => element.offsetParent !== null)
  const first = focusable[0]
  const last = focusable.at(-1)
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
  formatInput.value?.focus()
})

watch(() => [form.format, form.qualityPercent, form.matteColor], () => emit('settings-change'))
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="cancel">
    <section
      ref="dialog"
      class="export-image-dialog"
      :aria-busy="busy"
      aria-modal="true"
      role="dialog"
      aria-labelledby="export-image-title"
      @keydown="handleKeydown"
    >
      <header class="dialog-header">
        <div>
          <h2 id="export-image-title">Exportar imagem</h2>
          <span>Tamanho: {{ width }} × {{ height }} pixels</span>
        </div>
        <button :disabled="controlsBusy" type="button" title="Fechar" aria-label="Fechar" @click="cancel">×</button>
      </header>

      <form class="export-image-form" @submit.prevent="confirm">
        <label>
          Formato
          <select ref="formatInput" v-model="form.format" :disabled="controlsBusy">
            <option value="png">PNG — mais nítido e transparente</option>
            <option value="jpeg">JPEG — menor para fotos</option>
            <option value="webp">WebP — menor para sites</option>
          </select>
        </label>

        <p class="export-format-help">{{ formatHelp }}</p>

        <label v-if="capabilities.supportsLossyQuality">
          Qualidade da imagem: {{ form.qualityPercent }}%
          <input v-model.number="form.qualityPercent" :disabled="controlsBusy" max="100" min="1" step="1" type="range" />
        </label>

        <label v-if="!capabilities.supportsAlpha && hasTransparency">
          Fundo para transparência
          <span class="export-matte-control">
            <input v-model="form.matteColor" :disabled="controlsBusy" type="color" />
            <input v-model="form.matteColor" :disabled="controlsBusy" maxlength="7" pattern="#[0-9A-Fa-f]{6}" type="text" />
          </span>
        </label>

        <dl class="export-summary">
          <div><dt>Tamanho da imagem</dt><dd>{{ width }} × {{ height }} pixels</dd></div>
          <div><dt>Fundo transparente</dt><dd>{{ capabilities.supportsAlpha ? 'será mantido' : 'será substituído' }}</dd></div>
          <div><dt>Qualidade para impressão</dt><dd>{{ form.format === 'png' ? `${resolutionDpi} pixels por polegada` : 'não será incluída' }}</dd></div>
        </dl>

        <p v-if="estimatedBytes !== null" class="export-size-note" role="status">
          Tamanho aproximado: <strong>{{ estimatedSize }}</strong>
          <span v-if="form.format === 'png'"> (pode ficar um pouco menor ao salvar)</span>
        </p>
        <button v-else class="export-estimate-button" :disabled="controlsBusy" type="button" @click="estimate">
          {{ estimating ? 'Calculando…' : 'Calcular tamanho do arquivo' }}
        </button>
        <p v-if="form.format === 'jpeg' && hasTransparency" class="export-warning" role="status">
          JPEG não suporta transparência. As áreas transparentes usarão a cor de fundo escolhida.
        </p>

        <footer class="dialog-actions">
          <button :disabled="controlsBusy" type="button" @click="cancel">Cancelar</button>
          <button class="primary-button" :disabled="controlsBusy" type="submit">
            {{ busy ? 'Exportando…' : 'Exportar' }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

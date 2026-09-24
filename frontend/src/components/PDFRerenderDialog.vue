<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  PDF_IMPORT_DPI_OPTIONS,
  estimatePDFImportBytes,
  maximumPDFImportDPI,
  normalizePDFDPI,
  pdfPagePixelSize,
  validatePDFImport
} from '../editor/pdfImport.ts'
import type { PDFSmartSource } from '../types/editor.ts'

const props = defineProps<{
  busy: boolean
  error: string
  open: boolean
  progress: string
  source: PDFSmartSource | undefined
}>()

const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'rerender', request: { dpi: number; password: string }): void
}>()

const customDpi = ref(150)
const dpiMode = ref<'96' | '150' | '300' | 'custom'>('150')
const password = ref('')
const customDpiInput = ref<HTMLInputElement | null>(null)

const page = computed(() => props.source && ({
  pageNumber: props.source.pageNumber,
  widthPoints: props.source.widthPoints,
  heightPoints: props.source.heightPoints
}))
const effectiveDpi = computed(() => normalizePDFDPI(dpiMode.value === 'custom' ? customDpi.value : Number(dpiMode.value)))
const maximumDpi = computed(() => page.value ? maximumPDFImportDPI(page.value) : undefined)
const validationError = computed(() => page.value ? validatePDFImport({
  background: props.source?.background ?? 'white', dpi: effectiveDpi.value, pages: [1]
}, [{ ...page.value, pageNumber: 1 }]) : 'A origem PDF não está disponível.')
const size = computed(() => page.value ? pdfPagePixelSize(page.value, effectiveDpi.value) : undefined)
const estimatedBytes = computed(() => page.value ? estimatePDFImportBytes({
  background: props.source?.background ?? 'white', dpi: effectiveDpi.value, pages: [1]
}, [{ ...page.value, pageNumber: 1 }]) : 0)

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`
}

function useMaximumDpi() {
  if (maximumDpi.value === undefined) return
  dpiMode.value = 'custom'
  customDpi.value = maximumDpi.value
  void nextTick(() => customDpiInput.value?.focus())
}

function confirm() {
  if (props.busy || validationError.value) return
  emit('rerender', { dpi: effectiveDpi.value, password: password.value })
}

watch(() => props.open, (open) => {
  if (!open) return
  password.value = ''
  dpiMode.value = '150'
  customDpi.value = 150
})
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="emit('cancel')">
    <section class="pdf-rerender-dialog" aria-modal="true" role="dialog" aria-labelledby="pdf-rerender-title">
      <header class="dialog-header">
        <div>
          <h2 id="pdf-rerender-title">Re-renderizar PDF</h2>
          <span>{{ source?.name }} · página {{ source?.pageNumber }}</span>
        </div>
        <button type="button" title="Fechar" aria-label="Fechar" @click="emit('cancel')">×</button>
      </header>
      <div class="pdf-rerender-body">
        <p>Reconstrua o cache em outra resolução a partir do PDF original preservado. A escala e a posição da camada não serão alteradas.</p>
        <label>
          Qualidade
          <select v-model="dpiMode" :disabled="busy">
            <option v-for="option in PDF_IMPORT_DPI_OPTIONS" :key="option" :value="String(option)">
              {{ option === 96 ? 'Leve' : option === 150 ? 'Equilibrada' : 'Alta qualidade' }} — {{ option }} DPI
            </option>
            <option value="custom">Personalizada</option>
          </select>
        </label>
        <label v-if="dpiMode === 'custom'">
          Resolução
          <input ref="customDpiInput" v-model.number="customDpi" :disabled="busy" max="600" min="36" step="1" type="number" @keydown.enter.prevent.stop="customDpiInput?.blur()" />
        </label>
        <dl v-if="size" class="pdf-import-summary">
          <div><dt>Novo cache</dt><dd>{{ size.width }} × {{ size.height }} px</dd></div>
          <div><dt>Memória estimada</dt><dd>{{ formatBytes(estimatedBytes) }}</dd></div>
        </dl>
        <p v-if="validationError" class="form-error">{{ validationError }}</p>
        <button v-if="maximumDpi !== undefined && effectiveDpi > maximumDpi" class="link-button" type="button" @click="useMaximumDpi">Usar {{ maximumDpi }} DPI</button>
        <label v-if="error" class="pdf-rerender-password">
          Senha do PDF (caso ele seja protegido)
          <input v-model="password" :disabled="busy" autocomplete="current-password" type="password" />
        </label>
        <p v-if="error" class="form-error">{{ error }}</p>
        <p v-if="busy" class="pdf-import-progress" role="status">{{ progress }}</p>
      </div>
      <footer class="dialog-actions pdf-rerender-actions">
        <button type="button" @click="emit('cancel')">{{ busy ? 'Cancelar processamento' : 'Cancelar' }}</button>
        <button class="primary-button" :disabled="busy || Boolean(validationError)" type="button" @click="confirm">{{ busy ? 'Processando…' : 'Re-renderizar' }}</button>
      </footer>
    </section>
  </div>
</template>

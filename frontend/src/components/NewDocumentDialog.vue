<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  BUILTIN_DOCUMENT_PRESETS,
  convertDocumentUnit,
  documentBaseMemoryBytes,
  documentPhysicalSize,
  documentPixelSize,
  parseCustomDocumentPresets,
  proportionalDocumentDimension,
  validateDocumentSettings,
  type DocumentPreset
} from '../editor/document'
import type { DocumentBackground, DocumentUnit, NewDocumentSettings } from '../types/editor'
import { canCreateDocument } from '../editor/interactionGuards'

const props = defineProps<{
  busy: boolean
  open: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'create', settings: NewDocumentSettings): void
}>()

const PRESETS_STORAGE_KEY = 'axia:document-presets'
const dialog = ref<HTMLElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const category = ref<DocumentPreset['category']>('screen')
const customPresets = ref<DocumentPreset[]>(loadCustomPresets())
const savingPreset = ref(false)
const presetName = ref('')
const keepProportions = ref(true)
const aspectRatio = ref(1920 / 1080)
const form = reactive<NewDocumentSettings>({
  name: 'Sem título',
  unit: 'px',
  width: 1920,
  height: 1080,
  resolutionDpi: 72,
  background: 'transparent'
})

const categories: Array<{ id: DocumentPreset['category']; label: string }> = [
  { id: 'screen', label: 'Tela' },
  { id: 'photo', label: 'Foto' },
  { id: 'print', label: 'Impressão' },
  { id: 'saved', label: 'Salvos' }
]

const visiblePresets = computed(() => (
  category.value === 'saved'
    ? customPresets.value
    : BUILTIN_DOCUMENT_PRESETS.filter((preset) => preset.category === category.value)
))
const pixelSize = computed(() => documentPixelSize(form))
const validationError = computed(() => validateDocumentSettings(form))
const megapixels = computed(() => (pixelSize.value.width * pixelSize.value.height / 1_000_000).toFixed(2))
const physicalSize = computed(() => documentPhysicalSize(form))
const physicalSizeLabel = computed(() => (
  `${physicalSize.value.widthCentimeters.toFixed(2)} × ${physicalSize.value.heightCentimeters.toFixed(2)} cm`
))
const memoryLabel = computed(() => {
  const bytes = documentBaseMemoryBytes(form)
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})

function loadCustomPresets() {
  try {
    const stored = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) ?? '[]') as unknown
    return parseCustomDocumentPresets(stored)
  } catch {
    return []
  }
}

function persistCustomPresets() {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(customPresets.value))
  } catch {
    // O diálogo continua funcional quando preferências locais estão indisponíveis.
  }
}

function applyPreset(preset: DocumentPreset) {
  form.unit = preset.unit
  form.width = preset.width
  form.height = preset.height
  form.resolutionDpi = preset.resolutionDpi
  form.background = preset.background
  aspectRatio.value = preset.width / preset.height
}

function swapOrientation() {
  const width = form.width
  form.width = form.height
  form.height = width
  aspectRatio.value = form.width / form.height
}

function changeUnit(event: Event) {
  const nextUnit = (event.target as HTMLSelectElement).value as DocumentUnit
  Object.assign(form, convertDocumentUnit(form, nextUnit))
  updateAspectRatio()
}

function updateAspectRatio() {
  if (Number.isFinite(form.width) && form.width > 0 && Number.isFinite(form.height) && form.height > 0) {
    aspectRatio.value = form.width / form.height
  }
}

function toggleProportions() {
  if (keepProportions.value) updateAspectRatio()
}

function changeDimension(changed: 'width' | 'height', event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber
  form[changed] = value
  if (!keepProportions.value) return
  const linked = proportionalDocumentDimension(value, aspectRatio.value, form.unit, changed)
  if (linked !== null) form[changed === 'width' ? 'height' : 'width'] = linked
}

function savePreset() {
  const label = presetName.value.trim()
  if (!label || validationError.value) return
  const preset: DocumentPreset = {
    ...form,
    id: crypto.randomUUID(),
    category: 'saved',
    label
  }
  customPresets.value = [
    preset,
    ...customPresets.value
  ].slice(0, 20)
  persistCustomPresets()
  presetName.value = ''
  savingPreset.value = false
  category.value = 'saved'
}

function deletePreset(id: string) {
  customPresets.value = customPresets.value.filter((preset) => preset.id !== id)
  persistCustomPresets()
}

function createDocument() {
  if (!canCreateDocument(props.busy, validationError.value)) return
  emit('create', { ...form, name: form.name.trim() || 'Sem título' })
}

function closeDialog() {
  if (!props.busy) emit('close')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDialog()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = Array.from(dialog.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
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
  if (!open) {
    savingPreset.value = false
    presetName.value = ''
    return
  }
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
})
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="closeDialog">
    <section
      ref="dialog"
      class="new-document-dialog new-document-dialog--expanded"
      :aria-busy="busy"
      aria-modal="true"
      role="dialog"
      aria-labelledby="new-doc-title"
      @keydown="handleKeydown"
    >
      <header class="dialog-header">
        <div>
          <h2 id="new-doc-title">Novo documento</h2>
          <span>{{ pixelSize.width }} × {{ pixelSize.height }} px · {{ megapixels }} MP</span>
        </div>
        <button :disabled="busy" type="button" title="Fechar" aria-label="Fechar" @click="closeDialog">×</button>
      </header>

      <div class="new-document-content">
        <section class="document-presets" aria-label="Predefinições de documento">
          <nav class="preset-categories" aria-label="Categorias">
            <button
              v-for="item in categories"
              :key="item.id"
              :aria-pressed="category === item.id"
              :disabled="busy"
              type="button"
              @click="category = item.id"
            >
              {{ item.label }}
            </button>
          </nav>
          <div v-if="visiblePresets.length" class="preset-grid">
            <article
              v-for="preset in visiblePresets"
              :key="preset.id"
              class="document-preset-card"
            >
              <button class="preset-apply" :disabled="busy" type="button" @click="applyPreset(preset)">
                <span class="preset-ratio" :style="{ aspectRatio: `${preset.width} / ${preset.height}` }"></span>
                <strong>{{ preset.label }}</strong>
                <small>{{ preset.width }} × {{ preset.height }} {{ preset.unit }}</small>
              </button>
              <button
                v-if="preset.category === 'saved'"
                class="preset-delete"
                :aria-label="`Excluir predefinição ${preset.label}`"
                :disabled="busy"
                title="Excluir predefinição"
                type="button"
                @click.stop="deletePreset(preset.id)"
              >×</button>
            </article>
          </div>
          <div v-else class="preset-empty">
            <p>Nenhuma predefinição salva.</p>
            <span>Configure o documento ao lado e salve para reutilizar.</span>
          </div>
        </section>

        <form class="document-form document-details" :aria-busy="busy" :inert="busy || undefined" @submit.prevent="createDocument">
          <label class="field-full">
            Nome
            <input ref="nameInput" v-model="form.name" :disabled="busy" maxlength="160" type="text" />
          </label>

          <label>
            Largura
            <input
              :value="form.width"
              :disabled="busy"
              :min="form.unit === 'px' ? 1 : 0.01"
              :step="form.unit === 'px' ? 1 : 0.01"
              type="number"
              @input="changeDimension('width', $event)"
            />
          </label>
          <label>
            Altura
            <input
              :value="form.height"
              :disabled="busy"
              :min="form.unit === 'px' ? 1 : 0.01"
              :step="form.unit === 'px' ? 1 : 0.01"
              type="number"
              @input="changeDimension('height', $event)"
            />
          </label>
          <label class="document-proportion-lock field-full">
            <input v-model="keepProportions" :disabled="busy" type="checkbox" @change="toggleProportions" />
            Manter proporção entre largura e altura
          </label>
          <label>
            Unidade
            <select :value="form.unit" :disabled="busy" @change="changeUnit">
              <option value="px">Pixels</option>
              <option value="cm">Centímetros</option>
              <option value="mm">Milímetros</option>
              <option value="in">Polegadas</option>
            </select>
          </label>
          <label>
            Resolução
            <span class="field-with-suffix">
              <input v-model.number="form.resolutionDpi" :disabled="busy" max="2400" min="1" step="1" type="number" />
              <span>ppi</span>
            </span>
          </label>

          <p class="document-resolution-help field-full">
            <template v-if="form.unit === 'px'">
              Em pixels, o PPI define apenas o tamanho físico e os metadados: não redimensiona o documento nem reduz o arquivo.
            </template>
            <template v-else>
              Em unidades físicas, o PPI determina quantos pixels serão criados.
            </template>
          </p>

          <div class="orientation-control field-full">
            <span>Orientação</span>
            <button :disabled="busy" type="button" @click="swapOrientation">↔ Trocar largura e altura</button>
          </div>

          <label class="field-full">
            Conteúdo do fundo
            <select v-model="form.background" :disabled="busy">
              <option value="transparent">Transparente</option>
              <option value="white">Branco</option>
              <option value="black">Preto</option>
            </select>
          </label>

          <details class="document-advanced field-full">
            <summary>Opções avançadas</summary>
            <dl>
              <div><dt>Modo de cor</dt><dd>RGB · 8 bits</dd></div>
              <div><dt>Perfil</dt><dd>sRGB</dd></div>
              <div><dt>Proporção do pixel</dt><dd>Pixels quadrados</dd></div>
            </dl>
          </details>

          <div class="document-estimate field-full">
            <span>Tamanho base</span>
            <strong>{{ pixelSize.width }} × {{ pixelSize.height }} px · {{ memoryLabel }}</strong>
            <small>Tamanho físico em {{ form.resolutionDpi || 0 }} ppi: {{ physicalSizeLabel }}</small>
          </div>

          <p v-if="validationError" class="form-error field-full" role="alert">{{ validationError }}</p>

          <div v-if="savingPreset" class="save-preset-row field-full">
            <input v-model="presetName" :disabled="busy" maxlength="80" placeholder="Nome da predefinição" type="text" />
            <button :disabled="busy || !presetName.trim() || Boolean(validationError)" type="button" @click="savePreset">Salvar</button>
            <button :disabled="busy" type="button" @click="savingPreset = false">Cancelar</button>
          </div>

          <footer class="dialog-actions field-full">
            <button :disabled="busy" type="button" @click="savingPreset = !savingPreset">Salvar predefinição</button>
            <button :disabled="busy" type="button" @click="closeDialog">Cancelar</button>
            <button class="primary-button" :disabled="busy || Boolean(validationError)" type="submit">Criar</button>
          </footer>
        </form>
      </div>
    </section>
  </div>
</template>

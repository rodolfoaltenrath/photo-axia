<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import {
  PDF_IMPORT_DPI_OPTIONS,
  estimatePDFImportBytes,
  normalizePDFDPI,
  normalizePDFPages,
  pdfPagePixelSize,
  validatePDFImport,
  type PDFImportBackground
} from '../editor/pdfImport.ts'
import {
  closePDFImport,
  isPDFPasswordError,
  openPDFImport,
  renderPDFThumbnail,
  type PDFImportSource,
  type PDFRenderRequest
} from '../services/pdfImport.ts'
import type { PDFDocumentProxy } from 'pdfjs-dist'

const props = defineProps<{
  busy: boolean
  open: boolean
  progress: string
  source: PDFImportSource | null
}>()

const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'import', request: PDFRenderRequest): void
}>()

const dialog = ref<HTMLElement | null>(null)
const dpiInput = ref<HTMLSelectElement | null>(null)
const pageGrid = ref<HTMLElement | null>(null)
const pdf = shallowRef<PDFDocumentProxy>()
const pages = ref<Awaited<ReturnType<typeof openPDFImport>>['pages']>([])
const thumbnails = ref<string[]>([])
const selectedPage = ref<number>()
const customDpi = ref(150)
const dpiMode = ref<'96' | '150' | '300' | 'custom'>('150')
const background = ref<PDFImportBackground>('white')
const password = ref('')
const passwordRequired = ref(false)
const loading = ref(false)
const errorText = ref('')
let loadGeneration = 0
let handedOff = false
let loadController: AbortController | undefined
let thumbnailObserver: IntersectionObserver | undefined
let activeThumbnailRenders = 0
const thumbnailQueue: number[] = []
const queuedThumbnails = new Set<number>()

const effectiveDpi = computed(() => normalizePDFDPI(dpiMode.value === 'custom' ? customDpi.value : Number(dpiMode.value)))
const controlsBusy = computed(() => props.busy || loading.value)
const normalizedSelection = computed(() => normalizePDFPages(
  selectedPage.value === undefined ? [] : [selectedPage.value],
  pages.value.length
))
const validationError = computed(() => validatePDFImport({
  background: background.value,
  dpi: effectiveDpi.value,
  pages: normalizedSelection.value
}, pages.value))
const estimatedBytes = computed(() => estimatePDFImportBytes({
  background: background.value,
  dpi: effectiveDpi.value,
  pages: normalizedSelection.value
}, pages.value))
const selectedSize = computed(() => {
  const page = pages.value[normalizedSelection.value[0]! - 1]
  return page ? pdfPagePixelSize(page, effectiveDpi.value) : undefined
})

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`
}

function releaseThumbnails() {
  for (const source of thumbnails.value) if (source) URL.revokeObjectURL(source)
  thumbnails.value = []
}

function resetThumbnailLoading() {
  thumbnailObserver?.disconnect()
  thumbnailObserver = undefined
  thumbnailQueue.length = 0
  queuedThumbnails.clear()
  activeThumbnailRenders = 0
}

function pumpThumbnailQueue(generation: number, controller: AbortController) {
  while (activeThumbnailRenders < 2 && thumbnailQueue.length) {
    const pageNumber = thumbnailQueue.shift()!
    queuedThumbnails.delete(pageNumber)
    activeThumbnailRenders++
    void (async () => {
      try {
        const document = pdf.value
        if (!document || generation !== loadGeneration || controller.signal.aborted) return
        const page = await document.getPage(pageNumber)
        const thumbnail = await renderPDFThumbnail(page, 168, controller.signal)
        if (generation !== loadGeneration || controller.signal.aborted) {
          URL.revokeObjectURL(thumbnail)
          return
        }
        const previous = thumbnails.value[pageNumber - 1]
        if (previous) URL.revokeObjectURL(previous)
        thumbnails.value[pageNumber - 1] = thumbnail
        thumbnails.value = [...thumbnails.value]
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn(`Não foi possível gerar a miniatura da página ${pageNumber}.`, error)
        }
      } finally {
        if (generation !== loadGeneration) return
        activeThumbnailRenders = Math.max(0, activeThumbnailRenders - 1)
        if (!controller.signal.aborted) pumpThumbnailQueue(generation, controller)
      }
    })()
  }
}

function enqueueThumbnail(pageNumber: number, generation: number, controller: AbortController) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.value.length) return
  if (thumbnails.value[pageNumber - 1] || queuedThumbnails.has(pageNumber)) return
  queuedThumbnails.add(pageNumber)
  thumbnailQueue.push(pageNumber)
  pumpThumbnailQueue(generation, controller)
}

function observeVisibleThumbnails(generation: number, controller: AbortController) {
  const grid = pageGrid.value
  if (!grid) return
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-pdf-page]'))
  if (typeof IntersectionObserver === 'undefined') {
    for (const card of cards) enqueueThumbnail(Number(card.dataset.pdfPage), generation, controller)
    return
  }
  thumbnailObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      observer.unobserve(entry.target)
      enqueueThumbnail(Number((entry.target as HTMLElement).dataset.pdfPage), generation, controller)
    }
  }, { root: grid, rootMargin: '220px 0px' })
  for (const card of cards) thumbnailObserver.observe(card)
}

async function cleanup() {
  loadGeneration++
  loadController?.abort()
  loadController = undefined
  resetThumbnailLoading()
  releaseThumbnails()
  const current = pdf.value
  pdf.value = undefined
  pages.value = []
  selectedPage.value = undefined
  if (current && !handedOff) await closePDFImport(current).catch(() => undefined)
  handedOff = false
}

async function loadDocument() {
  const source = props.source
  if (!source) return
  const generation = ++loadGeneration
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  loading.value = true
  errorText.value = ''
  passwordRequired.value = false
  resetThumbnailLoading()
  releaseThumbnails()
  if (pdf.value) await closePDFImport(pdf.value).catch(() => undefined)
  pdf.value = undefined
  try {
    const opened = await openPDFImport(source.sourceUrl, password.value, controller.signal)
    if (generation !== loadGeneration) {
      await closePDFImport(opened.document)
      return
    }
    pdf.value = opened.document
    pages.value = opened.pages
    selectedPage.value = opened.pages.length ? 1 : undefined
    thumbnails.value = Array.from({ length: opened.pages.length }, () => '')
    loading.value = false
    await nextTick()
    dpiInput.value?.focus()
    observeVisibleThumbnails(generation, controller)
  } catch (error) {
    if (generation !== loadGeneration) return
    if (error instanceof DOMException && error.name === 'AbortError') return
    passwordRequired.value = isPDFPasswordError(error)
    errorText.value = passwordRequired.value
      ? 'Este PDF é protegido. Digite a senha para continuar.'
      : error instanceof Error ? error.message : 'Não foi possível abrir o PDF.'
  } finally {
    if (loadController === controller && !pdf.value) loadController = undefined
    if (generation === loadGeneration) loading.value = false
  }
}

function selectPage(pageNumber: number) {
  selectedPage.value = pageNumber
}

function cancel() {
  loadController?.abort()
  emit('cancel')
}

function confirm() {
  if (controlsBusy.value || validationError.value || !pdf.value || !props.source) return
  loadGeneration++
  loadController?.abort()
  loadController = undefined
  handedOff = true
  emit('import', {
    background: background.value,
    document: pdf.value,
    dpi: effectiveDpi.value,
    name: props.source.name,
    pages: normalizedSelection.value,
    pageSizes: pages.value
  })
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

watch(() => [props.open, props.source?.sourceUrl] as const, async ([open]) => {
  await cleanup()
  password.value = ''
  errorText.value = ''
  passwordRequired.value = false
  if (open && props.source) void loadDocument()
}, { immediate: true })
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="cancel">
    <section
      ref="dialog"
      class="pdf-import-dialog"
      :aria-busy="controlsBusy"
      aria-modal="true"
      role="dialog"
      aria-labelledby="pdf-import-title"
      @keydown="handleKeydown"
    >
      <header class="dialog-header">
        <div>
          <h2 id="pdf-import-title">Importar página do PDF</h2>
          <span>{{ source?.name }}<template v-if="pages.length"> · {{ pages.length }} {{ pages.length === 1 ? 'página' : 'páginas' }}</template></span>
        </div>
        <button type="button" title="Fechar" aria-label="Fechar" @click="cancel">×</button>
      </header>

      <div v-if="loading" class="pdf-import-loading" role="status">Lendo páginas e preparando miniaturas…</div>

      <form v-else-if="pages.length" class="pdf-import-body" @submit.prevent="confirm">
        <aside class="pdf-import-options">
          <label>
            Qualidade
            <select ref="dpiInput" v-model="dpiMode" :disabled="props.busy">
              <option v-for="option in PDF_IMPORT_DPI_OPTIONS" :key="option" :value="String(option)">
                {{ option === 96 ? 'Leve' : option === 150 ? 'Equilibrada' : 'Alta qualidade' }} — {{ option }} DPI
              </option>
              <option value="custom">Personalizada</option>
            </select>
          </label>
          <label v-if="dpiMode === 'custom'">
            Resolução
            <input v-model.number="customDpi" :disabled="props.busy" max="600" min="36" step="1" type="number" />
          </label>
          <fieldset>
            <legend>Fundo</legend>
            <label><input v-model="background" :disabled="props.busy" type="radio" value="white" /> Branco</label>
            <label><input v-model="background" :disabled="props.busy" type="radio" value="transparent" /> Transparente</label>
          </fieldset>
          <dl class="pdf-import-summary">
            <div><dt>Página escolhida</dt><dd>{{ selectedPage ?? 'Nenhuma' }}</dd></div>
            <div v-if="selectedSize"><dt>Tamanho final</dt><dd>{{ selectedSize.width }} × {{ selectedSize.height }} px</dd></div>
            <div><dt>Uso estimado de memória</dt><dd>{{ formatBytes(estimatedBytes) }}</dd></div>
          </dl>
          <p>A página será convertida em pixels. Textos e vetores não permanecerão editáveis.</p>
        </aside>

        <section class="pdf-page-picker" aria-label="Páginas do PDF">
          <header>
            <strong>Escolha uma página</strong>
          </header>
          <div ref="pageGrid" class="pdf-page-grid">
            <button
              v-for="page in pages"
              :key="page.pageNumber"
              :aria-pressed="selectedPage === page.pageNumber"
              :class="{ 'pdf-page-card--selected': selectedPage === page.pageNumber }"
              :disabled="props.busy"
              :data-pdf-page="page.pageNumber"
              type="button"
              @click="selectPage(page.pageNumber)"
            >
              <span class="pdf-page-thumbnail">
                <img v-if="thumbnails[page.pageNumber - 1]" :src="thumbnails[page.pageNumber - 1]" alt="" />
                <span v-else aria-hidden="true"></span>
              </span>
              <span>Página {{ page.pageNumber }}</span>
            </button>
          </div>
        </section>

        <p v-if="validationError" class="form-error pdf-import-error">{{ validationError }}</p>
        <p v-if="props.busy" class="pdf-import-progress" role="status">{{ progress }}</p>
        <footer class="dialog-actions pdf-import-actions">
          <button type="button" @click="cancel">{{ props.busy ? 'Cancelar importação' : 'Cancelar' }}</button>
          <button class="primary-button" :disabled="controlsBusy || Boolean(validationError)" type="submit">
            {{ props.busy ? 'Importando…' : 'Importar página' }}
          </button>
        </footer>
      </form>

      <form v-else class="pdf-import-error-state" @submit.prevent="loadDocument">
        <p :class="{ 'form-error': !passwordRequired }">{{ errorText || 'O PDF não contém páginas disponíveis.' }}</p>
        <label v-if="passwordRequired">
          Senha do PDF
          <input v-model="password" autocomplete="current-password" type="password" />
        </label>
        <div class="dialog-actions">
          <button type="button" @click="cancel">Cancelar</button>
          <button v-if="passwordRequired" class="primary-button" type="submit">Abrir PDF</button>
        </div>
      </form>
    </section>
  </div>
</template>

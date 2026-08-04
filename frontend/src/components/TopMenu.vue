<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { HistoryTimelineItem } from '../editor/history'

const props = defineProps<{
  canRedo: boolean
  canUndo: boolean
  documentName: string
  historyBytes: number
  historyItems: HistoryTimelineItem[]
  historyPosition: number
  redoLabel?: string
  statusText: string
  undoLabel?: string
}>()

const emit = defineEmits<{
  (event: 'exportDocument'): void
  (event: 'historyJump', position: number): void
  (event: 'importImages'): void
  (event: 'newDocument'): void
  (event: 'previewFilter', filterName: string): void
  (event: 'redo'): void
  (event: 'undo'): void
}>()

const historyDetails = ref<HTMLDetailsElement | null>(null)

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function jumpToHistory(position: number) {
  emit('historyJump', position)
  if (historyDetails.value) historyDetails.value.open = false
}

async function revealCurrentHistory() {
  if (!historyDetails.value?.open) return
  await nextTick()
  historyDetails.value.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' })
}

function closeHistory(event: PointerEvent | KeyboardEvent) {
  const details = historyDetails.value
  if (!details?.open) return
  if (event instanceof KeyboardEvent) {
    if (event.key === 'Escape') details.open = false
    return
  }
  if (event.target instanceof Node && !details.contains(event.target)) details.open = false
}

onMounted(() => {
  window.addEventListener('pointerdown', closeHistory, true)
  window.addEventListener('keydown', closeHistory)
})

watch(() => props.historyPosition, revealCurrentHistory)

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', closeHistory, true)
  window.removeEventListener('keydown', closeHistory)
})
</script>

<template>
  <header class="top-menu">
    <div class="brand">
      <span class="brand-mark">A</span>
      <strong>Axia</strong>
    </div>

    <nav class="menu-actions" aria-label="Acoes principais">
      <button type="button" @click="emit('newDocument')">Novo</button>
      <button type="button" @click="emit('importImages')">Importar</button>
      <div class="history-actions" aria-label="Histórico">
        <button
          class="history-icon-button"
          type="button"
          :disabled="!canUndo"
          :title="canUndo ? `Desfazer ${undoLabel} (Ctrl+Z)` : 'Nada para desfazer'"
          aria-label="Desfazer"
          @click="emit('undo')"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" /></svg>
        </button>
        <button
          class="history-icon-button"
          type="button"
          :disabled="!canRedo"
          :title="canRedo ? `Refazer ${redoLabel} (Ctrl+Shift+Z)` : 'Nada para refazer'"
          aria-label="Refazer"
          @click="emit('redo')"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6" /></svg>
        </button>
        <details ref="historyDetails" class="history-menu" @toggle="revealCurrentHistory">
          <summary class="history-icon-button" title="Abrir histórico" aria-label="Abrir histórico">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5v5h5M5.5 9A8 8 0 1 1 4 14m8-6v5l3 2" /></svg>
          </summary>
          <div class="history-popover">
            <div class="history-popover-title">
              <strong>Histórico</strong>
              <span>{{ historyPosition }}/{{ Math.max(0, historyItems.length - 1) }} · {{ formatBytes(historyBytes) }}</span>
            </div>
            <ol class="history-list">
              <li v-for="item in historyItems" :key="item.id">
                <button
                  type="button"
                  :class="[`history-entry--${item.state}`]"
                  :aria-current="item.state === 'current' ? 'step' : undefined"
                  @click="jumpToHistory(item.position)"
                >
                  <span class="history-entry-marker" aria-hidden="true"></span>
                  <span>{{ item.label }}</span>
                </button>
              </li>
            </ol>
          </div>
        </details>
      </div>
      <button disabled title="Formato de projeto em breve" type="button">Salvar</button>
      <button disabled title="Filtros não destrutivos em breve" type="button">Filtro</button>
      <button type="button" @click="emit('exportDocument')">Exportar PNG</button>
    </nav>

    <div class="document-status">
      <strong>{{ documentName }}</strong>
      <span>{{ statusText }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { HistoryTimelineItem } from '../editor/history'
import axiaLogo from '../../../assets/Logo.png'

type MenuName = 'file' | 'edit' | 'layer' | 'select' | 'window'

const props = defineProps<{
  canConvertToSmartLayer: boolean
  canDeleteLayer: boolean
  canDuplicateLayer: boolean
  canEditSmartLayer: boolean
  canFillLayer: boolean
  canFlattenImage: boolean
  canMergeLayers: boolean
  canRasterizeLayer: boolean
  canRedo: boolean
  canUndo: boolean
  documentDirty: boolean
  documentName: string
  hasSelection: boolean
  historyBytes: number
  historyItems: HistoryTimelineItem[]
  historyPosition: number
  isBusy: boolean
  redoLabel?: string
  statusText: string
  undoLabel?: string
}>()

const emit = defineEmits<{
  (event: 'addLayer'): void
  (event: 'clearSelection'): void
  (event: 'convertToSmartLayer'): void
  (event: 'deleteLayer'): void
  (event: 'deleteSelection'): void
  (event: 'duplicateLayer'): void
  (event: 'editSmartLayer'): void
  (event: 'exportDocument'): void
  (event: 'fillBackground'): void
  (event: 'fillForeground'): void
  (event: 'flattenImage'): void
  (event: 'historyJump', position: number): void
  (event: 'home'): void
  (event: 'importImages'): void
  (event: 'mergeLayers'): void
  (event: 'newDocument'): void
  (event: 'openLayerStyles'): void
  (event: 'openProject'): void
  (event: 'rasterizeLayer'): void
  (event: 'redo'): void
  (event: 'saveProject'): void
  (event: 'undo'): void
}>()

const menuBar = ref<HTMLElement | null>(null)
const openMenu = ref<MenuName>()
const historyOpen = ref(false)

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function toggleMenu(menu: MenuName) {
  historyOpen.value = false
  openMenu.value = openMenu.value === menu ? undefined : menu
}

function switchOpenMenu(menu: MenuName) {
  if (openMenu.value && openMenu.value !== menu) {
    historyOpen.value = false
    openMenu.value = menu
  }
}

function closeMenus() {
  openMenu.value = undefined
  historyOpen.value = false
}

function runCommand(command: () => void) {
  closeMenus()
  command()
}

function jumpToHistory(position: number) {
  closeMenus()
  emit('historyJump', position)
}

async function revealCurrentHistory() {
  if (!historyOpen.value) return
  await nextTick()
  menuBar.value?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' })
}

function handleGlobalPointerDown(event: PointerEvent) {
  if (event.target instanceof Node && !menuBar.value?.contains(event.target)) closeMenus()
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !openMenu.value) return
  event.preventDefault()
  closeMenus()
}

onMounted(() => {
  window.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('keydown', handleGlobalKeydown)
})

watch(() => props.historyPosition, revealCurrentHistory)
watch(historyOpen, revealCurrentHistory)

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <header class="top-menu">
    <button class="brand brand-button" title="Ir para o início" type="button" @click="emit('home')">
      <img class="brand-logo" :src="axiaLogo" alt="Axia Studio" />
    </button>

    <nav ref="menuBar" class="menu-actions" aria-label="Menu do aplicativo" role="menubar">
      <div class="application-menu" @pointerenter="switchOpenMenu('file')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'file'" @click="toggleMenu('file')" @keydown.down.prevent="openMenu = 'file'">Arquivo</button>
        <div v-if="openMenu === 'file'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('newDocument'))">Novo</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('openProject'))">Abrir projeto</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('importImages'))">Importar imagens</button>
          <div class="application-menu-separator" role="separator"></div>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('saveProject'))">Salvar</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('exportDocument'))">Exportar imagem…</button>
        </div>
      </div>

      <div class="application-menu" @pointerenter="switchOpenMenu('edit')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'edit'" @click="toggleMenu('edit')" @keydown.down.prevent="openMenu = 'edit'">Editar</button>
        <div v-if="openMenu === 'edit'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" :disabled="isBusy || !canUndo" :title="canUndo ? `Desfazer ${undoLabel}` : 'Nada para desfazer'" @click="runCommand(() => emit('undo'))">Desfazer</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canRedo" :title="canRedo ? `Refazer ${redoLabel}` : 'Nada para refazer'" @click="runCommand(() => emit('redo'))">Refazer</button>
          <div class="application-menu-separator" role="separator"></div>
          <button type="button" role="menuitem" :disabled="isBusy || !canFillLayer" title="Preencher com a cor principal (Alt+Backspace)" @click="runCommand(() => emit('fillForeground'))">Preencher com cor principal</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canFillLayer" title="Preencher com a cor secundária (Ctrl+Backspace)" @click="runCommand(() => emit('fillBackground'))">Preencher com cor secundária</button>
        </div>
      </div>

      <button class="application-menu-trigger" type="button" role="menuitem" disabled @pointerenter="closeMenus">Imagem</button>

      <div class="application-menu" @pointerenter="switchOpenMenu('layer')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'layer'" @click="toggleMenu('layer')" @keydown.down.prevent="openMenu = 'layer'">Camada</button>
        <div v-if="openMenu === 'layer'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('addLayer'))">Nova camada</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canDuplicateLayer" @click="runCommand(() => emit('duplicateLayer'))">Duplicar camada</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canDeleteLayer" @click="runCommand(() => emit('deleteLayer'))">Excluir camada</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canMergeLayers" @click="runCommand(() => emit('mergeLayers'))">Mesclar selecionadas</button>
          <div class="application-menu-separator" role="separator"></div>
          <button v-if="canConvertToSmartLayer" type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('convertToSmartLayer'))">Converter em camada inteligente</button>
          <button v-if="canEditSmartLayer" type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('editSmartLayer'))">Editar conteúdo</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('openLayerStyles'))">Opções de mesclagem…</button>
          <button v-if="canRasterizeLayer" type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('rasterizeLayer'))">Rasterizar camada</button>
          <div class="application-menu-separator" role="separator"></div>
          <button type="button" role="menuitem" :disabled="isBusy || !canFlattenImage" @click="runCommand(() => emit('flattenImage'))">Achatar imagem</button>
        </div>
      </div>

      <button class="application-menu-trigger" type="button" role="menuitem" disabled @pointerenter="closeMenus">Texto</button>

      <div class="application-menu" @pointerenter="switchOpenMenu('select')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'select'" @click="toggleMenu('select')" @keydown.down.prevent="openMenu = 'select'">Selecionar</button>
        <div v-if="openMenu === 'select'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" :disabled="isBusy || !hasSelection" @click="runCommand(() => emit('deleteSelection'))">Apagar pixels selecionados</button>
          <button type="button" role="menuitem" :disabled="!hasSelection" @click="runCommand(() => emit('clearSelection'))">Desmarcar</button>
        </div>
      </div>

      <button class="application-menu-trigger" type="button" role="menuitem" disabled @pointerenter="closeMenus">Filtro</button>

      <div class="application-menu" @pointerenter="switchOpenMenu('window')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'window'" @click="toggleMenu('window')" @keydown.down.prevent="openMenu = 'window'">Janela</button>
        <div v-if="openMenu === 'window'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" aria-haspopup="true" :aria-expanded="historyOpen" @click.stop="historyOpen = !historyOpen">Histórico<span aria-hidden="true">›</span></button>

          <div v-if="historyOpen" class="history-popover application-history-popover">
            <div class="history-popover-title">
              <strong>Histórico</strong>
              <span>{{ historyPosition }}/{{ Math.max(0, historyItems.length - 1) }} · {{ formatBytes(historyBytes) }}</span>
            </div>
            <ol class="history-list">
              <li v-for="item in historyItems" :key="item.id">
                <button type="button" :class="[`history-entry--${item.state}`]" :aria-current="item.state === 'current' ? 'step' : undefined" @click="jumpToHistory(item.position)">
                  <span class="history-entry-marker" aria-hidden="true"></span>
                  <span>{{ item.label }}</span>
                </button>
              </li>
            </ol>
          </div>
        </div>
      </div>

      <button class="application-menu-trigger" type="button" role="menuitem" disabled @pointerenter="closeMenus">Ajuda</button>
    </nav>

    <div class="document-status">
      <strong>{{ documentName }}{{ documentDirty ? ' *' : '' }}</strong>
      <span>{{ statusText }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { HistoryTimelineItem } from '../editor/history'
import { formatOfficialMessage, type MessageKey, type MessageParams, type OfficialLocale } from '../i18n/catalogs'
import axiaLogo from '../../../assets/Logo.png'

type MenuName = 'file' | 'edit' | 'layer' | 'text' | 'select' | 'window'

const props = withDefaults(defineProps<{
  canConvertToSmartLayer: boolean
  canClearLayerStyles: boolean
  canDeleteLayer: boolean
  canDuplicateLayer: boolean
  canEditText: boolean
  canEditSmartLayer: boolean
  canFillLayer: boolean
  canFlattenImage: boolean
  canMergeLayers: boolean
  canPasteLayerStyles: boolean
  canRasterizeLayer: boolean
  canRerenderPdfLayer: boolean
  canScaleLayerEffects: boolean
  canRedo: boolean
  canUndo: boolean
  characterPanelOpen: boolean
  documentDirty: boolean
  documentName: string
  hasSelection: boolean
  historyBytes: number
  historyItems: HistoryTimelineItem[]
  historyPosition: number
  isBusy: boolean
  redoLabel?: string
  statusText: string
  styleTargetCount: number
  undoLabel?: string
  locale?: OfficialLocale
}>(), { locale: 'pt-BR' })

const t = (key: MessageKey, params?: MessageParams) => formatOfficialMessage(props.locale, key, params)

const emit = defineEmits<{
  (event: 'addLayer'): void
  (event: 'clearSelection'): void
  (event: 'clearLayerStyles'): void
  (event: 'convertToSmartLayer'): void
  (event: 'copyLayerStyles'): void
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
  (event: 'importPdf'): void
  (event: 'mergeLayers'): void
  (event: 'newDocument'): void
  (event: 'openLayerStyles'): void
  (event: 'openStylePresets'): void
  (event: 'openImageDocument'): void
  (event: 'openPdfDocument'): void
  (event: 'openProject'): void
  (event: 'pasteLayerStyles'): void
  (event: 'rasterizeLayer'): void
  (event: 'rerenderPdfLayer'): void
  (event: 'scaleLayerEffects'): void
  (event: 'redo'): void
  (event: 'saveProject'): void
  (event: 'undo'): void
  (event: 'toggleCharacterPanel'): void
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
    <button class="brand brand-button" :title="t('menu.home')" type="button" @click="emit('home')">
      <img class="brand-logo" :src="axiaLogo" alt="Axia Studio" />
    </button>

    <nav ref="menuBar" class="menu-actions" :aria-label="t('menu.appLabel')" role="menubar">
      <div class="application-menu" @pointerenter="switchOpenMenu('file')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'file'" @click="toggleMenu('file')" @keydown.down.prevent="openMenu = 'file'">{{ t('menu.file') }}</button>
        <div v-if="openMenu === 'file'" class="application-menu-popover application-menu-popover--file" role="menu">
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('newDocument'))">{{ t('menu.file.new') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('openProject'))">{{ t('menu.file.openProject') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('openImageDocument'))">{{ t('menu.file.openImageDocument') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('openPdfDocument'))">{{ t('menu.file.openPdfDocument') }}</button>
          <div class="application-menu-separator" role="separator"></div>
          <button type="button" role="menuitem" :disabled="isBusy" :title="t('menu.file.addImagesTitle')" @click="runCommand(() => emit('importImages'))">{{ t('menu.file.addImages') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('importPdf'))">{{ t('menu.file.addPdf') }}</button>
          <div class="application-menu-separator" role="separator"></div>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('saveProject'))">{{ t('menu.file.save') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('exportDocument'))">{{ t('menu.file.export') }}</button>
        </div>
      </div>

      <div class="application-menu" @pointerenter="switchOpenMenu('edit')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'edit'" @click="toggleMenu('edit')" @keydown.down.prevent="openMenu = 'edit'">{{ t('menu.edit') }}</button>
        <div v-if="openMenu === 'edit'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" :disabled="isBusy || !canUndo" :title="canUndo ? t('menu.edit.undoNamed', { action: undoLabel ?? '' }) : t('menu.edit.undoUnavailable')" @click="runCommand(() => emit('undo'))">{{ t('menu.edit.undo') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canRedo" :title="canRedo ? t('menu.edit.redoNamed', { action: redoLabel ?? '' }) : t('menu.edit.redoUnavailable')" @click="runCommand(() => emit('redo'))">{{ t('menu.edit.redo') }}</button>
          <div class="application-menu-separator" role="separator"></div>
          <button type="button" role="menuitem" :disabled="isBusy || !canFillLayer" :title="t('menu.edit.fillForegroundTitle')" @click="runCommand(() => emit('fillForeground'))">{{ t('menu.edit.fillForeground') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canFillLayer" :title="t('menu.edit.fillBackgroundTitle')" @click="runCommand(() => emit('fillBackground'))">{{ t('menu.edit.fillBackground') }}</button>
        </div>
      </div>

      <button class="application-menu-trigger" type="button" role="menuitem" disabled @pointerenter="closeMenus">{{ t('menu.image') }}</button>

      <div class="application-menu" @pointerenter="switchOpenMenu('layer')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'layer'" @click="toggleMenu('layer')" @keydown.down.prevent="openMenu = 'layer'">{{ t('menu.layer') }}</button>
        <div v-if="openMenu === 'layer'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('addLayer'))">{{ t('menu.layer.new') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canDuplicateLayer" @click="runCommand(() => emit('duplicateLayer'))">{{ t('menu.layer.duplicate') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canDeleteLayer" @click="runCommand(() => emit('deleteLayer'))">{{ t('menu.layer.delete') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canMergeLayers" @click="runCommand(() => emit('mergeLayers'))">{{ t('menu.layer.merge') }}</button>
          <button v-if="canRerenderPdfLayer" type="button" role="menuitem" :disabled="isBusy" :title="t('menu.layer.rerenderPdfTitle')" @click="runCommand(() => emit('rerenderPdfLayer'))">{{ t('menu.layer.rerenderPdf') }}</button>
          <div class="application-menu-separator" role="separator"></div>
          <button v-if="canConvertToSmartLayer" type="button" role="menuitem" :disabled="isBusy" :title="t('menu.layer.convertSmartTitle')" @click="runCommand(() => emit('convertToSmartLayer'))">{{ t('menu.layer.convertSmart') }}</button>
          <button v-if="canEditSmartLayer" type="button" role="menuitem" :disabled="isBusy" :title="t('menu.layer.editSmartTitle')" @click="runCommand(() => emit('editSmartLayer'))">{{ t('menu.layer.editSmart') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('openLayerStyles'))">{{ t('menu.layer.blendingOptions') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('openStylePresets'))">{{ t('menu.layer.styles') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy" @click="runCommand(() => emit('copyLayerStyles'))">{{ t('menu.layer.copyStyle') }}</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canPasteLayerStyles" @click="runCommand(() => emit('pasteLayerStyles'))">{{ t('menu.layer.pasteStyle', { count: Math.max(1, styleTargetCount) }) }}</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canClearLayerStyles" @click="runCommand(() => emit('clearLayerStyles'))">{{ t('menu.layer.clearStyle', { count: Math.max(1, styleTargetCount) }) }}</button>
          <button type="button" role="menuitem" :disabled="isBusy || !canScaleLayerEffects" @click="runCommand(() => emit('scaleLayerEffects'))">{{ t('menu.layer.scaleEffects', { count: Math.max(1, styleTargetCount) }) }}</button>
          <button v-if="canRasterizeLayer" type="button" role="menuitem" :disabled="isBusy" :title="t('menu.layer.rasterizeTitle')" @click="runCommand(() => emit('rasterizeLayer'))">{{ t('menu.layer.rasterize') }}</button>
          <div class="application-menu-separator" role="separator"></div>
          <button type="button" role="menuitem" :disabled="isBusy || !canFlattenImage" @click="runCommand(() => emit('flattenImage'))">{{ t('menu.layer.flatten') }}</button>
        </div>
      </div>

      <div class="application-menu" @pointerenter="switchOpenMenu('text')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'text'" @click="toggleMenu('text')" @keydown.down.prevent="openMenu = 'text'">{{ t('menu.text') }}</button>
        <div v-if="openMenu === 'text'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" :disabled="!canEditText" @click="runCommand(() => emit('toggleCharacterPanel'))">{{ t('menu.text.characters') }}</button>
        </div>
      </div>

      <div class="application-menu" @pointerenter="switchOpenMenu('select')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'select'" @click="toggleMenu('select')" @keydown.down.prevent="openMenu = 'select'">{{ t('menu.select') }}</button>
        <div v-if="openMenu === 'select'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitem" :disabled="isBusy || !hasSelection" @click="runCommand(() => emit('deleteSelection'))">{{ t('menu.select.deletePixels') }}</button>
          <button type="button" role="menuitem" :disabled="!hasSelection" @click="runCommand(() => emit('clearSelection'))">{{ t('menu.select.deselect') }}</button>
        </div>
      </div>

      <button class="application-menu-trigger" type="button" role="menuitem" disabled @pointerenter="closeMenus">{{ t('menu.filter') }}</button>

      <div class="application-menu" @pointerenter="switchOpenMenu('window')">
        <button class="application-menu-trigger" type="button" role="menuitem" aria-haspopup="menu" :aria-expanded="openMenu === 'window'" @click="toggleMenu('window')" @keydown.down.prevent="openMenu = 'window'">{{ t('menu.window') }}</button>
        <div v-if="openMenu === 'window'" class="application-menu-popover" role="menu">
          <button type="button" role="menuitemcheckbox" :aria-checked="characterPanelOpen" @click="runCommand(() => emit('toggleCharacterPanel'))">{{ t('menu.window.characters') }}</button>
          <div class="application-menu-separator" role="separator"></div>
          <button type="button" role="menuitem" aria-haspopup="true" :aria-expanded="historyOpen" @click.stop="historyOpen = !historyOpen">{{ t('menu.window.history') }}<span aria-hidden="true">›</span></button>

          <div v-if="historyOpen" class="history-popover application-history-popover">
            <div class="history-popover-title">
              <strong>{{ t('menu.window.history') }}</strong>
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

      <button class="application-menu-trigger" type="button" role="menuitem" disabled @pointerenter="closeMenus">{{ t('menu.help') }}</button>
    </nav>

    <div class="document-status">
      <strong>{{ documentName }}{{ documentDirty ? ' *' : '' }}</strong>
      <span>{{ statusText }}</span>
    </div>
  </header>
</template>

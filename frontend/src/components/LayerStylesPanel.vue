<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { layerEffectLabel } from '../editor/layerStyles'
import type { LayerStylePreset } from '../editor/layerStylePresets'
import type { LayerEffect, LayerStyleGradient } from '../types/editor'

const props = defineProps<{
  busy: boolean
  layerName?: string
  presets: LayerStylePreset[]
  targetCount: number
}>()

const emit = defineEmits<{
  (event: 'apply', id: string): void
  (event: 'delete', id: string): void
  (event: 'save', name: string): void
}>()

const contextMenu = ref<{ x: number; y: number; presetId?: string }>()

function contextMenuPosition(event: MouseEvent) {
  const menuWidth = 150
  const menuHeight = 76
  return {
    x: Math.max(6, Math.min(event.clientX, window.innerWidth - menuWidth - 6)),
    y: Math.max(6, Math.min(event.clientY, window.innerHeight - menuHeight - 6))
  }
}

function openContextMenu(event: MouseEvent) {
  contextMenu.value = contextMenuPosition(event)
}

function openPresetContextMenu(event: MouseEvent, preset: LayerStylePreset) {
  contextMenu.value = {
    ...contextMenuPosition(event),
    presetId: preset.builtin ? undefined : preset.id
  }
}

function beginCreate() {
  contextMenu.value = undefined
  const numericNames = props.presets
    .map((preset) => /^\d+$/.test(preset.name) ? Number(preset.name) : 0)
    .filter((value) => Number.isSafeInteger(value) && value > 0)
  emit('save', String(Math.max(0, ...numericNames) + 1))
}

function closeContextMenu() {
  contextMenu.value = undefined
}

function deleteContextPreset() {
  const presetId = contextMenu.value?.presetId
  contextMenu.value = undefined
  if (presetId) emit('delete', presetId)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeContextMenu()
}

onMounted(() => {
  document.addEventListener('pointerdown', closeContextMenu)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeContextMenu)
  document.removeEventListener('keydown', handleKeydown)
})

function effectColor(effect: LayerEffect, fallback: string) {
  if ('color' in effect) return effect.color
  if ('paint' in effect && effect.paint.type === 'color') return effect.paint.color
  return fallback
}

function colorWithOpacity(color: string, opacity: number) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(color)
  if (!match) return color
  const channels = match.slice(1).map((channel) => Number.parseInt(channel, 16))
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${opacity})`
}

function gradientCSS(gradient: LayerStyleGradient, angle = 90) {
  const stops = gradient.colorStops.map((stop) => `${stop.color} ${Math.round(stop.position * 100)}%`).join(', ')
  return `linear-gradient(${angle}deg, ${stops})`
}

function shadowOffset(angle: number, distance: number) {
  const radians = angle * Math.PI / 180
  const scale = Math.min(7, Math.max(1, distance / 2))
  return { x: Math.round(Math.cos(radians) * scale), y: Math.round(-Math.sin(radians) * scale) }
}

function previewStyle(preset: LayerStylePreset) {
  const effects = preset.styles.enabled ? preset.styles.effects.filter((effect) => effect.enabled) : []
  let background = 'linear-gradient(135deg, #fafafa, #aeb5bd)'
  const shadows: string[] = []
  let border = ''

  for (const effect of effects) {
    const opacity = Math.max(0, Math.min(1, effect.opacity / 100))
    if (effect.type === 'color-overlay') background = effect.color
    if (effect.type === 'gradient-overlay') background = gradientCSS(effect.gradient, effect.angle)
    if (effect.type === 'pattern-overlay') background = 'repeating-linear-gradient(135deg, #b9c0c8 0 3px, #727b86 3px 6px)'
    if (effect.type === 'drop-shadow') {
      const offset = shadowOffset(effect.angle, effect.distance)
      shadows.push(`${offset.x}px ${offset.y}px ${Math.min(12, effect.size / 2 + 1)}px ${colorWithOpacity(effect.color, opacity)}`)
    }
    if (effect.type === 'inner-shadow') {
      const offset = shadowOffset(effect.angle, effect.distance)
      shadows.push(`inset ${offset.x}px ${offset.y}px ${Math.min(10, effect.size / 2 + 1)}px ${colorWithOpacity(effect.color, opacity)}`)
    }
    if (effect.type === 'outer-glow') shadows.push(`0 0 ${Math.min(12, effect.size / 2 + 2)}px ${colorWithOpacity(effectColor(effect, '#ffffff'), opacity)}`)
    if (effect.type === 'inner-glow') shadows.push(`inset 0 0 ${Math.min(12, effect.size / 2 + 2)}px ${colorWithOpacity(effectColor(effect, '#ffffff'), opacity)}`)
    if (effect.type === 'stroke') border = `${Math.min(4, Math.max(1, effect.size))}px solid ${effectColor(effect, '#111111')}`
    if (effect.type === 'satin') shadows.push(`inset 5px 5px 8px ${effect.color}`)
    if (effect.type === 'bevel-emboss') shadows.push('inset 2px 2px 2px rgb(255 255 255 / 65%), inset -2px -2px 2px rgb(0 0 0 / 55%)')
  }

  return {
    background,
    border,
    boxShadow: shadows.join(', '),
    opacity: Math.max(0.15, preset.styles.fillOpacity / 100)
  }
}

function effectSummary(preset: LayerStylePreset) {
  const labels = preset.styles.effects.filter((effect) => effect.enabled).map((effect) => layerEffectLabel(effect.type))
  return labels.length ? labels.join(', ') : 'Sem efeitos ativos'
}

const targetLabel = computed(() => props.targetCount > 1
  ? `${props.targetCount} camadas selecionadas`
  : props.layerName ?? 'Camada atual')
</script>

<template>
  <div class="styles-panel">
    <div class="styles-panel-intro">
      <strong>Biblioteca de estilos</strong>
      <span>Aplicar em {{ targetLabel }}</span>
    </div>

    <div class="style-thumbnail-grid" aria-live="polite" @contextmenu.prevent.stop="openContextMenu">
      <p v-if="!presets.length">Nenhum estilo salvo ainda.</p>
      <article
        v-for="preset in presets"
        :key="preset.id"
        class="style-thumbnail-card"
        @contextmenu.prevent.stop="openPresetContextMenu($event, preset)"
      >
        <button
          class="style-thumbnail-apply"
          :disabled="busy"
          type="button"
          :title="`Aplicar ${preset.name}. ${effectSummary(preset)}`"
          @click="emit('apply', preset.id)"
        >
          <span class="style-thumbnail-preview" aria-hidden="true">
            <span :style="previewStyle(preset)"></span>
          </span>
          <span class="visually-hidden">{{ preset.name }}</span>
        </button>
      </article>
    </div>

    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="layer-context-menu style-library-context-menu"
        role="menu"
        aria-label="Ações da biblioteca de estilos"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @contextmenu.prevent
        @pointerdown.stop
      >
        <button :disabled="busy" type="button" role="menuitem" @click="beginCreate">Novo estilo…</button>
        <button
          v-if="contextMenu.presetId"
          class="layer-action--danger"
          :disabled="busy"
          type="button"
          role="menuitem"
          @click="deleteContextPreset"
        >Excluir estilo</button>
      </div>
    </Teleport>
  </div>
</template>

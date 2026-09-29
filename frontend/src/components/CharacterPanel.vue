<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { TextLayerContent } from '../types/editor'

const props = defineProps<{
  collapsed?: boolean
  docked?: boolean
  layerName?: string
  text?: TextLayerContent
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'dock'): void
  (event: 'dragging', value: boolean): void
  (event: 'toggle:collapsed'): void
  (event: 'undock'): void
  (event: 'update:text', patch: Partial<TextLayerContent>): void
}>()

const panel = ref<HTMLElement | null>(null)
const position = ref({ x: 0, y: 0 })
let drag: { pointerId: number; x: number; y: number; startX: number; startY: number } | undefined

const panelStyle = computed(() => props.docked ? undefined : ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`
}))

function clampPosition(next = position.value) {
  const width = panel.value?.offsetWidth ?? 304
  const height = panel.value?.offsetHeight ?? 470
  return {
    x: Math.max(8, Math.min(next.x, Math.max(8, window.innerWidth - width - 8))),
    y: Math.max(44, Math.min(next.y, Math.max(44, window.innerHeight - height - 8)))
  }
}

function placeInitially() {
  if (position.value.x || position.value.y) return
  position.value = clampPosition({ x: window.innerWidth - 628, y: 116 })
}

function beginMove(event: PointerEvent) {
  if (props.docked || props.collapsed || event.button !== 0 || (event.target as Element | null)?.closest('button, input, select, textarea, label')) return
  drag = {
    pointerId: event.pointerId,
    x: position.value.x,
    y: position.value.y,
    startX: event.clientX,
    startY: event.clientY
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  emit('dragging', true)
  event.preventDefault()
}

function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  position.value = clampPosition({
    x: drag.x + event.clientX - drag.startX,
    y: drag.y + event.clientY - drag.startY
  })
}

function finishMove(event?: PointerEvent) {
  if (event && drag && event.pointerId !== drag.pointerId) return
  const shouldDock = Boolean(drag && event && event.clientX >= window.innerWidth - 340)
  drag = undefined
  emit('dragging', false)
  if (shouldDock) emit('dock')
}

function toggleWeight() {
  const text = props.text
  if (!text) return
  emit('update:text', { fontWeight: text.fontWeight >= 600 ? 400 : 700 })
}

function handleResize() {
  position.value = clampPosition()
}

onMounted(() => {
  placeInitially()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  finishMove()
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <section
    ref="panel"
    class="character-panel"
    :class="{
      'character-panel--collapsed': collapsed,
      'character-panel--docked': docked,
      'character-panel--floating': !docked
    }"
    :style="panelStyle"
    aria-labelledby="character-panel-title"
    role="dialog"
    @pointermove="move"
    @pointerup="finishMove"
    @pointercancel="finishMove"
  >
    <button
      v-if="collapsed"
      class="character-panel-collapsed-button"
      title="Expandir Caracteres"
      type="button"
      @click="emit('toggle:collapsed')"
    >T</button>
    <template v-else>
    <header class="character-panel-header" @pointerdown="beginMove">
      <div>
        <h2 id="character-panel-title">Caracteres</h2>
        <span :title="layerName">{{ text ? layerName || 'Camada de texto' : 'Selecione uma camada de texto' }}</span>
      </div>
      <div class="character-panel-header-actions">
        <button
          v-if="docked"
          aria-label="Desacoplar painel Caracteres"
          title="Desacoplar"
          type="button"
          @click="emit('undock')"
        >↗</button>
        <button
          v-else
          aria-label="Acoplar painel Caracteres"
          title="Acoplar à direita"
          type="button"
          @click="emit('dock')"
        >↘</button>
        <button aria-label="Recolher painel Caracteres" title="Recolher" type="button" @click="emit('toggle:collapsed')">−</button>
        <button aria-label="Fechar painel Caracteres" title="Fechar" type="button" @click="emit('close')">×</button>
      </div>
    </header>

    <div v-if="text" class="character-panel-content">
      <label class="character-panel-font">
        <span>Fonte e fallback CSS</span>
        <input
          :value="text.fontFamily"
          list="character-font-family-options"
          maxlength="512"
          @change="emit('update:text', { fontFamily: ($event.target as HTMLInputElement).value })"
        />
        <datalist id="character-font-family-options">
          <option value="Arial, sans-serif">Arial</option>
          <option value="Helvetica, Arial, sans-serif">Helvetica</option>
          <option value="Verdana, sans-serif">Verdana</option>
          <option value="Tahoma, sans-serif">Tahoma</option>
          <option value="Trebuchet MS, sans-serif">Trebuchet MS</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="Times New Roman, serif">Times New Roman</option>
          <option value="'Courier New', monospace">Courier New</option>
          <option value="Impact, sans-serif">Impact</option>
          <option value="system-ui, sans-serif">Sistema</option>
        </datalist>
      </label>

      <div class="character-panel-grid">
        <label>
          Estilo
          <select :value="text.fontStyle ?? 'normal'" @change="emit('update:text', { fontStyle: ($event.target as HTMLSelectElement).value as 'normal' | 'italic' })">
            <option value="normal">Normal</option>
            <option value="italic">Itálico</option>
          </select>
        </label>
        <label>
          Peso
          <select :value="text.fontWeight" @change="emit('update:text', { fontWeight: Number(($event.target as HTMLSelectElement).value) })">
            <option :value="300">Leve</option>
            <option :value="400">Normal</option>
            <option :value="600">Seminegrito</option>
            <option :value="700">Negrito</option>
          </select>
        </label>
        <label>
          Tamanho
          <input :value="text.fontSize" max="1000" min="1" type="number" @input="emit('update:text', { fontSize: Number(($event.target as HTMLInputElement).value) })" />
        </label>
        <label>
          Entrelinha
          <input :value="text.lineHeight" max="3" min="0.6" step="0.05" type="number" @input="emit('update:text', { lineHeight: Number(($event.target as HTMLInputElement).value) })" />
        </label>
        <label>
          Espaçamento
          <input :value="text.letterSpacing ?? 0" max="1000" min="-100" step="0.1" type="number" @input="emit('update:text', { letterSpacing: Number(($event.target as HTMLInputElement).value) })" />
        </label>
        <label>
          Cor
          <input class="character-panel-color" :value="text.color" type="color" @input="emit('update:text', { color: ($event.target as HTMLInputElement).value })" />
        </label>
      </div>

      <div class="character-panel-actions">
        <div class="character-panel-button-group" role="group" aria-label="Estilo tipográfico">
          <button :aria-pressed="text.fontWeight >= 600" title="Negrito" type="button" @click="toggleWeight"><strong>B</strong></button>
          <button :aria-pressed="text.fontStyle === 'italic'" title="Itálico" type="button" @click="emit('update:text', { fontStyle: text.fontStyle === 'italic' ? 'normal' : 'italic' })"><em>I</em></button>
          <button :aria-pressed="text.textTransform === 'uppercase'" title="Caixa alta" type="button" @click="emit('update:text', { textTransform: text.textTransform === 'uppercase' ? 'none' : 'uppercase' })">TT</button>
        </div>
        <div class="character-panel-button-group" role="group" aria-label="Alinhamento do texto">
          <button :aria-pressed="text.alignment === 'left'" title="Alinhar à esquerda" type="button" @click="emit('update:text', { alignment: 'left' })">≡</button>
          <button class="character-align-center" :aria-pressed="text.alignment === 'center'" title="Centralizar" type="button" @click="emit('update:text', { alignment: 'center' })">≡</button>
          <button class="character-align-right" :aria-pressed="text.alignment === 'right'" title="Alinhar à direita" type="button" @click="emit('update:text', { alignment: 'right' })">≡</button>
        </div>
      </div>

      <label>
        Decoração
        <select :value="text.decoration ?? 'none'" @change="emit('update:text', { decoration: ($event.target as HTMLSelectElement).value as TextLayerContent['decoration'] })">
          <option value="none">Nenhuma</option>
          <option value="underline">Sublinhado</option>
          <option value="line-through">Tachado</option>
        </select>
      </label>
    </div>
    <p v-else class="character-panel-empty">Selecione uma camada de texto para editar seus caracteres.</p>
    </template>
  </section>
</template>

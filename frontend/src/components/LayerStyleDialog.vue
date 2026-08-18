<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  centerFloatingWindow,
  fitFloatingWindow,
  moveFloatingWindow,
  resizeFloatingWindow,
  type FloatingWindowCorner,
  type FloatingWindowRect
} from '../editor/floatingWindow'
import {
  cloneLayerStyleConfig,
  createDefaultLayerEffect,
  normalizeLayerEffect,
  normalizeLayerStyleFillOpacity
} from '../editor/layerStyles'
import type { LayerStyleConfig, OuterGlowEffect } from '../types/editor'

const props = defineProps<{
  layerName: string
  open: boolean
  rasterEffectsAvailable: boolean
  styles: LayerStyleConfig
}>()

const emit = defineEmits<{
  (event: 'apply', styles: LayerStyleConfig): void
  (event: 'cancel'): void
  (event: 'preview', styles: LayerStyleConfig): void
}>()

const dialog = ref<HTMLElement | null>(null)
const initialFocus = ref<HTMLButtonElement | null>(null)
const draft = shallowRef(cloneLayerStyleConfig(props.styles))
const outerGlowSettings = shallowRef(createDefaultLayerEffect('outer-glow') as OuterGlowEffect)
const selectedCategory = ref<'blending' | 'outer-glow'>('blending')
const previewEnabled = ref(true)
let outerGlowOriginallyPresent = false

const DEFAULT_DIALOG_SIZE = { width: 680, height: 580 }
const MINIMUM_DIALOG_SIZE = { width: 560, height: 420 }
const dialogRect = shallowRef<FloatingWindowRect>({ left: 0, top: 0, ...DEFAULT_DIALOG_SIZE })
let dialogPositioned = false
let pointerInteraction: {
  corner?: FloatingWindowCorner
  kind: 'move' | 'resize'
  pointerId: number
  startClientX: number
  startClientY: number
  startRect: FloatingWindowRect
  target: HTMLElement
} | undefined
let previousBodyCursor = ''
let previousBodyUserSelect = ''

const dialogStyle = computed(() => ({
  height: `${dialogRect.value.height}px`,
  left: `${dialogRect.value.left}px`,
  top: `${dialogRect.value.top}px`,
  width: `${dialogRect.value.width}px`
}))

const outerGlow = computed(() => draft.value.effects.find(
  (effect): effect is OuterGlowEffect => effect.type === 'outer-glow'
))
const outerGlowActive = computed(() => Boolean(outerGlow.value?.enabled))
const outerGlowColor = computed(() => {
  const paint = outerGlowSettings.value.paint
  return paint.type === 'color' ? paint.color : paint.gradient.colorStops[0]?.color ?? '#ffffbe'
})
const outerGlowGradientEnd = computed(() => {
  const paint = outerGlowSettings.value.paint
  return paint.type === 'gradient' ? paint.gradient.colorStops.at(-1)?.color ?? '#ffffff' : '#ffffff'
})

function publishPreview() {
  if (previewEnabled.value) emit('preview', cloneLayerStyleConfig(draft.value))
}

function updateFillOpacity(value: number) {
  draft.value = {
    ...draft.value,
    fillOpacity: normalizeLayerStyleFillOpacity(value)
  }
  publishPreview()
}

function normalizedOuterGlow(value: OuterGlowEffect) {
  return normalizeLayerEffect(value) as OuterGlowEffect
}

function replaceOuterGlow(effect: OuterGlowEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateOuterGlow(patch: Partial<OuterGlowEffect>) {
  outerGlowSettings.value = normalizedOuterGlow({ ...outerGlowSettings.value, ...patch })
  if (outerGlow.value) replaceOuterGlow(outerGlowSettings.value)
  publishPreview()
}

function toggleOuterGlow(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  outerGlowSettings.value = normalizedOuterGlow({ ...outerGlowSettings.value, enabled })
  if (!enabled && !outerGlowOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== outerGlowSettings.value.id)
    }
  } else {
    replaceOuterGlow(outerGlowSettings.value)
  }
  publishPreview()
}

function setOuterGlowPaint(type: 'color' | 'gradient') {
  if (type === 'color') {
    updateOuterGlow({ paint: { type: 'color', color: outerGlowColor.value } })
    return
  }
  updateOuterGlow({
    paint: {
      type: 'gradient',
      angle: 90,
      scale: 100,
      reverse: false,
      alignWithLayer: true,
      gradient: {
        type: 'linear',
        colorStops: [
          { position: 0, color: outerGlowColor.value },
          { position: 1, color: outerGlowGradientEnd.value }
        ],
        opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 0 }],
        interpolation: 'srgb'
      }
    }
  })
}

function updateGradientColor(position: 0 | 1, color: string) {
  const paint = outerGlowSettings.value.paint
  if (paint.type !== 'gradient') return
  const colorStops = paint.gradient.colorStops.map((stop, index) => index === position ? { ...stop, color } : stop)
  updateOuterGlow({ paint: { ...paint, gradient: { ...paint.gradient, colorStops } } })
}

function togglePreview(event: Event) {
  previewEnabled.value = (event.target as HTMLInputElement).checked
  emit('preview', cloneLayerStyleConfig(previewEnabled.value ? draft.value : props.styles))
}

function restoreDefault() {
  if (selectedCategory.value === 'blending') {
    updateFillOpacity(100)
    return
  }
  const replacement = createDefaultLayerEffect('outer-glow', outerGlowSettings.value.id) as OuterGlowEffect
  outerGlowSettings.value = { ...replacement, enabled: outerGlowActive.value }
  if (outerGlow.value) replaceOuterGlow(outerGlowSettings.value)
  publishPreview()
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function finishPointerInteraction(event?: PointerEvent) {
  const interaction = pointerInteraction
  if (!interaction || (event && event.pointerId !== interaction.pointerId)) return
  pointerInteraction = undefined
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', finishPointerInteraction)
  window.removeEventListener('pointercancel', finishPointerInteraction)
  if (interaction.target.hasPointerCapture?.(interaction.pointerId)) {
    interaction.target.releasePointerCapture(interaction.pointerId)
  }
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
}

function handlePointerMove(event: PointerEvent) {
  const interaction = pointerInteraction
  if (!interaction || event.pointerId !== interaction.pointerId) return
  event.preventDefault()
  const deltaX = event.clientX - interaction.startClientX
  const deltaY = event.clientY - interaction.startClientY
  dialogRect.value = interaction.kind === 'move'
    ? moveFloatingWindow(interaction.startRect, deltaX, deltaY, viewportSize(), MINIMUM_DIALOG_SIZE)
    : resizeFloatingWindow(
        interaction.startRect,
        interaction.corner!,
        deltaX,
        deltaY,
        viewportSize(),
        MINIMUM_DIALOG_SIZE
      )
}

function startPointerInteraction(
  event: PointerEvent,
  kind: 'move' | 'resize',
  corner?: FloatingWindowCorner
) {
  if (event.button !== 0 || pointerInteraction) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
  pointerInteraction = {
    corner,
    kind,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startRect: { ...dialogRect.value },
    target
  }
  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = kind === 'move'
    ? 'move'
    : corner === 'north-west' || corner === 'south-east' ? 'nwse-resize' : 'nesw-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', finishPointerInteraction)
  window.addEventListener('pointercancel', finishPointerInteraction)
}

function beginMove(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return
  startPointerInteraction(event, 'move')
}

function beginResize(event: PointerEvent, corner: FloatingWindowCorner) {
  startPointerInteraction(event, 'resize', corner)
}

function fitDialogToViewport() {
  if (!props.open) return
  dialogRect.value = fitFloatingWindow(dialogRect.value, viewportSize(), MINIMUM_DIALOG_SIZE)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
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
  if (!open) {
    finishPointerInteraction()
    return
  }
  dialogRect.value = dialogPositioned
    ? fitFloatingWindow(dialogRect.value, viewportSize(), MINIMUM_DIALOG_SIZE)
    : centerFloatingWindow(viewportSize(), DEFAULT_DIALOG_SIZE, MINIMUM_DIALOG_SIZE)
  dialogPositioned = true
  draft.value = cloneLayerStyleConfig(props.styles)
  const existing = draft.value.effects.find((effect): effect is OuterGlowEffect => effect.type === 'outer-glow')
  outerGlowOriginallyPresent = Boolean(existing)
  outerGlowSettings.value = existing
    ? normalizedOuterGlow(existing)
    : createDefaultLayerEffect('outer-glow') as OuterGlowEffect
  selectedCategory.value = existing?.enabled && props.rasterEffectsAvailable ? 'outer-glow' : 'blending'
  previewEnabled.value = true
  await nextTick()
  initialFocus.value?.focus()
})

onMounted(() => window.addEventListener('resize', fitDialogToViewport))

onBeforeUnmount(() => {
  finishPointerInteraction()
  window.removeEventListener('resize', fitDialogToViewport)
})
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop dialog-backdrop--layer-style"
    role="presentation"
  >
    <section
      ref="dialog"
      class="layer-style-dialog"
      :style="dialogStyle"
      aria-modal="true"
      role="dialog"
      aria-labelledby="layer-style-title"
      @keydown="handleKeydown"
    >
      <header class="dialog-header layer-style-dialog-header" @pointerdown="beginMove">
        <div>
          <h2 id="layer-style-title">Opções de mesclagem</h2>
          <span :title="layerName">{{ layerName }}</span>
        </div>
        <button type="button" title="Fechar" aria-label="Fechar" @click="emit('cancel')">×</button>
      </header>

      <div class="layer-style-layout">
        <nav class="layer-style-navigation" aria-label="Categorias de estilo">
          <button
            ref="initialFocus"
            :class="{ 'layer-style-navigation--active': selectedCategory === 'blending' }"
            type="button"
            @click="selectedCategory = 'blending'"
          >
            Mesclagem
          </button>
          <span class="layer-style-effect-entry">
            <input
              :checked="outerGlowActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar brilho externo"
              :title="rasterEffectsAvailable ? 'Ativar brilho externo' : 'Disponível para camadas raster'"
              @change="toggleOuterGlow"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'outer-glow' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar brilho externo' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'outer-glow'"
            >
              Brilho externo
            </button>
          </span>
        </nav>

        <div v-if="selectedCategory === 'blending'" class="layer-style-controls">
          <h3>Mesclagem avançada</h3>
          <label class="layer-style-range">
            <span>Opacidade de preenchimento</span>
            <span class="layer-style-range-controls">
              <input
                :value="draft.fillOpacity"
                max="100"
                min="0"
                step="1"
                type="range"
                @input="updateFillOpacity(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="layer-style-number">
                <input
                  :value="draft.fillOpacity"
                  max="100"
                  min="0"
                  step="1"
                  type="number"
                  @input="updateFillOpacity(Number(($event.target as HTMLInputElement).value))"
                />
                <span aria-hidden="true">%</span>
              </span>
            </span>
          </label>
        </div>

        <div v-else class="layer-style-controls layer-style-controls--scrollable">
          <h3>Brilho externo</h3>
          <div class="layer-style-grid">
            <label>
              Preenchimento
              <select :value="outerGlowSettings.paint.type" @change="setOuterGlowPaint(($event.target as HTMLSelectElement).value as 'color' | 'gradient')">
                <option value="color">Cor</option>
                <option value="gradient">Gradiente</option>
              </select>
            </label>
            <label>
              {{ outerGlowSettings.paint.type === 'gradient' ? 'Cor inicial' : 'Cor' }}
              <input
                class="layer-style-color"
                :value="outerGlowColor"
                type="color"
                @input="outerGlowSettings.paint.type === 'gradient'
                  ? updateGradientColor(0, ($event.target as HTMLInputElement).value)
                  : updateOuterGlow({ paint: { type: 'color', color: ($event.target as HTMLInputElement).value } })"
              />
            </label>
            <label v-if="outerGlowSettings.paint.type === 'gradient'">
              Cor final
              <input
                class="layer-style-color"
                :value="outerGlowGradientEnd"
                type="color"
                @input="updateGradientColor(1, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              Técnica
              <select
                :value="outerGlowSettings.technique"
                @change="updateOuterGlow({ technique: ($event.target as HTMLSelectElement).value as OuterGlowEffect['technique'] })"
              >
                <option value="softer">Suave</option>
                <option value="precise">Precisa</option>
              </select>
            </label>
          </div>

          <div class="layer-style-slider-list">
            <label v-for="control in [
              { key: 'opacity', label: 'Opacidade', value: outerGlowSettings.opacity, max: 100, suffix: '%' },
              { key: 'spread', label: 'Expansão', value: outerGlowSettings.spread, max: 100, suffix: '%' },
              { key: 'size', label: 'Tamanho', value: outerGlowSettings.size, max: 250, suffix: 'px' },
              { key: 'noise', label: 'Ruído', value: outerGlowSettings.noise, max: 100, suffix: '%' },
              { key: 'range', label: 'Intervalo', value: outerGlowSettings.range, max: 100, suffix: '%' },
              { key: 'jitter', label: 'Tremulação', value: outerGlowSettings.jitter, max: 100, suffix: '%' }
            ]" :key="control.key" class="layer-style-parameter">
              <span>{{ control.label }}</span>
              <input
                :value="control.value"
                :max="control.max"
                :min="control.key === 'range' ? 1 : 0"
                type="range"
                @input="updateOuterGlow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="layer-style-parameter-value">
                <input
                  :value="control.value"
                  :max="control.max"
                  :min="control.key === 'range' ? 1 : 0"
                  type="number"
                  @input="updateOuterGlow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">{{ control.suffix }}</span>
              </span>
            </label>
          </div>

          <label class="layer-style-contour">
            <span>Contorno</span>
            <select
              :value="outerGlowSettings.contour.preset"
              @change="updateOuterGlow({ contour: { ...outerGlowSettings.contour, preset: ($event.target as HTMLSelectElement).value as OuterGlowEffect['contour']['preset'] } })"
            >
              <option value="linear">Linear</option>
              <option value="gaussian">Gaussiano</option>
              <option value="cone">Cone</option>
              <option value="inverted-cone">Cone invertido</option>
              <option value="ring">Anel</option>
            </select>
          </label>
        </div>
      </div>

      <footer class="layer-style-footer">
        <button type="button" @click="restoreDefault">Restaurar padrão</button>
        <label class="layer-style-preview-toggle">
          <input :checked="previewEnabled" type="checkbox" @change="togglePreview" />
          <span>Visualizar</span>
        </label>
        <div class="dialog-actions">
          <button type="button" @click="emit('cancel')">Cancelar</button>
          <button class="primary-button" type="button" @click="emit('apply', cloneLayerStyleConfig(draft))">OK</button>
        </div>
      </footer>
      <span
        class="layer-style-resize-handle layer-style-resize-handle--north-west"
        aria-hidden="true"
        @pointerdown="beginResize($event, 'north-west')"
      ></span>
      <span
        class="layer-style-resize-handle layer-style-resize-handle--north-east"
        aria-hidden="true"
        @pointerdown="beginResize($event, 'north-east')"
      ></span>
      <span
        class="layer-style-resize-handle layer-style-resize-handle--south-west"
        aria-hidden="true"
        @pointerdown="beginResize($event, 'south-west')"
      ></span>
      <span
        class="layer-style-resize-handle layer-style-resize-handle--south-east"
        aria-hidden="true"
        @pointerdown="beginResize($event, 'south-east')"
      ></span>
    </section>
  </div>
</template>

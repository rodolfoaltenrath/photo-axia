<script setup lang="ts">
import { computed, ref } from 'vue'
import { normalizeLayerStyleBlendIf } from '../../editor/layerStyles.ts'
import type { LayerBlendIfRange, LayerStyleBlendIf } from '../../types/editor.ts'

const props = defineProps<{
  disabled?: boolean
  value: LayerStyleBlendIf
}>()

const emit = defineEmits<{
  (event: 'update:value', value: LayerStyleBlendIf): void
}>()

type RangeName = keyof LayerBlendIfRange
type HandleIndex = 0 | 1
const HANDLES: HandleIndex[] = [0, 1]

const value = computed(() => normalizeLayerStyleBlendIf(props.value))
const dragging = ref<{
  initial: LayerStyleBlendIf
  index: HandleIndex
  name: RangeName
  pointerId: number
  target: HTMLElement
} | null>(null)

function percentage(number: number) {
  return `${number / 2.55}%`
}

function updateRange(name: RangeName, next: [number, number]) {
  emit('update:value', normalizeLayerStyleBlendIf({
    ...value.value,
    thisLayer: { ...value.value.thisLayer, [name]: next }
  }))
}

function updateNumber(name: RangeName, index: HandleIndex, raw: unknown) {
  const numeric = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(numeric)) return
  const range = [...value.value.thisLayer[name]] as [number, number]
  range[index] = Math.round(Math.min(255, Math.max(0, numeric)))
  updateRange(name, range)
}

function valueFromPointer(event: PointerEvent) {
  const target = dragging.value?.target
  if (!target) return 0
  const track = target.closest<HTMLElement>('.blend-if-track')
  if (!track) return 0
  const bounds = track.getBoundingClientRect()
  return Math.round(Math.min(255, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width) * 255)))
}

function dragValue(event: PointerEvent) {
  const current = dragging.value
  if (!current || event.pointerId !== current.pointerId) return
  const nextValue = valueFromPointer(event)
  const range = [...current.initial.thisLayer[current.name]] as [number, number]
  const oppositeRange = current.initial.thisLayer[current.name === 'shadows' ? 'highlights' : 'shadows']
  const maximum = current.name === 'shadows' ? oppositeRange[0] : 255
  const minimum = current.name === 'highlights' ? oppositeRange[1] : 0
  const bounded = Math.min(maximum, Math.max(minimum, nextValue))
  const joined = range[0] === range[1]

  if (event.altKey) {
    range[current.index] = bounded
  } else if (joined) {
    range[0] = bounded
    range[1] = bounded
  } else {
    range[current.index] = bounded
  }
  if (range[0] > range[1]) range.reverse()
  updateRange(current.name, range)
}

function startDrag(event: PointerEvent, name: RangeName, index: HandleIndex) {
  if (props.disabled || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  dragging.value = {
    initial: normalizeLayerStyleBlendIf(value.value),
    name,
    index,
    pointerId: event.pointerId,
    target
  }
  dragValue(event)
}

function stopDrag(event: PointerEvent) {
  if (dragging.value?.pointerId !== event.pointerId) return
  const target = dragging.value.target
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  dragging.value = null
}
</script>

<template>
  <section class="blend-if-controls" :class="{ 'blend-if-controls--disabled': disabled }">
    <div class="blend-if-heading">
      <h4>Mesclar se</h4>
      <span>Escala de cinza</span>
    </div>
    <p>Oculte luminosidades desta camada sem apagar seus pixels.</p>

    <div class="blend-if-row">
      <div class="blend-if-label">Esta camada</div>
      <div class="blend-if-track" aria-label="Intervalo de luminosidade desta camada">
        <span v-for="tick in 11" :key="tick" class="blend-if-tick" :style="{ left: `${(tick - 1) * 10}%` }"></span>
        <button
          v-for="index in HANDLES"
          :key="`shadow-${index}`"
          class="blend-if-handle blend-if-handle--shadow"
          :class="{ 'blend-if-handle--split': value.thisLayer.shadows[0] !== value.thisLayer.shadows[1] }"
          :disabled="disabled"
          :style="{ left: percentage(value.thisLayer.shadows[index]), '--handle-offset': index === 0 ? '5px' : '-5px' }"
          type="button"
          :aria-label="`Sombras, marcador ${index + 1}: ${value.thisLayer.shadows[index]}`"
          @pointercancel="stopDrag"
          @pointerdown="startDrag($event, 'shadows', index)"
          @pointermove="dragValue"
          @pointerup="stopDrag"
        ></button>
        <button
          v-for="index in HANDLES"
          :key="`highlight-${index}`"
          class="blend-if-handle blend-if-handle--highlight"
          :class="{ 'blend-if-handle--split': value.thisLayer.highlights[0] !== value.thisLayer.highlights[1] }"
          :disabled="disabled"
          :style="{ left: percentage(value.thisLayer.highlights[index]), '--handle-offset': index === 0 ? '-5px' : '5px' }"
          type="button"
          :aria-label="`Realces, marcador ${index + 1}: ${value.thisLayer.highlights[index]}`"
          @pointercancel="stopDrag"
          @pointerdown="startDrag($event, 'highlights', index)"
          @pointermove="dragValue"
          @pointerup="stopDrag"
        ></button>
      </div>
    </div>

    <div class="blend-if-values">
      <label>
        Sombras
        <span>
          <input :disabled="disabled" :value="value.thisLayer.shadows[0]" max="255" min="0" type="number" @input="updateNumber('shadows', 0, ($event.target as HTMLInputElement).value)" />
          <b>–</b>
          <input :disabled="disabled" :value="value.thisLayer.shadows[1]" max="255" min="0" type="number" @input="updateNumber('shadows', 1, ($event.target as HTMLInputElement).value)" />
        </span>
      </label>
      <label>
        Realces
        <span>
          <input :disabled="disabled" :value="value.thisLayer.highlights[0]" max="255" min="0" type="number" @input="updateNumber('highlights', 0, ($event.target as HTMLInputElement).value)" />
          <b>–</b>
          <input :disabled="disabled" :value="value.thisLayer.highlights[1]" max="255" min="0" type="number" @input="updateNumber('highlights', 1, ($event.target as HTMLInputElement).value)" />
        </span>
      </label>
    </div>
    <small>Arraste um marcador. Use <kbd>Alt</kbd> para dividi-lo e suavizar a transição.</small>
  </section>
</template>

<style scoped>
.blend-if-controls { border-top: 1px solid var(--ui-border, #343840); margin-top: 18px; padding-top: 16px; }
.blend-if-heading { align-items: baseline; display: flex; gap: 8px; justify-content: space-between; }
.blend-if-heading h4 { font-size: 13px; margin: 0; }
.blend-if-heading span, .blend-if-controls p, .blend-if-controls small { color: var(--ui-text-dim, #9ba4b2); font-size: 11px; }
.blend-if-controls p { margin: 4px 0 12px; }
.blend-if-row { display: grid; gap: 7px; }
.blend-if-label { color: var(--ui-text, #f4f6f8); font-size: 12px; font-weight: 600; }
.blend-if-track { background: linear-gradient(90deg, #000, #fff); border: 1px solid #4b525e; height: 20px; position: relative; }
.blend-if-tick { background: rgb(255 255 255 / 40%); bottom: 0; height: 4px; position: absolute; width: 1px; }
.blend-if-handle { background: #f6f8fb; border: 1px solid #111822; bottom: var(--handle-offset); cursor: ew-resize; height: 11px; margin-left: -5px; padding: 0; position: absolute; width: 11px; z-index: 1; }
.blend-if-handle--shadow { clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); }
.blend-if-handle--highlight { border-radius: 1px; transform: rotate(45deg); }
.blend-if-handle--split { outline: 1px solid #268cff; }
.blend-if-values { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; margin-top: 15px; }
.blend-if-values label { color: var(--ui-text-dim, #9ba4b2); display: grid; font-size: 11px; gap: 4px; }
.blend-if-values label > span { align-items: center; display: flex; gap: 4px; }
.blend-if-values input { min-width: 0; width: 100%; }
.blend-if-values b { color: var(--ui-text-dim, #9ba4b2); font-weight: 400; }
.blend-if-controls small { display: block; margin-top: 12px; }
.blend-if-controls kbd { background: #292d34; border: 1px solid #4d5460; border-radius: 3px; color: inherit; font: inherit; padding: 0 3px; }
.blend-if-controls--disabled { opacity: .56; }
</style>

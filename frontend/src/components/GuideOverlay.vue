<script setup lang="ts">
import { computed } from 'vue'
import {
  formatGuideValue,
  screenPositionForDocument,
  type EditorGuide,
  type RulerOrigin,
  type RulerUnit
} from '../editor/guides'

const props = defineProps<{
  documentOffsetX: number
  documentOffsetY: number
  draftGuide: EditorGuide | null
  guides: EditorGuide[]
  interactive: boolean
  origin: RulerOrigin
  resolutionDpi: number
  scale: number
  selectedGuideId: string | null
  snappedX?: number
  snappedY?: number
  unit: RulerUnit
  visible: boolean
}>()

const emit = defineEmits<{
  (event: 'startMove', guide: EditorGuide, pointerEvent: PointerEvent): void
}>()

const visibleGuides = computed(() => {
  if (!props.visible) return []
  return props.draftGuide
    ? [...props.guides.filter((guide) => guide.id !== props.draftGuide!.id), props.draftGuide]
    : props.guides
})

const guideLabels = computed(() => new Map(
  visibleGuides.value.map((guide) => [
    guide.id,
    formatGuideValue(guide, props.unit, props.resolutionDpi, props.origin)
  ])
))

function guideStyle(guide: EditorGuide) {
  const rawPosition = guide.orientation === 'vertical'
    ? screenPositionForDocument(guide.position, props.documentOffsetX, props.scale)
    : screenPositionForDocument(guide.position, props.documentOffsetY, props.scale)
  const position = Math.round(rawPosition)
  return guide.orientation === 'vertical'
    ? { transform: `translate3d(${position}px, 0, 0)` }
    : { transform: `translate3d(0, ${position}px, 0)` }
}

function guideLabel(guide: EditorGuide) {
  return guideLabels.value.get(guide.id) ?? ''
}

function isSnapped(guide: EditorGuide) {
  return guide.orientation === 'vertical'
    ? props.snappedX === guide.position
    : props.snappedY === guide.position
}
</script>

<template>
  <div class="guide-overlay" aria-label="Guias do documento">
    <div
      v-for="guide in visibleGuides"
      :key="guide.id"
      class="document-guide"
      :class="[
        `document-guide--${guide.orientation}`,
        {
          'document-guide--interactive': interactive,
          'document-guide--selected': selectedGuideId === guide.id,
          'document-guide--snapped': isSnapped(guide),
          'document-guide--draft': draftGuide?.id === guide.id
        }
      ]"
      :style="guideStyle(guide)"
      :title="`${guide.orientation === 'vertical' ? 'X' : 'Y'}: ${guideLabel(guide)}`"
      @pointerdown.stop.prevent="interactive && emit('startMove', guide, $event)"
    >
      <span class="document-guide-line"></span>
      <output v-if="draftGuide?.id === guide.id" class="guide-position-label">
        {{ guideLabel(guide) }}
      </output>
    </div>
  </div>
</template>

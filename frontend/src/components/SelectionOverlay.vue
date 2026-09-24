<script setup lang="ts">
import { computed } from 'vue'
import {
  matrixToSvg,
  type SelectionRegion
} from '../editor/selection'
import {
  selectionOverlayMetrics,
  selectionOverlayOutlinePath,
  selectionOverlayShouldAnimate
} from '../editor/selectionOverlay'

const props = defineProps<{
  documentHeight: number
  documentWidth: number
  scale: number
  animate: boolean
  reducedDetail: boolean
  selection: SelectionRegion
}>()

const isPixelSelection = computed(() => props.selection.kind === 'pixels')
const outlinePath = computed(() => selectionOverlayOutlinePath(props.selection, props.reducedDetail))
const selectionTransform = computed(() =>
  props.selection.kind === 'pixels' ? matrixToSvg(props.selection.sourceToDocument) : undefined
)
const metrics = computed(() => selectionOverlayMetrics(props.scale))
const shouldAnimate = computed(() => selectionOverlayShouldAnimate(props.selection, !props.animate))
</script>

<template>
  <svg
    class="selection-overlay"
    :viewBox="`0 0 ${documentWidth} ${documentHeight}`"
    aria-hidden="true"
    preserveAspectRatio="none"
  >
    <g :transform="selectionTransform">
      <path
        class="selection-overlay-outline selection-overlay-outline--light"
        :d="outlinePath"
        :stroke-width="metrics.strokeWidth"
      />
      <path
        class="selection-overlay-outline selection-overlay-outline--ants"
        :class="{ 'selection-overlay-outline--animated': shouldAnimate }"
        :d="outlinePath"
        :stroke-width="metrics.strokeWidth"
        :stroke-dasharray="`${metrics.dashLength} ${metrics.dashLength}`"
        :style="{ '--selection-ants-offset': metrics.dashOffset }"
      />
    </g>
    <title>{{ isPixelSelection ? 'Seleção da varinha mágica' : 'Área selecionada' }}</title>
  </svg>
</template>

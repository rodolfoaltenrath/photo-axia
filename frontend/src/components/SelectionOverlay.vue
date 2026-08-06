<script setup lang="ts">
import { computed } from 'vue'
import {
  matrixToSvg,
  pixelSpansFillPath,
  pixelSpansOutlinePath,
  vectorSelectionPath,
  type SelectionRegion
} from '../editor/selection'

const props = defineProps<{
  documentHeight: number
  documentWidth: number
  selection: SelectionRegion
}>()

const isPixelSelection = computed(() => props.selection.kind === 'pixels')
const fillPath = computed(() =>
  props.selection.kind === 'pixels' ? pixelSpansFillPath(props.selection.spans) : vectorSelectionPath(props.selection)
)
const outlinePath = computed(() =>
  props.selection.kind === 'pixels' ? pixelSpansOutlinePath(props.selection.spans) : fillPath.value
)
const selectionTransform = computed(() =>
  props.selection.kind === 'pixels' ? matrixToSvg(props.selection.sourceToDocument) : undefined
)
</script>

<template>
  <svg
    class="selection-overlay"
    :viewBox="`0 0 ${documentWidth} ${documentHeight}`"
    aria-hidden="true"
    preserveAspectRatio="none"
  >
    <g :transform="selectionTransform">
      <path class="selection-overlay-fill" :d="fillPath" />
      <path class="selection-overlay-outline selection-overlay-outline--light" :d="outlinePath" />
      <path class="selection-overlay-outline selection-overlay-outline--ants" :d="outlinePath" />
    </g>
    <title>{{ isPixelSelection ? 'Seleção da varinha mágica' : 'Área selecionada' }}</title>
  </svg>
</template>

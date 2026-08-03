<script setup lang="ts">
import { computed } from 'vue'
import type { LayerItem, LayerTransform } from '../types/editor'

const props = defineProps<{
  active: boolean
  layer: LayerItem
  transform: LayerTransform
}>()

const emit = defineEmits<{
  (event: 'pointerdown', pointerEvent: PointerEvent): void
}>()

const layerStyle = computed(() => ({
  left: '0',
  top: '0',
  width: `${props.transform.width}px`,
  height: `${props.transform.height}px`,
  opacity: props.layer.opacity === undefined ? 1 : props.layer.opacity / 100,
  transform: `translate3d(${props.transform.x}px, ${props.transform.y}px, 0) rotate(${props.transform.rotation ?? 0}deg)`
}))
</script>

<template>
  <div
    v-show="layer.visible"
    class="document-layer"
    :class="{ 'document-layer--active': active }"
    :style="layerStyle"
    @pointerdown="emit('pointerdown', $event)"
  >
    <img
      v-if="layer.kind === 'image' && layer.image"
      :alt="layer.name"
      decoding="async"
      draggable="false"
      :src="layer.image.sourceUrl"
    />
  </div>
</template>

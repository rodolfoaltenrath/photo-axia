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

const textStyle = computed(() => {
  const text = props.layer.text
  if (!text) return undefined

  return {
    width: `${text.baseWidth}px`,
    height: `${text.baseHeight}px`,
    color: text.color,
    fontFamily: text.fontFamily,
    fontSize: `${text.fontSize}px`,
    fontWeight: text.fontWeight,
    lineHeight: text.lineHeight,
    textAlign: text.alignment,
    transform: `scale(${props.transform.width / text.baseWidth}, ${props.transform.height / text.baseHeight})`
  }
})
</script>

<template>
  <div
    class="document-layer"
    :class="{ 'document-layer--active': active }"
    :data-layer-kind="layer.kind"
    :style="layerStyle"
    @pointerdown="emit('pointerdown', $event)"
  >
    <img
      v-if="layer.kind === 'image' && layer.image"
      :alt="layer.name"
      decoding="async"
      draggable="false"
      :src="layer.image.previewUrl ?? layer.image.sourceUrl"
    />
    <div
      v-else-if="layer.kind === 'text' && layer.text"
      class="document-text"
      :style="textStyle"
      v-text="layer.text.content"
    ></div>
  </div>
</template>

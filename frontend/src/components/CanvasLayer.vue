<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LayerItem, LayerTransform } from '../types/editor'
import { layerCompositingStyle } from '../editor/blendModes'
import { useLayerImageBuffer } from './canvas/composables/useLayerImageHandoff'

const props = defineProps<{
  active: boolean
  contentHidden: boolean
  grouped: boolean
  layer: LayerItem
  transform: LayerTransform
}>()

const emit = defineEmits<{
  (event: 'pointerdown', pointerEvent: PointerEvent): void
  (event: 'imageLoaded', layerId: string, source: string): void
  (event: 'imageError', layerId: string, source: string): void
}>()

const layerRoot = ref<HTMLElement | null>(null)
const {
  activeImageSlot,
  activeImageTransform,
  finishInteractiveTransform,
  handleImageError,
  handleImageLoad,
  imageSources
} = useLayerImageBuffer({
  active: () => props.active,
  layer: () => props.layer,
  transform: () => props.transform,
  layerRoot,
  imageLoaded: (layerId, source) => emit('imageLoaded', layerId, source),
  imageError: (layerId, source) => emit('imageError', layerId, source)
})

const layerStyle = computed(() => {
  const transform = props.layer.image ? activeImageTransform.value : props.transform
  const compositing = props.grouped
    ? { mixBlendMode: undefined, opacity: undefined }
    : layerCompositingStyle(props.layer.blendMode, props.layer.opacity)
  return {
    left: '0',
    top: '0',
    width: `${transform.width}px`,
    height: `${transform.height}px`,
    ...compositing,
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(${transform.rotation ?? 0}deg)`
  }
})

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
    ref="layerRoot"
    class="document-layer"
    :class="{ 'document-layer--active': active, 'document-layer--content-hidden': contentHidden }"
    :data-layer-id="layer.id"
    :data-layer-kind="layer.kind"
    :style="layerStyle"
    @axia-interaction-end="finishInteractiveTransform"
    @pointerdown="emit('pointerdown', $event)"
  >
    <template v-if="layer.image">
      <img
        v-for="(source, slot) in imageSources"
        v-show="source"
        :key="slot"
        :alt="activeImageSlot === slot ? layer.name : ''"
        class="layer-image-buffer"
        :class="{ 'layer-image-buffer--active': activeImageSlot === slot }"
        decoding="async"
        :fetchpriority="active ? 'high' : 'auto'"
        draggable="false"
        :src="source ?? undefined"
        @error="handleImageError(slot as 0 | 1)"
        @load="handleImageLoad(slot as 0 | 1, $event)"
      />
    </template>
    <div
      v-else-if="layer.kind === 'text' && layer.text"
      class="document-text"
      :style="textStyle"
      v-text="layer.text.content"
    ></div>
  </div>
</template>

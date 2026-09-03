<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LayerItem, LayerStyleGlobalLight, LayerTransform } from '../types/editor'
import { layerCompositingStyle } from '../editor/blendModes'
import { layerStyleFillOpacity } from '../editor/layerStyles'
import { shapePathData } from '../editor/shape'
import { useLayerImageBuffer } from './canvas/composables/useLayerImageHandoff'
import { useLayerStyleRaster } from './canvas/composables/useLayerStyleRaster'

const props = defineProps<{
  active: boolean
  contentHidden: boolean
  grouped: boolean
  layer: LayerItem
  layerStyleGlobalLight: LayerStyleGlobalLight
  transform: LayerTransform
}>()

const emit = defineEmits<{
  (event: 'pointerdown', pointerEvent: PointerEvent): void
  (event: 'imageLoaded', layerId: string, source: string): void
  (event: 'imageError', layerId: string, source: string): void
}>()

const layerRoot = ref<HTMLElement | null>(null)
const {
  desiredImageSource,
  geometryForSource,
  releaseSource,
  reportedSource
} = useLayerStyleRaster({
  consumer: 'canvas',
  globalLight: () => props.layerStyleGlobalLight,
  layer: () => props.layer,
  transform: () => props.transform
})
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
  imageSource: () => desiredImageSource.value,
  reportedSource,
  sourceReleased: releaseSource,
  imageLoaded: (layerId, source) => emit('imageLoaded', layerId, source),
  imageError: (layerId, source) => emit('imageError', layerId, source)
})

const activeImageIsStyled = computed(() => Boolean(geometryForSource(imageSources.value[activeImageSlot.value])))

function imageBufferStyle(source: string | null) {
  const geometry = geometryForSource(source)
  if (!geometry) return undefined
  return {
    left: `${geometry.offsetX / geometry.sourceWidth * 100}%`,
    top: `${geometry.offsetY / geometry.sourceHeight * 100}%`,
    width: `${geometry.renderedWidth / geometry.sourceWidth * 100}%`,
    height: `${geometry.renderedHeight / geometry.sourceHeight * 100}%`
  }
}

const layerStyle = computed(() => {
  const transform = props.layer.image ? activeImageTransform.value : props.transform
  const compositing = props.grouped
    ? { mixBlendMode: undefined, opacity: undefined }
    : layerCompositingStyle(props.layer.blendMode, props.layer.opacity)
  return {
    '--layer-fill-opacity': String(layerStyleFillOpacity(props.layer.styles)),
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

const shapePath = computed(() => {
  const shape = props.layer.shape
  return shape ? shapePathData({ x: 0, y: 0, width: shape.baseWidth, height: shape.baseHeight }, shape) : ''
})

const shapeViewBox = computed(() => {
  const shape = props.layer.shape
  return shape ? `0 0 ${shape.baseWidth} ${shape.baseHeight}` : undefined
})
</script>

<template>
  <div
    ref="layerRoot"
    class="document-layer"
    :class="{
      'document-layer--active': active,
      'document-layer--content-hidden': contentHidden,
      'document-layer--styled': activeImageIsStyled
    }"
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
        :class="{
          'layer-image-buffer--active': activeImageSlot === slot,
          'layer-image-buffer--styled': Boolean(geometryForSource(source))
        }"
        decoding="async"
        :fetchpriority="active ? 'high' : 'auto'"
        draggable="false"
        :src="source ?? undefined"
        :style="imageBufferStyle(source)"
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
    <svg
      v-else-if="layer.kind === 'shape' && layer.shape"
      class="document-shape"
      :viewBox="shapeViewBox"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path :d="shapePath" :fill="layer.shape.color" />
    </svg>
  </div>
</template>

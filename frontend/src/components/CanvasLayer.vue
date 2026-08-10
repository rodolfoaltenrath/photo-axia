<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { LayerItem, LayerTransform } from '../types/editor'

const props = defineProps<{
  active: boolean
  layer: LayerItem
  transform: LayerTransform
}>()

const emit = defineEmits<{
  (event: 'pointerdown', pointerEvent: PointerEvent): void
  (event: 'imageLoaded', layerId: string, source: string): void
  (event: 'imageError', layerId: string, source: string): void
}>()

const desiredImageSource = computed(() => props.layer.image?.previewUrl ?? props.layer.image?.sourceUrl ?? null)
const imageSources = ref<[string | null, string | null]>([desiredImageSource.value, null])
const imageReady = ref<[boolean, boolean]>([false, false])
const activeImageSlot = ref<0 | 1>(0)

async function activateImageSlot(slot: 0 | 1, source: string) {
  activeImageSlot.value = slot
  await nextTick()
  if (activeImageSlot.value !== slot || desiredImageSource.value !== source) return
  emit('imageLoaded', props.layer.id, source)
}

async function handleImageLoad(slot: 0 | 1, event: Event) {
  const source = imageSources.value[slot]
  if (!source) return
  const image = event.currentTarget as HTMLImageElement
  try {
    await image.decode()
  } catch {
    if (!image.complete || image.naturalWidth === 0) return
  }
  if (imageSources.value[slot] !== source) return
  const readiness = [...imageReady.value] as [boolean, boolean]
  readiness[slot] = true
  imageReady.value = readiness
  if (source === desiredImageSource.value) void activateImageSlot(slot, source)
}

function handleImageError(slot: 0 | 1) {
  const source = imageSources.value[slot]
  if (source && source === desiredImageSource.value) emit('imageError', props.layer.id, source)
}

watch(desiredImageSource, (source) => {
  if (!source || imageSources.value[activeImageSlot.value] === source) return
  const targetSlot: 0 | 1 = activeImageSlot.value === 0 ? 1 : 0
  if (imageSources.value[targetSlot] === source && imageReady.value[targetSlot]) {
    void activateImageSlot(targetSlot, source)
    return
  }
  const sources = [...imageSources.value] as [string | null, string | null]
  const readiness = [...imageReady.value] as [boolean, boolean]
  sources[targetSlot] = source
  readiness[targetSlot] = false
  imageSources.value = sources
  imageReady.value = readiness
})

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
    <template v-if="layer.kind === 'image' && layer.image">
      <img
        v-for="(source, slot) in imageSources"
        v-show="source"
        :key="slot"
        :alt="activeImageSlot === slot ? layer.name : ''"
        class="layer-image-buffer"
        :class="{ 'layer-image-buffer--active': activeImageSlot === slot }"
        decoding="async"
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

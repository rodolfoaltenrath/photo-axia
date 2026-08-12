<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { LayerItem, LayerTransform } from '../types/editor'
import { layerCompositingStyle } from '../editor/blendModes'

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
const desiredImageSource = computed(() => props.layer.image?.previewUrl ?? props.layer.image?.sourceUrl ?? null)

function copyTransform(transform: LayerTransform): LayerTransform {
  return {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    rotation: transform.rotation
  }
}

const imageSources = ref<[string | null, string | null]>([desiredImageSource.value, null])
const imageReady = ref<[boolean, boolean]>([false, false])
const imageTransforms = ref<[LayerTransform, LayerTransform]>([
  copyTransform(props.transform),
  copyTransform(props.transform)
])
const activeImageSlot = ref<0 | 1>(0)
const activeImageTransform = ref(copyTransform(props.transform))
let releaseFrame = 0
let compositorReadyFrame = 0
let deferredActivation: { slot: 0 | 1; source: string } | undefined

function releaseInactiveSlot(activeSlot: 0 | 1, source: string) {
  cancelAnimationFrame(releaseFrame)
  releaseFrame = requestAnimationFrame(() => {
    releaseFrame = 0
    if (activeImageSlot.value !== activeSlot || desiredImageSource.value !== source) return
    const inactiveSlot: 0 | 1 = activeSlot === 0 ? 1 : 0
    if (!imageSources.value[inactiveSlot]) return
    const sources = [...imageSources.value] as [string | null, string | null]
    const readiness = [...imageReady.value] as [boolean, boolean]
    sources[inactiveSlot] = null
    readiness[inactiveSlot] = false
    imageSources.value = sources
    imageReady.value = readiness
  })
}

function activateImageSlot(slot: 0 | 1, source: string) {
  if (imageSources.value[slot] !== source || desiredImageSource.value !== source) return
  if (
    layerRoot.value?.classList.contains('document-layer--dragging') ||
    layerRoot.value?.classList.contains('document-layer--transforming')
  ) {
    deferredActivation = { slot, source }
    return
  }

  // A fonte e a geometria pertencem ao mesmo buffer. O evento sincrono tambem
  // remove a pre-visualizacao no mesmo render em que o novo raster entra.
  activeImageTransform.value = copyTransform(imageTransforms.value[slot])
  activeImageSlot.value = slot
  releaseInactiveSlot(slot, source)
  cancelAnimationFrame(compositorReadyFrame)
  const confirmReady = () => {
    compositorReadyFrame = 0
    if (activeImageSlot.value !== slot || desiredImageSource.value !== source) return
    emit('imageLoaded', props.layer.id, source)
  }
  if (!props.active) {
    confirmReady()
    return
  }

  // A camada ativa permanece promovida pelo CSS. Dois frames dão ao WebKit
  // tempo para pintar o raster e enviar a textura ao compositor antes de o
  // fluxo de importacao liberar o primeiro arraste.
  compositorReadyFrame = requestAnimationFrame(() => {
    compositorReadyFrame = requestAnimationFrame(confirmReady)
  })
}

function finishInteractiveTransform(event: Event) {
  const pending = deferredActivation
  deferredActivation = undefined
  if (!pending) return
  const transform = (event as CustomEvent<LayerTransform>).detail
  if (transform) {
    const transforms = [...imageTransforms.value] as [LayerTransform, LayerTransform]
    transforms[pending.slot] = copyTransform(transform)
    imageTransforms.value = transforms
  }
  activateImageSlot(pending.slot, pending.source)
}

function handleImageLoad(slot: 0 | 1, event: Event) {
  const source = imageSources.value[slot]
  if (!source) return
  const image = event.currentTarget as HTMLImageElement
  if (!image.complete || image.naturalWidth === 0) return
  if (imageSources.value[slot] !== source) return
  const readiness = [...imageReady.value] as [boolean, boolean]
  readiness[slot] = true
  imageReady.value = readiness
  if (source === desiredImageSource.value) activateImageSlot(slot, source)
}

function handleImageError(slot: 0 | 1) {
  const source = imageSources.value[slot]
  if (source && source === desiredImageSource.value) emit('imageError', props.layer.id, source)
}

watch(desiredImageSource, (source) => {
  if (!source || imageSources.value[activeImageSlot.value] === source) return
  const targetSlot: 0 | 1 = activeImageSlot.value === 0 ? 1 : 0
  const transforms = [...imageTransforms.value] as [LayerTransform, LayerTransform]
  transforms[targetSlot] = copyTransform(props.transform)
  imageTransforms.value = transforms
  if (imageSources.value[targetSlot] === source && imageReady.value[targetSlot]) {
    activateImageSlot(targetSlot, source)
    return
  }
  const sources = [...imageSources.value] as [string | null, string | null]
  const readiness = [...imageReady.value] as [boolean, boolean]
  sources[targetSlot] = source
  readiness[targetSlot] = false
  imageSources.value = sources
  imageReady.value = readiness
})

watch(
  () => [
    props.transform.x,
    props.transform.y,
    props.transform.width,
    props.transform.height,
    props.transform.rotation
  ],
  () => {
    const desiredSource = desiredImageSource.value
    if (!desiredSource) return

    const matchingSlot = imageSources.value.findIndex((source) => source === desiredSource)
    if (matchingSlot < 0) return

    const slot = matchingSlot as 0 | 1
    const transform = copyTransform(props.transform)
    const transforms = [...imageTransforms.value] as [LayerTransform, LayerTransform]
    transforms[slot] = transform
    imageTransforms.value = transforms

    // Movimentos e redimensionamentos comuns continuam imediatos. Durante a
    // troca de raster, somente o buffer ainda invisivel recebe a nova geometria.
    if (slot === activeImageSlot.value) activeImageTransform.value = transform
  }
)

onBeforeUnmount(() => {
  cancelAnimationFrame(releaseFrame)
  cancelAnimationFrame(compositorReadyFrame)
})

const layerStyle = computed(() => {
  const transform = props.layer.kind === 'image' ? activeImageTransform.value : props.transform
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
    <template v-if="layer.kind === 'image' && layer.image">
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

<script setup lang="ts">
import { computed, nextTick, ref, watch, type CSSProperties } from 'vue'
import type { LayerItem, LayerStyleGlobalLight, LayerTransform } from '../types/editor'
import { layerCompositingStyle } from '../editor/blendModes'
import { nativeTextStrokeEffect } from '../editor/layerStyleCompositor'
import { layerStyleFillOpacity } from '../editor/layerStyles'
import { shapePathData } from '../editor/shape'
import { layoutText } from '../editor/text'
import { useLayerImageBuffer } from './canvas/composables/useLayerImageHandoff'
import { useLayerStyleRaster } from './canvas/composables/useLayerStyleRaster'

const props = defineProps<{
  active: boolean
  contentHidden: boolean
  grouped: boolean
  layer: LayerItem
  layerStyleGlobalLight: LayerStyleGlobalLight
  renderScale: number
  textEditor?: { value: string; selectAll: boolean }
  transform: LayerTransform
}>()

const emit = defineEmits<{
  (event: 'pointerdown', pointerEvent: PointerEvent): void
  (event: 'imageLoaded', layerId: string, source: string): void
  (event: 'imageError', layerId: string, source: string): void
  (event: 'textCancel'): void
  (event: 'textCommit'): void
  (event: 'textInput', value: string): void
}>()

const layerRoot = ref<HTMLElement | null>(null)
const textEditorElement = ref<HTMLTextAreaElement | null>(null)
const nativeTextStroke = computed(() => props.layer.text && !props.textEditor
  ? nativeTextStrokeEffect(props.layer.styles)
  : undefined)
const {
  desiredImageSource,
  geometryForSource,
  releaseSource,
  reportedSource
} = useLayerStyleRaster({
  consumer: 'canvas',
  globalLight: () => props.layerStyleGlobalLight,
  isInteracting: () => Boolean(
    layerRoot.value?.classList.contains('document-layer--dragging') ||
    layerRoot.value?.classList.contains('document-layer--transforming')
  ),
  layer: () => props.layer,
  renderScale: () => props.renderScale,
  skipTextRaster: () => Boolean(nativeTextStroke.value),
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
const showsStyledTextRaster = computed(() => Boolean(props.layer.text && !props.textEditor && activeImageIsStyled.value))
// Para uma camada de texto, o primeiro raster estilizado começa sem imagem
// ativa. Ainda assim o buffer precisa entrar no DOM para disparar `load` e só
// então assumir o lugar do texto vetorial. Usar apenas `activeImageIsStyled`
// aqui criava um ciclo: o <img> não existia para poder ficar ativo.
const mountsStyledTextRaster = computed(() => Boolean(props.layer.text && !props.textEditor && desiredImageSource.value))

const textLayout = computed(() => props.layer.text ? layoutText(props.layer.text) : undefined)

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
  const transform = props.layer.image || showsStyledTextRaster.value ? activeImageTransform.value : props.transform
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

const textStyle = computed<CSSProperties | undefined>(() => {
  const text = props.layer.text
  if (!text) return undefined
  const stroke = nativeTextStroke.value
  const scaleX = props.transform.width / text.baseWidth
  const scaleY = props.transform.height / text.baseHeight
  const styleScale = Math.sqrt(Math.max(0.0001, scaleX * scaleY))

  return {
    width: `${text.baseWidth}px`,
    height: `${text.baseHeight}px`,
    color: text.color,
    fontFamily: text.fontFamily,
    fontSize: `${text.fontSize}px`,
    fontWeight: text.fontWeight,
    fontStyle: text.fontStyle ?? 'normal',
    letterSpacing: `${text.letterSpacing ?? 0}px`,
    lineHeight: text.lineHeight,
    textDecoration: text.decoration ?? 'none',
    textTransform: text.textTransform ?? 'none',
    transform: `scale(${scaleX}, ${scaleY})`,
    ...(stroke?.paint.type === 'color'
      ? {
          WebkitTextStroke: `${stroke.size * 2 / styleScale}px ${stroke.paint.color}`,
          paintOrder: 'stroke fill'
        }
      : {})
  }
})

function textLineStyle(x: number, y: number): CSSProperties {
  return { left: `${x}px`, top: `${y}px` }
}

const shapePath = computed(() => {
  const shape = props.layer.shape
  return shape ? shapePathData({ x: 0, y: 0, width: shape.baseWidth, height: shape.baseHeight }, shape) : ''
})

const shapeViewBox = computed(() => {
  const shape = props.layer.shape
  return shape ? `0 0 ${shape.baseWidth} ${shape.baseHeight}` : undefined
})

watch(
  () => props.textEditor,
  async (editor) => {
    if (!editor) return
    await nextTick()
    textEditorElement.value?.focus()
    if (editor.selectAll) textEditorElement.value?.select()
  },
  { flush: 'post' }
)

function handleTextEditorKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('textCancel')
    return
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    emit('textCommit')
  }
}
</script>

<template>
  <div
    ref="layerRoot"
    class="document-layer"
    :class="{
      'document-layer--active': active,
      'document-layer--content-hidden': contentHidden,
      'document-layer--styled': activeImageIsStyled || nativeTextStroke
    }"
    :data-layer-id="layer.id"
    :data-layer-kind="layer.kind"
    :style="layerStyle"
    @axia-interaction-end="finishInteractiveTransform"
    @pointerdown="emit('pointerdown', $event)"
  >
    <textarea
      v-if="layer.kind === 'text' && layer.text && textEditor"
      ref="textEditorElement"
      class="document-text document-text-editor"
      :style="textStyle"
      :value="textEditor.value"
      aria-label="Editar texto"
      spellcheck="false"
      @blur="emit('textCommit')"
      @input="emit('textInput', ($event.target as HTMLTextAreaElement).value)"
      @keydown.stop="handleTextEditorKeydown"
      @pointerdown.stop
    ></textarea>
    <template v-else-if="layer.image || mountsStyledTextRaster">
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
    >
      <span
        v-for="(line, index) in textLayout?.lines"
        :key="index"
        class="document-text-line"
        :style="textLineStyle(line.x, line.y)"
      >{{ line.content || ' ' }}</span>
    </div>
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

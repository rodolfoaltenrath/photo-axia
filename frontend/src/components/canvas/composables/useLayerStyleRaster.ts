import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import {
  activeLayerStyleEffects,
  layerStyleEffectIsRasterSupported,
  layerStyleHash,
  layerStyleNeedsCompositing
} from '../../../editor/layerStyleCompositor'
import { sourceScaleFactor } from '../../../editor/selection'
import { textLayerSourceIdentity, textStyleRasterPlan, textStyleRasterSource } from '../../../editor/textCanvas'
import {
  invalidatePreviewLayerStyle,
  releasePreviewLayerStyleConsumer,
  renderPreviewLayerStyle,
  updatePreviewLayerStylePriority
} from '../../../services/layerStylePreview'
import type { LayerItem, LayerStyleGlobalLight, LayerTransform } from '../../../types/editor'
import type { RustStylePriority } from '../../../editor/rustStyleScheduling'

export interface StyledImageGeometry {
  offsetX: number
  offsetY: number
  renderedHeight: number
  renderedWidth: number
  sourceHeight: number
  sourceWidth: number
}

interface StyledImageSource extends StyledImageGeometry {
  originalSource: string
  url: string
  release: () => void
}

interface LayerStyleRasterOptions {
  consumer: 'canvas' | 'thumbnail'
  globalLight: () => LayerStyleGlobalLight
  isInteracting?: () => boolean
  layer: () => LayerItem
  renderScale?: () => number
  priority?: () => RustStylePriority
  skipTextRaster?: () => boolean
  transform: () => LayerTransform
}

function textStyleSource(layer: LayerItem, transform: LayerTransform, renderScale = 1) {
  const text = layer.text
  if (!text) return undefined
  const plan = textStyleRasterPlan(text, transform, (window.devicePixelRatio || 1) * renderScale)
  return {
    source: textStyleRasterSource(text, plan),
    width: plan.width,
    height: plan.height,
    effectScale: plan.effectScale,
    identity: `${textLayerSourceIdentity(text)}|${transform.width}x${transform.height}|${plan.effectScale}`
  }
}

export function useLayerStyleRaster(options: LayerStyleRasterOptions) {
  const consumerId = `${options.consumer}:${options.layer().id}`
  const styledSource = shallowRef<StyledImageSource>()
  const ownedSources = new Map<string, StyledImageSource>()
  let renderTimer: ReturnType<typeof setTimeout> | undefined
  let localGeneration = 0

  const originalSource = computed(() => {
    const image = options.layer().image
    return image?.previewUrl ?? image?.sourceUrl ?? null
  })
  const desiredImageSource = computed(() => styledSource.value?.url ?? originalSource.value)

  function releaseSource(source: string) {
    const owned = ownedSources.get(source)
    if (!owned || styledSource.value?.url === source) return
    URL.revokeObjectURL(source)
    owned.release()
    ownedSources.delete(source)
  }

  function geometryForSource(source: string | null) {
    return source ? ownedSources.get(source) : undefined
  }

  function reportedSource(source: string) {
    return ownedSources.get(source)?.originalSource ?? source
  }

  async function updateStyledRaster(generation: number) {
    const layer = options.layer()
    const image = layer.image
    const source = originalSource.value
    const transform = options.transform()
    const effects = activeLayerStyleEffects(layer.styles)
    if (
      (!image && !layer.text) || !layerStyleNeedsCompositing(layer.styles) ||
      (layer.text && options.skipTextRaster?.()) ||
      effects.some((effect) => !layerStyleEffectIsRasterSupported(effect))
    ) {
      if (generation === localGeneration) styledSource.value = undefined
      releasePreviewLayerStyleConsumer(consumerId)
      return
    }

    try {
      const textSource = !image ? textStyleSource(layer, transform, options.renderScale?.() ?? 1) : undefined
      if (generation !== localGeneration) return
      if (!image && !textSource) throw new Error('Não foi possível preparar o texto para o preview de estilo.')
      const preview = Boolean(image && source === image.previewUrl)
      const sourceWidth = image ? (preview ? image.previewWidth ?? image.width : image.width) : textSource!.width
      const sourceHeight = image ? (preview ? image.previewHeight ?? image.height : image.height) : textSource!.height
      const result = await renderPreviewLayerStyle({
        consumerId,
        layerId: layer.id,
        priority: options.priority?.() ?? 'visible',
        sourceIdentity: image ? `${source}|${image.editToken ?? ''}` : textSource!.identity,
        sourceUrl: image ? source ?? undefined : undefined,
        source: image ? async () => {
          const response = await fetch(source!)
          if (!response.ok) throw new Error('Não foi possível carregar a camada para o preview de estilo.')
          return response.blob()
        } : textSource!.source,
        sourceWidth,
        sourceHeight,
        styles: layer.styles,
        globalLight: options.globalLight(),
        resolutionScale: image
          ? 1 / sourceScaleFactor(transform, sourceWidth, sourceHeight)
          : textSource!.effectScale,
        quality: 'interactive'
      })
      if (generation !== localGeneration) { result.release(); return }
      let url: string
      try { url = URL.createObjectURL(result.blob) }
      catch (error) { result.release(); throw error }
      const next: StyledImageSource = {
        url,
        originalSource: source ?? `text:${layer.id}`,
        sourceWidth,
        sourceHeight,
        renderedWidth: result.width,
        renderedHeight: result.height,
        offsetX: result.offsetX,
        offsetY: result.offsetY,
        release: result.release
      }
      ownedSources.set(url, next)
      styledSource.value = next
    } catch {
      if (generation === localGeneration) styledSource.value = undefined
    }
  }

  watch(
    () => options.priority?.() ?? 'visible',
    priority => updatePreviewLayerStylePriority(consumerId, priority),
    { immediate: true }
  )

  watch(
    () => {
      const layer = options.layer()
      const image = layer.image
      const transform = options.transform()
      return [
        image?.previewUrl ?? image?.sourceUrl ?? '',
        image?.editToken ?? '',
        image?.previewWidth ?? image?.width ?? 0,
        image?.previewHeight ?? image?.height ?? 0,
        layer.text ? textLayerSourceIdentity(layer.text) : '',
        options.renderScale?.() ?? 1,
        transform.width,
        transform.height,
        layerStyleHash(layer.styles, options.globalLight())
      ]
    },
    () => {
      localGeneration++
      clearTimeout(renderTimer)
      invalidatePreviewLayerStyle(consumerId)
      const generation = localGeneration
      // Durante Ctrl+T, manter o último buffer pronto é mais fluido do que
      // converter texto e recompor efeitos a cada movimento do ponteiro. A
      // composição final ainda é solicitada logo após o gesto terminar.
      const delay = options.isInteracting?.() ? 180 : options.layer().text ? 120 : 40
      renderTimer = setTimeout(() => void updateStyledRaster(generation), delay)
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    localGeneration++
    clearTimeout(renderTimer)
    releasePreviewLayerStyleConsumer(consumerId)
    for (const [source, owned] of ownedSources) { URL.revokeObjectURL(source); owned.release() }
    ownedSources.clear()
  })

  return {
    desiredImageSource,
    geometryForSource,
    releaseSource,
    reportedSource
  }
}

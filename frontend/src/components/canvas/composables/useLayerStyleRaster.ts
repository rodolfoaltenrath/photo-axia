import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import {
  activeLayerStyleEffects,
  layerStyleEffectIsRasterSupported,
  layerStyleHash,
  layerStyleNeedsCompositing
} from '../../../editor/layerStyleCompositor'
import { sourceScaleFactor } from '../../../editor/selection'
import { drawTextLayerContent, textLayerSourceIdentity, textStyleRasterPlan } from '../../../editor/textCanvas'
import {
  releaseLayerStyleRenderConsumer,
  renderLayerStyle
} from '../../../services/layerStyleCompositor'
import type { LayerItem, LayerStyleGlobalLight, LayerTransform } from '../../../types/editor'

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
}

interface LayerStyleRasterOptions {
  consumer: 'canvas' | 'thumbnail'
  globalLight: () => LayerStyleGlobalLight
  isInteracting?: () => boolean
  layer: () => LayerItem
  renderScale?: () => number
  skipTextRaster?: () => boolean
  transform: () => LayerTransform
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
}

async function textStyleSource(layer: LayerItem, transform: LayerTransform, renderScale = 1) {
  const text = layer.text
  if (!text) return undefined
  const plan = textStyleRasterPlan(text, transform, (window.devicePixelRatio || 1) * renderScale)
  const canvas = document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const context = canvas.getContext('2d')
  if (!context) return undefined
  drawTextLayerContent(context, text, { x: plan.drawScaleX, y: plan.drawScaleY })
  const blob = await canvasBlob(canvas)
  canvas.width = 1
  canvas.height = 1
  return blob
    ? {
        blob,
        width: plan.width,
        height: plan.height,
        effectScale: plan.effectScale,
        identity: `${textLayerSourceIdentity(text)}|${transform.width}x${transform.height}|${plan.effectScale}`
      }
    : undefined
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
      return
    }

    try {
      const textSource = !image ? await textStyleSource(layer, transform, options.renderScale?.() ?? 1) : undefined
      if (!image && !textSource) throw new Error('Não foi possível preparar o texto para o preview de estilo.')
      const preview = Boolean(image && source === image.previewUrl)
      const sourceWidth = image ? (preview ? image.previewWidth ?? image.width : image.width) : textSource!.width
      const sourceHeight = image ? (preview ? image.previewHeight ?? image.height : image.height) : textSource!.height
      const result = await renderLayerStyle({
        consumerId,
        layerId: layer.id,
        sourceIdentity: image ? `${source}|${image.editToken ?? ''}` : textSource!.identity,
        source: image ? async () => {
          const response = await fetch(source!)
          if (!response.ok) throw new Error('Não foi possível carregar a camada para o preview de estilo.')
          return response.blob()
        } : textSource!.blob,
        sourceWidth,
        sourceHeight,
        styles: layer.styles,
        globalLight: options.globalLight(),
        resolutionScale: image
          ? 1 / sourceScaleFactor(transform, sourceWidth, sourceHeight)
          : textSource!.effectScale,
        quality: 'interactive'
      })
      if (generation !== localGeneration) return
      const url = URL.createObjectURL(result.blob)
      const next: StyledImageSource = {
        url,
        originalSource: source ?? `text:${layer.id}`,
        sourceWidth,
        sourceHeight,
        renderedWidth: result.width,
        renderedHeight: result.height,
        offsetX: result.offsetX,
        offsetY: result.offsetY
      }
      ownedSources.set(url, next)
      styledSource.value = next
    } catch {
      if (generation === localGeneration) styledSource.value = undefined
    }
  }

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
      const generation = localGeneration
      // Durante Ctrl+T, manter o último buffer pronto é mais fluido do que
      // converter texto e recompor efeitos a cada movimento do ponteiro. A
      // composição final ainda é solicitada logo após o gesto terminar.
      const delay = options.isInteracting?.() ? 180 : 40
      renderTimer = setTimeout(() => void updateStyledRaster(generation), delay)
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    localGeneration++
    clearTimeout(renderTimer)
    releaseLayerStyleRenderConsumer(consumerId)
    for (const source of ownedSources.keys()) URL.revokeObjectURL(source)
    ownedSources.clear()
  })

  return {
    desiredImageSource,
    geometryForSource,
    releaseSource,
    reportedSource
  }
}

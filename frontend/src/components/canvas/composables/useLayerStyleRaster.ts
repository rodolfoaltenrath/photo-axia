import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { activeLayerStyleEffects, layerStyleHash } from '../../../editor/layerStyleCompositor'
import { sourceScaleFactor } from '../../../editor/selection'
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
  layer: () => LayerItem
  transform: () => LayerTransform
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
    if (!image || !source || !effects.length || effects.some((effect) => effect.type !== 'outer-glow')) {
      if (generation === localGeneration) styledSource.value = undefined
      return
    }

    const preview = source === image.previewUrl
    const sourceWidth = preview ? image.previewWidth ?? image.width : image.width
    const sourceHeight = preview ? image.previewHeight ?? image.height : image.height
    try {
      const result = await renderLayerStyle({
        consumerId,
        layerId: layer.id,
        sourceIdentity: `${source}|${image.editToken ?? ''}`,
        source: async () => {
          const response = await fetch(source)
          if (!response.ok) throw new Error('Não foi possível carregar a camada para o preview de estilo.')
          return response.blob()
        },
        sourceWidth,
        sourceHeight,
        styles: layer.styles,
        globalLight: options.globalLight(),
        resolutionScale: 1 / sourceScaleFactor(transform, sourceWidth, sourceHeight),
        quality: 'interactive'
      })
      if (generation !== localGeneration) return
      const url = URL.createObjectURL(result.blob)
      const next: StyledImageSource = {
        url,
        originalSource: source,
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
        transform.width,
        transform.height,
        layerStyleHash(layer.styles, options.globalLight())
      ]
    },
    () => {
      localGeneration++
      clearTimeout(renderTimer)
      const generation = localGeneration
      renderTimer = setTimeout(() => void updateStyledRaster(generation), 40)
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

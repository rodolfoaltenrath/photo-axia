import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { brushPreviewSize } from '../../../editor/brush'
import {
  gradientGestureAction,
  gradientIsDegenerate,
  normalizeGradientStopsConfig,
  snapGradientEndpoint,
  type GradientConfigInput,
  type GradientGeometry,
  type GradientStopsConfig
} from '../../../editor/gradient'
import {
  createGradientPreviewLookup,
  MAXIMUM_INTERACTIVE_GRADIENT_PREVIEW_PIXELS,
  renderGradientPreviewPixels,
  type GradientPreviewLookup
} from '../../../editor/gradientPreview'
import {
  clipContextToSelection,
  cloneSelection,
  layerSourceToDocumentMatrix,
  multiplyMatrices,
  type Matrix2D,
  type SelectionPoint,
  type SelectionRegion
} from '../../../editor/selection'
import type { DocumentSpec, LayerItem } from '../../../types/editor'
import type { GradientInteraction } from '../canvas.types'

interface GradientInteractionOptions {
  activeTool: () => string
  config: () => GradientConfigInput
  document: () => DocumentSpec
  isBusy: () => boolean
  paintableLayer: () => LayerItem | undefined
  scale: () => number
  selection: () => SelectionRegion | null
  scrollArea: Ref<HTMLDivElement | null>
  surface: Ref<HTMLDivElement | null>
  documentPointFromPointer: (event: PointerEvent) => SelectionPoint | undefined
  scheduleInteractionFrame: (callback: () => void) => void
  discardInteractionFrame: () => void
  confirm: (geometry: GradientGeometry, config: GradientStopsConfig, selection: SelectionRegion | null) => void
}

export function useGradientInteraction(options: GradientInteractionOptions) {
  const gradientInteraction = ref<GradientInteraction | null>(null)
  const gradientPreviewCanvas = ref<HTMLCanvasElement | null>(null)
  const gradientPreviewReady = ref(false)
  let handoffFallbackTimer = 0
  let gradientPreviewGeneration = 0
  let gradientPreviewLookup: GradientPreviewLookup | undefined
  let gradientPreviewPixels: Uint8ClampedArray<ArrayBuffer> | undefined
  let gradientPreviewBuffer: HTMLCanvasElement | undefined
  let gradientBaseImage: HTMLImageElement | undefined

  const gradientPreviewDimensions = computed(() => {
    const documentSpec = options.document()
    return brushPreviewSize(
      documentSpec.width,
      documentSpec.height,
      documentSpec.width,
      documentSpec.height,
      options.scale(),
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      MAXIMUM_INTERACTIVE_GRADIENT_PREVIEW_PIXELS
    )
  })

  const gradientPreviewStyle = computed(() => gradientInteraction.value ? {
    left: '0',
    top: '0',
    width: `${options.document().width}px`,
    height: `${options.document().height}px`
  } : undefined)

  function captureGradientPreviewCanvas(element: unknown) {
    gradientPreviewCanvas.value = element instanceof HTMLCanvasElement ? element : null
  }

  function gradientPreviewHidesLayer(layerId: string) {
    return gradientPreviewReady.value && gradientInteraction.value?.layerId === layerId
  }

  function previewBuffer(width: number, height: number) {
    if (!gradientPreviewBuffer) gradientPreviewBuffer = document.createElement('canvas')
    if (gradientPreviewBuffer.width !== width) gradientPreviewBuffer.width = width
    if (gradientPreviewBuffer.height !== height) gradientPreviewBuffer.height = height
    return gradientPreviewBuffer
  }

  function displayedLayerImage(layerId: string, source: string) {
    const escapedId = CSS.escape(layerId)
    const layer = options.surface.value?.querySelector<HTMLElement>(
      `.document-layer[data-layer-id="${escapedId}"]`
    )
    const image = layer?.querySelector<HTMLImageElement>('img.layer-image-buffer--active')
    return image?.complete && image.naturalWidth > 0 && image.getAttribute('src') === source
      ? image
      : undefined
  }

  function loadGradientBaseImage(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('A prévia da camada não pôde ser carregada.'))
      image.src = source
    })
  }

  function drawGradientPreview() {
    const interaction = gradientInteraction.value
    const canvas = gradientPreviewCanvas.value
    if (!interaction || !canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    if (gradientIsDegenerate(interaction.geometry)) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      gradientPreviewReady.value = false
      return
    }
    const documentSpec = options.document()
    const documentToPreview: Matrix2D = [
      canvas.width / documentSpec.width,
      0,
      0,
      canvas.height / documentSpec.height,
      0,
      0
    ]
    gradientPreviewLookup ??= createGradientPreviewLookup(interaction.config)
    gradientPreviewPixels = renderGradientPreviewPixels({
      width: canvas.width,
      height: canvas.height,
      documentWidth: documentSpec.width,
      documentHeight: documentSpec.height,
      geometry: interaction.geometry,
      config: interaction.config,
      lookup: gradientPreviewLookup,
      output: gradientPreviewPixels
    })
    const buffer = previewBuffer(canvas.width, canvas.height)
    const bufferContext = buffer.getContext('2d')
    if (!bufferContext) return
    bufferContext.putImageData(
      new ImageData(gradientPreviewPixels, canvas.width, canvas.height),
      0,
      0
    )
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)

    const layer = options.paintableLayer()
    if (interaction.selection && gradientBaseImage && layer?.transform && layer.id === interaction.layerId) {
      const imageToPreview = multiplyMatrices(
        documentToPreview,
        layerSourceToDocumentMatrix(
          layer.transform,
          gradientBaseImage.naturalWidth,
          gradientBaseImage.naturalHeight
        )
      )
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.setTransform(...imageToPreview)
      context.drawImage(gradientBaseImage, 0, 0)
      context.save()
      context.globalCompositeOperation = 'destination-out'
      clipContextToSelection(context, interaction.selection, documentToPreview)
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.restore()
    }

    context.save()
    if (interaction.selection) clipContextToSelection(context, interaction.selection, documentToPreview)
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(buffer, 0, 0)
    context.restore()
    gradientPreviewReady.value = !interaction.selection || Boolean(gradientBaseImage)
  }

  async function prepareGradientBaseImage(interaction: GradientInteraction, source: string) {
    const generation = ++gradientPreviewGeneration
    await nextTick()
    try {
      const image = displayedLayerImage(interaction.layerId, source) ?? await loadGradientBaseImage(source)
      if (generation !== gradientPreviewGeneration || gradientInteraction.value !== interaction) return
      gradientBaseImage = image
      drawGradientPreview()
    } catch {
      // Mantém a camada original visível. O raster definitivo ainda pode ser aplicado
      // pelo worker mesmo se a imagem auxiliar da prévia não estiver disponível.
    }
  }

  function startGradientPointer(event: PointerEvent, point: SelectionPoint) {
    const scroll = options.scrollArea.value
    const layer = options.paintableLayer()
    const documentSpec = options.document()
    if (
      !scroll ||
      event.button !== 0 ||
      options.isBusy() ||
      Boolean(gradientInteraction.value) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > documentSpec.width ||
      point.y > documentSpec.height ||
      !layer?.image ||
      !layer.transform
    ) return false
    event.preventDefault()
    event.stopPropagation()
    scroll.setPointerCapture(event.pointerId)
    const config = normalizeGradientStopsConfig(options.config())
    gradientInteraction.value = {
      pointerId: event.pointerId,
      layerId: layer.id,
      geometry: { start: { ...point }, end: { ...point } },
      config,
      selection: cloneSelection(options.selection())
    }
    gradientPreviewReady.value = false
    gradientPreviewLookup = createGradientPreviewLookup(config)
    gradientPreviewPixels = undefined
    gradientBaseImage = undefined
    const interaction = gradientInteraction.value
    const source = layer.image.previewUrl ?? layer.image.sourceUrl
    if (interaction.selection) void prepareGradientBaseImage(interaction, source)
    else void nextTick(drawGradientPreview)
    return true
  }

  function hasGradientPointer(pointerId: number) {
    return gradientInteraction.value?.pointerId === pointerId
  }

  function updateGradientPointer(event: PointerEvent) {
    const interaction = gradientInteraction.value
    if (interaction?.pointerId !== event.pointerId) return false
    event.preventDefault()
    const point = options.documentPointFromPointer(event)
    if (!point) return true
    interaction.geometry = {
      start: interaction.geometry.start,
      end: event.shiftKey ? snapGradientEndpoint(interaction.geometry.start, point) : point
    }
    options.scheduleInteractionFrame(drawGradientPreview)
    return true
  }

  function stopGradientPointer(event: PointerEvent) {
    const interaction = gradientInteraction.value
    if (interaction?.pointerId !== event.pointerId) return false
    let endpointChanged = false
    if (event.type === 'pointerup') {
      const point = options.documentPointFromPointer(event)
      if (point) {
        const end = event.shiftKey ? snapGradientEndpoint(interaction.geometry.start, point) : point
        endpointChanged = end.x !== interaction.geometry.end.x || end.y !== interaction.geometry.end.y
        interaction.geometry = {
          start: interaction.geometry.start,
          end
        }
      }
    }
    options.discardInteractionFrame()
    if (gradientGestureAction(event.type, interaction.geometry) === 'confirm') {
      interaction.pointerId = -1
      // O frame pendente já foi descarregado por CanvasViewport antes deste método.
      // Só redesenha quando o pointerup realmente trouxe uma coordenada final nova.
      if (endpointChanged) drawGradientPreview()
      options.confirm(interaction.geometry, interaction.config, interaction.selection)
      queueMicrotask(() => {
        if (gradientInteraction.value === interaction && !options.isBusy()) cancelGradient()
      })
    } else {
      gradientPreviewGeneration += 1
      gradientPreviewReady.value = false
      gradientPreviewLookup = undefined
      gradientPreviewPixels = undefined
      gradientBaseImage = undefined
      gradientInteraction.value = null
      gradientPreviewCanvas.value = null
    }
    return true
  }

  function cancelGradient() {
    if (!gradientInteraction.value) return false
    if (handoffFallbackTimer) window.clearTimeout(handoffFallbackTimer)
    handoffFallbackTimer = 0
    options.discardInteractionFrame()
    gradientPreviewGeneration += 1
    gradientPreviewReady.value = false
    gradientPreviewLookup = undefined
    gradientPreviewPixels = undefined
    gradientBaseImage = undefined
    const canvas = gradientPreviewCanvas.value
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    gradientInteraction.value = null
    gradientPreviewCanvas.value = null
    return true
  }

  function notifyLayerImageReady(layerId: string) {
    const interaction = gradientInteraction.value
    if (options.isBusy() || interaction?.pointerId !== -1 || interaction.layerId !== layerId) return
    // CanvasLayer emits readiness only after its double buffer becomes the active
    // texture, so the preview can now leave without revealing the previous raster.
    cancelGradient()
  }

  watch(options.activeTool, (tool) => {
    if (tool !== 'gradient') cancelGradient()
  })
  watch(() => options.config().type, (type) => {
    if (gradientInteraction.value && gradientInteraction.value.config.type !== type) cancelGradient()
  })
  watch(options.isBusy, (busy) => {
    const interaction = gradientInteraction.value
    if (busy && interaction && interaction.pointerId >= 0) {
      cancelGradient()
      return
    }
    if (!busy && interaction?.pointerId === -1) {
      // Successful commits are cleared by notifyLayerImageReady after CanvasLayer's
      // two-frame texture handoff. This fallback covers errors and no-op commits.
      if (handoffFallbackTimer) window.clearTimeout(handoffFallbackTimer)
      handoffFallbackTimer = window.setTimeout(() => {
        handoffFallbackTimer = 0
        if (!options.isBusy() && gradientInteraction.value === interaction) cancelGradient()
      }, 1000)
    }
  })
  watch(
    () => [options.paintableLayer()?.id, options.document()] as const,
    () => cancelGradient()
  )

  onBeforeUnmount(cancelGradient)

  return {
    cancelGradient,
    captureGradientPreviewCanvas,
    gradientPreviewHidesLayer,
    gradientInteraction,
    gradientPreviewDimensions,
    gradientPreviewStyle,
    hasGradientPointer,
    notifyLayerImageError: notifyLayerImageReady,
    notifyLayerImageLoaded: notifyLayerImageReady,
    startGradientPointer,
    stopGradientPointer,
    updateGradientPointer
  }
}

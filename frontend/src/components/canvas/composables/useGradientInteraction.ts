import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { brushPreviewSize } from '../../../editor/brush'
import {
  gradientGestureAction,
  snapGradientEndpoint,
  type GradientConfig,
  type GradientGeometry
} from '../../../editor/gradient'
import {
  clipContextToSelection,
  cloneSelection,
  type Matrix2D,
  type SelectionPoint,
  type SelectionRegion
} from '../../../editor/selection'
import type { DocumentSpec, LayerItem } from '../../../types/editor'
import type { GradientInteraction } from '../canvas.types'

interface GradientInteractionOptions {
  activeTool: () => string
  config: () => GradientConfig
  document: () => DocumentSpec
  isBusy: () => boolean
  paintableLayer: () => LayerItem | undefined
  scale: () => number
  selection: () => SelectionRegion | null
  scrollArea: Ref<HTMLDivElement | null>
  documentPointFromPointer: (event: PointerEvent) => SelectionPoint | undefined
  scheduleInteractionFrame: (callback: () => void) => void
  discardInteractionFrame: () => void
  confirm: (geometry: GradientGeometry, config: GradientConfig, selection: SelectionRegion | null) => void
}

export function useGradientInteraction(options: GradientInteractionOptions) {
  const gradientInteraction = ref<GradientInteraction | null>(null)
  const gradientPreviewCanvas = ref<HTMLCanvasElement | null>(null)

  const gradientPreviewDimensions = computed(() => {
    const documentSpec = options.document()
    return brushPreviewSize(
      documentSpec.width,
      documentSpec.height,
      documentSpec.width,
      documentSpec.height,
      options.scale(),
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      1_048_576
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

  function drawGradientPreview() {
    const interaction = gradientInteraction.value
    const canvas = gradientPreviewCanvas.value
    if (!interaction || !canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const documentSpec = options.document()
    const documentToPreview: Matrix2D = [
      canvas.width / documentSpec.width,
      0,
      0,
      canvas.height / documentSpec.height,
      0,
      0
    ]
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.save()
    if (interaction.selection) clipContextToSelection(context, interaction.selection, documentToPreview)
    context.setTransform(...documentToPreview)
    const gradient = context.createLinearGradient(
      interaction.geometry.start.x,
      interaction.geometry.start.y,
      interaction.geometry.end.x,
      interaction.geometry.end.y
    )
    const startColor = interaction.config.reversed
      ? interaction.config.backgroundColor
      : interaction.config.foregroundColor
    const endColor = interaction.config.reversed
      ? interaction.config.foregroundColor
      : interaction.config.backgroundColor
    gradient.addColorStop(0, startColor)
    gradient.addColorStop(1, endColor)
    context.fillStyle = gradient
    context.fillRect(0, 0, documentSpec.width, documentSpec.height)
    context.restore()
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
    const config = options.config()
    gradientInteraction.value = {
      pointerId: event.pointerId,
      layerId: layer.id,
      geometry: { start: { ...point }, end: { ...point } },
      config: { ...config },
      selection: cloneSelection(options.selection())
    }
    void nextTick(drawGradientPreview)
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
    if (event.type === 'pointerup') {
      const point = options.documentPointFromPointer(event)
      if (point) {
        interaction.geometry = {
          start: interaction.geometry.start,
          end: event.shiftKey ? snapGradientEndpoint(interaction.geometry.start, point) : point
        }
      }
    }
    options.discardInteractionFrame()
    if (gradientGestureAction(event.type, interaction.geometry) === 'confirm') {
      interaction.pointerId = -1
      drawGradientPreview()
      options.confirm(interaction.geometry, interaction.config, interaction.selection)
      queueMicrotask(() => {
        if (gradientInteraction.value === interaction && !options.isBusy()) cancelGradient()
      })
    } else {
      gradientInteraction.value = null
      gradientPreviewCanvas.value = null
    }
    return true
  }

  function cancelGradient() {
    if (!gradientInteraction.value) return false
    options.discardInteractionFrame()
    const canvas = gradientPreviewCanvas.value
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    gradientInteraction.value = null
    gradientPreviewCanvas.value = null
    return true
  }

  watch(options.activeTool, (tool) => {
    if (tool !== 'gradient') cancelGradient()
  })
  watch(options.isBusy, (busy) => {
    const interaction = gradientInteraction.value
    if ((busy && interaction && interaction.pointerId >= 0) || (!busy && interaction?.pointerId === -1)) {
      cancelGradient()
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
    gradientInteraction,
    gradientPreviewDimensions,
    gradientPreviewStyle,
    hasGradientPointer,
    startGradientPointer,
    stopGradientPointer,
    updateGradientPointer
  }
}

import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  appendBrushPoint,
  brushPointSpacing,
  brushPreviewHandoffAction,
  brushPreviewSize,
  brushPreviewUsesLayerSpace,
  drawBrushPoints,
  stableEraserPreviewSize,
  type BrushOperation
} from '../../../editor/brush'
import { layerTransformStyle, type DocumentPoint } from '../../../editor/freeTransform'
import {
  invertMatrix,
  layerSourceToDocumentMatrix,
  multiplyMatrices,
  type Matrix2D,
  type SelectionRegion
} from '../../../editor/selection'
import type { DocumentSpec, LayerItem, LayerTransform } from '../../../types/editor'
import type { BrushInteraction } from '../canvas.types'

interface BrushInteractionOptions {
  activeDisplayTransform: () => LayerTransform | undefined
  activeTool: () => string
  brushColor: () => string
  brushSize: () => number
  document: () => DocumentSpec
  isBusy: () => boolean
  paintableLayer: () => LayerItem | undefined
  scale: () => number
  selection: () => SelectionRegion | null
  scrollArea: Ref<HTMLDivElement | null>
  surface: Ref<HTMLDivElement | null>
  documentPointFromPointer: (event: PointerEvent) => DocumentPoint | undefined
  scheduleInteractionFrame: (callback: () => void) => void
  discardInteractionFrame: () => void
  paintStroke: (
    points: DocumentPoint[],
    size: number,
    color: string,
    operation: BrushOperation,
    selection: SelectionRegion | null,
    previewWidth: number,
    previewHeight: number
  ) => void
}

export function useBrushInteraction(options: BrushInteractionOptions) {
  const brushInteraction = shallowRef<BrushInteraction | null>(null)
  const brushPreviewCanvas = ref<HTMLCanvasElement | null>(null)
  const brushPreviewPending = ref(false)
  const eraserPreviewReady = ref(false)

  let pendingBrushBaseImageSource: string | undefined
  let pendingBrushCommittedImageSource: string | undefined
  let pendingBrushWasFree = false
  let pendingBrushOperation: BrushOperation = 'paint'
  let pendingBrushLayerId: string | undefined
  let pendingBrushPreviewSize: { width: number; height: number } | undefined
  let eraserPreviewGeneration = 0

  const activeBrushOperation = computed<BrushOperation | undefined>(() =>
    brushInteraction.value?.operation ?? (brushPreviewPending.value ? pendingBrushOperation : undefined)
  )

  const brushPreviewDimensions = computed(() => {
    const captured = brushInteraction.value
      ? { width: brushInteraction.value.previewWidth, height: brushInteraction.value.previewHeight }
      : pendingBrushPreviewSize
    if (captured) return captured
    const layer = options.paintableLayer()
    if (!layer?.image || !layer.transform) return { width: 1, height: 1 }
    const free = activeBrushOperation.value === 'paint' && (
      brushInteraction.value ? !brushInteraction.value.selection : brushPreviewPending.value && pendingBrushWasFree
    )
    const documentSpec = options.document()
    const scale = options.scale()
    const density = typeof window === 'undefined' ? 1 : window.devicePixelRatio
    if (free) {
      return brushPreviewSize(
        documentSpec.width * 2,
        documentSpec.height * 2,
        documentSpec.width,
        documentSpec.height,
        scale,
        density
      )
    }
    return brushPreviewSize(
      layer.image.width,
      layer.image.height,
      layer.transform.width,
      layer.transform.height,
      scale,
      density
    )
  })

  const brushPreviewStyle = computed(() => {
    const transform = options.activeDisplayTransform()
    const layer = options.paintableLayer()
    if (!transform || !layer || (!brushInteraction.value && !brushPreviewPending.value)) return undefined
    const free = activeBrushOperation.value === 'paint' && (
      brushInteraction.value ? !brushInteraction.value.selection : pendingBrushWasFree
    )
    if (free) {
      const documentSpec = options.document()
      return {
        left: '0',
        top: '0',
        width: `${documentSpec.width}px`,
        height: `${documentSpec.height}px`
      }
    }
    return layerTransformStyle(transform)
  })

  function captureBrushPreviewCanvas(element: unknown) {
    brushPreviewCanvas.value = element instanceof HTMLCanvasElement ? element : null
  }

  function brushPreviewHidesLayer(layerId: string) {
    return eraserPreviewReady.value &&
      (brushInteraction.value?.layerId ?? pendingBrushLayerId) === layerId
  }

  function createBrushSelectionPath(selection: SelectionRegion | null) {
    if (!selection) return null
    const path = new Path2D()
    if (selection.kind === 'pixels') {
      for (const span of selection.spans) path.rect(span.x0, span.y, span.x1 - span.x0, 1)
    } else if (selection.kind === 'rectangle') {
      const { x, y, width, height } = selection.bounds
      path.rect(x, y, width, height)
    } else if (selection.kind === 'ellipse') {
      const { x, y, width, height } = selection.bounds
      path.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    } else {
      const first = selection.points[0]
      if (first) {
        path.moveTo(first.x, first.y)
        for (let index = 1; index < selection.points.length; index++) {
          const point = selection.points[index]!
          path.lineTo(point.x, point.y)
        }
        path.closePath()
      }
    }
    return path
  }

  function drawPendingBrushPreview() {
    const interaction = brushInteraction.value
    const layer = options.paintableLayer()
    const canvas = brushPreviewCanvas.value
    if (
      !interaction ||
      !layer?.image ||
      !layer.transform ||
      layer.id !== interaction.layerId ||
      !canvas
    ) return
    if (interaction.operation === 'erase' && !eraserPreviewReady.value) return
    const context = canvas.getContext('2d')
    if (!context) return
    const documentSpec = options.document()
    const documentToPreview: Matrix2D = brushPreviewUsesLayerSpace(
      interaction.operation,
      Boolean(interaction.selection)
    )
      ? invertMatrix(layerSourceToDocumentMatrix(layer.transform, canvas.width, canvas.height))
      : [canvas.width / documentSpec.width, 0, 0, canvas.height / documentSpec.height, 0, 0]

    context.save()
    if (interaction.selection && interaction.selectionPath) {
      const selectionToPreview = interaction.selection.kind === 'pixels'
        ? multiplyMatrices(documentToPreview, interaction.selection.sourceToDocument)
        : documentToPreview
      context.setTransform(...selectionToPreview)
      context.clip(interaction.selectionPath)
    }
    context.setTransform(...documentToPreview)
    interaction.renderedPointCount = drawBrushPoints(
      context,
      interaction.points,
      interaction.renderedPointCount,
      options.brushSize(),
      options.brushColor(),
      interaction.operation
    )
    context.restore()
  }

  function loadBrushPreviewImage(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('A prévia da camada não pôde ser carregada.'))
      image.src = source
    })
  }

  function eraserPreviewDimensions(layer: LayerItem) {
    if (!layer.image || !layer.transform) return { width: 1, height: 1 }
    return stableEraserPreviewSize(
      layer.image,
      layer.transform.width,
      layer.transform.height,
      options.scale(),
      typeof window === 'undefined' ? 1 : window.devicePixelRatio
    )
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

  async function prepareEraserPreview(interaction: BrushInteraction) {
    const generation = ++eraserPreviewGeneration
    await nextTick()
    try {
      const image = displayedLayerImage(interaction.layerId, interaction.baseImageSource) ??
        await loadBrushPreviewImage(interaction.baseImageSource)
      if (generation !== eraserPreviewGeneration || brushInteraction.value !== interaction) return
      const canvas = brushPreviewCanvas.value
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      interaction.renderedPointCount = 0
      eraserPreviewReady.value = true
      drawPendingBrushPreview()
    } catch {
      // O raster definitivo ainda será processado pelo worker. Enquanto a prévia
      // não estiver disponível, mantemos a camada original visível.
    }
  }

  function clearBrushPreview() {
    eraserPreviewGeneration += 1
    const canvas = brushPreviewCanvas.value
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    brushPreviewPending.value = false
    eraserPreviewReady.value = false
    pendingBrushWasFree = false
    pendingBrushOperation = 'paint'
    pendingBrushLayerId = undefined
    pendingBrushPreviewSize = undefined
    pendingBrushBaseImageSource = undefined
    pendingBrushCommittedImageSource = undefined
  }

  function startBrushPointer(event: PointerEvent, point: DocumentPoint, operation: BrushOperation) {
    const scroll = options.scrollArea.value
    const layer = options.paintableLayer()
    if (
      !scroll ||
      event.button !== 0 ||
      options.isBusy() ||
      !layer?.image ||
      !layer.transform
    ) return false
    event.preventDefault()
    event.stopPropagation()
    scroll.setPointerCapture(event.pointerId)
    const documentSpec = options.document()
    const selection = options.selection()
    const density = typeof window === 'undefined' ? 1 : window.devicePixelRatio
    const previewSize = operation === 'erase'
      ? eraserPreviewDimensions(layer)
      : !selection
        ? brushPreviewSize(
            documentSpec.width * 2,
            documentSpec.height * 2,
            documentSpec.width,
            documentSpec.height,
            options.scale(),
            density
          )
        : brushPreviewSize(
            layer.image.width,
            layer.image.height,
            layer.transform.width,
            layer.transform.height,
            options.scale(),
            density
          )
    brushInteraction.value = {
      pointerId: event.pointerId,
      layerId: layer.id,
      operation,
      points: [point],
      renderedPointCount: 0,
      selection,
      selectionPath: createBrushSelectionPath(selection),
      baseImageSource: layer.image.previewUrl ?? layer.image.sourceUrl,
      previewWidth: previewSize.width,
      previewHeight: previewSize.height
    }
    eraserPreviewReady.value = false
    if (operation === 'erase') void prepareEraserPreview(brushInteraction.value)
    else void nextTick(drawPendingBrushPreview)
    return true
  }

  function hasBrushPointer(pointerId: number) {
    return brushInteraction.value?.pointerId === pointerId
  }

  function updateBrushPointer(event: PointerEvent) {
    const interaction = brushInteraction.value
    if (interaction?.pointerId !== event.pointerId) return false
    event.preventDefault()
    const spacing = brushPointSpacing(options.brushSize(), options.scale())
    const samples = event.getCoalescedEvents?.() ?? []
    for (const sample of samples) {
      const point = options.documentPointFromPointer(sample)
      if (point) appendBrushPoint(interaction.points, point, spacing)
    }
    const point = options.documentPointFromPointer(event)
    if (point) appendBrushPoint(interaction.points, point, spacing)
    options.scheduleInteractionFrame(() => {
      if (brushInteraction.value?.pointerId !== event.pointerId) return
      drawPendingBrushPreview()
    })
    return true
  }

  function stopBrushPointer(event: PointerEvent) {
    const interaction = brushInteraction.value
    if (interaction?.pointerId !== event.pointerId) return false
    const finalPoint = options.documentPointFromPointer(event)
    if (finalPoint) appendBrushPoint(interaction.points, finalPoint, 0, true)
    drawPendingBrushPreview()
    brushInteraction.value = null
    if (event.type !== 'pointercancel' && interaction.points.length > 0) {
      pendingBrushBaseImageSource = interaction.baseImageSource
      pendingBrushCommittedImageSource = undefined
      pendingBrushWasFree = interaction.operation === 'paint' && !interaction.selection
      pendingBrushOperation = interaction.operation
      pendingBrushLayerId = interaction.layerId
      pendingBrushPreviewSize = {
        width: interaction.previewWidth,
        height: interaction.previewHeight
      }
      brushPreviewPending.value = true
      options.paintStroke(
        interaction.points,
        options.brushSize(),
        options.brushColor(),
        interaction.operation,
        interaction.selection,
        interaction.previewWidth,
        interaction.previewHeight
      )
    } else {
      clearBrushPreview()
    }
    return true
  }

  function cancelBrush() {
    if (!brushInteraction.value) return false
    options.discardInteractionFrame()
    clearBrushPreview()
    brushInteraction.value = null
    return true
  }

  function notifyLayerImageLoaded(layerId: string, source: string) {
    if (!brushPreviewPending.value || layerId !== pendingBrushLayerId) return
    const action = brushPreviewHandoffAction(
      pendingBrushBaseImageSource,
      source,
      options.isBusy(),
      true
    )
    if (action === 'mark-committed') pendingBrushCommittedImageSource = source
    if (action === 'clear') clearBrushPreview()
  }

  function notifyLayerImageError(layerId: string, source: string) {
    if (
      brushPreviewPending.value &&
      layerId === pendingBrushLayerId &&
      source === pendingBrushCommittedImageSource
    ) clearBrushPreview()
  }

  watch(
    () => {
      const layer = options.paintableLayer()
      if (!layer || layer.id !== pendingBrushLayerId) return undefined
      return layer.image?.previewUrl ?? layer.image?.sourceUrl
    },
    (source) => {
      if (!brushPreviewPending.value) return
      const action = brushPreviewHandoffAction(
        pendingBrushBaseImageSource,
        source,
        options.isBusy(),
        false
      )
      if (action === 'mark-committed') pendingBrushCommittedImageSource = source
      if (action === 'clear') clearBrushPreview()
    }
  )

  watch(options.isBusy, (busy) => {
    if (busy || !brushPreviewPending.value) return
    const layer = options.paintableLayer()
    const image = layer && layer.id === pendingBrushLayerId ? layer.image : undefined
    const currentSource = image?.previewUrl ?? image?.sourceUrl
    const action = brushPreviewHandoffAction(
      pendingBrushBaseImageSource,
      currentSource,
      false,
      false
    )
    if (action === 'mark-committed') pendingBrushCommittedImageSource = currentSource
    if (action === 'clear') clearBrushPreview()
  })

  watch(options.activeTool, (tool) => {
    if (tool !== 'brush' && tool !== 'eraser' && brushInteraction.value) cancelBrush()
  })

  onBeforeUnmount(() => {
    eraserPreviewGeneration += 1
    const canvas = brushPreviewCanvas.value
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
  })

  return {
    activeBrushOperation,
    brushPreviewDimensions,
    brushPreviewHidesLayer,
    brushPreviewStyle,
    cancelBrush,
    captureBrushPreviewCanvas,
    clearBrushPreview,
    hasBrushPointer,
    notifyLayerImageError,
    notifyLayerImageLoaded,
    startBrushPointer,
    stopBrushPointer,
    updateBrushPointer
  }
}

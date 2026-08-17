import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { snapBoundsTranslation } from '../../../editor/guides'
import {
  imageSourceForRasterSize,
  snapCanvasTranslation,
  viewportPreviewGeometry
} from '../../../editor/preview'
import {
  clipContextToSelection,
  layerSourceToDocumentMatrix,
  multiplyMatrices,
  selectionContainsPoint,
  selectionMoveDelta,
  translateSelection,
  type SelectionPoint,
  type SelectionRegion
} from '../../../editor/selection'
import type { EditorGuide } from '../../../editor/guides'
import type { LayerItem } from '../../../types/editor'
import type { SelectionMoveAnchor, SelectionMoveInteraction } from '../canvas.types'

interface SelectionMoveOptions {
  activeTool: () => string
  document: () => { width: number; height: number }
  guideSnappingEnabled: () => boolean
  guides: () => EditorGuide[]
  guidesVisible: () => boolean
  isBusy: () => boolean
  paintableLayer: () => LayerItem | undefined
  scale: () => number
  selectionMoveAnchor: () => SelectionMoveAnchor | null
  scrollArea: Ref<HTMLDivElement | null>
  surface: Ref<HTMLDivElement | null>
  selectionDraft: Ref<SelectionRegion | null>
  scheduleInteractionFrame: (callback: () => void) => void
  discardInteractionFrame: () => void
  setSnappedGuides: (guides: { x?: number; y?: number }) => void
  onWindowPointerMove: (event: PointerEvent) => void
  onWindowPointerStop: (event: PointerEvent) => void
  moveSelection: (
    originalSelection: SelectionRegion,
    movedSelection: SelectionRegion,
    deltaX: number,
    deltaY: number,
    previewScaleX: number,
    previewScaleY: number
  ) => void
}

export function useSelectionMove(options: SelectionMoveOptions) {
  const selectionMoveInteraction = shallowRef<SelectionMoveInteraction | null>(null)
  const selectionMoveCanvas = ref<HTMLCanvasElement | null>(null)
  const selectionMoveReady = ref(false)
  const selectionMovePending = ref(false)

  let pendingSelectionMoveBaseSource: string | undefined
  let pendingSelectionMoveCommittedSource: string | undefined
  let cachedSelectionMoveImage: { source: string; image: HTMLImageElement } | undefined
  let keyboardSelectionCommitTimeout: ReturnType<typeof setTimeout> | undefined

  const selectionMovePreviewStyle = computed(() => {
    const interaction = selectionMoveInteraction.value
    if (!interaction) return undefined
    return {
      left: `${interaction.previewX}px`,
      top: `${interaction.previewY}px`,
      width: `${interaction.previewDocumentWidth}px`,
      height: `${interaction.previewDocumentHeight}px`
    }
  })

  function captureSelectionMoveCanvas(element: unknown) {
    selectionMoveCanvas.value = element instanceof HTMLCanvasElement ? element : null
  }

  function selectionMoveHidesLayer(layerId: string) {
    return selectionMoveReady.value && selectionMoveInteraction.value?.layerId === layerId
  }

  function bindSelectionMoveWindowEvents() {
    window.addEventListener('pointermove', options.onWindowPointerMove)
    window.addEventListener('pointerup', options.onWindowPointerStop)
    window.addEventListener('pointercancel', options.onWindowPointerStop)
  }

  function unbindSelectionMoveWindowEvents() {
    window.removeEventListener('pointermove', options.onWindowPointerMove)
    window.removeEventListener('pointerup', options.onWindowPointerStop)
    window.removeEventListener('pointercancel', options.onWindowPointerStop)
  }

  function clearSelectionMovePreview() {
    unbindSelectionMoveWindowEvents()
    if (keyboardSelectionCommitTimeout) clearTimeout(keyboardSelectionCommitTimeout)
    keyboardSelectionCommitTimeout = undefined
    const canvas = selectionMoveCanvas.value
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    selectionMoveInteraction.value = null
    selectionMoveReady.value = false
    selectionMovePending.value = false
    options.selectionDraft.value = null
    pendingSelectionMoveBaseSource = undefined
    pendingSelectionMoveCommittedSource = undefined
  }

  function redrawSelectionMovePreview() {
    const interaction = selectionMoveInteraction.value
    const canvas = selectionMoveCanvas.value
    const baseCanvas = interaction?.baseCanvas
    const contentCanvas = interaction?.contentCanvas
    if (!interaction || !canvas || !baseCanvas || !contentCanvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const deltaX = snapCanvasTranslation(
      (interaction.previewBaseDeltaX + interaction.deltaX) * (canvas.width / interaction.previewDocumentWidth)
    )
    const deltaY = snapCanvasTranslation(
      (interaction.previewBaseDeltaY + interaction.deltaY) * (canvas.height / interaction.previewDocumentHeight)
    )
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(baseCanvas, 0, 0)
    context.drawImage(contentCanvas, deltaX, deltaY)
  }

  async function loadSelectionMovePreviewImage(source: string) {
    if (cachedSelectionMoveImage?.source === source && cachedSelectionMoveImage.image.complete) {
      return cachedSelectionMoveImage.image
    }
    const image = new Image()
    image.decoding = 'async'
    image.src = source
    try {
      await image.decode()
    } catch {
      await new Promise<void>((resolve, reject) => {
        if (image.complete && image.naturalWidth > 0) resolve()
        else {
          image.onload = () => resolve()
          image.onerror = () => reject(new Error('Não foi possível preparar a prévia da seleção flutuante.'))
        }
      })
    }
    cachedSelectionMoveImage = { source, image }
    return image
  }

  async function prepareSelectionMovePreview() {
    const interaction = selectionMoveInteraction.value
    const canvas = selectionMoveCanvas.value
    const layer = options.paintableLayer()
    if (!interaction || !canvas || !layer?.image || !layer.transform) return
    const layerElements = options.surface.value?.querySelectorAll<HTMLElement>('.document-layer')
    const layerElement = layerElements
      ? Array.from(layerElements).find((element) => element.dataset.layerId === interaction.layerId)
      : undefined
    const activeImage = layerElement?.querySelector<HTMLImageElement>('img.layer-image-buffer--active')
    const activeSource = activeImage?.currentSrc || activeImage?.src
    const image = activeImage?.complete && activeImage.naturalWidth > 0 && activeSource === interaction.previewImageSource
      ? activeImage
      : await loadSelectionMovePreviewImage(interaction.previewImageSource)
    if (selectionMoveInteraction.value !== interaction || image.naturalWidth === 0) return

    const baseCanvas = document.createElement('canvas')
    baseCanvas.width = canvas.width
    baseCanvas.height = canvas.height
    const baseContext = baseCanvas.getContext('2d', { alpha: true })
    const contentCanvas = document.createElement('canvas')
    contentCanvas.width = canvas.width
    contentCanvas.height = canvas.height
    const contentContext = contentCanvas.getContext('2d', { alpha: true })
    if (!baseContext || !contentContext) return
    baseContext.imageSmoothingEnabled = true
    baseContext.imageSmoothingQuality = 'high'
    contentContext.imageSmoothingEnabled = true
    contentContext.imageSmoothingQuality = 'high'
    const documentToPreview: [number, number, number, number, number, number] = [
      canvas.width / interaction.previewDocumentWidth,
      0,
      0,
      canvas.height / interaction.previewDocumentHeight,
      -interaction.previewX * (canvas.width / interaction.previewDocumentWidth),
      -interaction.previewY * (canvas.height / interaction.previewDocumentHeight)
    ]
    const imageToPreview = multiplyMatrices(
      documentToPreview,
      layerSourceToDocumentMatrix(interaction.transform, image.naturalWidth, image.naturalHeight)
    )
    baseContext.setTransform(...imageToPreview)
    baseContext.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight)
    baseContext.setTransform(1, 0, 0, 1, 0, 0)

    contentContext.save()
    clipContextToSelection(contentContext, interaction.previewSelection, documentToPreview)
    contentContext.setTransform(...imageToPreview)
    contentContext.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight)
    contentContext.restore()
    baseContext.save()
    baseContext.globalCompositeOperation = 'destination-out'
    clipContextToSelection(baseContext, interaction.previewSelection, documentToPreview)
    baseContext.setTransform(1, 0, 0, 1, 0, 0)
    baseContext.fillRect(0, 0, canvas.width, canvas.height)
    baseContext.restore()

    if (selectionMoveInteraction.value !== interaction) return
    interaction.baseCanvas = baseCanvas
    interaction.contentCanvas = contentCanvas
    redrawSelectionMovePreview()
    selectionMoveReady.value = true
  }

  function beginSelectionMove(pointerId: number, start: SelectionPoint, selection: SelectionRegion) {
    const scroll = options.scrollArea.value
    const surface = options.surface.value
    const layer = options.paintableLayer()
    if (!scroll || !surface || !layer?.image || !layer.transform || options.isBusy()) return false
    const anchorCandidate = options.selectionMoveAnchor()
    const anchor = anchorCandidate?.layerId === layer.id ? anchorCandidate : null
    const surfaceRect = surface.getBoundingClientRect()
    const viewportRect = scroll.getBoundingClientRect()
    const documentSpec = options.document()
    const previewGeometry = viewportPreviewGeometry(
      documentSpec.width,
      documentSpec.height,
      options.scale(),
      typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      surfaceRect,
      viewportRect
    )
    const previewAsset = anchor?.image ?? layer.image
    const previewTransform = anchor?.transform ?? layer.transform
    const previewImageSource = imageSourceForRasterSize(
      previewAsset,
      Math.abs(previewTransform.width) * (previewGeometry.rasterWidth / previewGeometry.width),
      Math.abs(previewTransform.height) * (previewGeometry.rasterHeight / previewGeometry.height)
    )
    selectionMoveInteraction.value = {
      pointerId,
      layerId: layer.id,
      start,
      deltaX: 0,
      deltaY: 0,
      originalSelection: selection,
      baseImageSource: layer.image.previewUrl ?? layer.image.sourceUrl,
      previewImageSource,
      previewSelection: anchor?.selection ?? selection,
      previewBaseDeltaX: anchor?.deltaX ?? 0,
      previewBaseDeltaY: anchor?.deltaY ?? 0,
      previewWidth: previewGeometry.rasterWidth,
      previewHeight: previewGeometry.rasterHeight,
      previewX: previewGeometry.x,
      previewY: previewGeometry.y,
      previewDocumentWidth: previewGeometry.width,
      previewDocumentHeight: previewGeometry.height,
      transform: { ...previewTransform }
    }
    options.selectionDraft.value = selection
    void nextTick(() => void prepareSelectionMovePreview())
    return true
  }

  function startSelectionMove(event: PointerEvent, point: SelectionPoint, selection: SelectionRegion) {
    const layer = options.paintableLayer()
    if (
      !options.scrollArea.value ||
      !layer?.image ||
      !selectionContainsPoint(selection, point) ||
      options.isBusy()
    ) return false
    event.preventDefault()
    event.stopPropagation()
    const started = beginSelectionMove(event.pointerId, point, selection)
    if (started) bindSelectionMoveWindowEvents()
    return started
  }

  function snappingActive(event: Pick<PointerEvent, 'ctrlKey' | 'metaKey'>) {
    return options.guideSnappingEnabled() &&
      options.guidesVisible() &&
      options.guides().length > 0 &&
      !event.ctrlKey &&
      !event.metaKey
  }

  function hasSelectionMovePointer(pointerId: number) {
    return selectionMoveInteraction.value?.pointerId === pointerId
  }

  function updateSelectionMovePointer(event: PointerEvent, point: SelectionPoint) {
    const interaction = selectionMoveInteraction.value
    if (interaction?.pointerId !== event.pointerId) return false
    event.preventDefault()
    const pointerDelta = selectionMoveDelta(interaction.start, point, event.shiftKey)
    let delta = { deltaX: pointerDelta.x, deltaY: pointerDelta.y }
    if (snappingActive(event)) {
      const bounds = interaction.originalSelection.bounds
      const snapped = snapBoundsTranslation(bounds, delta.deltaX, delta.deltaY, options.guides(), options.scale())
      delta = { deltaX: Math.round(snapped.deltaX), deltaY: Math.round(snapped.deltaY) }
      options.setSnappedGuides({ x: snapped.snappedX, y: snapped.snappedY })
    } else {
      options.setSnappedGuides({})
    }
    options.scheduleInteractionFrame(() => {
      const current = selectionMoveInteraction.value
      if (!current || current.pointerId !== event.pointerId) return
      current.deltaX = delta.deltaX
      current.deltaY = delta.deltaY
      options.selectionDraft.value = translateSelection(
        current.originalSelection,
        current.deltaX,
        current.deltaY
      )
      redrawSelectionMovePreview()
    })
    return true
  }

  function emitSelectionMove(interaction: SelectionMoveInteraction) {
    const movedSelection = translateSelection(
      interaction.originalSelection,
      interaction.deltaX,
      interaction.deltaY
    )
    interaction.pointerId = -1
    selectionMovePending.value = true
    pendingSelectionMoveBaseSource = interaction.baseImageSource
    pendingSelectionMoveCommittedSource = undefined
    options.selectionDraft.value = movedSelection
    options.moveSelection(
      interaction.originalSelection,
      movedSelection,
      interaction.deltaX,
      interaction.deltaY,
      interaction.previewWidth / interaction.previewDocumentWidth,
      interaction.previewHeight / interaction.previewDocumentHeight
    )
  }

  function stopSelectionMovePointer(event: PointerEvent) {
    const interaction = selectionMoveInteraction.value
    if (interaction?.pointerId !== event.pointerId) return false
    unbindSelectionMoveWindowEvents()
    if (event.type === 'pointercancel' || (!interaction.deltaX && !interaction.deltaY)) {
      clearSelectionMovePreview()
    } else {
      emitSelectionMove(interaction)
    }
    return true
  }

  function handleKeyboardSelectionNudge(nudge: { x: number; y: number }, selection: SelectionRegion) {
    let interaction = selectionMoveInteraction.value
    if (!interaction || interaction.pointerId !== -2) {
      if (interaction || !beginSelectionMove(-2, { x: 0, y: 0 }, selection)) return true
      interaction = selectionMoveInteraction.value
    }
    if (!interaction) return true
    interaction.deltaX += nudge.x
    interaction.deltaY += nudge.y
    options.selectionDraft.value = translateSelection(
      interaction.originalSelection,
      interaction.deltaX,
      interaction.deltaY
    )
    redrawSelectionMovePreview()
    if (keyboardSelectionCommitTimeout) clearTimeout(keyboardSelectionCommitTimeout)
    keyboardSelectionCommitTimeout = setTimeout(commitKeyboardSelectionMove, 2000)
    return true
  }

  function commitKeyboardSelectionMove() {
    if (keyboardSelectionCommitTimeout) clearTimeout(keyboardSelectionCommitTimeout)
    keyboardSelectionCommitTimeout = undefined
    const interaction = selectionMoveInteraction.value
    if (!interaction || interaction.pointerId !== -2) return
    if (!interaction.deltaX && !interaction.deltaY) {
      clearSelectionMovePreview()
      return
    }
    emitSelectionMove(interaction)
  }

  function cancelSelectionMove() {
    const interaction = selectionMoveInteraction.value
    if (!interaction || interaction.pointerId === -1) return false
    options.discardInteractionFrame()
    clearSelectionMovePreview()
    return true
  }

  function shouldKeepPointerCapture(event: PointerEvent) {
    return event.buttons !== 0 && selectionMoveInteraction.value?.pointerId === event.pointerId
  }

  function notifyLayerImageLoaded(layerId: string, source: string) {
    if (layerId !== selectionMoveInteraction.value?.layerId) return
    if (selectionMovePending.value && source !== pendingSelectionMoveBaseSource) {
      pendingSelectionMoveCommittedSource = source
    }
    if (
      selectionMovePending.value &&
      layerId === selectionMoveInteraction.value?.layerId &&
      source === pendingSelectionMoveCommittedSource
    ) clearSelectionMovePreview()
  }

  function notifyLayerImageError(layerId: string, source: string) {
    if (layerId !== selectionMoveInteraction.value?.layerId) return
    if (
      selectionMovePending.value &&
      layerId === selectionMoveInteraction.value?.layerId &&
      source === pendingSelectionMoveCommittedSource
    ) clearSelectionMovePreview()
  }

  watch(
    () => options.selectionMoveAnchor()?.image.previewUrl ?? options.selectionMoveAnchor()?.image.sourceUrl,
    (source) => {
      if (!source || cachedSelectionMoveImage?.source !== source) cachedSelectionMoveImage = undefined
    }
  )

  watch(
    () => {
      const layer = options.paintableLayer()
      if (!layer || layer.id !== selectionMoveInteraction.value?.layerId) return undefined
      const image = layer.image
      return image?.previewUrl ?? image?.sourceUrl
    },
    (source) => {
      if (selectionMovePending.value && source && source !== pendingSelectionMoveBaseSource) {
        pendingSelectionMoveCommittedSource = source
      }
    }
  )

  watch(options.isBusy, (busy) => {
    if (busy || !selectionMovePending.value) return
    const layer = options.paintableLayer()
    const image = layer && layer.id === selectionMoveInteraction.value?.layerId ? layer.image : undefined
    const currentSource = image?.previewUrl ?? image?.sourceUrl
    if (currentSource && currentSource !== pendingSelectionMoveBaseSource) {
      pendingSelectionMoveCommittedSource = currentSource
    } else {
      clearSelectionMovePreview()
    }
  })

  watch(options.activeTool, (tool) => {
    if (tool !== 'move' && selectionMoveInteraction.value && selectionMoveInteraction.value.pointerId !== -1) {
      options.discardInteractionFrame()
      clearSelectionMovePreview()
    }
  })

  onBeforeUnmount(() => {
    unbindSelectionMoveWindowEvents()
    cachedSelectionMoveImage = undefined
    if (keyboardSelectionCommitTimeout) clearTimeout(keyboardSelectionCommitTimeout)
  })

  return {
    cancelSelectionMove,
    captureSelectionMoveCanvas,
    commitKeyboardSelectionMove,
    handleKeyboardSelectionNudge,
    hasSelectionMovePointer,
    notifyLayerImageError,
    notifyLayerImageLoaded,
    selectionMoveHidesLayer,
    selectionMoveInteraction,
    selectionMovePreviewStyle,
    shouldKeepPointerCapture,
    startSelectionMove,
    stopSelectionMovePointer,
    updateSelectionMovePointer
  }
}

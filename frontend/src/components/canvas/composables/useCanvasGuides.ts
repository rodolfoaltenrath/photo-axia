import { computed, onBeforeUnmount, onMounted, shallowRef, ref, watch, type Ref } from 'vue'
import type { DocumentPoint } from '../../../editor/freeTransform'
import {
  snapGuidePositionToLayer,
  snapGuidePositionToTicks,
  type EditorGuide,
  type GuideOrientation,
  type RulerOrigin,
  type RulerUnit
} from '../../../editor/guides'
import type { LayerTransform } from '../../../types/editor'
import type { GuideInteraction, OriginInteraction } from '../canvas.types'

export interface CanvasRulersApi {
  updatePointerDocument: (point: DocumentPoint | null) => void
  updateViewportOffsets: (x: number, y: number) => void
}

export interface GuideOverlayApi {
  updateViewportOffsets: (x: number, y: number) => void
}

interface CanvasGuideOptions {
  canvasRulers: Ref<CanvasRulersApi | null>
  activeTool: () => string
  document: () => { width: number; height: number; resolutionDpi: number }
  guideIds: () => string[]
  guideSnappingEnabled: () => boolean
  guidesLocked: () => boolean
  rulersVisible: () => boolean
  rulerOrigin: () => RulerOrigin
  rulerUnit: () => RulerUnit
  scale: () => number
  activeSnapTransform: () => LayerTransform | undefined
  documentPointFromClient: (clientX: number, clientY: number) => DocumentPoint | undefined
  scheduleInteractionFrame: (callback: () => void) => void
  flushInteractionFrame: () => void
  createGuide: (guide: EditorGuide) => void
  updateGuide: (guide: EditorGuide) => void
  deleteGuide: (guideId: string) => void
  updateGuidesVisible: (visible: boolean) => void
  updateRulerOrigin: (origin: RulerOrigin) => void
}

export function useCanvasGuides(options: CanvasGuideOptions) {
  const selectedGuideId = ref<string | null>(null)
  const snappedGuides = ref<{ x?: number; y?: number }>({})
  const guideInteraction = shallowRef<GuideInteraction | null>(null)
  const originInteraction = shallowRef<OriginInteraction | null>(null)
  const displayedRulerOrigin = computed(() => originInteraction.value?.draft ?? options.rulerOrigin())
  const draftGuide = computed(() => guideInteraction.value?.guide ?? null)

  function guideAtPointer(
    interaction: GuideInteraction,
    event: Pick<PointerEvent, 'clientX' | 'clientY' | 'altKey' | 'shiftKey'>
  ) {
    const point = options.documentPointFromClient(event.clientX, event.clientY)
    if (!point) return { guide: interaction.guide, snapped: {} }
    const orientation: GuideOrientation = event.altKey
      ? interaction.initialOrientation === 'horizontal' ? 'vertical' : 'horizontal'
      : interaction.initialOrientation
    const origin = orientation === 'vertical' ? displayedRulerOrigin.value.x : displayedRulerOrigin.value.y
    let position = orientation === 'vertical' ? point.x : point.y
    if (event.shiftKey) {
      const document = options.document()
      position = snapGuidePositionToTicks(
        position,
        options.scale(),
        options.rulerUnit(),
        document.resolutionDpi,
        origin
      )
    } else if (options.guideSnappingEnabled()) {
      const transform = options.activeSnapTransform()
      if (transform) {
        const result = snapGuidePositionToLayer(position, orientation, transform, options.scale())
        if (result.snappedX !== undefined || result.snappedY !== undefined) {
          return {
            guide: { ...interaction.guide, orientation, position: result.value },
            snapped: { x: result.snappedX, y: result.snappedY }
          }
        }
      }
    }
    if (options.rulerUnit() === 'px' && !event.shiftKey) position = Math.round(position)
    return { guide: { ...interaction.guide, orientation, position }, snapped: {} }
  }

  function pointerCaptureTarget(event: PointerEvent) {
    const target = event.currentTarget instanceof Element
      ? event.currentTarget
      : event.target instanceof Element ? event.target : null
    target?.setPointerCapture(event.pointerId)
    return target
  }

  function releaseGuidePointer(interaction: GuideInteraction) {
    if (interaction.pointerTarget?.hasPointerCapture(interaction.pointerId)) {
      interaction.pointerTarget.releasePointerCapture(interaction.pointerId)
    }
  }

  function startGuideCreation(orientation: GuideOrientation, event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    snappedGuides.value = {}
    options.updateGuidesVisible(true)
    const guide: EditorGuide = { id: crypto.randomUUID(), orientation, position: 0 }
    const interaction: GuideInteraction = {
      pointerId: event.pointerId,
      pointerTarget: pointerCaptureTarget(event),
      guide,
      initialGuide: null,
      initialOrientation: orientation
    }
    const initial = guideAtPointer(interaction, event)
    interaction.guide = initial.guide
    snappedGuides.value = initial.snapped
    guideInteraction.value = interaction
    selectedGuideId.value = guide.id
  }

  function startGuideMove(guide: EditorGuide, event: PointerEvent) {
    if (event.button !== 0 || options.guidesLocked() || options.activeTool() !== 'move') return
    event.preventDefault()
    snappedGuides.value = {}
    guideInteraction.value = {
      pointerId: event.pointerId,
      pointerTarget: pointerCaptureTarget(event),
      guide: { ...guide },
      initialGuide: { ...guide },
      initialOrientation: guide.orientation
    }
    selectedGuideId.value = guide.id
  }

  function startRulerOrigin(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    originInteraction.value = { pointerId: event.pointerId, draft: { ...options.rulerOrigin() } }
  }

  function resetRulerOrigin() {
    options.updateRulerOrigin({ x: 0, y: 0 })
  }

  function rulerOriginAtPointer(clientX: number, clientY: number) {
    const point = options.documentPointFromClient(clientX, clientY)
    if (!point) return undefined
    const document = options.document()
    const origin = {
      x: Math.max(0, Math.min(document.width, point.x)),
      y: Math.max(0, Math.min(document.height, point.y))
    }
    return options.rulerUnit() === 'px'
      ? { x: Math.round(origin.x), y: Math.round(origin.y) }
      : origin
  }

  function updateRulerInteraction(event: PointerEvent) {
    const guideDrag = guideInteraction.value
    if (guideDrag?.pointerId === event.pointerId) {
      event.preventDefault()
      const result = guideAtPointer(guideDrag, event)
      options.scheduleInteractionFrame(() => {
        if (guideInteraction.value?.pointerId !== event.pointerId) return
        guideInteraction.value = { ...guideInteraction.value, guide: result.guide }
        snappedGuides.value = result.snapped
      })
      return
    }
    const originDrag = originInteraction.value
    if (originDrag?.pointerId === event.pointerId) {
      const draft = rulerOriginAtPointer(event.clientX, event.clientY)
      if (!draft) return
      event.preventDefault()
      options.scheduleInteractionFrame(() => {
        if (originInteraction.value?.pointerId !== event.pointerId) return
        originInteraction.value = { ...originInteraction.value, draft }
      })
    }
  }

  function stopRulerInteraction(event: PointerEvent) {
    const guideDrag = guideInteraction.value
    if (guideDrag?.pointerId === event.pointerId) {
      options.flushInteractionFrame()
      const guide = guideAtPointer(guideDrag, event).guide
      const document = options.document()
      const maximum = guide.orientation === 'vertical' ? document.width : document.height
      if (guide.position >= 0 && guide.position <= maximum) {
        const committed = { ...guide, position: Math.round(guide.position * 100) / 100 }
        if (guideDrag.initialGuide) options.updateGuide(committed)
        else options.createGuide(committed)
        selectedGuideId.value = committed.id
      } else if (guideDrag.initialGuide) {
        options.deleteGuide(guideDrag.initialGuide.id)
        selectedGuideId.value = null
      }
      releaseGuidePointer(guideDrag)
      guideInteraction.value = null
      snappedGuides.value = {}
      return
    }
    const originDrag = originInteraction.value
    if (originDrag?.pointerId === event.pointerId) {
      const finalOrigin = rulerOriginAtPointer(event.clientX, event.clientY) ?? originDrag.draft
      options.updateRulerOrigin({
        x: Math.round(finalOrigin.x * 100) / 100,
        y: Math.round(finalOrigin.y * 100) / 100
      })
      originInteraction.value = null
    }
  }

  function updateRulerPointer(clientX: number, clientY: number) {
    if (!options.rulersVisible()) return
    const document = options.document()
    const hoverPoint = options.documentPointFromClient(clientX, clientY)
    const pointer = hoverPoint &&
      hoverPoint.x >= 0 && hoverPoint.y >= 0 &&
      hoverPoint.x <= document.width && hoverPoint.y <= document.height
      ? hoverPoint
      : null
    options.canvasRulers.value?.updatePointerDocument(pointer)
  }

  function clearRulerPointer() {
    options.canvasRulers.value?.updatePointerDocument(null)
  }

  function setSnappedGuides(next: { x?: number; y?: number }) {
    const current = snappedGuides.value
    if (current.x === next.x && current.y === next.y) return
    snappedGuides.value = next
  }

  function clearSelectedGuide() {
    selectedGuideId.value = null
  }

  function cancelInteraction() {
    if (!guideInteraction.value && !originInteraction.value) return false
    if (guideInteraction.value) releaseGuidePointer(guideInteraction.value)
    guideInteraction.value = null
    originInteraction.value = null
    snappedGuides.value = {}
    return true
  }

  function deleteSelectedGuide() {
    if (!selectedGuideId.value || options.activeTool() !== 'move' || options.guidesLocked()) return false
    options.deleteGuide(selectedGuideId.value)
    selectedGuideId.value = null
    return true
  }

  function resetTransientInteractions() {
    cancelInteraction()
  }

  watch(options.guideIds, (guideIds) => {
    if (selectedGuideId.value && !guideIds.includes(selectedGuideId.value)) selectedGuideId.value = null
  })

  onMounted(() => {
    window.addEventListener('pointermove', updateRulerInteraction)
    window.addEventListener('pointerup', stopRulerInteraction)
    window.addEventListener('pointercancel', stopRulerInteraction)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', updateRulerInteraction)
    window.removeEventListener('pointerup', stopRulerInteraction)
    window.removeEventListener('pointercancel', stopRulerInteraction)
    if (guideInteraction.value) releaseGuidePointer(guideInteraction.value)
  })

  return {
    cancelInteraction,
    clearRulerPointer,
    clearSelectedGuide,
    deleteSelectedGuide,
    displayedRulerOrigin,
    draftGuide,
    resetRulerOrigin,
    resetTransientInteractions,
    selectedGuideId,
    setSnappedGuides,
    snappedGuides,
    startGuideCreation,
    startGuideMove,
    startRulerOrigin,
    updateRulerPointer
  }
}

import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { DocumentPoint } from '../../../editor/freeTransform'
import {
  clampSelectionToBounds,
  constrainedSelectionEndpoint,
  createLassoSelection,
  createShapeSelection,
  pointsBounds,
  selectionIsEmpty,
  snapShapeSelectionToBounds,
  type SelectionMode,
  type SelectionPoint,
  type SelectionRegion
} from '../../../editor/selection'
import type { LayerTransform } from '../../../types/editor'
import type { SelectionInteraction } from '../canvas.types'

interface SelectionInteractionOptions {
  activeTool: () => string
  activeLayerTransform: () => LayerTransform | undefined
  document: () => { width: number; height: number }
  scale: () => number
  selection: () => SelectionRegion | null
  selectionMode: () => SelectionMode
  scrollArea: Ref<HTMLDivElement | null>
  snapPoint: (point: DocumentPoint, event: PointerEvent) => DocumentPoint
  scheduleInteractionFrame: (callback: () => void) => void
  discardInteractionFrame: () => void
  magicWandSelect: (point: SelectionPoint) => void
  updateSelection: (selection: SelectionRegion | null) => void
}

export function useSelectionInteraction(options: SelectionInteractionOptions) {
  const selectionDraft = shallowRef<SelectionRegion | null>(null)
  const selectionInteraction = ref<SelectionInteraction | null>(null)
  const visibleSelection = computed(() => selectionDraft.value ?? options.selection())

  function selectionBounds() {
    const transform = options.activeLayerTransform()
    if (!transform) {
      const document = options.document()
      return { x: 0, y: 0, width: document.width, height: document.height }
    }
    return { x: transform.x, y: transform.y, width: transform.width, height: transform.height }
  }

  function startSelectionPointer(event: PointerEvent, point: SelectionPoint) {
    const scroll = options.scrollArea.value
    if (!scroll || event.button !== 0) return false
    event.preventDefault()
    event.stopPropagation()
    const mode = options.selectionMode()
    if (mode === 'magic-wand') {
      options.magicWandSelect(point)
      return true
    }

    scroll.setPointerCapture(event.pointerId)
    selectionInteraction.value = {
      pointerId: event.pointerId,
      mode,
      start: point,
      points: [point]
    }
    selectionDraft.value = mode === 'lasso'
      ? { kind: 'lasso', points: [point], bounds: { x: point.x, y: point.y, width: 0, height: 0 } }
      : createShapeSelection(mode, point, point)
    return true
  }

  function updateSelectionWithDocumentPoint(event: PointerEvent, rawPoint: DocumentPoint) {
    const interaction = selectionInteraction.value
    if (interaction?.pointerId !== event.pointerId) return false
    event.preventDefault()
    const point = interaction.mode === 'lasso' ? rawPoint : options.snapPoint(rawPoint, event)
    if (interaction.mode === 'lasso') {
      const previous = interaction.points.at(-1)!
      const minimumDistance = Math.max(0.25, 1.5 / options.scale())
      if ((point.x - previous.x) ** 2 + (point.y - previous.y) ** 2 < minimumDistance ** 2) return true
      interaction.points.push(point)
      const points = interaction.points.slice()
      options.scheduleInteractionFrame(() => {
        if (selectionInteraction.value?.pointerId !== event.pointerId) return
        selectionDraft.value = { kind: 'lasso', points, bounds: pointsBounds(points) }
      })
    } else {
      const endpoint = event.shiftKey
        ? constrainedSelectionEndpoint(
            interaction.start,
            point,
            Number.POSITIVE_INFINITY,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            Number.NEGATIVE_INFINITY
          )
        : point
      const selection = createShapeSelection(interaction.mode, interaction.start, endpoint, event.shiftKey)
      options.scheduleInteractionFrame(() => {
        if (selectionInteraction.value?.pointerId !== event.pointerId) return
        selectionDraft.value = selection
      })
    }
    return true
  }

  function hasSelectionPointer(pointerId: number) {
    return selectionInteraction.value?.pointerId === pointerId
  }

  function stopSelectionPointer(pointerId: number) {
    if (selectionInteraction.value?.pointerId !== pointerId) return false
    let completed = selectionDraft.value
    if (completed?.kind === 'lasso') {
      completed = createLassoSelection(completed.points, Math.max(0.2, 0.75 / options.scale()))
    }
    if (completed) {
      const bounds = selectionBounds()
      completed = clampSelectionToBounds(completed, bounds)
      completed = snapShapeSelectionToBounds(completed, bounds, 6 / Math.max(options.scale(), 0.01))
    }
    options.updateSelection(completed && !selectionIsEmpty(completed) ? completed : null)
    selectionInteraction.value = null
    selectionDraft.value = null
    return true
  }

  function cancelSelection() {
    if (!selectionInteraction.value && !options.selection()) return false
    options.discardInteractionFrame()
    selectionInteraction.value = null
    selectionDraft.value = null
    options.updateSelection(null)
    return true
  }

  function cancelCreation() {
    if (!selectionInteraction.value) return
    options.discardInteractionFrame()
    selectionInteraction.value = null
    selectionDraft.value = null
  }

  watch(options.activeTool, (tool) => {
    if (tool !== 'crop') cancelCreation()
  })

  return {
    cancelSelection,
    hasSelectionPointer,
    selectionDraft,
    startSelectionPointer,
    stopSelectionPointer,
    updateSelectionWithDocumentPoint,
    visibleSelection
  }
}

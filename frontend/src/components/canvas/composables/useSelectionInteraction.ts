import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { DocumentPoint } from '../../../editor/freeTransform'
import {
  clampSelectionToBounds,
  constrainedSelectionEndpoint,
  createLassoSelection,
  pointsBounds,
  selectionIsEmpty,
  snapShapeSelectionToBounds,
  type SelectionMode,
  type SelectionPoint,
  type SelectionRegion
} from '../../../editor/selection'
import {
  createMarqueeSelection,
  isMarqueeSelectionMode
} from '../../../editor/marqueeSelection'
import {
  combineSelections,
  resolveSelectionCombineMode,
  type SelectionCombineMode
} from '../../../editor/selectionCombine'
import type { LayerTransform } from '../../../types/editor'
import type { SelectionInteraction } from '../canvas.types'

interface SelectionInteractionOptions {
  activeTool: () => string
  activeLayerTransform: () => LayerTransform | undefined
  document: () => { width: number; height: number }
  scale: () => number
  selection: () => SelectionRegion | null
  selectionCombineMode: () => SelectionCombineMode
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
  const visibleSelection = computed(() => selectionInteraction.value ? selectionDraft.value : options.selection())

  function selectionBounds(mode: SelectionInteraction['mode']) {
    if (isMarqueeSelectionMode(mode)) {
      const document = options.document()
      return { x: 0, y: 0, width: document.width, height: document.height }
    }
    const transform = options.activeLayerTransform()
    if (!transform) {
      const document = options.document()
      return { x: 0, y: 0, width: document.width, height: document.height }
    }
    return { x: transform.x, y: transform.y, width: transform.width, height: transform.height }
  }

  function combinedDraft(
    parentSelection: SelectionRegion | null,
    incoming: SelectionRegion | null,
    mode: SelectionCombineMode
  ) {
    return combineSelections(parentSelection, incoming, mode, options.document())
  }

  function startSelectionPointer(event: PointerEvent, rawPoint: SelectionPoint) {
    const scroll = options.scrollArea.value
    if (!scroll || event.button !== 0) return false
    const document = options.document()
    const pointIsInsideDocument = rawPoint.x >= 0 && rawPoint.y >= 0 &&
      rawPoint.x < document.width && rawPoint.y < document.height
    event.preventDefault()
    event.stopPropagation()
    const mode = options.selectionMode()
    if (mode === 'magic-wand') {
      if (!pointIsInsideDocument) return false
      options.magicWandSelect(rawPoint)
      return true
    }

    const point = mode === 'rectangle' || mode === 'ellipse'
      ? options.snapPoint(rawPoint, event)
      : rawPoint
    const parentSelection = options.selection()
    const combineMode = resolveSelectionCombineMode(options.selectionCombineMode(), event)

    scroll.setPointerCapture(event.pointerId)
    selectionInteraction.value = {
      pointerId: event.pointerId,
      mode,
      start: point,
      points: [point],
      parentSelection,
      combineMode
    }
    const incoming: SelectionRegion | null = mode === 'lasso'
      ? { kind: 'lasso', points: [point], bounds: { x: point.x, y: point.y, width: 0, height: 0 } }
      : createMarqueeSelection(mode, point, point, options.document())
    selectionDraft.value = combinedDraft(parentSelection, incoming, combineMode)
    return true
  }

  function updateSelectionWithDocumentPoint(event: PointerEvent, rawPoint: DocumentPoint) {
    const interaction = selectionInteraction.value
    if (interaction?.pointerId !== event.pointerId) return false
    event.preventDefault()
    if (interaction.mode === 'single-row' || interaction.mode === 'single-column') return true
    const point = interaction.mode === 'rectangle' || interaction.mode === 'ellipse'
      ? options.snapPoint(rawPoint, event)
      : rawPoint
    if (interaction.mode === 'lasso') {
      const previous = interaction.points.at(-1)!
      const minimumDistance = Math.max(0.25, 1.5 / options.scale())
      if ((point.x - previous.x) ** 2 + (point.y - previous.y) ** 2 < minimumDistance ** 2) return true
      interaction.points.push(point)
      const points = interaction.points.slice()
      options.scheduleInteractionFrame(() => {
        if (selectionInteraction.value?.pointerId !== event.pointerId) return
        selectionDraft.value = combinedDraft(
          interaction.parentSelection,
          { kind: 'lasso', points, bounds: pointsBounds(points) },
          interaction.combineMode
        )
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
      const selection = createMarqueeSelection(
        interaction.mode,
        interaction.start,
        endpoint,
        options.document(),
        event.shiftKey
      )
      options.scheduleInteractionFrame(() => {
        if (selectionInteraction.value?.pointerId !== event.pointerId) return
        selectionDraft.value = combinedDraft(interaction.parentSelection, selection, interaction.combineMode)
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
    const interaction = selectionInteraction.value
    if (interaction.mode === 'lasso') {
      const lasso = createLassoSelection(interaction.points, Math.max(0.2, 0.75 / options.scale()))
      const clamped = clampSelectionToBounds(lasso, selectionBounds(interaction.mode))
      completed = combinedDraft(interaction.parentSelection, clamped, interaction.combineMode)
    }
    if (completed) {
      const bounds = selectionBounds(interaction.mode)
      completed = clampSelectionToBounds(completed, bounds)
      if (interaction.mode === 'rectangle' || interaction.mode === 'ellipse') {
        completed = snapShapeSelectionToBounds(completed, bounds, 6 / Math.max(options.scale(), 0.01))
      }
    }
    options.updateSelection(completed && !selectionIsEmpty(completed) ? completed : null)
    selectionInteraction.value = null
    selectionDraft.value = null
    return true
  }

  function cancelSelection() {
    if (!selectionInteraction.value && !options.selection()) return false
    options.discardInteractionFrame()
    const wasCreating = Boolean(selectionInteraction.value)
    selectionInteraction.value = null
    selectionDraft.value = null
    if (!wasCreating) options.updateSelection(null)
    return true
  }

  function cancelCreation() {
    if (!selectionInteraction.value) return
    options.discardInteractionFrame()
    selectionInteraction.value = null
    selectionDraft.value = null
  }

  function cancelSelectionPointer(pointerId: number) {
    if (selectionInteraction.value?.pointerId !== pointerId) return false
    cancelCreation()
    return true
  }

  watch(options.activeTool, (tool) => {
    if (tool !== 'crop') cancelCreation()
  })

  return {
    cancelSelection,
    cancelSelectionPointer,
    hasSelectionPointer,
    selectionDraft,
    startSelectionPointer,
    stopSelectionPointer,
    updateSelectionWithDocumentPoint,
    visibleSelection
  }
}

import { computed, nextTick, onBeforeUnmount, ref, shallowRef, triggerRef, watch, type Ref } from 'vue'
import { brushPreviewSize } from '../../../editor/brush'
import {
  constrainedTranslationDelta,
  resizeLayerTransform,
  type DocumentPoint,
  type TransformHandle
} from '../../../editor/freeTransform'
import {
  normalizeShapeConfig,
  reanchorShapeDrag,
  shapeGeometryFromDrag,
  shapeIsDegenerate,
  traceShapePath,
  type ShapeGeometry,
  type ShapeToolConfig
} from '../../../editor/shape'
import { type Matrix2D, type SelectionPoint } from '../../../editor/selection'
import type { DocumentSpec } from '../../../types/editor'

type ShapeInteractionPhase = 'drawing' | 'editing' | 'move' | 'resize'

export interface ShapeInteraction {
  pointerId: number | null
  phase: ShapeInteractionPhase
  insertionAnchorId?: string
  start: SelectionPoint
  end: SelectionPoint
  pointerOffset: SelectionPoint
  geometry: ShapeGeometry
  config: ShapeToolConfig
  previewWidth: number
  previewHeight: number
  constrainProportions: boolean
  fromCenter: boolean
  transformStart?: {
    pointer: DocumentPoint
    geometry: ShapeGeometry
    handle?: TransformHandle
    fromCenter?: boolean
  }
}

interface ShapeInteractionOptions {
  activeTool: () => string
  config: () => ShapeToolConfig
  document: () => DocumentSpec
  isBusy: () => boolean
  activeLayerId: () => string | undefined
  scale: () => number
  scrollArea: Ref<HTMLDivElement | null>
  documentPointFromPointer: (event: PointerEvent) => SelectionPoint | undefined
  scheduleInteractionFrame: (callback: () => void) => void
  discardInteractionFrame: () => void
  confirm: (
    insertionAnchorId: string | undefined,
    geometry: ShapeGeometry,
    config: ShapeToolConfig
  ) => void
}

function geometryFromTransform(transform: { x: number; y: number; width: number; height: number }): ShapeGeometry {
  return { x: transform.x, y: transform.y, width: transform.width, height: transform.height }
}

export function useShapeInteraction(options: ShapeInteractionOptions) {
  const interaction = shallowRef<ShapeInteraction | null>(null)
  const previewCanvas = ref<HTMLCanvasElement | null>(null)
  const previewDimensions = computed(() => {
    const documentSpec = options.document()
    return brushPreviewSize(
      documentSpec.width,
      documentSpec.height,
      documentSpec.width,
      documentSpec.height,
      options.scale(),
      typeof window === 'undefined' ? 1 : window.devicePixelRatio
    )
  })
  const previewStyle = computed(() => interaction.value ? {
    left: '0', top: '0', width: `${options.document().width}px`, height: `${options.document().height}px`
  } : undefined)
  const isEditing = computed(() => interaction.value?.phase === 'editing')
  const transformStyle = computed(() => {
    const current = interaction.value
    if (!current || current.phase === 'drawing') return undefined
    return {
      left: `${current.geometry.x}px`,
      top: `${current.geometry.y}px`,
      width: `${current.geometry.width}px`,
      height: `${current.geometry.height}px`
    }
  })

  function capturePreviewCanvas(element: unknown) {
    previewCanvas.value = element instanceof HTMLCanvasElement ? element : null
  }

  function drawPreview() {
    const current = interaction.value
    const canvas = previewCanvas.value
    if (!current || !canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const documentSpec = options.document()
    const scaleX = canvas.width / documentSpec.width
    const scaleY = canvas.height / documentSpec.height
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (shapeIsDegenerate(current.geometry)) return
    context.save()
    const documentToPreview: Matrix2D = [scaleX, 0, 0, scaleY, 0, 0]
    context.setTransform(...documentToPreview)
    traceShapePath(context, current.geometry, current.config)
    context.fillStyle = current.config.color
    context.fill()
    context.restore()
  }

  function start(event: PointerEvent, point: SelectionPoint) {
    const scroll = options.scrollArea.value
    if (
      interaction.value || !scroll || event.button !== 0 || options.isBusy()
    ) return false
    event.preventDefault()
    event.stopPropagation()
    scroll.setPointerCapture(event.pointerId)
    const size = previewDimensions.value
    interaction.value = {
      pointerId: event.pointerId,
      phase: 'drawing',
      insertionAnchorId: options.activeLayerId(),
      start: point,
      end: point,
      pointerOffset: { x: 0, y: 0 },
      geometry: shapeGeometryFromDrag(point, point, event.shiftKey, event.altKey),
      config: normalizeShapeConfig(options.config()),
      previewWidth: size.width,
      previewHeight: size.height,
      constrainProportions: event.shiftKey,
      fromCenter: event.altKey
    }
    void nextTick(drawPreview)
    return true
  }

  function hasPointer(pointerId: number) {
    return interaction.value?.pointerId === pointerId
  }

  function updateDrawing(current: ShapeInteraction, event: PointerEvent, point: SelectionPoint) {
    let effectivePoint = {
      x: point.x + current.pointerOffset.x,
      y: point.y + current.pointerOffset.y
    }
    const nextConstrain = event.shiftKey
    const nextFromCenter = event.altKey
    if (current.fromCenter !== nextFromCenter && current.constrainProportions === nextConstrain) {
      const currentGeometry = shapeGeometryFromDrag(
        current.start,
        effectivePoint,
        current.constrainProportions,
        current.fromCenter
      )
      const reanchored = reanchorShapeDrag(currentGeometry, effectivePoint, nextFromCenter)
      current.start = reanchored.start
      current.pointerOffset = {
        x: reanchored.end.x - point.x,
        y: reanchored.end.y - point.y
      }
      effectivePoint = reanchored.end
    }
    current.end = effectivePoint
    current.constrainProportions = nextConstrain
    current.fromCenter = nextFromCenter
    current.geometry = shapeGeometryFromDrag(
      current.start,
      current.end,
      current.constrainProportions,
      current.fromCenter
    )
  }

  function update(event: PointerEvent) {
    const current = interaction.value
    if (current?.pointerId !== event.pointerId) return false
    const point = options.documentPointFromPointer(event)
    if (!point) return true
    event.preventDefault()
    if (current.phase === 'drawing') {
      updateDrawing(current, event, point)
    } else if (current.phase === 'move' && current.transformStart) {
      const delta = constrainedTranslationDelta(
        point.x - current.transformStart.pointer.x,
        point.y - current.transformStart.pointer.y,
        event.shiftKey
      )
      current.geometry = {
        ...current.transformStart.geometry,
        x: current.transformStart.geometry.x + delta.x,
        y: current.transformStart.geometry.y + delta.y
      }
    } else if (current.phase === 'resize' && current.transformStart?.handle) {
      const handle = current.transformStart.handle
      const isCorner = handle.x !== 0 && handle.y !== 0
      if (current.transformStart.fromCenter !== event.altKey) {
        current.transformStart.geometry = { ...current.geometry }
        current.transformStart.fromCenter = event.altKey
      }
      current.geometry = geometryFromTransform(resizeLayerTransform(
        { ...current.transformStart.geometry, rotation: 0 },
        handle,
        point,
        event.altKey,
        isCorner && !event.shiftKey
      ))
    }
    triggerRef(interaction)
    options.scheduleInteractionFrame(drawPreview)
    return true
  }

  function stop(event: PointerEvent) {
    const current = interaction.value
    if (current?.pointerId !== event.pointerId) return false
    const point = options.documentPointFromPointer(event)
    if (current.phase === 'drawing' && point) updateDrawing(current, event, point)
    current.pointerId = null
    current.transformStart = undefined
    if (event.type === 'pointercancel' || shapeIsDegenerate(current.geometry)) {
      cancel()
    } else {
      current.phase = 'editing'
      triggerRef(interaction)
      options.scheduleInteractionFrame(drawPreview)
    }
    return true
  }

  function captureTransformPointer(event: PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
  }

  function startTransformMove(event: PointerEvent) {
    const current = interaction.value
    const point = options.documentPointFromPointer(event)
    if (event.button !== 0 || current?.phase !== 'editing' || !point) return
    captureTransformPointer(event)
    current.phase = 'move'
    current.pointerId = event.pointerId
    current.transformStart = { pointer: point, geometry: { ...current.geometry } }
    triggerRef(interaction)
  }

  function startTransformResize(event: PointerEvent, handle: TransformHandle) {
    const current = interaction.value
    const point = options.documentPointFromPointer(event)
    if (event.button !== 0 || current?.phase !== 'editing' || !point) return
    captureTransformPointer(event)
    current.phase = 'resize'
    current.pointerId = event.pointerId
    current.transformStart = {
      pointer: point,
      geometry: { ...current.geometry },
      handle,
      fromCenter: event.altKey
    }
    triggerRef(interaction)
  }

  function commit() {
    const current = interaction.value
    if (!current || current.phase === 'drawing' || shapeIsDegenerate(current.geometry)) return false
    options.discardInteractionFrame()
    interaction.value = null
    options.confirm(
      current.insertionAnchorId,
      current.geometry,
      current.config
    )
    clearPreview()
    return true
  }

  function cancel() {
    if (!interaction.value) return false
    options.discardInteractionFrame()
    interaction.value = null
    clearPreview()
    return true
  }

  function clearPreview() {
    const canvas = previewCanvas.value
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
  }

  watch(options.config, (config) => {
    const current = interaction.value
    if (!current || current.phase === 'drawing') return
    current.config = normalizeShapeConfig(config)
    options.scheduleInteractionFrame(drawPreview)
  })

  watch(options.activeTool, (tool) => {
    if (tool === 'shape') return
    if (interaction.value?.phase === 'editing') commit()
    else cancel()
  })

  onBeforeUnmount(clearPreview)

  return {
    cancelShape: cancel,
    captureShapePreviewCanvas: capturePreviewCanvas,
    commitShape: commit,
    hasShapePointer: hasPointer,
    shapeInteraction: interaction,
    shapeIsEditing: isEditing,
    shapePreviewDimensions: previewDimensions,
    shapePreviewStyle: previewStyle,
    shapeTransformStyle: transformStyle,
    startShapePointer: start,
    startShapeTransformMove: startTransformMove,
    startShapeTransformResize: startTransformResize,
    stopShapePointer: stop,
    updateShapePointer: update
  }
}

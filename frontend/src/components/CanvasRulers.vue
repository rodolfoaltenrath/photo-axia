<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  rulerTicks,
  rulerUnitLabel,
  screenPositionForDocument,
  type GuideOrientation,
  type RulerOrigin,
  type RulerUnit
} from '../editor/guides'

const props = defineProps<{
  documentHeight: number
  documentOffsetX: number
  documentOffsetY: number
  documentWidth: number
  origin: RulerOrigin
  resolutionDpi: number
  scale: number
  size: number
  unit: RulerUnit
  viewportHeight: number
  viewportWidth: number
}>()

const emit = defineEmits<{
  (event: 'resetOrigin'): void
  (event: 'startGuide', orientation: GuideOrientation, pointerEvent: PointerEvent): void
  (event: 'startOrigin', pointerEvent: PointerEvent): void
}>()

const horizontalCanvas = ref<HTMLCanvasElement | null>(null)
const verticalCanvas = ref<HTMLCanvasElement | null>(null)
const horizontalPointer = ref<HTMLSpanElement | null>(null)
const verticalPointer = ref<HTMLSpanElement | null>(null)
let drawFrame = 0
let pointerFrame = 0
let lastPointer: { x: number; y: number } | null = null
let liveDocumentOffsetX = props.documentOffsetX
let liveDocumentOffsetY = props.documentOffsetY

function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  const physicalWidth = Math.max(1, Math.round(width * ratio))
  const physicalHeight = Math.max(1, Math.round(height * ratio))
  if (canvas.width !== physicalWidth) canvas.width = physicalWidth
  if (canvas.height !== physicalHeight) canvas.height = physicalHeight
  canvas.style.width = `${Math.max(0, width)}px`
  canvas.style.height = `${Math.max(0, height)}px`
  const context = canvas.getContext('2d')
  if (!context) return undefined
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  return context
}

function drawHorizontal() {
  const canvas = horizontalCanvas.value
  if (!canvas) return
  const width = Math.max(0, props.viewportWidth)
  const size = props.size
  const context = prepareCanvas(canvas, width, size)
  if (!context) return
  context.fillStyle = '#15161a'
  context.fillRect(0, 0, width, size)
  context.strokeStyle = '#34363d'
  context.beginPath()
  context.moveTo(0, size - 0.5)
  context.lineTo(width, size - 0.5)
  context.stroke()

  const visibleStart = -liveDocumentOffsetX / props.scale
  const visibleEnd = (width - liveDocumentOffsetX) / props.scale
  const layout = rulerTicks(visibleStart, visibleEnd, props.scale, props.unit, props.resolutionDpi, props.origin.x)
  context.font = '9px Segoe UI, sans-serif'
  context.textBaseline = 'top'
  context.fillStyle = '#c0c2c8'
  context.strokeStyle = '#62656e'
  for (const tick of layout.ticks) {
    const x = Math.round(screenPositionForDocument(tick.position, liveDocumentOffsetX, props.scale)) + 0.5
    if (x < 0 || x > width) continue
    context.beginPath()
    context.moveTo(x, tick.major ? 7 : 12)
    context.lineTo(x, size)
    context.stroke()
    if (tick.label && x < width - size) context.fillText(tick.label, x + 3, 0)
  }

  for (const edge of [0, props.documentWidth]) {
    const x = Math.round(screenPositionForDocument(edge, liveDocumentOffsetX, props.scale)) + 0.5
    if (x < 0 || x > width) continue
    context.strokeStyle = '#92959d'
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, size)
    context.stroke()
  }
}

function drawVertical() {
  const canvas = verticalCanvas.value
  if (!canvas) return
  const height = Math.max(0, props.viewportHeight)
  const size = props.size
  const context = prepareCanvas(canvas, size, height)
  if (!context) return
  context.fillStyle = '#15161a'
  context.fillRect(0, 0, size, height)
  context.strokeStyle = '#34363d'
  context.beginPath()
  context.moveTo(size - 0.5, 0)
  context.lineTo(size - 0.5, height)
  context.stroke()

  const visibleStart = -liveDocumentOffsetY / props.scale
  const visibleEnd = (height - liveDocumentOffsetY) / props.scale
  const layout = rulerTicks(visibleStart, visibleEnd, props.scale, props.unit, props.resolutionDpi, props.origin.y)
  context.font = '9px Segoe UI, sans-serif'
  context.textBaseline = 'top'
  context.fillStyle = '#c0c2c8'
  context.strokeStyle = '#62656e'
  for (const tick of layout.ticks) {
    const y = Math.round(screenPositionForDocument(tick.position, liveDocumentOffsetY, props.scale)) + 0.5
    if (y < 0 || y > height) continue
    context.beginPath()
    context.moveTo(tick.major ? 7 : 12, y)
    context.lineTo(size, y)
    context.stroke()
    if (tick.label && y > 18) {
      context.save()
      context.translate(0, y - 3)
      context.rotate(-Math.PI / 2)
      context.fillText(tick.label, 0, 0)
      context.restore()
    }
  }

  for (const edge of [0, props.documentHeight]) {
    const y = Math.round(screenPositionForDocument(edge, liveDocumentOffsetY, props.scale)) + 0.5
    if (y < 0 || y > height) continue
    context.strokeStyle = '#92959d'
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(size, y)
    context.stroke()
  }
}

function drawPointer() {
  pointerFrame = 0
  const horizontal = horizontalPointer.value
  const vertical = verticalPointer.value
  if (!horizontal || !vertical) return

  if (!lastPointer) {
    horizontal.hidden = true
    vertical.hidden = true
    return
  }

  const x = Math.round(screenPositionForDocument(lastPointer.x, liveDocumentOffsetX, props.scale))
  const y = Math.round(screenPositionForDocument(lastPointer.y, liveDocumentOffsetY, props.scale))
  horizontal.hidden = x < 0 || x > props.viewportWidth
  vertical.hidden = y < 0 || y > props.viewportHeight
  if (!horizontal.hidden) horizontal.style.transform = `translate3d(${x}px, 0, 0)`
  if (!vertical.hidden) vertical.style.transform = `translate3d(0, ${y}px, 0)`
}

function updatePointerDocument(point: { x: number; y: number } | null) {
  lastPointer = point
  if (!pointerFrame) pointerFrame = requestAnimationFrame(drawPointer)
}

function scheduleDraw() {
  if (drawFrame) return
  drawFrame = requestAnimationFrame(() => {
    drawFrame = 0
    drawHorizontal()
    drawVertical()
  })
}

function updateViewportOffsets(offsetX: number, offsetY: number) {
  const horizontalChanged = offsetX !== liveDocumentOffsetX
  const verticalChanged = offsetY !== liveDocumentOffsetY
  if (!horizontalChanged && !verticalChanged) return
  liveDocumentOffsetX = offsetX
  liveDocumentOffsetY = offsetY
  cancelAnimationFrame(drawFrame)
  drawFrame = 0
  cancelAnimationFrame(pointerFrame)
  pointerFrame = 0
  if (horizontalChanged) drawHorizontal()
  if (verticalChanged) drawVertical()
  drawPointer()
}

watch(
  () => [props.documentOffsetX, props.documentOffsetY] as const,
  ([offsetX, offsetY]) => updateViewportOffsets(offsetX, offsetY)
)

watch(
  () => [
    props.viewportWidth,
    props.viewportHeight,
    props.documentWidth,
    props.documentHeight,
    props.scale,
    props.size,
    props.resolutionDpi,
    props.unit,
    props.origin.x,
    props.origin.y
  ],
  () => void nextTick(() => {
    scheduleDraw()
    updatePointerDocument(lastPointer)
  }),
  { immediate: true }
)

onBeforeUnmount(() => {
  cancelAnimationFrame(drawFrame)
  cancelAnimationFrame(pointerFrame)
})

defineExpose({ updatePointerDocument, updateViewportOffsets })
</script>

<template>
  <div class="canvas-rulers" aria-label="Réguas do documento">
    <button
      class="ruler-corner"
      type="button"
      :title="`Origem das réguas · ${rulerUnitLabel(unit)} (arraste para alterar; duplo clique para redefinir)`"
      @dblclick="emit('resetOrigin')"
      @pointerdown="emit('startOrigin', $event)"
    >
      {{ rulerUnitLabel(unit) }}
    </button>
    <canvas
      ref="horizontalCanvas"
      class="document-ruler document-ruler--horizontal"
      aria-label="Régua horizontal; arraste para criar uma guia"
      @pointerdown="emit('startGuide', 'horizontal', $event)"
    ></canvas>
    <canvas
      ref="verticalCanvas"
      class="document-ruler document-ruler--vertical"
      aria-label="Régua vertical; arraste para criar uma guia"
      @pointerdown="emit('startGuide', 'vertical', $event)"
    ></canvas>
    <span ref="horizontalPointer" class="ruler-pointer ruler-pointer--horizontal" hidden></span>
    <span ref="verticalPointer" class="ruler-pointer ruler-pointer--vertical" hidden></span>
  </div>
</template>

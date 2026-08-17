import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { DocumentSpec } from '../../../types/editor'
import {
  clampZoom,
  MAX_ZOOM,
  nextZoomLevel,
  wheelZoomLevel
} from '../../../editor/viewport'
import {
  centeredScrollOffset,
  preserveViewportCenter,
  viewportDocumentOffset
} from '../../../editor/viewportNavigation'
import type { PendingNavigation } from '../canvas.types'

interface CanvasNavigationOptions {
  scrollArea: Ref<HTMLDivElement | null>
  document: () => DocumentSpec
  zoom: () => number
  emitZoom: (zoom: number) => void
  scheduleInteractionFrame: (callback: () => void) => void
  onViewportOffsetChange?: (offset: { x: number; y: number }) => void
}

export function useCanvasNavigation(options: CanvasNavigationOptions) {
  const viewportScroll = ref({ left: 0, top: 0 })
  const isNativeScrolling = ref(false)
  const visualZoom = ref(options.zoom())
  const zoomTarget = ref(options.zoom())
  const viewportSize = ref({ width: 1, height: 1 })
  const isViewportReady = ref(false)

  let nativeScrollTimeout: ReturnType<typeof setTimeout> | undefined
  let resizeObserver: ResizeObserver | undefined
  let wheelZoomFrame = 0
  let wheelZoomFrameTime = 0
  let navigationScheduled = false
  let wheelZoomAnchor: { clientX: number; clientY: number } | undefined
  let viewportInitialization = 0
  let pendingNavigation: PendingNavigation | undefined

  const scale = computed(() => visualZoom.value / 100)
  const documentViewportOffset = computed(() => viewportDocumentOffset(
    viewportSize.value,
    viewportScroll.value.left,
    viewportScroll.value.top
  ))
  const scaledDocumentSize = computed(() => ({
    width: Math.max(1, options.document().width * scale.value),
    height: Math.max(1, options.document().height * scale.value)
  }))
  const pasteboardStyle = computed(() => ({
    width: `${viewportSize.value.width * 2 + scaledDocumentSize.value.width}px`,
    height: `${viewportSize.value.height * 2 + scaledDocumentSize.value.height}px`
  }))
  const frameStyle = computed(() => ({
    left: `${viewportSize.value.width}px`,
    top: `${viewportSize.value.height}px`,
    width: `${scaledDocumentSize.value.width}px`,
    height: `${scaledDocumentSize.value.height}px`
  }))
  const surfaceStyle = computed(() => ({
    width: `${options.document().width}px`,
    height: `${options.document().height}px`,
    transform: `scale(${scale.value})`,
    '--transform-handle-size': `${10 / scale.value}px`,
    '--transform-line-width': `${1 / scale.value}px`,
    '--transform-rotate-offset': `${34 / scale.value}px`
  }))

  function syncViewportScroll() {
    const scroll = options.scrollArea.value
    if (!scroll) return
    const next = { left: scroll.scrollLeft, top: scroll.scrollTop }
    if (next.left === viewportScroll.value.left && next.top === viewportScroll.value.top) return
    viewportScroll.value = next
    options.onViewportOffsetChange?.(viewportDocumentOffset(viewportSize.value, next.left, next.top))
  }

  function handleNativeScroll() {
    syncViewportScroll()
    isNativeScrolling.value = true
    if (nativeScrollTimeout) clearTimeout(nativeScrollTimeout)
    nativeScrollTimeout = setTimeout(() => {
      isNativeScrolling.value = false
    }, 120)
  }

  function defaultZoomAnchor() {
    const scroll = options.scrollArea.value
    if (!scroll) return undefined

    const viewport = scroll.getBoundingClientRect()
    const canvasLeft = viewport.left + viewportSize.value.width - scroll.scrollLeft
    const canvasTop = viewport.top + viewportSize.value.height - scroll.scrollTop
    const canvasRight = canvasLeft + scaledDocumentSize.value.width
    const canvasBottom = canvasTop + scaledDocumentSize.value.height
    return {
      x: Math.max(canvasLeft, Math.min(canvasRight, viewport.left + viewport.width / 2)),
      y: Math.max(canvasTop, Math.min(canvasBottom, viewport.top + viewport.height / 2))
    }
  }

  function captureZoomNavigation(clientX?: number, clientY?: number) {
    const scroll = options.scrollArea.value
    if (!scroll) return

    const anchor = clientX === undefined || clientY === undefined
      ? defaultZoomAnchor()
      : { x: clientX, y: clientY }
    if (!anchor) return

    const viewport = scroll.getBoundingClientRect()
    const viewportX = anchor.x - viewport.left
    const viewportY = anchor.y - viewport.top
    pendingNavigation = {
      type: 'anchor',
      viewportX,
      viewportY,
      documentX: (scroll.scrollLeft + viewportX - viewportSize.value.width) / scale.value,
      documentY: (scroll.scrollTop + viewportY - viewportSize.value.height) / scale.value
    }
  }

  function applyPendingNavigation() {
    const scroll = options.scrollArea.value
    const navigation = pendingNavigation
    pendingNavigation = undefined
    if (!scroll || !navigation) return

    if (navigation.type === 'center') {
      scroll.scrollLeft = centeredScrollOffset(scroll.scrollWidth, scroll.clientWidth)
      scroll.scrollTop = centeredScrollOffset(scroll.scrollHeight, scroll.clientHeight)
      syncViewportScroll()
      return
    }

    scroll.scrollLeft = viewportSize.value.width + navigation.documentX * scale.value - navigation.viewportX
    scroll.scrollTop = viewportSize.value.height + navigation.documentY * scale.value - navigation.viewportY
    syncViewportScroll()
  }

  function schedulePendingNavigation() {
    if (navigationScheduled) return
    navigationScheduled = true

    // Vue applies the new scale before resolving nextTick. Updating the scroll
    // here keeps both operations in the same browser frame and avoids exposing
    // an intermediate, incorrectly anchored canvas during continuous zoom.
    void nextTick(() => {
      navigationScheduled = false
      applyPendingNavigation()
    })
  }

  function stageZoom(value: number, clientX?: number, clientY?: number) {
    captureZoomNavigation(clientX, clientY)
    visualZoom.value = clampZoom(value)
    schedulePendingNavigation()
  }

  function stopWheelZoomAnimation() {
    cancelAnimationFrame(wheelZoomFrame)
    wheelZoomFrame = 0
    wheelZoomFrameTime = 0
    wheelZoomAnchor = undefined
  }

  function animateWheelZoom(timestamp: number) {
    const elapsed = wheelZoomFrameTime ? Math.min(34, timestamp - wheelZoomFrameTime) : 16.67
    wheelZoomFrameTime = timestamp

    const current = visualZoom.value
    const target = zoomTarget.value
    const blend = 1 - Math.exp(-elapsed / 42)
    const interpolated = current * Math.exp(Math.log(target / current) * blend)
    const roundedZoom = clampZoom(interpolated)
    const complete = Math.abs(Math.log(target / interpolated)) < 0.001 || roundedZoom === current
    const nextZoom = complete ? target : roundedZoom
    const anchor = wheelZoomAnchor

    stageZoom(nextZoom, anchor?.clientX, anchor?.clientY)

    if (complete) {
      wheelZoomFrame = 0
      wheelZoomFrameTime = 0
      wheelZoomAnchor = undefined
      options.emitZoom(target)
      return
    }

    wheelZoomFrame = requestAnimationFrame(animateWheelZoom)
  }

  function startWheelZoomAnimation() {
    if (wheelZoomFrame) return
    wheelZoomFrame = requestAnimationFrame(animateWheelZoom)
  }

  function requestZoom(value: number, clientX?: number, clientY?: number) {
    const nextZoom = clampZoom(value)
    stopWheelZoomAnimation()
    zoomTarget.value = nextZoom
    stageZoom(nextZoom, clientX, clientY)
    options.emitZoom(nextZoom)
  }

  function zoomByStep(direction: 1 | -1, clientX?: number, clientY?: number) {
    requestZoom(nextZoomLevel(zoomTarget.value, direction), clientX, clientY)
  }

  function zoomIn() {
    zoomByStep(1)
  }

  function zoomOut() {
    zoomByStep(-1)
  }

  function fitDocument() {
    const scroll = options.scrollArea.value
    if (!scroll) return

    const document = options.document()
    const availableWidth = Math.max(1, scroll.clientWidth - 96)
    const availableHeight = Math.max(1, scroll.clientHeight - 96)
    const fittedZoom = clampZoom(
      Math.min(MAX_ZOOM / 100, availableWidth / document.width, availableHeight / document.height) * 100
    )
    stopWheelZoomAnimation()
    pendingNavigation = { type: 'center' }
    visualZoom.value = fittedZoom
    zoomTarget.value = fittedZoom
    options.emitZoom(fittedZoom)
    schedulePendingNavigation()
  }

  function syncViewportSize(preserveCenter = false) {
    const scroll = options.scrollArea.value
    if (!scroll) return

    const width = scroll.clientWidth
    const height = scroll.clientHeight
    if (viewportSize.value.width === width && viewportSize.value.height === height) return

    const previousSize = viewportSize.value
    const centerNavigation = preserveCenter && isViewportReady.value && !pendingNavigation
      ? preserveViewportCenter(scroll.scrollLeft, scroll.scrollTop, previousSize, { width, height }, scale.value)
      : undefined
    viewportSize.value = { width, height }
    if (centerNavigation) {
      pendingNavigation = centerNavigation
      schedulePendingNavigation()
    }
  }

  async function initializeViewport() {
    const initialization = ++viewportInitialization
    isViewportReady.value = false

    syncViewportSize()
    await nextTick()
    syncViewportSize()
    await nextTick()
    fitDocument()
    await nextTick()

    if (initialization !== viewportInitialization) return
    applyPendingNavigation()
    isViewportReady.value = true
  }

  function handleWheel(event: WheelEvent) {
    const scroll = options.scrollArea.value
    scroll?.focus()

    if (event.ctrlKey || event.metaKey || event.altKey) {
      event.preventDefault()
      zoomTarget.value = wheelZoomLevel(zoomTarget.value, event.deltaY)
      wheelZoomAnchor = { clientX: event.clientX, clientY: event.clientY }
      startWheelZoomAnimation()
      return
    }

    if (event.shiftKey && scroll) {
      event.preventDefault()
      const scrollLeft = scroll.scrollLeft + (event.deltaY || event.deltaX)
      options.scheduleInteractionFrame(() => {
        if (options.scrollArea.value) options.scrollArea.value.scrollLeft = scrollLeft
      })
    }
  }

  watch(options.zoom, (value) => {
    zoomTarget.value = value
    if (Math.abs(value - visualZoom.value) < 0.005) {
      schedulePendingNavigation()
      return
    }

    stopWheelZoomAnimation()
    stageZoom(value)
  })

  watch(
    () => {
      const document = options.document()
      return [document.id, document.width, document.height]
    },
    () => void initializeViewport()
  )

  onMounted(() => {
    const scroll = options.scrollArea.value
    if (!scroll) return
    syncViewportSize()
    syncViewportScroll()
    resizeObserver = new ResizeObserver(() => syncViewportSize(true))
    resizeObserver.observe(scroll)
    void initializeViewport()
  })

  onBeforeUnmount(() => {
    stopWheelZoomAnimation()
    resizeObserver?.disconnect()
    if (nativeScrollTimeout) clearTimeout(nativeScrollTimeout)
  })

  return {
    documentViewportOffset,
    fitDocument,
    frameStyle,
    handleNativeScroll,
    handleWheel,
    isNativeScrolling,
    isViewportReady,
    pasteboardStyle,
    requestZoom,
    scale,
    scaledDocumentSize,
    surfaceStyle,
    syncViewportScroll,
    viewportSize,
    visualZoom,
    zoomByStep,
    zoomIn,
    zoomOut
  }
}

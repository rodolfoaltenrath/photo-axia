import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import {
  canvasArrowNudgeDelta,
  canvasPageScrollDelta,
  canvasZoomShortcut
} from '../../../editor/canvasShortcuts'

interface CanvasShortcutOptions {
  scrollArea: Ref<HTMLDivElement | null>
  handleArrowNudge: (event: KeyboardEvent, delta: { x: number; y: number }) => boolean
  commitKeyboardNudge: () => void
  cancelGuideInteraction: () => boolean
  deleteSelectedGuide: () => boolean
  deleteSelection: () => boolean
  isTransforming: () => boolean
  cancelTransform: () => void
  commitTransform: () => void
  cancelBrush: () => boolean
  cancelSelectionMove: () => boolean
  cancelSelection: () => boolean
  clearSelection: () => void
  selectAll: () => void
  startTransform: () => void
  fitDocument: () => void
  requestZoom: (zoom: number) => void
  zoomByStep: (direction: 1 | -1) => void
  resetTransientInteractions: () => void
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, select, textarea, [contenteditable="true"]'))
}

export function useCanvasShortcuts(options: CanvasShortcutOptions) {
  const isSpacePressed = ref(false)
  const modifierKeys = ref({ alt: false, command: false, shift: false })

  function updateModifierKeys(event: KeyboardEvent) {
    modifierKeys.value = {
      alt: event.altKey,
      command: event.ctrlKey || event.metaKey,
      shift: event.shiftKey
    }
  }

  function handleCanvasKeydown(event: KeyboardEvent) {
    const scroll = options.scrollArea.value
    if (!scroll) return

    const arrowDelta = canvasArrowNudgeDelta(event.key, event.shiftKey)
    if (arrowDelta) {
      event.preventDefault()
      options.handleArrowNudge(event, arrowDelta)
      return
    }

    const pageDelta = canvasPageScrollDelta(
      event.key,
      event.ctrlKey || event.metaKey,
      { width: scroll.clientWidth, height: scroll.clientHeight }
    )
    if (!pageDelta) return
    event.preventDefault()
    scroll.scrollBy({ ...pageDelta, behavior: 'auto' })
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    updateModifierKeys(event)
    if (event.defaultPrevented || isEditableShortcutTarget(event.target)) return
    const arrowDelta = canvasArrowNudgeDelta(event.key, event.shiftKey)
    if (arrowDelta && options.handleArrowNudge(event, arrowDelta)) return

    if (event.key === 'Escape' && options.cancelGuideInteraction()) {
      event.preventDefault()
      return
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && options.deleteSelectedGuide()) {
      event.preventDefault()
      return
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && options.deleteSelection()) {
      event.preventDefault()
      return
    }

    if (options.isTransforming() && event.key === 'Escape') {
      event.preventDefault()
      options.cancelTransform()
      return
    }

    if (options.isTransforming() && event.key === 'Enter') {
      event.preventDefault()
      options.commitTransform()
      return
    }

    if (event.code === 'Space') {
      event.preventDefault()
      isSpacePressed.value = true
    }

    if (event.key === 'Escape' && options.cancelBrush()) {
      event.preventDefault()
      return
    }

    if (event.key === 'Escape' && options.cancelSelectionMove()) {
      event.preventDefault()
      return
    }

    if (event.key === 'Escape' && options.cancelSelection()) {
      event.preventDefault()
      return
    }

    if (!event.ctrlKey && !event.metaKey) return

    if (event.code === 'KeyD') {
      event.preventDefault()
      options.clearSelection()
      return
    }

    if (event.code === 'KeyA') {
      event.preventDefault()
      options.selectAll()
      return
    }

    if (event.code === 'KeyT') {
      event.preventDefault()
      options.startTransform()
      return
    }

    const shortcut = canvasZoomShortcut(event.code)
    if (!shortcut) return
    event.preventDefault()
    if (shortcut.type === 'fit') options.fitDocument()
    else if (shortcut.type === 'zoom') options.requestZoom(shortcut.value)
    else options.zoomByStep(shortcut.direction)
  }

  function handleWindowKeyup(event: KeyboardEvent) {
    updateModifierKeys(event)
    if (event.code === 'Space') isSpacePressed.value = false
    if (canvasArrowNudgeDelta(event.key, false)) options.commitKeyboardNudge()
  }

  function resetInteractionKeys() {
    options.commitKeyboardNudge()
    isSpacePressed.value = false
    modifierKeys.value = { alt: false, command: false, shift: false }
    options.resetTransientInteractions()
  }

  onMounted(() => {
    window.addEventListener('keydown', handleWindowKeydown)
    window.addEventListener('keyup', handleWindowKeyup)
    window.addEventListener('blur', resetInteractionKeys)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleWindowKeydown)
    window.removeEventListener('keyup', handleWindowKeyup)
    window.removeEventListener('blur', resetInteractionKeys)
  })

  return {
    handleCanvasKeydown,
    isSpacePressed,
    modifierKeys
  }
}

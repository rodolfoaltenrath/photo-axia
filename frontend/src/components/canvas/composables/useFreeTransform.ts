import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  layerTransformStyle,
  layerTransformsMatch,
  moveLayerTransform,
  normalizeRotation,
  resizeLayerTransform,
  rotateLayerTransform,
  rotateVector,
  transformCenter,
  type DocumentPoint,
  type TransformHandle
} from '../../../editor/freeTransform'
import { transformedLayerBounds } from '../../../editor/guides'
import type { LayerItem, LayerTransform } from '../../../types/editor'
import type {
  KeyboardLayerMoveSession,
  LayerDragSession,
  TransformInteraction,
  TransformSession,
  TransformSessionMember
} from '../canvas.types'

interface FreeTransformOptions {
  activeLayer: () => LayerItem | undefined
  activeLayerId: () => string
  selectedLayerIds: () => string[]
  layers: () => LayerItem[]
  activeTool: () => string
  autoSelectLayer: () => boolean
  isBusy: () => boolean
  modifierKeys: () => { alt: boolean; shift: boolean }
  scale: () => number
  scrollArea: Ref<HTMLDivElement | null>
  surface: Ref<HTMLDivElement | null>
  documentPointFromClient: (clientX: number, clientY: number) => DocumentPoint | undefined
  snapPoint: (point: DocumentPoint, event: PointerEvent) => DocumentPoint
  snapTransform: (transform: LayerTransform, event: PointerEvent) => LayerTransform
  scheduleInteractionFrame: (callback: () => void) => void
  flushInteractionFrame: () => void
  discardInteractionFrame: () => void
  selectLayer: (layerId: string) => void
  updateTransform: (layerId: string, transform: LayerTransform) => void
}

function groupBoundsFromMembers(members: TransformSessionMember[]): LayerTransform {
  if (members.length === 1) return { ...members[0]!.original }
  const boxes = members.map((member) => transformedLayerBounds(member.original))
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 }
}

function applyGroupMove(members: TransformSessionMember[], groupOriginal: LayerTransform, groupDraft: LayerTransform) {
  const dx = groupDraft.x - groupOriginal.x
  const dy = groupDraft.y - groupOriginal.y
  const drafts: Record<string, LayerTransform> = {}
  for (const member of members) {
    drafts[member.layerId] = {
      ...member.original,
      x: Math.round((member.original.x + dx) * 100) / 100,
      y: Math.round((member.original.y + dy) * 100) / 100
    }
  }
  return drafts
}

function applyGroupResize(members: TransformSessionMember[], groupOriginal: LayerTransform, groupDraft: LayerTransform) {
  if (members.length === 1) return { [members[0]!.layerId]: groupDraft }
  const scaleX = groupOriginal.width === 0 ? 1 : groupDraft.width / groupOriginal.width
  const scaleY = groupOriginal.height === 0 ? 1 : groupDraft.height / groupOriginal.height
  const drafts: Record<string, LayerTransform> = {}
  for (const member of members) {
    const relX = (member.original.x - groupOriginal.x) / groupOriginal.width
    const relY = (member.original.y - groupOriginal.y) / groupOriginal.height
    drafts[member.layerId] = {
      x: Math.round((groupDraft.x + relX * groupDraft.width) * 100) / 100,
      y: Math.round((groupDraft.y + relY * groupDraft.height) * 100) / 100,
      width: Math.round(member.original.width * scaleX * 100) / 100,
      height: Math.round(member.original.height * scaleY * 100) / 100,
      rotation: member.original.rotation ?? 0
    }
  }
  return drafts
}

function applyGroupRotate(
  members: TransformSessionMember[],
  groupOriginal: LayerTransform,
  groupDraft: LayerTransform
) {
  if (members.length === 1) return { [members[0]!.layerId]: groupDraft }
  const center = transformCenter(groupOriginal)
  const deltaDeg = (groupDraft.rotation ?? 0) - (groupOriginal.rotation ?? 0)
  const deltaRad = (deltaDeg * Math.PI) / 180
  const drafts: Record<string, LayerTransform> = {}
  for (const member of members) {
    const memberCenter = transformCenter(member.original)
    const relative = { x: memberCenter.x - center.x, y: memberCenter.y - center.y }
    const rotated = rotateVector(relative, deltaRad)
    const nextCenter = { x: center.x + rotated.x, y: center.y + rotated.y }
    drafts[member.layerId] = {
      x: Math.round((nextCenter.x - member.original.width / 2) * 100) / 100,
      y: Math.round((nextCenter.y - member.original.height / 2) * 100) / 100,
      width: member.original.width,
      height: member.original.height,
      rotation: normalizeRotation((member.original.rotation ?? 0) + deltaDeg)
    }
  }
  return drafts
}

export function applyElementTransform(target: HTMLElement, transform: LayerTransform) {
  target.style.width = `${transform.width}px`
  target.style.height = `${transform.height}px`
  target.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(${transform.rotation ?? 0}deg)`
}

export function useFreeTransform(options: FreeTransformOptions) {
  const freeTransformBox = ref<HTMLElement | null>(null)
  const transformRotationOutput = ref<HTMLElement | null>(null)
  const dragState = shallowRef<LayerDragSession | null>(null)
  const keyboardLayerMove = shallowRef<KeyboardLayerMoveSession | null>(null)
  const transformSession = shallowRef<TransformSession | null>(null)
  const transformInteraction = ref<TransformInteraction | null>(null)
  let keyboardLayerCommitTimeout: ReturnType<typeof setTimeout> | undefined

  const isTransforming = computed(() => Boolean(transformSession.value))

  function displayTransform(layer: Pick<LayerItem, 'id' | 'transform'>) {
    const session = transformSession.value
    if (session && layer.id in session.drafts) return session.drafts[layer.id]
    if (keyboardLayerMove.value?.layerId === layer.id) return keyboardLayerMove.value.draft
    return layer.transform
  }

  const activeDisplayTransform = computed(() => {
    const layer = options.activeLayer()
    return layer ? displayTransform(layer) : undefined
  })

  const freeTransformStyle = computed(() => {
    const session = transformSession.value
    if (!session) return undefined
    return layerTransformStyle(session.groupDraft)
  })

  function findLayerElement(layerId: string) {
    return Array.from(options.surface.value?.querySelectorAll<HTMLElement>('.document-layer') ?? [])
      .find((element) => element.dataset.layerId === layerId)
  }

  function commitKeyboardLayerMove() {
    if (keyboardLayerCommitTimeout) clearTimeout(keyboardLayerCommitTimeout)
    keyboardLayerCommitTimeout = undefined
    const session = keyboardLayerMove.value
    if (!session) return
    session.target.classList.remove('document-layer--dragging')
    session.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: session.draft }))
    keyboardLayerMove.value = null
    if (!layerTransformsMatch(session.original, session.draft)) {
      options.updateTransform(session.layerId, { ...session.draft })
    }
  }

  function nudgeActiveLayer(nudge: { x: number; y: number }) {
    const layer = options.activeLayer()
    if (!layer?.visible || !layer.transform) return true

    const freeTransform = transformSession.value
    const member = freeTransform?.members.find((item) => item.layerId === layer.id)
    if (freeTransform && member) {
      const draft = {
        ...freeTransform.drafts[layer.id]!,
        x: freeTransform.drafts[layer.id]!.x + nudge.x,
        y: freeTransform.drafts[layer.id]!.y + nudge.y
      }
      freeTransform.drafts = { ...freeTransform.drafts, [layer.id]: draft }
      applyElementTransform(member.target, draft)
      if (freeTransform.members.length === 1 && freeTransformBox.value) {
        applyElementTransform(freeTransformBox.value, draft)
      }
      return true
    }

    let session = keyboardLayerMove.value
    if (session?.layerId !== layer.id) {
      if (session) commitKeyboardLayerMove()
      const target = findLayerElement(layer.id)
      if (!target) return true
      const original = { ...layer.transform, rotation: layer.transform.rotation ?? 0 }
      target.classList.add('document-layer--dragging')
      session = { layerId: layer.id, original, draft: { ...original }, target }
    }

    const draft = {
      ...session.draft,
      x: session.draft.x + nudge.x,
      y: session.draft.y + nudge.y
    }
    keyboardLayerMove.value = { ...session, draft }
    applyElementTransform(session.target, draft)
    if (keyboardLayerCommitTimeout) clearTimeout(keyboardLayerCommitTimeout)
    keyboardLayerCommitTimeout = setTimeout(commitKeyboardLayerMove, 2000)
    return true
  }

  function startFreeTransform() {
    if (transformSession.value || options.isBusy()) return
    commitKeyboardLayerMove()
    const activeId = options.activeLayerId()
    const requested = options.selectedLayerIds()
    const layerIds = requested.includes(activeId) || requested.length === 0 ? requested : [activeId, ...requested]
    const candidateIds = layerIds.length ? layerIds : [activeId]

    const allLayers = options.layers()
    const members: TransformSessionMember[] = []
    for (const layerId of candidateIds) {
      const layer = allLayers.find((item) => item.id === layerId)
      const target = findLayerElement(layerId)
      const transform = layer?.transform
      if (!layer || !target || !transform || !layer.visible) continue
      members.push({ layerId, original: { ...transform, rotation: transform.rotation ?? 0 }, target })
    }
    if (!members.length) return

    cancelPointerInteractions()
    const groupOriginal = groupBoundsFromMembers(members)
    const drafts: Record<string, LayerTransform> = {}
    for (const member of members) drafts[member.layerId] = { ...member.original }

    transformSession.value = {
      members,
      groupOriginal,
      groupDraft: { ...groupOriginal },
      drafts
    }
    for (const member of members) member.target.classList.add('document-layer--transforming')
    options.scrollArea.value?.focus()
  }

  function commitFreeTransform() {
    options.flushInteractionFrame()
    const session = transformSession.value
    if (session) {
      for (const member of session.members) {
        const draft = session.drafts[member.layerId]
        if (draft && !layerTransformsMatch(member.original, draft)) {
          options.updateTransform(member.layerId, { ...draft })
        }
        member.target.classList.remove('document-layer--transforming')
        member.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: draft ?? member.original }))
      }
    }
    transformInteraction.value = null
    transformSession.value = null
  }

  function cancelFreeTransform() {
    options.discardInteractionFrame()
    const session = transformSession.value
    if (session) {
      for (const member of session.members) {
        applyElementTransform(member.target, member.original)
        member.target.classList.remove('document-layer--transforming')
        member.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: member.original }))
      }
    }
    transformInteraction.value = null
    transformSession.value = null
  }

  function currentTransformDraft() {
    return transformSession.value?.groupDraft ?? activeDisplayTransform.value
  }

  function captureTransformPointer(event: PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
  }

  function startTransformMove(event: PointerEvent) {
    const transform = currentTransformDraft()
    const pointer = options.documentPointFromClient(event.clientX, event.clientY)
    if (event.button !== 0 || !transform || !pointer) return
    captureTransformPointer(event)
    transformInteraction.value = {
      type: 'move',
      pointerId: event.pointerId,
      start: pointer,
      initial: { ...transform }
    }
  }

  function startTransformResize(event: PointerEvent, handle: TransformHandle) {
    const transform = currentTransformDraft()
    if (event.button !== 0 || !transform) return
    captureTransformPointer(event)
    transformInteraction.value = {
      type: 'resize',
      pointerId: event.pointerId,
      handle,
      initial: { ...transform }
    }
  }

  function startTransformRotate(event: PointerEvent) {
    const transform = currentTransformDraft()
    const pointer = options.documentPointFromClient(event.clientX, event.clientY)
    if (event.button !== 0 || !transform || !pointer) return
    const center = transformCenter(transform)
    captureTransformPointer(event)
    transformInteraction.value = {
      type: 'rotate',
      pointerId: event.pointerId,
      startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
      initial: { ...transform }
    }
  }

  function updateTransformPointer(event: PointerEvent) {
    const interaction = transformInteraction.value
    const session = transformSession.value
    if (interaction?.pointerId === event.pointerId && session) {
      const pointer = options.documentPointFromClient(event.clientX, event.clientY)
      if (!pointer) return true

      event.preventDefault()
      let transform: LayerTransform
      if (interaction.type === 'move') {
        transform = options.snapTransform(
          moveLayerTransform(interaction.initial, interaction.start, pointer),
          event
        )
      } else if (interaction.type === 'resize') {
        const modifiers = options.modifierKeys()
        const isCorner = interaction.handle.x !== 0 && interaction.handle.y !== 0
        const fromCenter = event.altKey || modifiers.alt
        const freeProportions = event.shiftKey || modifiers.shift
        transform = resizeLayerTransform(
          interaction.initial,
          interaction.handle,
          options.snapPoint(pointer, event),
          fromCenter,
          isCorner && !freeProportions
        )
      } else {
        const snapRotation = event.shiftKey || options.modifierKeys().shift
        transform = rotateLayerTransform(interaction.initial, interaction.startAngle, pointer, snapRotation)
      }

      const interactionType = interaction.type
      options.scheduleInteractionFrame(() => {
        const current = transformSession.value
        if (current !== session) return
        current.groupDraft = transform
        const drafts = interactionType === 'move'
          ? applyGroupMove(current.members, current.groupOriginal, transform)
          : interactionType === 'resize'
            ? applyGroupResize(current.members, current.groupOriginal, transform)
            : applyGroupRotate(current.members, current.groupOriginal, transform)
        current.drafts = drafts
        for (const member of current.members) {
          const draft = drafts[member.layerId]
          if (draft) applyElementTransform(member.target, draft)
        }
        if (freeTransformBox.value) applyElementTransform(freeTransformBox.value, transform)
        if (transformRotationOutput.value) {
          transformRotationOutput.value.textContent = `${transform.rotation ?? 0}°`
        }
      })
      return true
    }

    const drag = dragState.value
    if (drag?.pointerId !== event.pointerId) return false
    const transform = options.snapTransform({
      ...drag.transform,
      x: Math.round(drag.transform.x + (event.clientX - drag.startX) / options.scale()),
      y: Math.round(drag.transform.y + (event.clientY - drag.startY) / options.scale())
    }, event)
    options.scheduleInteractionFrame(() => {
      if (dragState.value?.layerId !== drag.layerId) return
      drag.preview = transform
      applyElementTransform(drag.target, transform)
    })
    return true
  }

  function stopTransformPointer(pointerId: number) {
    let stopped = false
    if (transformInteraction.value?.pointerId === pointerId) {
      transformInteraction.value = null
      stopped = true
    }
    if (dragState.value?.pointerId === pointerId) {
      const drag = dragState.value
      drag.target.classList.remove('document-layer--dragging')
      drag.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: drag.preview }))
      if (!layerTransformsMatch(drag.transform, drag.preview)) {
        options.updateTransform(drag.layerId, { ...drag.preview })
      } else {
        applyElementTransform(drag.target, drag.transform)
      }
      dragState.value = null
      stopped = true
    }
    return stopped
  }

  function cancelPointerInteractions() {
    transformInteraction.value = null
    const drag = dragState.value
    if (!drag) return
    applyElementTransform(drag.target, drag.transform)
    drag.target.classList.remove('document-layer--dragging')
    drag.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: drag.transform }))
    dragState.value = null
  }

  function startLayerDrag(event: PointerEvent, clickedLayer: LayerItem) {
    event.stopPropagation()
    event.preventDefault()
    const targetLayer = options.autoSelectLayer() ? clickedLayer : options.activeLayer()
    if (!targetLayer?.visible) return true
    if (targetLayer.id !== options.activeLayerId()) options.selectLayer(targetLayer.id)
    if (!targetLayer.transform) return true

    const pointerTarget = event.currentTarget as HTMLElement
    const target = targetLayer.id === clickedLayer.id
      ? pointerTarget
      : findLayerElement(targetLayer.id)
    if (!target) return true
    pointerTarget.setPointerCapture(event.pointerId)
    target.classList.add('document-layer--dragging')
    dragState.value = {
      layerId: targetLayer.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      transform: { ...targetLayer.transform },
      preview: { ...targetLayer.transform },
      target
    }
    return true
  }

  watch(options.activeLayerId, (layerId) => {
    if (keyboardLayerMove.value && keyboardLayerMove.value.layerId !== layerId) commitKeyboardLayerMove()
    if (transformSession.value && !transformSession.value.members.some((member) => member.layerId === layerId)) {
      commitFreeTransform()
    }
  })

  watch(options.activeTool, (tool) => {
    if (tool !== 'move') commitKeyboardLayerMove()
  })

  onBeforeUnmount(() => {
    if (keyboardLayerCommitTimeout) clearTimeout(keyboardLayerCommitTimeout)
    keyboardLayerMove.value?.target.classList.remove('document-layer--dragging')
    dragState.value?.target.classList.remove('document-layer--dragging')
    for (const member of transformSession.value?.members ?? []) {
      member.target.classList.remove('document-layer--transforming')
    }
  })

  return {
    activeDisplayTransform,
    cancelFreeTransform,
    cancelPointerInteractions,
    commitFreeTransform,
    commitKeyboardLayerMove,
    displayTransform,
    freeTransformBox,
    freeTransformStyle,
    isTransforming,
    nudgeActiveLayer,
    startFreeTransform,
    startLayerDrag,
    startTransformMove,
    startTransformResize,
    startTransformRotate,
    stopTransformPointer,
    transformRotationOutput,
    updateTransformPointer
  }
}

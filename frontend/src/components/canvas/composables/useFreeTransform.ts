import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  constrainedTranslationDelta,
  layerTransformOnlyMoved,
  layerTransformStyle,
  layerTransformsMatch,
  moveLayerTransform,
  resizeLayerTransform,
  rotateLayerTransform,
  transformCenter,
  type DocumentPoint,
  type TransformHandle
} from '../../../editor/freeTransform.ts'
import { applyGroupMove, applyGroupResize, applyGroupRotate, groupBoundsFromRects } from '../../../editor/groupTransform.ts'
import type { LayerItem, LayerTransform } from '../../../types/editor.ts'
import type {
  KeyboardLayerMoveSession,
  LayerDragSession,
  TransformInteraction,
  TransformSession,
  TransformSessionMember
} from '../canvas.types.ts'

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
  snapTransform: (
    transform: LayerTransform,
    event: PointerEvent,
    movingLayerIds?: readonly string[]
  ) => LayerTransform
  scheduleInteractionFrame: (callback: () => void) => void
  flushInteractionFrame: () => void
  discardInteractionFrame: () => void
  selectLayer: (layerId: string) => void
  moveLayers: (updates: Array<{ layerId: string; transform: LayerTransform }>) => void
  updateTransform: (layerId: string, transform: LayerTransform) => void
}

export function applyElementTransform(target: HTMLElement, transform: LayerTransform) {
  target.style.width = `${transform.width}px`
  target.style.height = `${transform.height}px`
  target.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(${transform.rotation ?? 0}deg)`
}

export function createTransformSessionRef() {
  return ref<TransformSession | null>(null)
}

export function layerDragIds(selectedLayerIds: readonly string[], targetLayerId: string) {
  const uniqueSelection = [...new Set(selectedLayerIds)]
  return uniqueSelection.includes(targetLayerId) ? uniqueSelection : [targetLayerId]
}

export function useFreeTransform(options: FreeTransformOptions) {
  const freeTransformBox = ref<HTMLElement | null>(null)
  const transformRotationOutput = ref<HTMLElement | null>(null)
  const dragState = shallowRef<LayerDragSession | null>(null)
  const keyboardLayerMove = shallowRef<KeyboardLayerMoveSession | null>(null)
  // A sessão precisa ser profundamente reativa: cada gesto substitui
  // groupDraft/drafts sem encerrar o Ctrl+T. Com shallowRef, o DOM recebia o
  // draft novo diretamente, mas os computed do Vue continuavam em cache com
  // a caixa anterior e podiam reaplicá-la ao iniciar o gesto seguinte.
  const transformSession = createTransformSessionRef()
  const transformInteraction = ref<TransformInteraction | null>(null)
  let keyboardLayerCommitTimeout: ReturnType<typeof setTimeout> | undefined

  const isTransforming = computed(() => Boolean(transformSession.value))

  function displayTransform(layer: Pick<LayerItem, 'id' | 'transform'>) {
    const session = transformSession.value
    if (session && layer.id in session.drafts) return session.drafts[layer.id]
    const keyboardDraft = keyboardLayerMove.value?.drafts[layer.id]
    if (keyboardDraft) return keyboardDraft
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
    const updates: Array<{ layerId: string; transform: LayerTransform }> = []
    for (const member of session.members) {
      const draft = session.drafts[member.layerId] ?? member.original
      member.target.classList.remove('document-layer--dragging')
      member.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: draft }))
      if (!layerTransformsMatch(member.original, draft)) {
        updates.push({ layerId: member.layerId, transform: { ...draft } })
      }
    }
    keyboardLayerMove.value = null
    if (updates.length) options.moveLayers(updates)
  }

  function nudgeActiveLayer(nudge: { x: number; y: number }) {
    const layer = options.activeLayer()
    if (!layer?.visible || !layer.transform) return true

    const freeTransform = transformSession.value
    const member = freeTransform?.members.find((item) => item.layerId === layer.id)
    if (freeTransform && member) {
      const drafts: Record<string, LayerTransform> = {}
      for (const candidate of freeTransform.members) {
        const current = freeTransform.drafts[candidate.layerId]!
        drafts[candidate.layerId] = {
          ...current,
          x: current.x + nudge.x,
          y: current.y + nudge.y
        }
        applyElementTransform(candidate.target, drafts[candidate.layerId]!)
      }
      freeTransform.drafts = drafts
      freeTransform.groupDraft = {
        ...freeTransform.groupDraft,
        x: freeTransform.groupDraft.x + nudge.x,
        y: freeTransform.groupDraft.y + nudge.y
      }
      if (freeTransformBox.value) applyElementTransform(freeTransformBox.value, freeTransform.groupDraft)
      return true
    }

    let session = keyboardLayerMove.value
    if (!session?.members.some((item) => item.layerId === layer.id)) {
      if (session) commitKeyboardLayerMove()
      const ids = layerDragIds(options.selectedLayerIds(), layer.id)
      const members: TransformSessionMember[] = []
      for (const layerId of ids) {
        const candidate = options.layers().find((item) => item.id === layerId)
        const target = findLayerElement(layerId)
        if (!candidate?.visible || !candidate.transform || !target) continue
        members.push({
          layerId,
          original: { ...candidate.transform, rotation: candidate.transform.rotation ?? 0 },
          target
        })
      }
      if (!members.length) return true
      for (const item of members) item.target.classList.add('document-layer--dragging')
      session = {
        members,
        drafts: Object.fromEntries(members.map((item) => [item.layerId, { ...item.original }]))
      }
    }

    const drafts: Record<string, LayerTransform> = {}
    for (const item of session.members) {
      const current = session.drafts[item.layerId]!
      drafts[item.layerId] = {
        ...current,
        x: current.x + nudge.x,
        y: current.y + nudge.y
      }
      applyElementTransform(item.target, drafts[item.layerId]!)
    }
    keyboardLayerMove.value = { ...session, drafts }
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
    const groupDraft = groupBoundsFromRects(members.map((member) => member.original))
    const drafts: Record<string, LayerTransform> = {}
    for (const member of members) drafts[member.layerId] = { ...member.original }

    transformSession.value = {
      members,
      groupDraft,
      drafts
    }
    for (const member of members) member.target.classList.add('document-layer--transforming')
    options.scrollArea.value?.focus()
  }

  function commitFreeTransform() {
    options.flushInteractionFrame()
    const session = transformSession.value
    if (session) {
      const changed = session.members.flatMap((member) => {
        const draft = session.drafts[member.layerId]
        return draft && !layerTransformsMatch(member.original, draft)
          ? [{ member, draft }]
          : []
      })
      const movementOnly = changed.length > 0 && changed.every(({ member, draft }) =>
        layerTransformOnlyMoved(member.original, draft)
      )
      for (const member of session.members) {
        const draft = session.drafts[member.layerId]
        if (!movementOnly && draft && !layerTransformsMatch(member.original, draft)) {
          options.updateTransform(member.layerId, { ...draft })
        }
        member.target.classList.remove('document-layer--transforming')
        member.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: draft ?? member.original }))
      }
      if (movementOnly) {
        options.moveLayers(changed.map(({ member, draft }) => ({
          layerId: member.layerId,
          transform: { ...draft }
        })))
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

  function transformInteractionStart() {
    const session = transformSession.value
    return {
      groupStart: session ? session.groupDraft : undefined,
      memberStarts: session ? { ...session.drafts } : {}
    }
  }

  function startTransformMove(event: PointerEvent) {
    const transform = currentTransformDraft()
    const pointer = options.documentPointFromClient(event.clientX, event.clientY)
    if (event.button !== 0 || !transform || !pointer) return
    const { groupStart, memberStarts } = transformInteractionStart()
    if (!groupStart) return
    captureTransformPointer(event)
    transformInteraction.value = {
      type: 'move',
      pointerId: event.pointerId,
      start: pointer,
      initial: { ...transform },
      groupStart,
      memberStarts
    }
  }

  function startTransformResize(event: PointerEvent, handle: TransformHandle) {
    const transform = currentTransformDraft()
    if (event.button !== 0 || !transform) return
    const { groupStart, memberStarts } = transformInteractionStart()
    if (!groupStart) return
    captureTransformPointer(event)
    transformInteraction.value = {
      type: 'resize',
      pointerId: event.pointerId,
      handle,
      initial: { ...transform },
      groupStart,
      memberStarts
    }
  }

  function startTransformRotate(event: PointerEvent) {
    const transform = currentTransformDraft()
    const pointer = options.documentPointFromClient(event.clientX, event.clientY)
    if (event.button !== 0 || !transform || !pointer) return
    const { groupStart, memberStarts } = transformInteractionStart()
    if (!groupStart) return
    const center = transformCenter(transform)
    captureTransformPointer(event)
    transformInteraction.value = {
      type: 'rotate',
      pointerId: event.pointerId,
      startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
      initial: { ...transform },
      groupStart,
      memberStarts
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
        const moved = moveLayerTransform(interaction.initial, interaction.start, pointer)
        const delta = constrainedTranslationDelta(
          moved.x - interaction.initial.x,
          moved.y - interaction.initial.y,
          event.shiftKey || options.modifierKeys().shift
        )
        transform = options.snapTransform(
          {
            ...moved,
            x: interaction.initial.x + delta.x,
            y: interaction.initial.y + delta.y
          },
          event,
          session.members.map((member) => member.layerId)
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
      const ids = session.members.map((member) => member.layerId)
      options.scheduleInteractionFrame(() => {
        const current = transformSession.value
        if (current !== session) return
        current.groupDraft = transform
        const drafts = interactionType === 'move'
          ? applyGroupMove(ids, interaction.memberStarts, interaction.groupStart, transform)
          : interactionType === 'resize'
            ? applyGroupResize(ids, interaction.memberStarts, interaction.groupStart, transform)
            : applyGroupRotate(ids, interaction.memberStarts, interaction.groupStart, transform)
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
    const pointerDelta = constrainedTranslationDelta(
      (event.clientX - drag.startX) / options.scale(),
      (event.clientY - drag.startY) / options.scale(),
      event.shiftKey || options.modifierKeys().shift
    )
    const groupPreview = options.snapTransform({
      ...drag.groupTransform,
      x: drag.groupTransform.x + pointerDelta.x,
      y: drag.groupTransform.y + pointerDelta.y
    }, event, drag.members.map((member) => member.layerId))
    const memberStarts = Object.fromEntries(
      drag.members.map((member) => [member.layerId, member.original])
    )
    const previews = applyGroupMove(
      drag.members.map((member) => member.layerId),
      memberStarts,
      drag.groupTransform,
      groupPreview
    )
    options.scheduleInteractionFrame(() => {
      if (dragState.value !== drag) return
      drag.previews = previews
      for (const member of drag.members) {
        const preview = previews[member.layerId]
        if (preview) applyElementTransform(member.target, preview)
      }
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
      const updates: Array<{ layerId: string; transform: LayerTransform }> = []
      for (const member of drag.members) {
        const preview = drag.previews[member.layerId] ?? member.original
        member.target.classList.remove('document-layer--dragging')
        member.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: preview }))
        if (layerTransformsMatch(member.original, preview)) {
          applyElementTransform(member.target, member.original)
        } else {
          updates.push({ layerId: member.layerId, transform: { ...preview } })
        }
      }
      dragState.value = null
      if (updates.length) options.moveLayers(updates)
      stopped = true
    }
    return stopped
  }

  function cancelPointerInteractions() {
    transformInteraction.value = null
    const drag = dragState.value
    if (!drag) return
    for (const member of drag.members) {
      applyElementTransform(member.target, member.original)
      member.target.classList.remove('document-layer--dragging')
      member.target.dispatchEvent(new CustomEvent('axia-interaction-end', { detail: member.original }))
    }
    dragState.value = null
  }

  function startLayerDrag(event: PointerEvent, clickedLayer: LayerItem) {
    event.stopPropagation()
    event.preventDefault()
    const targetLayer = options.autoSelectLayer() ? clickedLayer : options.activeLayer()
    if (!targetLayer?.visible) return true
    const selectedLayerIds = options.selectedLayerIds()
    if (!selectedLayerIds.includes(targetLayer.id)) options.selectLayer(targetLayer.id)
    if (!targetLayer.transform) return true

    const pointerTarget = event.currentTarget as HTMLElement
    const ids = layerDragIds(selectedLayerIds, targetLayer.id)
    const members: TransformSessionMember[] = []
    for (const layerId of ids) {
      const layer = options.layers().find((item) => item.id === layerId)
      if (!layer?.visible || !layer.transform) continue
      const target = layerId === clickedLayer.id ? pointerTarget : findLayerElement(layerId)
      if (!target) continue
      members.push({
        layerId,
        original: { ...layer.transform, rotation: layer.transform.rotation ?? 0 },
        target
      })
    }
    if (!members.some((member) => member.layerId === targetLayer.id)) return true

    pointerTarget.setPointerCapture(event.pointerId)
    for (const member of members) member.target.classList.add('document-layer--dragging')
    dragState.value = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      groupTransform: groupBoundsFromRects(members.map((member) => member.original)),
      members,
      previews: Object.fromEntries(members.map((member) => [member.layerId, { ...member.original }]))
    }
    return true
  }

  watch(options.activeLayerId, (layerId) => {
    if (keyboardLayerMove.value && !keyboardLayerMove.value.members.some((member) => member.layerId === layerId)) {
      commitKeyboardLayerMove()
    }
    if (transformSession.value && !transformSession.value.members.some((member) => member.layerId === layerId)) {
      commitFreeTransform()
    }
  })

  watch(options.activeTool, (tool) => {
    if (tool !== 'move') commitKeyboardLayerMove()
  })

  onBeforeUnmount(() => {
    if (keyboardLayerCommitTimeout) clearTimeout(keyboardLayerCommitTimeout)
    for (const member of keyboardLayerMove.value?.members ?? []) {
      member.target.classList.remove('document-layer--dragging')
    }
    for (const member of dragState.value?.members ?? []) {
      member.target.classList.remove('document-layer--dragging')
    }
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

import { Events, Window } from '@wailsio/runtime'
import { OpenLayerStyleWindow } from '../../bindings/axia/app'
import type { LayerEffectType, LayerStyleConfig, LayerStyleGlobalLight } from '../types/editor.ts'

export const LAYER_STYLE_WINDOW_NAME = 'layer-styles'

const OPEN_EVENT = 'axia:layer-styles:open'
const READY_EVENT = 'axia:layer-styles:ready'
const PREVIEW_EVENT = 'axia:layer-styles:preview'
const APPLY_EVENT = 'axia:layer-styles:apply'
const CANCEL_EVENT = 'axia:layer-styles:cancel'
const WINDOW_CLOSED_EVENT = 'axia:layer-styles:window-closed'

export interface LayerStyleWindowSession {
  globalLight: LayerStyleGlobalLight
  initialEffectType?: LayerEffectType
  layerName: string
  rasterEffectsAvailable: boolean
  sessionId: string
  styles: LayerStyleConfig
}

export interface LayerStyleWindowChange {
  globalLight: LayerStyleGlobalLight
  revision: number
  sessionId: string
  styles: LayerStyleConfig
}

function fromLayerStyleWindow(sender?: string) {
  return !sender || sender === LAYER_STYLE_WINDOW_NAME
}

export async function openLayerStyleNativeWindow(session: LayerStyleWindowSession) {
  await OpenLayerStyleWindow()
  await sendLayerStyleWindowSession(session)
}

export function sendLayerStyleWindowSession(session: LayerStyleWindowSession) {
  return Events.Emit(OPEN_EVENT, session)
}

export async function closeCurrentLayerStyleWindow() {
  await Window.Close()
}

export function registerLayerStyleWindowHost(handlers: {
  apply: (change: LayerStyleWindowChange) => void
  cancel: (sessionId: string) => void
  closed: () => void
  preview: (change: LayerStyleWindowChange) => void
  ready: () => void
}) {
  const unregister = [
    Events.On(APPLY_EVENT, (event) => {
      if (fromLayerStyleWindow(event.sender)) handlers.apply(event.data as LayerStyleWindowChange)
    }),
    Events.On(CANCEL_EVENT, (event) => {
      const sessionId = (event.data as { sessionId?: unknown } | null)?.sessionId
      if (fromLayerStyleWindow(event.sender) && typeof sessionId === 'string') handlers.cancel(sessionId)
    }),
    Events.On(PREVIEW_EVENT, (event) => {
      if (fromLayerStyleWindow(event.sender)) handlers.preview(event.data as LayerStyleWindowChange)
    }),
    Events.On(READY_EVENT, (event) => {
      if (fromLayerStyleWindow(event.sender)) handlers.ready()
    }),
    Events.On(WINDOW_CLOSED_EVENT, () => handlers.closed())
  ]
  return () => unregister.forEach((off) => off())
}

export function registerLayerStyleWindowClient(open: (session: LayerStyleWindowSession) => void) {
  const unregister = Events.On(OPEN_EVENT, (event) => open(event.data as LayerStyleWindowSession))
  void Events.Emit(READY_EVENT)
  return unregister
}

export function emitLayerStyleWindowPreview(change: LayerStyleWindowChange) {
  return Events.Emit(PREVIEW_EVENT, change)
}

export function emitLayerStyleWindowApply(change: LayerStyleWindowChange) {
  return Events.Emit(APPLY_EVENT, change)
}

export function emitLayerStyleWindowCancel(sessionId: string) {
  return Events.Emit(CANCEL_EVENT, { sessionId })
}

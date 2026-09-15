<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import LayerStyleDialog from './components/LayerStyleDialog.vue'
import { LatestFrameEmitter } from './editor/latestFrameEmitter.ts'
import { cloneLayerStyleConfig, normalizeLayerStyleGlobalLight } from './editor/layerStyles.ts'
import {
  closeCurrentLayerStyleWindow,
  emitLayerStyleWindowApply,
  emitLayerStyleWindowCancel,
  emitLayerStyleWindowPreview,
  registerLayerStyleWindowClient,
  type LayerStyleWindowSession
} from './services/layerStyleWindow.ts'
import type { LayerStyleConfig, LayerStyleGlobalLight } from './types/editor.ts'

const session = shallowRef<LayerStyleWindowSession>()
let revision = 0
let unregister: (() => void) | undefined
const previewEmitter = new LatestFrameEmitter(emitLayerStyleWindowPreview)

function acceptSession(next: LayerStyleWindowSession) {
  if (session.value?.sessionId === next.sessionId) return
  previewEmitter.clear()
  revision = 0
  session.value = {
    ...next,
    globalLight: normalizeLayerStyleGlobalLight(next.globalLight),
    styles: cloneLayerStyleConfig(next.styles)
  }
}

function change(styles: LayerStyleConfig, globalLight: LayerStyleGlobalLight) {
  const current = session.value
  if (!current) return null
  revision += 1
  return {
    globalLight: normalizeLayerStyleGlobalLight(globalLight),
    revision,
    sessionId: current.sessionId,
    styles: cloneLayerStyleConfig(styles)
  }
}

function preview(styles: LayerStyleConfig, globalLight: LayerStyleGlobalLight) {
  const payload = change(styles, globalLight)
  if (payload) previewEmitter.enqueue(payload)
}

async function apply(styles: LayerStyleConfig, globalLight: LayerStyleGlobalLight) {
  previewEmitter.clear()
  const payload = change(styles, globalLight)
  if (!payload) return
  await emitLayerStyleWindowApply(payload)
  await closeCurrentLayerStyleWindow()
}

async function cancel() {
  previewEmitter.clear()
  if (!session.value) return
  await emitLayerStyleWindowCancel(session.value.sessionId)
  await closeCurrentLayerStyleWindow()
}

onMounted(() => {
  document.documentElement.classList.add('layer-style-native-window')
  unregister = registerLayerStyleWindowClient(acceptSession)
})

onBeforeUnmount(() => {
  previewEmitter.stop()
  unregister?.()
  document.documentElement.classList.remove('layer-style-native-window')
})
</script>

<template>
  <LayerStyleDialog
    v-if="session"
    :global-light="session.globalLight"
    :initial-category="session.initialEffectType"
    :layer-name="session.layerName"
    native-window
    open
    :raster-effects-available="session.rasterEffectsAvailable"
    :styles="session.styles"
    @apply="apply"
    @cancel="cancel"
    @preview="preview"
  />
</template>

import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { layerStyleHash } from '../../../editor/layerStyleCompositor.ts'
import { layerStyleBlendIfUsesUnderlying } from '../../../editor/layerStyles.ts'
import { renderDocumentInteractiveBlendIfPreview } from '../../../services/renderDocument.ts'
import type { DocumentSpec, LayerItem } from '../../../types/editor.ts'

interface DocumentBlendIfPreviewOptions {
  document: () => DocumentSpec
  layers: () => LayerItem[]
  maximumHeight: () => number
  maximumWidth: () => number
}

/** Mantém uma única prévia composta, somente quando Camada abaixo for necessária. */
export function useDocumentBlendIfPreview(options: DocumentBlendIfPreviewOptions) {
  const source = shallowRef<string>()
  const active = computed(() => options.layers().some((layer) =>
    layer.visible && layerStyleBlendIfUsesUnderlying(layer.styles.blendIf)
  ))
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearSource() {
    if (source.value) URL.revokeObjectURL(source.value)
    source.value = undefined
  }

  async function refresh(currentGeneration: number) {
    if (!active.value) {
      if (currentGeneration === generation) clearSource()
      return
    }
    try {
      const blob = await renderDocumentInteractiveBlendIfPreview(
        options.document(),
        options.layers(),
        Math.max(1, options.maximumWidth()),
        Math.max(1, options.maximumHeight())
      )
      if (currentGeneration !== generation) return
      if (!blob) throw new Error('Não foi possível gerar a prévia de Mesclar se.')
      const next = URL.createObjectURL(blob)
      const previous = source.value
      source.value = next
      if (previous) URL.revokeObjectURL(previous)
    } catch {
      // A prévia DOM individual permanece utilizável se algum asset ainda estiver carregando.
      if (currentGeneration === generation) clearSource()
    }
  }

  watch(
    () => {
      const document = options.document()
      return [
        document.id, document.width, document.height, document.background,
        document.layerStyleGlobalLight.angle, document.layerStyleGlobalLight.altitude,
        options.maximumWidth(), options.maximumHeight(),
        ...options.layers().map((layer) => [
          layer.id, layer.visible, layer.opacity, layer.blendMode,
          layer.image?.sourceUrl, layer.image?.previewUrl, layer.image?.editToken,
          layer.transform?.x, layer.transform?.y, layer.transform?.width, layer.transform?.height, layer.transform?.rotation,
          layerStyleHash(layer.styles, document.layerStyleGlobalLight)
        ])
      ]
    },
    () => {
      generation += 1
      clearTimeout(timer)
      const currentGeneration = generation
      timer = setTimeout(() => void refresh(currentGeneration), 120)
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    generation += 1
    clearTimeout(timer)
    clearSource()
  })

  return { active, source }
}

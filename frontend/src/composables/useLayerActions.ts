import type { ComputedRef, Ref } from 'vue'
import { cloneLayerHistoryState, cloneLayerPatch, cloneLayerState, type EditorHistoryDelta } from '../editor/editorHistory'
import { moveLayerBy, moveLayerRelativeTo } from '../editor/layerOrder'
import { createLayerStyleConfig } from '../editor/layerStyles'
import { DEFAULT_TEXT_LAYER, measureTextLayer } from '../editor/text'
import type { HistoryRecordOptions } from '../editor/history'
import type {
  DocumentSpec,
  LayerBlendMode,
  LayerItem,
  TextLayerContent
} from '../types/editor'

interface LayerActionsOptions {
  activeDocument: Ref<DocumentSpec>
  activeLayer: ComputedRef<LayerItem>
  activeLayerId: Ref<string>
  cancelLayerPreview: (layerId: string) => void
  errorText: Ref<string>
  layers: Ref<LayerItem[]>
  recordHistory: (label: string, delta: EditorHistoryDelta, options?: HistoryRecordOptions) => void
  refreshLayerPreview: (layer: LayerItem) => Promise<void>
  statusText: Ref<string>
}

/** Handles synchronous layer-panel actions without owning editor-wide state. */
export function useLayerActions(options: LayerActionsOptions) {
  function insertionIndex() {
    const index = options.layers.value.findIndex((layer) => layer.id === options.activeLayerId.value)
    return index < 0 ? 0 : index
  }

  function addLayer() {
    const id = crypto.randomUUID()
    const activeBefore = options.activeLayerId.value
    const index = insertionIndex()
    const layer: LayerItem = {
      id,
      name: `Camada ${options.layers.value.length}`,
      visible: true,
      opacity: 100,
      blendMode: 'normal',
      kind: 'pixel',
      styles: createLayerStyleConfig()
    }
    options.layers.value.splice(index, 0, layer)
    options.activeLayerId.value = id
    options.recordHistory('Criar camada', {
      type: 'layers:add',
      items: [{ index, layer: cloneLayerHistoryState(layer) }],
      activeBefore,
      activeAfter: id
    })
    options.statusText.value = 'Nova camada criada'
  }

  function addTextLayer(point: { x: number; y: number }, paragraphWidth?: number) {
    const id = crypto.randomUUID()
    const text = { ...DEFAULT_TEXT_LAYER }
    if (paragraphWidth && paragraphWidth > 2) {
      text.layoutMode = 'paragraph'
      text.baseWidth = Math.min(16_384, Math.max(1, Math.round(paragraphWidth)))
    }
    const size = measureTextLayer(text)
    text.baseWidth = size.width
    text.baseHeight = size.height
    const activeBefore = options.activeLayerId.value
    const index = insertionIndex()
    const document = options.activeDocument.value
    const layer: LayerItem = {
      id,
      name: text.content,
      visible: true,
      opacity: 100,
      blendMode: 'normal',
      kind: 'text',
      styles: createLayerStyleConfig(),
      text,
      transform: {
        x: Math.round(Math.max(0, Math.min(point.x, document.width - size.width))),
        y: Math.round(Math.max(0, Math.min(point.y, document.height - size.height))),
        width: size.width,
        height: size.height,
        rotation: 0
      }
    }
    options.layers.value.splice(index, 0, layer)
    options.activeLayerId.value = id
    options.recordHistory('Criar texto', {
      type: 'layers:add',
      items: [{ index, layer: cloneLayerHistoryState(layer) }],
      activeBefore,
      activeAfter: id
    })
    options.statusText.value = 'Camada de texto criada'
  }

  function updateTextLayer(layerId: string, patch: Partial<TextLayerContent>) {
    const layer = options.layers.value.find((item) => item.id === layerId)
    if (!layer?.text || !layer.transform) return
    const entries = Object.entries(patch) as Array<[keyof TextLayerContent, TextLayerContent[keyof TextLayerContent]]>
    if (!entries.some(([key, value]) => layer.text?.[key] !== value)) return

    const property = Object.keys(patch).sort().join('-')
    const previous = layer.text
    const transform = layer.transform
    const before = cloneLayerPatch({ name: layer.name, text: previous, transform })
    const scaleX = transform.width / previous.baseWidth
    const scaleY = transform.height / previous.baseHeight
    const text: TextLayerContent = { ...previous, ...patch }
    text.fontSize = Math.min(1000, Math.max(1, Number.isFinite(text.fontSize) ? text.fontSize : previous.fontSize))
    text.fontWeight = Math.min(900, Math.max(100, Number.isFinite(text.fontWeight) ? text.fontWeight : previous.fontWeight))
    text.lineHeight = Math.min(3, Math.max(0.6, Number.isFinite(text.lineHeight) ? text.lineHeight : previous.lineHeight))
    text.layoutMode = text.layoutMode === 'paragraph' ? 'paragraph' : 'point'
    text.baseWidth = Math.min(16_384, Math.max(1, Number.isFinite(text.baseWidth) ? text.baseWidth : previous.baseWidth))
    text.fontStyle = text.fontStyle === 'italic' ? 'italic' : 'normal'
    text.letterSpacing = Math.min(1000, Math.max(-100,
      typeof text.letterSpacing === 'number' && Number.isFinite(text.letterSpacing) ? text.letterSpacing : 0
    ))
    text.decoration = text.decoration === 'underline' || text.decoration === 'line-through' ? text.decoration : 'none'
    text.textTransform = text.textTransform === 'uppercase' ? 'uppercase' : 'none'
    text.alignment = text.alignment === 'center' || text.alignment === 'right' || text.alignment === 'justify'
      ? text.alignment
      : 'left'
    const size = measureTextLayer(text)
    text.baseWidth = size.width
    text.baseHeight = size.height
    layer.text = text
    layer.transform = {
      ...transform,
      width: Math.round(size.width * scaleX * 100) / 100,
      height: Math.round(size.height * scaleY * 100) / 100
    }
    if (patch.content !== undefined) {
      layer.name = patch.content.trim().split('\n')[0]?.slice(0, 36) || 'Texto'
    }
    options.recordHistory(
      patch.content !== undefined ? 'Editar texto' : 'Alterar texto',
      {
        type: 'layer:patch',
        layerId,
        before,
        after: cloneLayerPatch({ name: layer.name, text: layer.text, transform: layer.transform })
      },
      { mergeKey: `text:${layerId}:${property}`, mergeWindowMs: 800 }
    )
  }

  function toggleLayer(layerId: string) {
    const layer = options.layers.value.find((item) => item.id === layerId)
    if (!layer) return
    const label = layer.visible ? 'Ocultar camada' : 'Mostrar camada'
    const before = layer.visible
    layer.visible = !before
    if (layer.visible && layer.image) void options.refreshLayerPreview(layer)
    options.recordHistory(label, {
      type: 'layer:patch', layerId, before: { visible: before }, after: { visible: layer.visible }
    })
  }

  function renameLayer(layerId: string, name: string) {
    const layer = options.layers.value.find((item) => item.id === layerId)
    const cleanName = name.trim()
    if (!layer || !cleanName || layer.name === cleanName) return
    const before = layer.name
    layer.name = cleanName
    options.recordHistory('Renomear camada', {
      type: 'layer:patch', layerId, before: { name: before }, after: { name: cleanName }
    })
    options.statusText.value = `Camada renomeada para ${cleanName}`
  }

  function duplicateLayer(layerId = options.activeLayerId.value) {
    const index = options.layers.value.findIndex((layer) => layer.id === layerId)
    const source = options.layers.value[index]
    if (!source) return
    const duplicate: LayerItem = {
      ...cloneLayerState(source),
      id: crypto.randomUUID(),
      name: `${source.name} cópia`,
      kind: source.kind === 'background' ? 'pixel' : source.kind,
      transform: source.transform
        ? {
            ...source.transform,
            x: source.transform.x + (source.kind === 'background' ? 0 : 12),
            y: source.transform.y + (source.kind === 'background' ? 0 : 12)
          }
        : undefined
    }
    const activeBefore = options.activeLayerId.value
    options.layers.value.splice(index, 0, duplicate)
    options.activeLayerId.value = duplicate.id
    options.recordHistory('Duplicar camada', {
      type: 'layers:add',
      items: [{ index, layer: cloneLayerHistoryState(duplicate) }],
      activeBefore,
      activeAfter: duplicate.id
    })
    options.statusText.value = 'Camada duplicada'
  }

  function deleteLayer(layerId: string) {
    const index = options.layers.value.findIndex((layer) => layer.id === layerId)
    const layer = options.layers.value[index]
    if (!layer) return
    if (options.layers.value.length === 1) {
      options.errorText.value = 'O documento precisa manter pelo menos uma camada.'
      options.statusText.value = 'Não é possível excluir a única camada do documento'
      return
    }
    options.cancelLayerPreview(layerId)
    const activeBefore = options.activeLayerId.value
    const removed = cloneLayerHistoryState(layer)
    options.layers.value.splice(index, 1)
    if (options.activeLayerId.value === layerId) {
      options.activeLayerId.value = options.layers.value[Math.min(index, options.layers.value.length - 1)]!.id
    }
    options.recordHistory('Excluir camada', {
      type: 'layers:remove',
      items: [{ index, layer: removed }],
      activeBefore,
      activeAfter: options.activeLayerId.value
    })
    options.errorText.value = ''
    options.statusText.value = 'Camada excluída'
  }

  function moveLayer(layerId: string, direction: -1 | 1) {
    const change = moveLayerBy(options.layers.value, layerId, direction)
    if (!change) return
    options.layers.value = change.layers
    options.recordHistory(direction < 0 ? 'Elevar camada' : 'Abaixar camada', {
      type: 'layer:reorder', layerId, beforeIndex: change.beforeIndex, afterIndex: change.afterIndex
    })
    options.statusText.value = direction < 0 ? 'Camada elevada' : 'Camada abaixada'
  }

  function reorderLayer(layerId: string, targetId: string, position: 'before' | 'after') {
    const change = moveLayerRelativeTo(options.layers.value, layerId, targetId, position)
    if (!change) return
    options.layers.value = change.layers
    options.recordHistory('Reordenar camada', {
      type: 'layer:reorder', layerId, beforeIndex: change.beforeIndex, afterIndex: change.afterIndex
    })
    options.statusText.value = 'Ordem das camadas atualizada'
  }

  function updateLayerOpacity(value: number) {
    const layer = options.activeLayer.value
    const opacity = Math.min(100, Math.max(0, value))
    if (layer.opacity === opacity) return
    const before = layer.opacity
    layer.opacity = opacity
    options.recordHistory('Alterar opacidade', {
      type: 'layer:patch', layerId: layer.id, before: { opacity: before }, after: { opacity }
    }, { mergeKey: `opacity:${layer.id}`, mergeWindowMs: 800 })
  }

  function updateLayerBlendMode(blendMode: LayerBlendMode) {
    const layer = options.activeLayer.value
    if (layer.blendMode === blendMode) return
    const before = layer.blendMode
    layer.blendMode = blendMode
    options.recordHistory('Alterar modo de mesclagem', {
      type: 'layer:patch', layerId: layer.id, before: { blendMode: before }, after: { blendMode }
    })
    options.statusText.value = 'Modo de mesclagem atualizado'
  }

  return {
    addLayer,
    addTextLayer,
    deleteLayer,
    duplicateLayer,
    moveLayer,
    renameLayer,
    reorderLayer,
    toggleLayer,
    updateLayerBlendMode,
    updateLayerOpacity,
    updateTextLayer
  }
}

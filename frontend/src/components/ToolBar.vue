<script setup lang="ts">
import type { EditorTool } from '../types/editor'
import brushIcon from '../assets/icons/brush.svg'
import cropIcon from '../assets/icons/crop.svg'
import eraserIcon from '../assets/icons/eraser.svg'
import handIcon from '../assets/icons/hand.svg'
import moveIcon from '../assets/icons/move.svg'
import textIcon from '../assets/icons/text.svg'
import zoomIcon from '../assets/icons/zoom.svg'

const activeTool = defineModel<EditorTool>('activeTool', { required: true })
const emit = defineEmits<{
  (event: 'toolDoubleClick', tool: EditorTool): void
}>()

const tools: Array<{ id: EditorTool; icon: string; label: string; enabled: boolean }> = [
  { id: 'move', icon: moveIcon, label: 'Mover (V)', enabled: true },
  { id: 'brush', icon: brushIcon, label: 'Pincel (em breve)', enabled: false },
  { id: 'eraser', icon: eraserIcon, label: 'Borracha (em breve)', enabled: false },
  { id: 'crop', icon: cropIcon, label: 'Recorte e seleção (C)', enabled: true },
  { id: 'text', icon: textIcon, label: 'Texto (T)', enabled: true },
  { id: 'hand', icon: handIcon, label: 'Mão (H)', enabled: true },
  { id: 'zoom', icon: zoomIcon, label: 'Zoom (Z)', enabled: true }
]
</script>

<template>
  <aside class="tool-bar" aria-label="Ferramentas">
    <button
      v-for="tool in tools"
      :key="tool.id"
      :aria-label="tool.label"
      :aria-pressed="activeTool === tool.id"
      :disabled="!tool.enabled"
      :title="tool.label"
      type="button"
      @click="activeTool = tool.id"
      @dblclick="emit('toolDoubleClick', tool.id)"
    >
      <img alt="" :src="tool.icon" />
    </button>
  </aside>
</template>

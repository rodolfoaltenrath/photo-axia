<script setup lang="ts">
import { ref, watch } from 'vue'
import type { EditorTool } from '../types/editor'
import brushIcon from '../assets/icons/brush.svg'
import cropIcon from '../assets/icons/crop.svg'
import eraserIcon from '../assets/icons/eraser.svg'
import eyedropperIcon from '../assets/icons/eyedropper.svg'
import gradientIcon from '../assets/icons/gradient.svg'
import paintBucketIcon from '../assets/icons/paint-bucket.svg'
import handIcon from '../assets/icons/hand.svg'
import moveIcon from '../assets/icons/move.svg'
import textIcon from '../assets/icons/text.svg'
import zoomIcon from '../assets/icons/zoom.svg'

const activeTool = defineModel<EditorTool>('activeTool', { required: true })
const foregroundColor = defineModel<string>('foregroundColor', { required: true })
const backgroundColor = defineModel<string>('backgroundColor', { required: true })
const emit = defineEmits<{
  (event: 'toolDoubleClick', tool: EditorTool): void
}>()

type ToolDefinition = { id: EditorTool; icon: string; label: string; enabled: boolean }

const toolsBeforeColorGroup: ToolDefinition[] = [
  { id: 'move', icon: moveIcon, label: 'Mover (V)', enabled: true },
  { id: 'brush', icon: brushIcon, label: 'Pincel (B)', enabled: true },
  { id: 'eraser', icon: eraserIcon, label: 'Borracha (E)', enabled: true }
]

const colorTools: ToolDefinition[] = [
  { id: 'gradient', icon: gradientIcon, label: 'Degradê (G)', enabled: true },
  { id: 'paint-bucket', icon: paintBucketIcon, label: 'Balde de Tinta (Shift+G)', enabled: true }
]

const toolsAfterColorGroup: ToolDefinition[] = [
  { id: 'eyedropper', icon: eyedropperIcon, label: 'Conta-gotas (I)', enabled: true },
  { id: 'crop', icon: cropIcon, label: 'Recorte e seleção (C)', enabled: true },
  { id: 'text', icon: textIcon, label: 'Texto (T)', enabled: true },
  { id: 'hand', icon: handIcon, label: 'Mão (H)', enabled: true },
  { id: 'zoom', icon: zoomIcon, label: 'Zoom (Z)', enabled: true }
]

const rememberedColorTool = ref<'gradient' | 'paint-bucket'>('gradient')
watch(activeTool, (tool) => {
  if (tool === 'gradient' || tool === 'paint-bucket') rememberedColorTool.value = tool
}, { immediate: true })

function selectColorTool(tool: 'gradient' | 'paint-bucket', event?: Event) {
  rememberedColorTool.value = tool
  activeTool.value = tool
  const details = (event?.currentTarget as HTMLElement | null)?.closest('details')
  if (details) details.open = false
}

function swapColors() {
  const previousForeground = foregroundColor.value
  foregroundColor.value = backgroundColor.value
  backgroundColor.value = previousForeground
}

function resetColors() {
  foregroundColor.value = '#000000'
  backgroundColor.value = '#ffffff'
}
</script>

<template>
  <aside class="tool-bar" aria-label="Ferramentas">
    <button
      v-for="tool in toolsBeforeColorGroup"
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

    <div class="toolbar-tool-group" :class="{ active: activeTool === 'gradient' || activeTool === 'paint-bucket' }">
      <button
        :aria-label="colorTools.find((tool) => tool.id === rememberedColorTool)?.label"
        :aria-pressed="activeTool === 'gradient' || activeTool === 'paint-bucket'"
        :title="colorTools.find((tool) => tool.id === rememberedColorTool)?.label"
        type="button"
        @click="selectColorTool(rememberedColorTool)"
      >
        <img alt="" :src="rememberedColorTool === 'gradient' ? gradientIcon : paintBucketIcon" />
      </button>
      <details>
        <summary aria-label="Mostrar ferramentas de degradê e preenchimento" title="Mostrar ferramentas do grupo G">▸</summary>
        <div class="toolbar-tool-flyout" role="menu" aria-label="Ferramentas do grupo G">
          <button
            v-for="tool in colorTools"
            :key="tool.id"
            :aria-pressed="activeTool === tool.id"
            :title="tool.label"
            type="button"
            role="menuitem"
            @click="selectColorTool(tool.id as 'gradient' | 'paint-bucket', $event)"
          >
            <img alt="" :src="tool.icon" />
            <span>{{ tool.label }}</span>
          </button>
        </div>
      </details>
    </div>

    <button
      v-for="tool in toolsAfterColorGroup"
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

    <div class="toolbar-colors" aria-label="Cores do editor">
      <button
        class="toolbar-color-swap"
        type="button"
        title="Trocar cores principal e secundária"
        aria-label="Trocar cores principal e secundária"
        @click="swapColors"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 5h9m0 0L9.5 2.5M12 5 9.5 7.5M13 11H4m0 0 2.5-2.5M4 11l2.5 2.5" />
        </svg>
      </button>
      <input
        v-model="backgroundColor"
        class="toolbar-color-swatch toolbar-color-swatch--background"
        type="color"
        title="Cor secundária"
        aria-label="Cor secundária"
      />
      <input
        v-model="foregroundColor"
        class="toolbar-color-swatch toolbar-color-swatch--foreground"
        type="color"
        title="Cor principal"
        aria-label="Cor principal"
      />
      <button
        class="toolbar-color-reset"
        type="button"
        title="Restaurar preto e branco"
        aria-label="Restaurar cores para preto e branco"
        @click="resetColors"
      >
        <span></span><span></span>
      </button>
    </div>
  </aside>
</template>

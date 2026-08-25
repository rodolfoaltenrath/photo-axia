<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EditorTool } from '../types/editor'
import {
  isMarqueeSelectionMode,
  type MarqueeSelectionMode
} from '../editor/marqueeSelection'
import type { SelectionMode } from '../editor/selection'
import brushIcon from '../assets/icons/brush.svg'
import eraserIcon from '../assets/icons/eraser.svg'
import eyedropperIcon from '../assets/icons/eyedropper.svg'
import gradientIcon from '../assets/icons/degrade.png'
import paintBucketIcon from '../assets/icons/paint-bucket.svg'
import handIcon from '../assets/icons/hand.svg'
import moveIcon from '../assets/icons/mover.png'
import textIcon from '../assets/icons/text.svg'
import zoomIcon from '../assets/icons/zoom.svg'
import marqueeRectangleIcon from '../assets/icons/marquee-rectangle.svg'
import marqueeEllipseIcon from '../assets/icons/marquee-ellipse.svg'

const props = defineProps<{ selectionMode: SelectionMode }>()
const activeTool = defineModel<EditorTool>('activeTool', { required: true })
const foregroundColor = defineModel<string>('foregroundColor', { required: true })
const backgroundColor = defineModel<string>('backgroundColor', { required: true })
const emit = defineEmits<{
  (event: 'toolDoubleClick', tool: EditorTool): void
  (event: 'updateSelectionMode', mode: SelectionMode): void
}>()
const toolbarElement = ref<HTMLElement | null>(null)

type ToolDefinition = { id: EditorTool; icon: string; label: string; enabled: boolean; rasterIcon?: boolean }

const toolsBeforeColorGroup: ToolDefinition[] = [
  { id: 'move', icon: moveIcon, label: 'Mover (V)', enabled: true, rasterIcon: true },
  { id: 'brush', icon: brushIcon, label: 'Pincel (B)', enabled: true },
  { id: 'eraser', icon: eraserIcon, label: 'Borracha (E)', enabled: true }
]

const colorTools: ToolDefinition[] = [
  { id: 'gradient', icon: gradientIcon, label: 'Degradê (G)', enabled: true, rasterIcon: true },
  { id: 'paint-bucket', icon: paintBucketIcon, label: 'Balde de Tinta (Shift+G)', enabled: true }
]

const toolsBeforeMarqueeGroup: ToolDefinition[] = [
  { id: 'eyedropper', icon: eyedropperIcon, label: 'Conta-gotas (I)', enabled: true },
]

const toolsAfterMarqueeGroup: ToolDefinition[] = [
  { id: 'text', icon: textIcon, label: 'Texto (T)', enabled: true },
  { id: 'hand', icon: handIcon, label: 'Mão (H)', enabled: true },
  { id: 'zoom', icon: zoomIcon, label: 'Zoom (Z)', enabled: true }
]

const marqueeTools: Array<{ mode: MarqueeSelectionMode; icon: string; label: string }> = [
  { mode: 'rectangle', icon: marqueeRectangleIcon, label: 'Seleção Retangular (M)' },
  { mode: 'ellipse', icon: marqueeEllipseIcon, label: 'Seleção Elíptica (Shift+M)' }
]

const rememberedColorTool = ref<'gradient' | 'paint-bucket'>('gradient')
const rememberedMarqueeMode = ref<MarqueeSelectionMode>('rectangle')
watch(activeTool, (tool) => {
  if (tool === 'gradient' || tool === 'paint-bucket') rememberedColorTool.value = tool
}, { immediate: true })
watch(() => props.selectionMode, (mode) => {
  if (marqueeTools.some((tool) => tool.mode === mode)) rememberedMarqueeMode.value = mode as MarqueeSelectionMode
}, { immediate: true })

function selectColorTool(tool: 'gradient' | 'paint-bucket', event?: Event) {
  rememberedColorTool.value = tool
  activeTool.value = tool
  const details = (event?.currentTarget as HTMLElement | null)?.closest('details')
  if (details) details.open = false
}

function selectMarqueeTool(mode: MarqueeSelectionMode, event?: Event) {
  rememberedMarqueeMode.value = mode
  emit('updateSelectionMode', mode)
  activeTool.value = 'crop'
  const details = (event?.currentTarget as HTMLElement | null)?.closest('details')
  if (details) details.open = false
}

function marqueeTool(mode: MarqueeSelectionMode) {
  return marqueeTools.find((tool) => tool.mode === mode) ?? marqueeTools[0]!
}

function openToolFlyout(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const group = (event.currentTarget as HTMLElement | null)?.closest('.toolbar-tool-group')
  const details = group?.querySelector<HTMLDetailsElement>('details')
  if (!details) return
  closeToolFlyouts(details)
  details.open = true
}

function closeToolFlyouts(except?: HTMLDetailsElement | null) {
  const openFlyouts = Array.from(toolbarElement.value?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? [])
  for (const details of openFlyouts) {
    if (details !== except) details.open = false
  }
}

function handleOutsideToolPointer(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target : null
  const clickedDetails = target?.closest<HTMLDetailsElement>('details')
  closeToolFlyouts(clickedDetails && toolbarElement.value?.contains(clickedDetails) ? clickedDetails : null)
}

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsideToolPointer, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsideToolPointer, true)
})

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
  <aside ref="toolbarElement" class="tool-bar" aria-label="Ferramentas">
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
      <img alt="" :class="{ 'toolbar-raster-icon': tool.rasterIcon }" :src="tool.icon" />
    </button>

    <div class="toolbar-tool-group" :class="{ active: activeTool === 'gradient' || activeTool === 'paint-bucket' }">
      <button
        :aria-label="colorTools.find((tool) => tool.id === rememberedColorTool)?.label"
        :aria-pressed="activeTool === 'gradient' || activeTool === 'paint-bucket'"
        :title="colorTools.find((tool) => tool.id === rememberedColorTool)?.label"
        type="button"
        @click="selectColorTool(rememberedColorTool)"
        @contextmenu="openToolFlyout"
      >
        <img
          alt=""
          :class="{ 'toolbar-raster-icon': rememberedColorTool === 'gradient' }"
          :src="rememberedColorTool === 'gradient' ? gradientIcon : paintBucketIcon"
        />
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
            <img alt="" :class="{ 'toolbar-raster-icon': tool.rasterIcon }" :src="tool.icon" />
            <span>{{ tool.label }}</span>
          </button>
        </div>
      </details>
    </div>

    <button
      v-for="tool in toolsBeforeMarqueeGroup"
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

    <div class="toolbar-tool-group" :class="{ active: activeTool === 'crop' && isMarqueeSelectionMode(selectionMode) }">
      <button
        :aria-label="marqueeTool(rememberedMarqueeMode).label"
        :aria-pressed="activeTool === 'crop' && isMarqueeSelectionMode(selectionMode)"
        :title="marqueeTool(rememberedMarqueeMode).label"
        type="button"
        @click="selectMarqueeTool(rememberedMarqueeMode)"
        @contextmenu="openToolFlyout"
      >
        <img alt="" :src="marqueeTool(rememberedMarqueeMode).icon" />
      </button>
      <details>
        <summary aria-label="Mostrar ferramentas de seleção Marquee" title="Mostrar ferramentas do grupo M">▸</summary>
        <div class="toolbar-tool-flyout" role="menu" aria-label="Ferramentas do grupo M">
          <button
            v-for="tool in marqueeTools"
            :key="tool.mode"
            :aria-pressed="activeTool === 'crop' && selectionMode === tool.mode"
            :title="tool.label"
            type="button"
            role="menuitem"
            @click="selectMarqueeTool(tool.mode, $event)"
          >
            <img alt="" :src="tool.icon" />
            <span>{{ tool.label }}</span>
          </button>
        </div>
      </details>
    </div>

    <button
      v-for="tool in toolsAfterMarqueeGroup"
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

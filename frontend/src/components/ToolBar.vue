<script setup lang="ts">
import type { EditorTool } from '../types/editor'
import cropIcon from '../../../assets/cAAAAAElFTkSuQmCC.png'
import eraserIcon from '../../../assets/cBlAth80uFXgSGuZXfH6Saw6asLQRI3zP6om1WTOPzOQJP2RUz7nxH6Bppt4quWuqp1AAAAAElFTkSuQmCC.png'
import handIcon from '../../../assets/G737GyVxO24FNVAAAAAElFTkSuQmCC.png'
import moveIcon from '../../../assets/60WfwDkFH1iPYe5kwAAAABJRU5ErkJggg==.png'
import brushIcon from '../../../assets/ddLPp7O3fzOa9R+zT4BdqVJm+AAAAABJRU5ErkJggg==.png'
import selectIcon from '../../../assets/0EASsO5g1EQi9NHBckXHAUjEwzCpDgqSAfBUTAywSBMiqOC9BAchE04bIKjgKoAACuiXrD5nX1PAAAAAElFTkSuQmCC.png'
import textIcon from '../../../assets/zmiTgwYiKmwAAAABJRU5ErkJggg==.png'

const activeTool = defineModel<EditorTool>('activeTool', { required: true })

const tools: Array<{ id: EditorTool; icon: string; label: string }> = [
  { id: 'move', icon: moveIcon, label: 'Mover' },
  { id: 'select', icon: selectIcon, label: 'Selecionar' },
  { id: 'brush', icon: brushIcon, label: 'Pincel' },
  { id: 'eraser', icon: eraserIcon, label: 'Borracha' },
  { id: 'crop', icon: cropIcon, label: 'Cortar' },
  { id: 'text', icon: textIcon, label: 'Texto' },
  { id: 'hand', icon: handIcon, label: 'Navegar' }
]
</script>

<template>
  <aside class="tool-bar" aria-label="Ferramentas">
    <button
      v-for="tool in tools"
      :key="tool.id"
      :aria-pressed="activeTool === tool.id"
      :title="tool.label"
      type="button"
      @click="activeTool = tool.id"
    >
      <img :alt="tool.label" :src="tool.icon" />
    </button>
  </aside>
</template>

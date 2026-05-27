<script setup lang="ts">
import type { EditorTool, LayerItem } from '../types/editor'

defineProps<{
  activeLayer: LayerItem
  activeTool: EditorTool
  brushSize: number
  opacity: number
  zoom: number
}>()

defineEmits<{
  (event: 'update:brushSize', value: number): void
  (event: 'update:opacity', value: number): void
  (event: 'update:zoom', value: number): void
}>()
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      <h2>Propriedades</h2>
    </div>

    <label>
      Ferramenta
      <input :value="activeTool" readonly />
    </label>

    <label>
      Camada
      <input :value="activeLayer.name" readonly />
    </label>

    <label>
      Pincel
      <input
        :value="brushSize"
        max="128"
        min="1"
        type="range"
        @input="$emit('update:brushSize', Number(($event.target as HTMLInputElement).value))"
      />
    </label>

    <label>
      Opacidade
      <input
        :value="opacity"
        max="100"
        min="0"
        type="range"
        @input="$emit('update:opacity', Number(($event.target as HTMLInputElement).value))"
      />
    </label>

    <label>
      Zoom
      <input
        :value="zoom"
        max="400"
        min="12"
        step="1"
        type="number"
        @input="$emit('update:zoom', Number(($event.target as HTMLInputElement).value))"
      />
    </label>
  </section>
</template>


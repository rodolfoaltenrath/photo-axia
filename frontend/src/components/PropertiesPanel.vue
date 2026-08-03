<script setup lang="ts">
import type { EditorTool, LayerItem } from '../types/editor'

defineProps<{
  activeLayer: LayerItem
  activeTool: EditorTool
  brushSize: number
  zoom: number
}>()

defineEmits<{
  (event: 'update:brushSize', value: number): void
  (event: 'update:layerOpacity', value: number): void
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

    <label v-if="activeTool === 'brush' || activeTool === 'eraser'">
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
        :value="activeLayer.opacity"
        max="100"
        min="0"
        type="range"
        @input="$emit('update:layerOpacity', Number(($event.target as HTMLInputElement).value))"
      />
    </label>

    <template v-if="activeLayer.transform">
      <div class="property-grid">
        <label>
          X
          <input :value="activeLayer.transform.x" readonly type="number" />
        </label>
        <label>
          Y
          <input :value="activeLayer.transform.y" readonly type="number" />
        </label>
      </div>
      <div class="property-grid">
        <label>
          Largura
          <input :value="activeLayer.transform.width" readonly type="number" />
        </label>
        <label>
          Altura
          <input :value="activeLayer.transform.height" readonly type="number" />
        </label>
      </div>
      <label>
        Rotação
        <input :value="activeLayer.transform.rotation ?? 0" readonly type="number" />
      </label>
    </template>

    <label>
      Zoom
      <input
        :value="zoom"
        max="3200"
        min="5"
        step="0.01"
        type="number"
        @input="$emit('update:zoom', Number(($event.target as HTMLInputElement).value))"
      />
    </label>
  </section>
</template>

<script setup lang="ts">
import type { LayerItem } from '../types/editor'

defineProps<{
  activeLayerId: string
  layers: LayerItem[]
}>()

defineEmits<{
  (event: 'addLayer'): void
  (event: 'selectLayer', layerId: string): void
  (event: 'toggleLayer', layerId: string): void
}>()
</script>

<template>
  <section class="panel layers-panel">
    <div class="panel-title">
      <h2>Camadas</h2>
      <button type="button" title="Adicionar camada" @click="$emit('addLayer')">+</button>
    </div>

    <ol class="layer-list">
      <li
        v-for="layer in layers"
        :key="layer.id"
        :class="{ active: layer.id === activeLayerId }"
      >
        <button
          class="visibility-button"
          type="button"
          :title="layer.visible ? 'Ocultar camada' : 'Mostrar camada'"
          @click="$emit('toggleLayer', layer.id)"
        >
          {{ layer.visible ? 'V' : '-' }}
        </button>
        <button class="layer-button" type="button" @click="$emit('selectLayer', layer.id)">
          <span class="layer-thumb"></span>
          <span>
            <strong>{{ layer.name }}</strong>
            <small>{{ layer.kind }} - {{ layer.opacity }}%</small>
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>


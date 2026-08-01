<script setup lang="ts">
import type { LayerItem } from '../types/editor'
import addLayerIcon from '../assets/icons/add-layer.svg'
import visibleIcon from '../assets/icons/visible.svg'

defineProps<{
  activeLayerId: string
  layers: LayerItem[]
}>()

defineEmits<{
  (event: 'addLayer'): void
  (event: 'selectLayer', layerId: string): void
  (event: 'toggleLayer', layerId: string): void
}>()

const kindLabels: Record<LayerItem['kind'], string> = {
  pixel: 'Pixels',
  image: 'Imagem',
  adjustment: 'Ajuste',
  background: 'Fundo'
}
</script>

<template>
  <section class="panel layers-panel">
    <div class="panel-title">
      <h2>Camadas</h2>
      <button type="button" title="Adicionar camada" @click="$emit('addLayer')">
        <img alt="" :src="addLayerIcon" />
      </button>
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
          :aria-label="layer.visible ? `Ocultar ${layer.name}` : `Mostrar ${layer.name}`"
          :title="layer.visible ? 'Ocultar camada' : 'Mostrar camada'"
          @click="$emit('toggleLayer', layer.id)"
        >
          <img alt="" :class="{ 'visibility-icon--hidden': !layer.visible }" :src="visibleIcon" />
        </button>
        <button
          class="layer-button"
          type="button"
          :aria-current="layer.id === activeLayerId ? 'true' : undefined"
          @click="$emit('selectLayer', layer.id)"
        >
          <span class="layer-thumb" :class="{ 'layer-thumb--transparent': !layer.image }">
            <img v-if="layer.image" alt="" :src="layer.image.sourceUrl" />
          </span>
          <span>
            <strong>{{ layer.name }}</strong>
            <small>{{ kindLabels[layer.kind] }} · {{ layer.opacity }}%</small>
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>

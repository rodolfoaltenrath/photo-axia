<script setup lang="ts">
import LayerStylePatternPicker from './LayerStylePatternPicker.vue'
import type { LayerStylePatternAsset, PatternOverlayEffect } from '../../types/editor'

defineProps<{ effect: PatternOverlayEffect }>()

const emit = defineEmits<{
  (event: 'update', patch: Partial<PatternOverlayEffect>): void
}>()

function selectPattern(asset: LayerStylePatternAsset) {
  emit('update', { pattern: asset })
}
</script>

<template>
  <div class="layer-style-controls layer-style-controls--scrollable">
    <h3>Sobreposição de padrão</h3>
    <div class="layer-style-grid">
      <LayerStylePatternPicker :pattern="effect.pattern" @select="selectPattern" />
      <label>
        Modo
        <select
          :value="effect.blendMode"
          @change="emit('update', { blendMode: ($event.target as HTMLSelectElement).value as PatternOverlayEffect['blendMode'] })"
        >
          <option value="normal">Normal</option>
          <option value="multiply">Multiplicação</option>
          <option value="screen">Divisão</option>
          <option value="overlay">Sobrepor</option>
          <option value="lighten">Clarear</option>
          <option value="darken">Escurecer</option>
        </select>
      </label>
      <label>
        Ângulo
        <span class="layer-style-number">
          <input
            :value="effect.angle"
            max="180"
            min="-180"
            type="number"
            @input="emit('update', { angle: Number(($event.target as HTMLInputElement).value) })"
          />
          <span aria-hidden="true">°</span>
        </span>
      </label>
    </div>

    <div class="layer-style-slider-list">
      <label class="layer-style-parameter">
        <span>Opacidade</span>
        <input
          :value="effect.opacity"
          max="100"
          min="0"
          type="range"
          @input="emit('update', { opacity: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="layer-style-parameter-value">
          <input
            :value="effect.opacity"
            max="100"
            min="0"
            type="number"
            @input="emit('update', { opacity: Number(($event.target as HTMLInputElement).value) })"
          />
          <span aria-hidden="true">%</span>
        </span>
      </label>
      <label class="layer-style-parameter">
        <span>Escala</span>
        <input
          :value="effect.scale"
          max="1000"
          min="1"
          type="range"
          @input="emit('update', { scale: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="layer-style-parameter-value">
          <input
            :value="effect.scale"
            max="1000"
            min="1"
            type="number"
            @input="emit('update', { scale: Number(($event.target as HTMLInputElement).value) })"
          />
          <span aria-hidden="true">%</span>
        </span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ColorOverlayEffect } from '../../types/editor'

defineProps<{ effect: ColorOverlayEffect }>()

const emit = defineEmits<{
  (event: 'update', patch: Partial<ColorOverlayEffect>): void
}>()
</script>

<template>
  <div class="layer-style-controls layer-style-controls--scrollable">
    <h3>Sobreposição de cor</h3>
    <div class="layer-style-grid">
      <label>
        Cor
        <input
          class="layer-style-color"
          :value="effect.color"
          type="color"
          @input="emit('update', { color: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label>
        Modo
        <select
          :value="effect.blendMode"
          @change="emit('update', { blendMode: ($event.target as HTMLSelectElement).value as ColorOverlayEffect['blendMode'] })"
        >
          <option value="normal">Normal</option>
          <option value="multiply">Multiplicação</option>
          <option value="screen">Divisão</option>
          <option value="overlay">Sobrepor</option>
          <option value="lighten">Clarear</option>
          <option value="darken">Escurecer</option>
        </select>
      </label>
    </div>

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
  </div>
</template>

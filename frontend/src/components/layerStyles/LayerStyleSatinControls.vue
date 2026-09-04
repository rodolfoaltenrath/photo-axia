<script setup lang="ts">
import type { SatinEffect } from '../../types/editor'

defineProps<{ effect: SatinEffect }>()

const emit = defineEmits<{
  (event: 'update', patch: Partial<SatinEffect>): void
}>()
</script>

<template>
  <div class="layer-style-controls layer-style-controls--scrollable">
    <h3>Acetinado</h3>
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
          @change="emit('update', { blendMode: ($event.target as HTMLSelectElement).value as SatinEffect['blendMode'] })"
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
            step="1"
            type="number"
            @input="emit('update', { angle: Number(($event.target as HTMLInputElement).value) })"
          />
          <span aria-hidden="true">°</span>
        </span>
      </label>
      <label class="layer-style-preview-toggle">
        <input
          :checked="effect.invert"
          type="checkbox"
          @change="emit('update', { invert: ($event.target as HTMLInputElement).checked })"
        />
        <span>Inverter</span>
      </label>
    </div>

    <div class="layer-style-slider-list">
      <label v-for="control in [
        { key: 'opacity', label: 'Opacidade', value: effect.opacity, max: 100, min: 0, suffix: '%' },
        { key: 'distance', label: 'Distância', value: effect.distance, max: 1000, min: 0, suffix: 'px' },
        { key: 'size', label: 'Tamanho', value: effect.size, max: 250, min: 0, suffix: 'px' }
      ]" :key="control.key" class="layer-style-parameter">
        <span>{{ control.label }}</span>
        <input
          :value="control.value"
          :max="control.max"
          :min="control.min"
          type="range"
          @input="emit('update', { [control.key]: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="layer-style-parameter-value">
          <input
            :value="control.value"
            :max="control.max"
            :min="control.min"
            type="number"
            @input="emit('update', { [control.key]: Number(($event.target as HTMLInputElement).value) })"
          />
          <span aria-hidden="true">{{ control.suffix }}</span>
        </span>
      </label>
    </div>

    <label class="layer-style-contour">
      <span>Contorno</span>
      <select
        :value="effect.contour.preset"
        @change="emit('update', { contour: { ...effect.contour, preset: ($event.target as HTMLSelectElement).value as SatinEffect['contour']['preset'] } })"
      >
        <option value="linear">Linear</option>
        <option value="gaussian">Gaussiano</option>
        <option value="cone">Cone</option>
        <option value="inverted-cone">Cone invertido</option>
        <option value="ring">Anel</option>
      </select>
    </label>
  </div>
</template>

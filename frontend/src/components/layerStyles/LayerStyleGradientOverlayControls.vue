<script setup lang="ts">
import type { GradientOverlayEffect, LayerStyleGradient } from '../../types/editor'

const props = defineProps<{ effect: GradientOverlayEffect }>()

const emit = defineEmits<{
  (event: 'update', patch: Partial<GradientOverlayEffect>): void
}>()

function updateGradientColor(position: 0 | 1, color: string) {
  const colorStops = props.effect.gradient.colorStops.map((stop, index) =>
    index === position ? { ...stop, color } : stop
  )
  emit('update', { gradient: { ...props.effect.gradient, colorStops } })
}

function updateGradient(patch: Partial<LayerStyleGradient>) {
  emit('update', { gradient: { ...props.effect.gradient, ...patch } })
}
</script>

<template>
  <div class="layer-style-controls layer-style-controls--scrollable">
    <h3>Sobreposição de gradiente</h3>
    <div class="layer-style-grid">
      <label>
        Cor inicial
        <input
          class="layer-style-color"
          :value="effect.gradient.colorStops[0]?.color ?? '#000000'"
          type="color"
          @input="updateGradientColor(0, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        Cor final
        <input
          class="layer-style-color"
          :value="effect.gradient.colorStops.at(-1)?.color ?? '#ffffff'"
          type="color"
          @input="updateGradientColor(1, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        Modo
        <select
          :value="effect.blendMode"
          @change="emit('update', { blendMode: ($event.target as HTMLSelectElement).value as GradientOverlayEffect['blendMode'] })"
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
        Tipo de gradiente
        <select
          :value="effect.gradient.type"
          @change="updateGradient({ type: ($event.target as HTMLSelectElement).value as LayerStyleGradient['type'] })"
        >
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
          <option value="angle">Angular</option>
          <option value="reflected">Refletido</option>
          <option value="diamond">Diamante</option>
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
      <label class="layer-style-preview-toggle">
        <input
          :checked="effect.reverse"
          type="checkbox"
          @change="emit('update', { reverse: ($event.target as HTMLInputElement).checked })"
        />
        <span>Inverter gradiente</span>
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

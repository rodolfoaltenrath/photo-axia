<script setup lang="ts">
import LayerStylePatternPicker from './LayerStylePatternPicker.vue'
import type { BevelEmbossEffect, LayerStyleGlobalLight, LayerStylePatternAsset } from '../../types/editor'

const props = defineProps<{
  effect: BevelEmbossEffect
  globalLight: LayerStyleGlobalLight
}>()

const emit = defineEmits<{
  (event: 'update', patch: Partial<BevelEmbossEffect>): void
  (event: 'update-angle', value: number): void
  (event: 'select-texture', asset: LayerStylePatternAsset): void
}>()

const displayAngle = () => props.effect.useGlobalLight ? props.globalLight.angle : props.effect.angle
</script>

<template>
  <div class="layer-style-controls layer-style-controls--scrollable">
    <h3>Bisel e entalhe</h3>
    <div class="layer-style-grid">
      <label>
        Estilo
        <select
          :value="effect.style"
          @change="emit('update', { style: ($event.target as HTMLSelectElement).value as BevelEmbossEffect['style'] })"
        >
          <option value="inner-bevel">Bisel interno</option>
          <option value="outer-bevel">Bisel externo</option>
          <option value="emboss">Entalhe</option>
          <option value="pillow-emboss">Entalhe em almofada</option>
        </select>
      </label>
      <label>
        Técnica
        <select
          :value="effect.technique"
          @change="emit('update', { technique: ($event.target as HTMLSelectElement).value as BevelEmbossEffect['technique'] })"
        >
          <option value="smooth">Suave</option>
          <option value="chisel-hard">Cinzel duro</option>
          <option value="chisel-soft">Cinzel suave</option>
        </select>
      </label>
      <label>
        Direção
        <select
          :value="effect.direction"
          @change="emit('update', { direction: ($event.target as HTMLSelectElement).value as BevelEmbossEffect['direction'] })"
        >
          <option value="up">Para cima</option>
          <option value="down">Para baixo</option>
        </select>
      </label>
      <label>
        Ângulo
        <span class="layer-style-number">
          <input
            :value="displayAngle()"
            max="180"
            min="-180"
            step="1"
            type="number"
            @input="emit('update-angle', Number(($event.target as HTMLInputElement).value))"
          />
          <span aria-hidden="true">°</span>
        </span>
      </label>
      <label>
        Altitude
        <span class="layer-style-number">
          <input
            :value="effect.altitude"
            max="90"
            min="0"
            step="1"
            type="number"
            @input="emit('update', { altitude: Number(($event.target as HTMLInputElement).value) })"
          />
          <span aria-hidden="true">°</span>
        </span>
      </label>
      <label class="layer-style-preview-toggle">
        <input
          :checked="effect.useGlobalLight"
          type="checkbox"
          @change="emit('update', { useGlobalLight: ($event.target as HTMLInputElement).checked })"
        />
        <span>Usar luz global</span>
      </label>
    </div>

    <div class="layer-style-slider-list">
      <label v-for="control in [
        { key: 'opacity', label: 'Opacidade', value: effect.opacity, max: 100, min: 0, suffix: '%' },
        { key: 'depth', label: 'Profundidade', value: effect.depth, max: 1000, min: 1, suffix: '%' },
        { key: 'size', label: 'Tamanho', value: effect.size, max: 250, min: 0, suffix: 'px' },
        { key: 'soften', label: 'Suavizar', value: effect.soften, max: 250, min: 0, suffix: 'px' }
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
      <span>Contorno de brilho</span>
      <select
        :value="effect.glossContour.preset"
        @change="emit('update', { glossContour: { ...effect.glossContour, preset: ($event.target as HTMLSelectElement).value as BevelEmbossEffect['glossContour']['preset'] } })"
      >
        <option value="linear">Linear</option>
        <option value="gaussian">Gaussiano</option>
        <option value="cone">Cone</option>
        <option value="inverted-cone">Cone invertido</option>
        <option value="ring">Anel</option>
      </select>
    </label>

    <h3>Realce</h3>
    <div class="layer-style-grid">
      <label>
        Cor
        <input
          class="layer-style-color"
          :value="effect.highlightColor"
          type="color"
          @input="emit('update', { highlightColor: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label>
        Modo
        <select
          :value="effect.highlightMode"
          @change="emit('update', { highlightMode: ($event.target as HTMLSelectElement).value as BevelEmbossEffect['highlightMode'] })"
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
      <span>Opacidade do realce</span>
      <input
        :value="effect.highlightOpacity"
        max="100"
        min="0"
        type="range"
        @input="emit('update', { highlightOpacity: Number(($event.target as HTMLInputElement).value) })"
      />
      <span class="layer-style-parameter-value">
        <input
          :value="effect.highlightOpacity"
          max="100"
          min="0"
          type="number"
          @input="emit('update', { highlightOpacity: Number(($event.target as HTMLInputElement).value) })"
        />
        <span aria-hidden="true">%</span>
      </span>
    </label>

    <h3>Sombra</h3>
    <div class="layer-style-grid">
      <label>
        Cor
        <input
          class="layer-style-color"
          :value="effect.shadowColor"
          type="color"
          @input="emit('update', { shadowColor: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label>
        Modo
        <select
          :value="effect.shadowMode"
          @change="emit('update', { shadowMode: ($event.target as HTMLSelectElement).value as BevelEmbossEffect['shadowMode'] })"
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
      <span>Opacidade da sombra</span>
      <input
        :value="effect.shadowOpacity"
        max="100"
        min="0"
        type="range"
        @input="emit('update', { shadowOpacity: Number(($event.target as HTMLInputElement).value) })"
      />
      <span class="layer-style-parameter-value">
        <input
          :value="effect.shadowOpacity"
          max="100"
          min="0"
          type="number"
          @input="emit('update', { shadowOpacity: Number(($event.target as HTMLInputElement).value) })"
        />
        <span aria-hidden="true">%</span>
      </span>
    </label>

    <label class="layer-style-preview-toggle">
      <input
        :checked="effect.contourEnabled"
        type="checkbox"
        @change="emit('update', { contourEnabled: ($event.target as HTMLInputElement).checked })"
      />
      <span>Contorno do efeito</span>
    </label>
    <template v-if="effect.contourEnabled">
      <label class="layer-style-contour">
        <span>Contorno</span>
        <select
          :value="effect.contour.preset"
          @change="emit('update', { contour: { ...effect.contour, preset: ($event.target as HTMLSelectElement).value as BevelEmbossEffect['contour']['preset'] } })"
        >
          <option value="linear">Linear</option>
          <option value="gaussian">Gaussiano</option>
          <option value="cone">Cone</option>
          <option value="inverted-cone">Cone invertido</option>
          <option value="ring">Anel</option>
        </select>
      </label>
      <label class="layer-style-parameter">
        <span>Alcance do contorno</span>
        <input
          :value="effect.contourRange"
          max="100"
          min="1"
          type="range"
          @input="emit('update', { contourRange: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="layer-style-parameter-value">
          <input
            :value="effect.contourRange"
            max="100"
            min="1"
            type="number"
            @input="emit('update', { contourRange: Number(($event.target as HTMLInputElement).value) })"
          />
          <span aria-hidden="true">%</span>
        </span>
      </label>
    </template>

    <h3>Textura</h3>
    <label class="layer-style-preview-toggle">
      <input
        :checked="effect.textureEnabled"
        type="checkbox"
        @change="emit('update', { textureEnabled: ($event.target as HTMLInputElement).checked })"
      />
      <span>Ativar textura</span>
    </label>
    <template v-if="effect.textureEnabled">
      <div class="layer-style-grid">
        <LayerStylePatternPicker :pattern="effect.texture" @select="(asset) => emit('select-texture', asset)" />
        <label class="layer-style-preview-toggle">
          <input
            :checked="effect.textureInvert"
            type="checkbox"
            @change="emit('update', { textureInvert: ($event.target as HTMLInputElement).checked })"
          />
          <span>Inverter textura</span>
        </label>
      </div>
      <div class="layer-style-slider-list">
        <label v-for="control in [
          { key: 'textureScale', label: 'Escala', value: effect.textureScale, max: 1000, min: 1, suffix: '%' },
          { key: 'textureDepth', label: 'Profundidade', value: effect.textureDepth, max: 1000, min: -1000, suffix: '%' }
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
    </template>
  </div>
</template>

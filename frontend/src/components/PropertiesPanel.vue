<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { EditorTool, LayerItem, TextLayerContent } from '../types/editor'

const props = defineProps<{
  activeLayer: LayerItem
  activeTool: EditorTool
  brushColor: string
  brushSize: number
  zoom: number
}>()

defineEmits<{
  (event: 'update:brushColor', value: string): void
  (event: 'update:brushSize', value: number): void
  (event: 'update:layerOpacity', value: number): void
  (event: 'update:text', patch: Partial<TextLayerContent>): void
  (event: 'update:zoom', value: number): void
}>()

const textInput = ref<HTMLTextAreaElement | null>(null)

watch(
  () => [props.activeLayer.id, props.activeTool],
  async () => {
    if (props.activeTool !== 'text' || props.activeLayer.kind !== 'text') return
    await nextTick()
    textInput.value?.focus()
    textInput.value?.select()
  }
)
</script>

<template>
  <section class="panel properties-panel">
    <div class="panel-title properties-panel-title">
      <h2>Propriedades</h2>
    </div>

    <div class="properties-scroll">
      <div class="property-summary">
        <span>Ferramenta</span>
        <strong class="property-summary-tool">{{ activeTool }}</strong>
        <span>Camada</span>
        <strong :title="activeLayer.name">{{ activeLayer.name }}</strong>
      </div>

      <label v-if="activeTool === 'brush' || activeTool === 'eraser'" class="compact-range">
        <span>Tamanho</span>
        <input
          :value="brushSize"
          max="128"
          min="1"
          type="range"
          @input="$emit('update:brushSize', Number(($event.target as HTMLInputElement).value))"
        />
      </label>

      <label v-if="activeTool === 'brush'" class="compact-range">
        <span>Cor</span>
        <input
          class="text-color-input"
          :value="brushColor"
          type="color"
          @input="$emit('update:brushColor', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label class="compact-range">
        <span>Opacidade</span>
        <input
          :value="activeLayer.opacity"
          max="100"
          min="0"
          type="range"
          @input="$emit('update:layerOpacity', Number(($event.target as HTMLInputElement).value))"
        />
      </label>

      <section v-if="activeLayer.kind === 'text' && activeLayer.text" class="property-section text-properties">
        <h3>Texto</h3>
        <label>
          Conteúdo
          <textarea
            ref="textInput"
            :value="activeLayer.text.content"
            rows="2"
            spellcheck="false"
            @input="$emit('update:text', { content: ($event.target as HTMLTextAreaElement).value })"
          ></textarea>
        </label>

        <label>
          Fonte
          <select
            :value="activeLayer.text.fontFamily"
            @change="$emit('update:text', { fontFamily: ($event.target as HTMLSelectElement).value })"
          >
            <option value="Arial, sans-serif">Arial</option>
            <option value="Verdana, sans-serif">Verdana</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="'Courier New', monospace">Courier New</option>
          </select>
        </label>

        <div class="property-grid">
          <label>
            Tamanho
            <input
              :value="activeLayer.text.fontSize"
              max="1000"
              min="1"
              type="number"
              @input="$emit('update:text', { fontSize: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label>
            Peso
            <select
              :value="activeLayer.text.fontWeight"
              @change="$emit('update:text', { fontWeight: Number(($event.target as HTMLSelectElement).value) })"
            >
              <option :value="300">Leve</option>
              <option :value="400">Normal</option>
              <option :value="600">Seminegrito</option>
              <option :value="700">Negrito</option>
            </select>
          </label>
        </div>

        <div class="property-grid">
          <label>
            Cor
            <input
              class="text-color-input"
              :value="activeLayer.text.color"
              type="color"
              @input="$emit('update:text', { color: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label>
            Entrelinha
            <input
              :value="activeLayer.text.lineHeight"
              max="3"
              min="0.6"
              step="0.05"
              type="number"
              @input="$emit('update:text', { lineHeight: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
        </div>

        <label>
          Alinhamento
          <select
            :value="activeLayer.text.alignment"
            @change="$emit('update:text', { alignment: ($event.target as HTMLSelectElement).value as TextLayerContent['alignment'] })"
          >
            <option value="left">Esquerda</option>
            <option value="center">Centro</option>
            <option value="right">Direita</option>
          </select>
        </label>
      </section>

      <section v-if="activeLayer.transform" class="property-section transform-properties">
        <h3>Transformação</h3>
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
      </section>

      <label class="compact-number">
        <span>Zoom</span>
        <input
          :value="zoom"
          max="3200"
          min="5"
          step="0.01"
          type="number"
          @input="$emit('update:zoom', Number(($event.target as HTMLInputElement).value))"
        />
      </label>
    </div>
  </section>
</template>

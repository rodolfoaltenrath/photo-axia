<script setup lang="ts">
import type { EditorTool, LayerItem, TextLayerContent } from '../types/editor'
import { layerKindHelp, layerKindLabel } from '../editor/layerPresentation'

const props = defineProps<{
  activeLayer: LayerItem
  activeTool: EditorTool
  activeTab: 'properties' | 'styles'
  zoom: number
}>()

const emit = defineEmits<{
  (event: 'update:activeTab', value: 'properties' | 'styles'): void
  (event: 'update:text', patch: Partial<TextLayerContent>): void
  (event: 'update:zoom', value: number): void
}>()

</script>

<template>
  <section class="panel properties-panel">
    <div class="panel-title properties-panel-title inspector-tabs" role="tablist" aria-label="Painel de edição">
      <button
        :aria-selected="activeTab === 'properties'"
        :class="{ 'inspector-tab--active': activeTab === 'properties' }"
        role="tab"
        type="button"
        @click="emit('update:activeTab', 'properties')"
      >Propriedades</button>
      <button
        :aria-selected="activeTab === 'styles'"
        :class="{ 'inspector-tab--active': activeTab === 'styles' }"
        role="tab"
        type="button"
        @click="emit('update:activeTab', 'styles')"
      >Estilos</button>
    </div>

    <div v-if="activeTab === 'properties'" class="properties-scroll" role="tabpanel">
      <div class="property-summary">
        <span>Ferramenta</span>
        <strong class="property-summary-tool">{{ activeTool === 'brush' ? 'Pincel' : activeTool === 'eraser' ? 'Borracha' : activeTool === 'shape' ? 'Forma' : activeTool }}</strong>
        <span>Camada</span>
        <strong :title="activeLayer.name">{{ activeLayer.name }}</strong>
        <span>Conteúdo</span>
        <strong :title="layerKindHelp(activeLayer)">{{ layerKindLabel(activeLayer) }}</strong>
      </div>

      <section v-if="activeLayer.kind === 'text' && activeLayer.text" class="property-section text-properties">
        <h3>Texto</h3>
        <label>
          Conteúdo
          <textarea
            :value="activeLayer.text.content"
            rows="2"
            spellcheck="false"
            @input="$emit('update:text', { content: ($event.target as HTMLTextAreaElement).value })"
          ></textarea>
        </label>

        <label>
          Tipo
          <select
            :value="activeLayer.text.layoutMode ?? 'point'"
            @change="$emit('update:text', { layoutMode: ($event.target as HTMLSelectElement).value as TextLayerContent['layoutMode'] })"
          >
            <option value="point">Texto pontual</option>
            <option value="paragraph">Texto de parágrafo</option>
          </select>
        </label>

        <label>
          Trajetória
          <select
            :value="activeLayer.text.pathMode ?? 'none'"
            @change="$emit('update:text', { pathMode: ($event.target as HTMLSelectElement).value as TextLayerContent['pathMode'] })"
          >
            <option value="none">Sem trajetória</option>
            <option value="ellipse">Elipse / círculo</option>
          </select>
          <small>O texto continua editável e acompanha a borda da elipse da própria camada.</small>
        </label>

        <label v-if="(activeLayer.text.layoutMode ?? 'point') === 'paragraph' && (activeLayer.text.pathMode ?? 'none') === 'none'">
          Largura do parágrafo
          <input
            :value="activeLayer.text.baseWidth"
            max="16384"
            min="1"
            type="number"
            @input="$emit('update:text', { baseWidth: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>

        <template v-if="(activeLayer.text.pathMode ?? 'none') === 'ellipse'">
          <div class="property-grid">
            <label>
              Largura da elipse
              <input
                :value="activeLayer.text.baseWidth"
                max="16384"
                min="1"
                type="number"
                @input="$emit('update:text', { baseWidth: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>
            <label>
              Altura da elipse
              <input
                :value="activeLayer.text.baseHeight"
                max="16384"
                min="1"
                type="number"
                @input="$emit('update:text', { baseHeight: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>
          </div>
          <label>
            Posição inicial (graus)
            <input
              :value="activeLayer.text.pathOffset ?? 0"
              max="360"
              min="-360"
              step="1"
              type="number"
              @input="$emit('update:text', { pathOffset: Number(($event.target as HTMLInputElement).value) })"
            />
            <small>0° fica no topo; valores positivos avançam no sentido horário.</small>
          </label>
        </template>

      </section>

      <section
        v-if="activeLayer.transform && activeTool !== 'brush' && activeTool !== 'eraser'"
        class="property-section transform-properties"
      >
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

    <div v-else class="properties-scroll styles-panel-scroll" role="tabpanel">
      <slot name="styles"></slot>
    </div>

  </section>
</template>

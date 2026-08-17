<script setup lang="ts">
import { formatZoom } from '../../editor/viewport'
import type { RulerUnit } from '../../editor/guides'
import type { SelectionMode } from '../../editor/selection'
import type { DocumentSpec, EditorTool } from '../../types/editor'

defineProps<{
  activeTool: EditorTool
  autoSelectLayer: boolean
  brushSize: number
  document: DocumentSpec
  guideCount: number
  guideSnappingEnabled: boolean
  guidesLocked: boolean
  guidesVisible: boolean
  hasSelection: boolean
  isTransforming: boolean
  isViewportReady: boolean
  magicWandContiguous: boolean
  magicWandTolerance: number
  rotation: number
  rulerUnit: RulerUnit
  rulersVisible: boolean
  selectionMode: SelectionMode
  visualZoom: number
  captureRotationOutput: (element: unknown) => void
}>()

const emit = defineEmits<{
  (event: 'cancelTransform'): void
  (event: 'clearGuides'): void
  (event: 'clearSelection'): void
  (event: 'commitTransform'): void
  (event: 'deleteSelection'): void
  (event: 'fitDocument'): void
  (event: 'updateAutoSelectLayer', enabled: boolean): void
  (event: 'updateGuideSnappingEnabled', enabled: boolean): void
  (event: 'updateGuidesLocked', enabled: boolean): void
  (event: 'updateGuidesVisible', enabled: boolean): void
  (event: 'updateMagicWandContiguous', enabled: boolean): void
  (event: 'updateMagicWandTolerance', tolerance: number): void
  (event: 'updateRulerUnit', unit: RulerUnit): void
  (event: 'updateRulersVisible', enabled: boolean): void
  (event: 'updateSelectionMode', mode: SelectionMode): void
  (event: 'zoomIn'): void
  (event: 'zoomOut'): void
}>()
</script>

<template>
  <div class="context-bar">
    <span>{{ activeTool }}</span>
    <div v-if="activeTool === 'crop'" class="selection-options">
      <label>
        Modo
        <select
          :value="selectionMode"
          @change="emit('updateSelectionMode', ($event.target as HTMLSelectElement).value as SelectionMode)"
        >
          <option value="rectangle">Retângulo</option>
          <option value="ellipse">Elipse</option>
          <option value="lasso">Laço livre</option>
          <option value="magic-wand">Varinha mágica</option>
        </select>
      </label>
      <label v-if="selectionMode === 'magic-wand'" class="selection-tolerance">
        Tolerância
        <input
          :value="magicWandTolerance"
          max="255"
          min="0"
          type="range"
          @input="emit('updateMagicWandTolerance', Number(($event.target as HTMLInputElement).value))"
        />
        <output>{{ magicWandTolerance }}</output>
      </label>
      <label v-if="selectionMode === 'magic-wand'" class="selection-contiguous">
        <input
          :checked="magicWandContiguous"
          type="checkbox"
          @change="emit('updateMagicWandContiguous', ($event.target as HTMLInputElement).checked)"
        />
        Contíguo
      </label>
      <button :disabled="!hasSelection" type="button" title="Apagar pixels selecionados (Delete)" @click="emit('deleteSelection')">
        Apagar
      </button>
      <button :disabled="!hasSelection" type="button" title="Desmarcar (Ctrl+D)" @click="emit('clearSelection')">
        Desmarcar
      </button>
    </div>
    <span v-if="activeTool === 'move' && hasSelection" class="selection-move-hint">
      Arraste dentro da seleção para mover os pixels · Ctrl+D move a camada inteira
    </span>
    <label
      v-else-if="activeTool === 'move'"
      class="auto-select-control"
      title="Ao desativar, clicar no documento mantém e move a camada selecionada"
    >
      <input
        :checked="autoSelectLayer"
        type="checkbox"
        @change="emit('updateAutoSelectLayer', ($event.target as HTMLInputElement).checked)"
      />
      <span>Seleção automática</span>
    </label>
    <span v-if="activeTool === 'brush' || activeTool === 'eraser'">{{ brushSize }} px</span>
    <span>{{ document.width }} × {{ document.height }}</span>
    <span>{{ document.unit === 'px' ? 'pixels' : `${document.physicalWidth} × ${document.physicalHeight} ${document.unit}` }}</span>
    <span>{{ isViewportReady ? `${formatZoom(visualZoom)}%` : '—' }}</span>
    <details class="guide-settings-menu">
      <summary title="Configurar réguas e guias">Réguas</summary>
      <div class="guide-settings-popover">
        <label>
          <input
            :checked="rulersVisible"
            type="checkbox"
            @change="emit('updateRulersVisible', ($event.target as HTMLInputElement).checked)"
          />
          Mostrar réguas <kbd>Ctrl+R</kbd>
        </label>
        <label>
          <input
            :checked="guidesVisible"
            type="checkbox"
            @change="emit('updateGuidesVisible', ($event.target as HTMLInputElement).checked)"
          />
          Mostrar guias <kbd>Ctrl+;</kbd>
        </label>
        <label>
          <input
            :checked="guideSnappingEnabled"
            type="checkbox"
            @change="emit('updateGuideSnappingEnabled', ($event.target as HTMLInputElement).checked)"
          />
          Encaixar nas guias
        </label>
        <label>
          <input
            :checked="guidesLocked"
            type="checkbox"
            @change="emit('updateGuidesLocked', ($event.target as HTMLInputElement).checked)"
          />
          Bloquear guias
        </label>
        <label class="ruler-unit-control">
          Unidade
          <select :value="rulerUnit" @change="emit('updateRulerUnit', ($event.target as HTMLSelectElement).value as RulerUnit)">
            <option value="px">Pixels</option>
            <option value="cm">Centímetros</option>
            <option value="mm">Milímetros</option>
            <option value="in">Polegadas</option>
          </select>
        </label>
        <button :disabled="!guideCount" type="button" @click="emit('clearGuides')">Limpar guias</button>
      </div>
    </details>
    <div v-if="isTransforming" class="zoom-actions transform-actions">
      <span :ref="captureRotationOutput">{{ rotation }}°</span>
      <button type="button" title="Cancelar transformação (Esc)" @click="emit('cancelTransform')">Cancelar</button>
      <button type="button" title="Aplicar transformação (Enter)" @click="emit('commitTransform')">Aplicar</button>
    </div>
    <div v-else class="zoom-actions">
      <button type="button" title="Reduzir zoom (Ctrl+-)" @click="emit('zoomOut')">−</button>
      <button type="button" title="Ajustar à tela (Ctrl+0)" @click="emit('fitDocument')">Ajustar</button>
      <button type="button" title="Aumentar zoom (Ctrl++)" @click="emit('zoomIn')">+</button>
    </div>
  </div>
</template>

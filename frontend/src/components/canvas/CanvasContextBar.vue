<script setup lang="ts">
import { formatZoom } from '../../editor/viewport'
import type { RulerUnit } from '../../editor/guides'
import type { SelectionMode } from '../../editor/selection'
import type { SelectionCombineMode } from '../../editor/selectionCombine'
import type { GradientType } from '../../editor/gradient'
import type { DocumentSpec, EditorTool } from '../../types/editor'

defineProps<{
  activeTool: EditorTool
  autoSelectLayer: boolean
  brushSize: number
  document: DocumentSpec
  guideCount: number
  gradientReversed: boolean
  gradientType: GradientType
  guideSnappingEnabled: boolean
  guidesLocked: boolean
  guidesVisible: boolean
  hasSelection: boolean
  isTransforming: boolean
  isViewportReady: boolean
  magicWandContiguous: boolean
  magicWandTolerance: number
  paintBucketContiguous: boolean
  paintBucketTolerance: number
  rotation: number
  rulerUnit: RulerUnit
  rulersVisible: boolean
  selectionMode: SelectionMode
  selectionCombineMode: SelectionCombineMode
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
  (event: 'updateGradientReversed', reversed: boolean): void
  (event: 'updateGradientType', type: GradientType): void
  (event: 'updateGuidesLocked', enabled: boolean): void
  (event: 'updateGuidesVisible', enabled: boolean): void
  (event: 'updateMagicWandContiguous', enabled: boolean): void
  (event: 'updateMagicWandTolerance', tolerance: number): void
  (event: 'updatePaintBucketContiguous', enabled: boolean): void
  (event: 'updatePaintBucketTolerance', tolerance: number): void
  (event: 'updateRulerUnit', unit: RulerUnit): void
  (event: 'updateRulersVisible', enabled: boolean): void
  (event: 'updateSelectionMode', mode: SelectionMode): void
  (event: 'updateSelectionCombineMode', mode: SelectionCombineMode): void
  (event: 'zoomIn'): void
  (event: 'zoomOut'): void
}>()
</script>

<template>
  <div class="context-bar">
    <span>{{ activeTool }}</span>
    <div v-if="activeTool === 'crop'" class="selection-options">
      <div
        v-if="selectionMode !== 'magic-wand'"
        class="selection-combine-control"
        role="group"
        aria-label="Combinação da seleção"
      >
        <button
          :aria-pressed="selectionCombineMode === 'replace'"
          type="button"
          title="Nova seleção"
          aria-label="Nova seleção"
          @click="emit('updateSelectionCombineMode', 'replace')"
        ><span class="selection-combine-icon selection-combine-icon--replace"></span></button>
        <button
          :aria-pressed="selectionCombineMode === 'add'"
          type="button"
          title="Adicionar à seleção"
          aria-label="Adicionar à seleção"
          @click="emit('updateSelectionCombineMode', 'add')"
        ><span class="selection-combine-icon selection-combine-icon--add">+</span></button>
        <button
          :aria-pressed="selectionCombineMode === 'subtract'"
          type="button"
          title="Subtrair da seleção"
          aria-label="Subtrair da seleção"
          @click="emit('updateSelectionCombineMode', 'subtract')"
        ><span class="selection-combine-icon selection-combine-icon--subtract">−</span></button>
        <button
          :aria-pressed="selectionCombineMode === 'intersect'"
          type="button"
          title="Interseccionar com a seleção"
          aria-label="Interseccionar com a seleção"
          @click="emit('updateSelectionCombineMode', 'intersect')"
        ><span class="selection-combine-icon selection-combine-icon--intersect"></span></button>
      </div>
      <label>
        Modo
        <select
          :value="selectionMode"
          @change="emit('updateSelectionMode', ($event.target as HTMLSelectElement).value as SelectionMode)"
        >
          <optgroup label="Marquee">
            <option value="rectangle">Retangular</option>
            <option value="ellipse">Elíptica</option>
          </optgroup>
          <optgroup label="Compatibilidade">
            <option value="lasso">Laço livre</option>
            <option value="magic-wand">Varinha mágica</option>
          </optgroup>
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
    <div v-if="activeTool === 'gradient'" class="gradient-options">
      <div class="gradient-mode-control" role="group" aria-label="Tipo de degradê">
        <button
          :class="{ active: gradientType === 'linear' }"
          :aria-pressed="gradientType === 'linear'"
          type="button"
          @click="emit('updateGradientType', 'linear')"
        >Linear</button>
        <button
          :class="{ active: gradientType === 'radial' }"
          :aria-pressed="gradientType === 'radial'"
          type="button"
          @click="emit('updateGradientType', 'radial')"
        >Radial</button>
      </div>
      <button
        class="gradient-reverse-button"
        type="button"
        :aria-pressed="gradientReversed"
        title="Inverter sentido das cores"
        aria-label="Inverter sentido das cores do degradê"
        @click="emit('updateGradientReversed', !gradientReversed)"
      >
        ↔
      </button>
    </div>
    <div v-if="activeTool === 'paint-bucket'" class="selection-options">
      <label class="selection-tolerance">
        Tolerância
        <input
          :value="paintBucketTolerance"
          max="255"
          min="0"
          type="range"
          @input="emit('updatePaintBucketTolerance', Number(($event.target as HTMLInputElement).value))"
        />
        <output>{{ paintBucketTolerance }}</output>
      </label>
      <label class="selection-contiguous">
        <input
          :checked="paintBucketContiguous"
          type="checkbox"
          @change="emit('updatePaintBucketContiguous', ($event.target as HTMLInputElement).checked)"
        />
        Contíguo
      </label>
      <span>Esquerdo: principal · Direito: secundária</span>
    </div>
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

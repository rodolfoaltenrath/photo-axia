<script setup lang="ts">
import { ref, watch } from 'vue'
import GradientStopsEditor from '../GradientStopsEditor.vue'
import { formatZoom } from '../../editor/viewport'
import { MAX_BRUSH_SIZE, normalizeBrushSize } from '../../editor/brush'
import type { RulerUnit } from '../../editor/guides'
import type { SelectionMode } from '../../editor/selection'
import type { SelectionCombineMode } from '../../editor/selectionCombine'
import type { GradientStopsConfig } from '../../editor/gradient'
import { normalizeShapeConfig, type ShapeToolConfig } from '../../editor/shape'
import { gradientStripBackground } from '../../editor/gradientEditor'
import type { DocumentSpec, EditorTool, TextLayerContent } from '../../types/editor'

const props = defineProps<{
  activeTool: EditorTool
  autoSelectLayer: boolean
  brushColor: string
  brushSize: number
  document: DocumentSpec
  guideCount: number
  gradientConfig: GradientStopsConfig
  shapeConfig: ShapeToolConfig
  shapeEditing: boolean
  guideSnappingEnabled: boolean
  smartGuidesEnabled: boolean
  guidesLocked: boolean
  guidesVisible: boolean
  hasSelection: boolean
  isTransforming: boolean
  isViewportReady: boolean
  magicWandContiguous: boolean
  magicWandTolerance: number
  quickSelectionColorTolerance: number
  quickSelectionEdgeTolerance: number
  paintBucketContiguous: boolean
  paintBucketTolerance: number
  rotation: number
  rulerUnit: RulerUnit
  rulersVisible: boolean
  selectionMode: SelectionMode
  selectionCombineMode: SelectionCombineMode
  text?: TextLayerContent
  visualZoom: number
  captureRotationOutput: (element: unknown) => void
}>()

const emit = defineEmits<{
  (event: 'cancelTransform'): void
  (event: 'cancelShape'): void
  (event: 'clearGuides'): void
  (event: 'clearSelection'): void
  (event: 'commitTransform'): void
  (event: 'commitShape'): void
  (event: 'deleteSelection'): void
  (event: 'fitDocument'): void
  (event: 'updateAutoSelectLayer', enabled: boolean): void
  (event: 'updateBrushColor', color: string): void
  (event: 'updateBrushSize', size: number): void
  (event: 'updateGuideSnappingEnabled', enabled: boolean): void
  (event: 'updateSmartGuidesEnabled', enabled: boolean): void
  (event: 'updateGradientConfig', config: GradientStopsConfig): void
  (event: 'updateShapeConfig', config: ShapeToolConfig): void
  (event: 'updateGuidesLocked', enabled: boolean): void
  (event: 'updateGuidesVisible', enabled: boolean): void
  (event: 'updateMagicWandContiguous', enabled: boolean): void
  (event: 'updateMagicWandTolerance', tolerance: number): void
  (event: 'updateQuickSelectionColorTolerance', tolerance: number): void
  (event: 'updateQuickSelectionEdgeTolerance', tolerance: number): void
  (event: 'updatePaintBucketContiguous', enabled: boolean): void
  (event: 'updatePaintBucketTolerance', tolerance: number): void
  (event: 'updateRulerUnit', unit: RulerUnit): void
  (event: 'updateRulersVisible', enabled: boolean): void
  (event: 'updateSelectionMode', mode: SelectionMode): void
  (event: 'updateSelectionCombineMode', mode: SelectionCombineMode): void
  (event: 'updateText', patch: Partial<TextLayerContent>): void
  (event: 'zoomIn'): void
  (event: 'zoomOut'): void
}>()

function updateBrushSize(value: number) {
  emit('updateBrushSize', normalizeBrushSize(value))
}

function updateShapeConfig(patch: Partial<ShapeToolConfig>) {
  emit('updateShapeConfig', normalizeShapeConfig({ ...props.shapeConfig, ...patch }))
}

function toggleTextWeight() {
  if (!props.text) return
  emit('updateText', { fontWeight: props.text.fontWeight >= 600 ? 400 : 700 })
}

const gradientEditorOpen = ref(false)
const toolLabels: Record<EditorTool, string> = {
  move: 'Mover',
  brush: 'Pincel',
  eraser: 'Borracha',
  gradient: 'Degradê',
  'paint-bucket': 'Balde de Tinta',
  shape: 'Forma',
  eyedropper: 'Conta-gotas',
  crop: 'Seleção',
  'object-selection': 'Seleção de Objeto',
  'quick-selection': 'Seleção Rápida',
  'magic-wand': 'Varinha Mágica',
  text: 'Texto',
  hand: 'Mão',
  zoom: 'Zoom'
}
watch(() => props.activeTool, (tool) => {
  if (tool !== 'gradient') gradientEditorOpen.value = false
})
</script>

<template>
  <div class="context-bar">
    <span class="context-bar-tool-label" :title="toolLabels[activeTool]">{{ toolLabels[activeTool] }}</span>
    <div v-if="activeTool === 'crop' || activeTool === 'magic-wand' || activeTool === 'quick-selection'" class="selection-options">
      <div
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
      <label v-if="activeTool === 'crop'">
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
          </optgroup>
        </select>
      </label>
      <label v-if="activeTool === 'magic-wand'" class="selection-tolerance">
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
      <label v-if="activeTool === 'magic-wand'" class="selection-contiguous">
        <input
          :checked="magicWandContiguous"
          type="checkbox"
          @change="emit('updateMagicWandContiguous', ($event.target as HTMLInputElement).checked)"
        />
        Contíguo
      </label>
      <label v-if="activeTool === 'quick-selection'" class="selection-tolerance" title="Quanto a cor pode variar a partir das sementes">
        Cor
        <input
          :value="quickSelectionColorTolerance"
          max="255"
          min="0"
          type="range"
          @input="emit('updateQuickSelectionColorTolerance', Number(($event.target as HTMLInputElement).value))"
        />
        <output>{{ quickSelectionColorTolerance }}</output>
      </label>
      <label v-if="activeTool === 'quick-selection'" class="selection-tolerance" title="Contraste local necessário para interromper o crescimento">
        Borda
        <input
          :value="quickSelectionEdgeTolerance"
          max="255"
          min="0"
          type="range"
          @input="emit('updateQuickSelectionEdgeTolerance', Number(($event.target as HTMLInputElement).value))"
        />
        <output>{{ quickSelectionEdgeTolerance }}</output>
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
      title="Ao desativar, o clique normal mantém a camada atual; use Ctrl+clique para escolher temporariamente outra camada"
    >
      <input
        :checked="autoSelectLayer"
        type="checkbox"
        @change="emit('updateAutoSelectLayer', ($event.target as HTMLInputElement).checked)"
      />
      <span>Seleção automática</span>
    </label>
    <div v-if="activeTool === 'text' && text" class="text-context-options" aria-label="Controles de texto">
      <label>
        <span>Fonte</span>
        <select
          :value="text.fontFamily"
          aria-label="Fonte"
          @change="emit('updateText', { fontFamily: ($event.target as HTMLSelectElement).value })"
        >
          <option value="Arial, sans-serif">Arial</option>
          <option value="Helvetica, Arial, sans-serif">Helvetica</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Courier New', monospace">Courier New</option>
          <option value="system-ui, sans-serif">Sistema</option>
        </select>
      </label>
      <label>
        <span>Tamanho</span>
        <input
          :value="text.fontSize"
          aria-label="Tamanho do texto em pixels"
          max="1000"
          min="1"
          type="number"
          @input="emit('updateText', { fontSize: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label>
        <span>Entrelinha</span>
        <input
          :value="text.lineHeight"
          aria-label="Entrelinha"
          max="3"
          min="0.6"
          step="0.05"
          type="number"
          @input="emit('updateText', { lineHeight: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label class="text-context-color">
        <span>Cor</span>
        <input
          :value="text.color"
          aria-label="Cor do texto"
          type="color"
          @input="emit('updateText', { color: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <div class="text-context-toggle-group" role="group" aria-label="Estilo do texto">
        <button
          :aria-pressed="text.fontWeight >= 600"
          type="button"
          title="Negrito"
          @click="toggleTextWeight"
        ><strong>B</strong></button>
        <button
          :aria-pressed="text.fontStyle === 'italic'"
          type="button"
          title="Itálico"
          @click="emit('updateText', { fontStyle: text.fontStyle === 'italic' ? 'normal' : 'italic' })"
        ><em>I</em></button>
      </div>
      <div class="text-context-toggle-group" role="group" aria-label="Alinhamento do texto">
        <button
          class="text-align-left"
          :aria-pressed="text.alignment === 'left'"
          type="button"
          title="Alinhar à esquerda"
          @click="emit('updateText', { alignment: 'left' })"
        >≡</button>
        <button
          class="text-align-center"
          :aria-pressed="text.alignment === 'center'"
          type="button"
          title="Centralizar"
          @click="emit('updateText', { alignment: 'center' })"
        >≡</button>
        <button
          class="text-align-right"
          :aria-pressed="text.alignment === 'right'"
          type="button"
          title="Alinhar à direita"
          @click="emit('updateText', { alignment: 'right' })"
        >≡</button>
      </div>
    </div>
    <div v-if="activeTool === 'brush' || activeTool === 'eraser'" class="brush-context-options">
      <label class="brush-size-control">
        <span>Tamanho</span>
        <input
          :value="brushSize"
          aria-label="Tamanho do pincel em pixels"
          :max="MAX_BRUSH_SIZE"
          min="1"
          type="range"
          @input="updateBrushSize(Number(($event.target as HTMLInputElement).value))"
        />
        <input
          :value="brushSize"
          aria-label="Tamanho do pincel"
          :max="MAX_BRUSH_SIZE"
          min="1"
          type="number"
          @input="updateBrushSize(Number(($event.target as HTMLInputElement).value))"
        />
        <span>px</span>
      </label>
      <label v-if="activeTool === 'brush'" class="brush-color-control">
        <span>Cor</span>
        <input
          :value="brushColor"
          aria-label="Cor do pincel"
          type="color"
          @input="emit('updateBrushColor', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <span v-else class="brush-context-hint">Apaga para transparência</span>
    </div>
    <div v-if="activeTool === 'shape'" class="shape-context-options">
      <label class="brush-color-control">
        <span>Cor</span>
        <input
          :value="shapeConfig.color"
          aria-label="Cor da forma"
          type="color"
          @input="updateShapeConfig({ color: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label v-if="shapeConfig.kind !== 'ellipse'">
        <span>Arredondamento</span>
        <input
          :value="shapeConfig.cornerRadius"
          min="0"
          max="8192"
          type="number"
          @input="updateShapeConfig({ cornerRadius: Number(($event.target as HTMLInputElement).value) })"
        />
        <span>px</span>
      </label>
      <label v-if="shapeConfig.kind === 'ellipse'" title="0% cria uma elipse; valores maiores aproximam a forma de um quadrado arredondado">
        <span>Quadratura</span>
        <input
          :value="shapeConfig.squareness"
          min="0"
          max="100"
          type="range"
          @input="updateShapeConfig({ squareness: Number(($event.target as HTMLInputElement).value) })"
        />
        <output>{{ shapeConfig.squareness }}%</output>
      </label>
      <template v-if="shapeConfig.kind === 'star'">
        <label>
          <span>Pontas</span>
          <input
            :value="shapeConfig.starPoints"
            min="3"
            max="32"
            type="number"
            @input="updateShapeConfig({ starPoints: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label title="Controla o tamanho da parte interna da estrela">
          <span>Profundidade</span>
          <input
            :value="shapeConfig.starInnerRatio"
            min="5"
            max="95"
            type="range"
            @input="updateShapeConfig({ starInnerRatio: Number(($event.target as HTMLInputElement).value) })"
          />
          <output>{{ shapeConfig.starInnerRatio }}%</output>
        </label>
      </template>
      <span class="brush-context-hint">Shift: proporção igual · Alt: pelo centro · Enter: confirmar · Esc: cancelar</span>
      <div v-if="shapeEditing" class="shape-confirm-actions" role="group" aria-label="Confirmar ou cancelar forma">
        <button type="button" title="Cancelar forma (Esc)" @click="emit('cancelShape')">Cancelar</button>
        <button class="primary-button" type="button" title="Confirmar forma (Enter)" @click="emit('commitShape')">Confirmar</button>
      </div>
    </div>
    <div v-if="activeTool === 'gradient'" class="gradient-options">
      <div class="gradient-editor-control">
        <button
          class="gradient-editor-trigger"
          type="button"
          :aria-expanded="gradientEditorOpen"
          aria-haspopup="dialog"
          @click="gradientEditorOpen = !gradientEditorOpen"
        >
          <span class="gradient-editor-trigger-checker">
            <span :style="{ backgroundImage: gradientStripBackground(gradientConfig) }"></span>
          </span>
          Editar degradê
        </button>
        <GradientStopsEditor
          v-if="gradientEditorOpen"
          :config="gradientConfig"
          @close="gradientEditorOpen = false"
          @update:config="emit('updateGradientConfig', $event)"
        />
      </div>
      <div class="gradient-mode-control" role="group" aria-label="Tipo de degradê">
        <button
          :class="{ active: gradientConfig.type === 'linear' }"
          :aria-pressed="gradientConfig.type === 'linear'"
          type="button"
          @click="emit('updateGradientConfig', { ...gradientConfig, type: 'linear' })"
        >Linear</button>
        <button
          :class="{ active: gradientConfig.type === 'radial' }"
          :aria-pressed="gradientConfig.type === 'radial'"
          type="button"
          @click="emit('updateGradientConfig', { ...gradientConfig, type: 'radial' })"
        >Radial</button>
      </div>
      <button
        class="gradient-reverse-button"
        type="button"
        :aria-pressed="gradientConfig.reversed"
        title="Inverter sentido das cores"
        aria-label="Inverter sentido das cores do degradê"
        @click="emit('updateGradientConfig', { ...gradientConfig, reversed: !gradientConfig.reversed })"
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
            :checked="smartGuidesEnabled"
            type="checkbox"
            @change="emit('updateSmartGuidesEnabled', ($event.target as HTMLInputElement).checked)"
          />
          Guias inteligentes
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

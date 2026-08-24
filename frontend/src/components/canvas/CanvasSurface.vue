<script setup lang="ts">
import CanvasLayer from '../CanvasLayer.vue'
import CanvasRulers from '../CanvasRulers.vue'
import GuideOverlay from '../GuideOverlay.vue'
import SelectionOverlay from '../SelectionOverlay.vue'
import { layerCompositingStyle } from '../../editor/blendModes'
import { RULER_SIZE } from '../../editor/guides'
import { TRANSFORM_HANDLES } from '../../editor/freeTransform'
import type { CanvasSurfaceActions, CanvasSurfaceView } from './canvas.types'

defineProps<{ actions: CanvasSurfaceActions; view: CanvasSurfaceView }>()
</script>

<template>
  <div class="canvas-workspace" :style="{ '--ruler-size': view.rulersVisible ? `${RULER_SIZE}px` : '0px' }">
    <CanvasRulers
      v-if="view.rulersVisible"
      :ref="actions.captureCanvasRulers"
      :document-height="view.documentHeight"
      :document-offset-x="view.documentOffsetX"
      :document-offset-y="view.documentOffsetY"
      :document-width="view.documentWidth"
      :origin="view.origin"
      :resolution-dpi="view.documentResolutionDpi"
      :scale="view.scale"
      :size="RULER_SIZE"
      :unit="view.rulerUnit"
      :viewport-height="view.viewportHeight"
      :viewport-width="view.viewportWidth"
      @reset-origin="actions.resetRulerOrigin"
      @start-guide="actions.startGuideCreation"
      @start-origin="actions.startRulerOrigin"
    />
    <div class="canvas-viewport-main">
      <div
        :ref="actions.captureScrollArea"
        class="canvas-scroll"
        :class="view.viewportCursorClass"
        tabindex="0"
        @auxclick.prevent
        @lostpointercapture="actions.handleLostPointerCapture"
        @pointercancel="actions.stopPointer"
        @pointerdown.capture="actions.startViewportPointer"
        @pointerleave="actions.clearRulerPointer"
        @pointermove="actions.updatePointer"
        @pointerup="actions.stopPointer"
        @scroll.passive="actions.handleNativeScroll"
      >
        <div class="canvas-pasteboard" :style="view.pasteboardStyle">
          <div class="canvas-frame" :style="view.frameStyle">
            <div :ref="actions.captureSurface" class="canvas-surface" :style="view.surfaceStyle">
    <div class="transparent-grid"></div>
    <div class="document-composite">
      <div class="document-background" :style="view.backgroundStyle"></div>
      <div class="document-layers">
        <div
          v-for="layer in view.layers"
          :key="layer.id"
          class="document-layer-composite"
          :style="layerCompositingStyle(layer.blendMode, layer.opacity)"
        >
          <CanvasLayer
            :active="layer.id === view.activeLayerId"
            :content-hidden="actions.selectionMoveHidesLayer(layer.id) || actions.brushPreviewHidesLayer(layer.id)"
            grouped
            :layer="layer"
            :layer-style-global-light="view.layerStyleGlobalLight"
            :transform="actions.displayTransform(layer) ?? view.defaultLayerTransform"
            @image-error="actions.handleLayerImageError"
            @image-loaded="actions.handleLayerImageLoaded"
            @pointerdown="actions.startLayerPointer($event, layer)"
          />
          <canvas
            v-if="view.brushPreviewStyle && view.activeBrushOperation === 'paint' && view.paintableLayerId === layer.id"
            :ref="actions.captureBrushPreviewCanvas"
            class="brush-preview"
            :style="view.brushPreviewStyle"
            :width="view.brushPreviewDimensions.width"
            :height="view.brushPreviewDimensions.height"
          ></canvas>
          <canvas
            v-if="view.brushPreviewStyle && view.activeBrushOperation === 'erase' && view.paintableLayerId === layer.id"
            :ref="actions.captureBrushPreviewCanvas"
            class="brush-preview brush-preview--eraser"
            :style="view.brushPreviewStyle"
            :width="view.brushPreviewDimensions.width"
            :height="view.brushPreviewDimensions.height"
          ></canvas>
          <canvas
            v-if="view.gradientPreviewStyle && view.gradientInteraction?.layerId === layer.id"
            :ref="actions.captureGradientPreviewCanvas"
            class="gradient-preview"
            :style="view.gradientPreviewStyle"
            :width="view.gradientPreviewDimensions.width"
            :height="view.gradientPreviewDimensions.height"
          ></canvas>
          <canvas
            v-if="view.selectionMovePreviewStyle && view.selectionMoveInteraction?.layerId === layer.id"
            :ref="actions.captureSelectionMoveCanvas"
            class="selection-move-preview"
            :style="view.selectionMovePreviewStyle"
            :width="view.selectionMoveInteraction.previewWidth"
            :height="view.selectionMoveInteraction.previewHeight"
          ></canvas>
        </div>
      </div>
    </div>
    <SelectionOverlay
      v-if="view.selection"
      :document-height="view.documentHeight"
      :document-width="view.documentWidth"
      :selection="view.selection"
    />
    <svg
      v-if="view.gradientInteraction"
      class="gradient-controls"
      :viewBox="`0 0 ${view.documentWidth} ${view.documentHeight}`"
      :style="{
        '--gradient-start-color': view.gradientInteraction.config.reversed
          ? view.gradientInteraction.config.backgroundColor
          : view.gradientInteraction.config.foregroundColor,
        '--gradient-end-color': view.gradientInteraction.config.reversed
          ? view.gradientInteraction.config.foregroundColor
          : view.gradientInteraction.config.backgroundColor
      }"
      aria-hidden="true"
    >
      <line
        class="gradient-controls-line"
        :x1="view.gradientInteraction.geometry.start.x"
        :y1="view.gradientInteraction.geometry.start.y"
        :x2="view.gradientInteraction.geometry.end.x"
        :y2="view.gradientInteraction.geometry.end.y"
        :stroke-width="1.5 / Math.max(0.01, view.scale)"
      />
      <circle
        class="gradient-control gradient-control--start"
        :cx="view.gradientInteraction.geometry.start.x"
        :cy="view.gradientInteraction.geometry.start.y"
        :r="5 / Math.max(0.01, view.scale)"
        :stroke-width="1.5 / Math.max(0.01, view.scale)"
      />
      <circle
        class="gradient-control gradient-control--end"
        :cx="view.gradientInteraction.geometry.end.x"
        :cy="view.gradientInteraction.geometry.end.y"
        :r="5 / Math.max(0.01, view.scale)"
        :stroke-width="1.5 / Math.max(0.01, view.scale)"
      />
    </svg>
    <div
      v-if="view.freeTransformStyle"
      :ref="actions.captureFreeTransformBox"
      class="free-transform-box"
      :style="view.freeTransformStyle"
      @dblclick.stop="actions.commitFreeTransform"
    >
      <div
        class="free-transform-body"
        title="Arraste para mover"
        @pointerdown="actions.startTransformMove"
      ></div>
      <div class="free-transform-origin" aria-hidden="true"></div>
      <div class="free-transform-rotate-stem" aria-hidden="true"></div>
      <button
        class="free-transform-rotate"
        type="button"
        title="Girar; segure Shift para passos de 15°"
        aria-label="Girar camada"
        @pointerdown="actions.startTransformRotate"
      >
        <svg class="free-transform-rotate-icon" aria-hidden="true" viewBox="0 0 24 24">
          <path class="free-transform-rotate-icon-outline" d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />
          <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />
        </svg>
      </button>
      <button
        v-for="handle in TRANSFORM_HANDLES"
        :key="handle.id"
        class="free-transform-handle"
        :style="{ left: `${handle.left}%`, top: `${handle.top}%`, cursor: handle.cursor }"
        type="button"
        :aria-label="`Redimensionar por ${handle.id}`"
        title="Arraste para redimensionar; Alt usa o centro; Shift libera a proporção"
        @pointerdown="actions.startTransformResize($event, handle)"
      ></button>
    </div>
            </div>
          </div>
        </div>
      </div>
      <GuideOverlay
        :ref="actions.captureGuideOverlay"
        :document-offset-x="view.documentOffsetX"
        :document-offset-y="view.documentOffsetY"
        :draft-guide="view.draftGuide"
        :guides="view.guides"
        :interactive="view.guidesInteractive"
        :origin="view.origin"
        :resolution-dpi="view.documentResolutionDpi"
        :scale="view.scale"
        :selected-guide-id="view.selectedGuideId"
        :snapped-x="view.snappedX"
        :snapped-y="view.snappedY"
        :unit="view.rulerUnit"
        :visible="view.guidesVisible"
        @start-move="actions.startGuideMove"
      />
    </div>
  </div>
</template>

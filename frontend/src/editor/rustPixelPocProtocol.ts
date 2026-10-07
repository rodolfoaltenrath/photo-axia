// Experimental Worker protocol; WASM ABI is separate.
import type { RustPixelPocBatchPlan } from './rustPixelPocBatch.ts'
import type { RustPixelPocAlphaMask } from './rustPixelPocAlphaMask.ts'
import type { RustPixelPocDropShadow } from './rustPixelPocDropShadow.ts'
import type { RustPixelPocInnerShadow } from './rustPixelPocInnerShadow.ts'
import type { RustPixelPocGlow } from './rustPixelPocGlow.ts'
import type { RustPixelPocSatin } from './rustPixelPocSatin.ts'
import type { RustPixelPocStroke } from './rustPixelPocStroke.ts'
import type { RustPixelPocBevel } from './rustPixelPocBevel.ts'
import type { RustPixelPocStagesPlan } from './rustPixelPocStages.ts'
import type { RustPixelPocStyleSourceInput } from './rustPixelPocStylePreparation.ts'
import type { LayerStyleWorkerSource } from './layerStyleRenderProtocol.ts'
import type { RustStyleDecodeTimings } from './rustStyleMediaTimings.ts'
import type { RustPixelPocBlendIf, RustPixelPocColorOverlay, RustPixelPocGradientOverlay, RustPixelPocPatternOverlay,
  RustPixelPocRegion, RustPixelPocUnderlyingBlendIf } from './rustPixelPocRuntime.ts'
import type { RustDocumentOutputGrid } from './rustDocumentComposite.ts'
export type RustPixelPocRequest =
  | { type: 'prepare-document'; id: number; packet: ArrayBuffer; generation: number }
  | { type: 'compose-prepared-document'; id: number; documentId: number; region: RustPixelPocRegion; grid?: RustDocumentOutputGrid }
  | { type: 'release-document'; id: number; documentId: number }
  | { type: 'compose-document-region'; id: number; packet: ArrayBuffer }
  | { type: 'stage-style-media'; id: number; source: LayerStyleWorkerSource; input: RustPixelPocStyleSourceInput; generation: number }
  | { type: 'style-media-staged-png'; id: number; sourceId: number; input: RustPixelPocStyleSourceInput;
      region: RustPixelPocRegion; patterns: Record<string, Blob> }
  | { type: 'style-media-staged-region'; id: number; sourceId: number; input: RustPixelPocStyleSourceInput;
      region: RustPixelPocRegion; patterns: Record<string, Blob> }
  | { type: 'stage-style-source'; id: number; rgba: ArrayBuffer; input: RustPixelPocStyleSourceInput; generation: number }
  | { type: 'style-stages-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion; plan: RustPixelPocStagesPlan }
  | { type: 'bevel-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion;
      target: ArrayBuffer; bevel: RustPixelPocBevel }
  | { type: 'stroke-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion;
      target: ArrayBuffer; stroke: RustPixelPocStroke }
  | { type: 'satin-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion;
      target: ArrayBuffer; satin: RustPixelPocSatin }
  | { type: 'glow-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion;
      target: ArrayBuffer; glow: RustPixelPocGlow }
  | { type: 'inner-shadow-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion;
      target: ArrayBuffer; shadow: RustPixelPocInnerShadow }
  | { type: 'drop-shadow-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion;
      target: ArrayBuffer; shadow: RustPixelPocDropShadow }
  | { type: 'alpha-mask-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion; config: RustPixelPocAlphaMask }
  | { type: 'local-batch-staged-region'; id: number; sourceId: number; region: RustPixelPocRegion; plan: RustPixelPocBatchPlan }
  | { type: 'init'; id: number; wasm: ArrayBuffer }
  | { type: 'render'; id: number; rgba: ArrayBuffer; fillOpacity: number }
  | { type: 'render-region'; id: number; rgba: ArrayBuffer; sourceWidth: number; sourceHeight: number;
      region: { x: number; y: number; width: number; height: number }; fillOpacity: number }
  | { type: 'stage-source'; id: number; rgba: ArrayBuffer; sourceWidth: number;
      sourceHeight: number; generation: number }
  | { type: 'invalidate-source'; id: number; generation: number }
  | { type: 'render-staged-region'; id: number; sourceId: number;
      region: { x: number; y: number; width: number; height: number }; fillOpacity: number }
  | { type: 'blend-if-staged-region'; id: number; sourceId: number;
      region: RustPixelPocRegion; backdrop: ArrayBuffer; blendIf: RustPixelPocUnderlyingBlendIf }
  | { type: 'blend-if-this-layer-staged-region'; id: number; sourceId: number;
      region: RustPixelPocRegion; blendIf: RustPixelPocBlendIf }
  | { type: 'color-overlay-staged-region'; id: number; sourceId: number;
      region: RustPixelPocRegion; target: ArrayBuffer; effect: RustPixelPocColorOverlay }
  | { type: 'pattern-overlay-staged-region'; id: number; sourceId: number;
      region: RustPixelPocRegion; target: ArrayBuffer;
      pattern: { rgba: ArrayBuffer; width: number; height: number }; effect: RustPixelPocPatternOverlay }
  | { type: 'release-source'; id: number; sourceId: number }
  | { type: 'gradient-overlay-staged-region'; id: number; sourceId: number;
      region: RustPixelPocRegion; target: ArrayBuffer; effect: RustPixelPocGradientOverlay }
  | { type: 'cancel'; id: number }
  | { type: 'dispose'; id: number }

export interface RustPixelPocTimings {
  allocationMs: number
  copyInMs: number
  kernelMs: number
  copyOutMs: number
  releaseMs: number
}

export type RustPixelPocResponse =
  | { type: 'document-prepared'; id: number; documentId: number; generation: number; bytes: number; layerCount: number; preparationMs: number }
  | { type: 'document-released'; id: number; documentId: number }
  | { type: 'rendered-prepared-document'; id: number; documentId: number; generation: number; rgba: ArrayBuffer;
      region: RustPixelPocRegion; width: number; height: number; timings: RustPixelPocTimings }
  | { type: 'rendered-document-region'; id: number; rgba: ArrayBuffer; region: RustPixelPocRegion;
      width: number; height: number; timings: RustPixelPocTimings }
  | { type: 'encoded-staged-region'; id: number; blob: Blob; width: number; height: number;
      sourceId: number; generation: number; timings: RustPixelPocTimings;
      patternMedia?: RustStyleDecodeTimings;
      encoding: { canvasUploadMs: number; pngEncodeMs: number } }
  | { type: 'ready'; id: number }
  | { type: 'rendered'; id: number; rgba: ArrayBuffer; timings: RustPixelPocTimings }
  | { type: 'rendered-region'; id: number; rgba: ArrayBuffer; width: number; height: number;
      timings: RustPixelPocTimings }
  | { type: 'rendered-staged-region'; id: number; rgba: ArrayBuffer; width: number; height: number;
      sourceId: number; generation: number; timings: RustPixelPocTimings; patternMedia?: RustStyleDecodeTimings }
  | { type: 'source-staged'; id: number; sourceId: number; generation: number; stagingMs: number;
      prepared?: { sourceKey: string; width: number; height: number; offsetX: number; offsetY: number; preparationMs: number;
        media?: RustStyleDecodeTimings; paddingMs?: number } }
  | { type: 'source-invalidated'; id: number; generation: number }
  | { type: 'source-released'; id: number; sourceId: number }
  | { type: 'cancelled'; id: number }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; code: 'wasm-unavailable' | 'invalid-input' | 'wasm-failure' | 'memory-limit' | 'work-limit' }

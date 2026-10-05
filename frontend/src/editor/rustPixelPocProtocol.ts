// Experimental protocol; not connected to the editor renderer.
import type { RustPixelPocBatchPlan } from './rustPixelPocBatch.ts'
import type { RustPixelPocAlphaMask } from './rustPixelPocAlphaMask.ts'
import type { RustPixelPocDropShadow } from './rustPixelPocDropShadow.ts'
import type { RustPixelPocBlendIf, RustPixelPocColorOverlay, RustPixelPocGradientOverlay, RustPixelPocPatternOverlay,
  RustPixelPocRegion, RustPixelPocUnderlyingBlendIf } from './rustPixelPocRuntime.ts'
export type RustPixelPocRequest =
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
  | { type: 'ready'; id: number }
  | { type: 'rendered'; id: number; rgba: ArrayBuffer; timings: RustPixelPocTimings }
  | { type: 'rendered-region'; id: number; rgba: ArrayBuffer; width: number; height: number;
      timings: RustPixelPocTimings }
  | { type: 'rendered-staged-region'; id: number; rgba: ArrayBuffer; width: number; height: number;
      sourceId: number; generation: number; timings: RustPixelPocTimings }
  | { type: 'source-staged'; id: number; sourceId: number; generation: number; stagingMs: number }
  | { type: 'source-invalidated'; id: number; generation: number }
  | { type: 'source-released'; id: number; sourceId: number }
  | { type: 'cancelled'; id: number }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; code: 'wasm-unavailable' | 'invalid-input' | 'wasm-failure' | 'memory-limit' }

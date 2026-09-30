// Experimental C1 protocol. No document or UI code depends on this worker yet.
export type RustPixelPocRequest =
  | { type: 'init'; id: number; wasm: ArrayBuffer }
  | { type: 'render'; id: number; rgba: ArrayBuffer; fillOpacity: number }
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
  | { type: 'cancelled'; id: number }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; code: 'wasm-unavailable' | 'invalid-input' | 'wasm-failure' }

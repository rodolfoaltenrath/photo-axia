import type { LayerStyleConfig, LayerStyleGlobalLight } from '../types/editor.ts'
import type { LayerStyleRenderQuality } from './layerStyleCompositor.ts'

export interface LayerStyleWorkerRenderRequest {
  type: 'render'
  id: number
  source: Blob
  sourceWidth: number
  sourceHeight: number
  styles: LayerStyleConfig
  globalLight: LayerStyleGlobalLight
  resolutionScale: number
  quality: LayerStyleRenderQuality
}

export interface LayerStyleWorkerCancelRequest {
  type: 'cancel'
  id: number
}

export type LayerStyleWorkerRequest = LayerStyleWorkerRenderRequest | LayerStyleWorkerCancelRequest

export interface LayerStyleWorkerResult {
  id: number
  result?: {
    blob: Blob
    width: number
    height: number
    offsetX: number
    offsetY: number
  }
  error?: string
}

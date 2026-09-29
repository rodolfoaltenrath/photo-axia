import type { LayerStyleConfig, LayerStyleGlobalLight, TextLayerContent } from '../types/editor.ts'
import type { LayerStyleRenderQuality } from './layerStyleCompositor.ts'

export interface LayerStyleWorkerRasterSource {
  type: 'raster'
  blob: Blob
}

export interface LayerStyleWorkerTextSource {
  type: 'text'
  text: TextLayerContent
  drawScaleX: number
  drawScaleY: number
}

export type LayerStyleWorkerSource = LayerStyleWorkerRasterSource | LayerStyleWorkerTextSource

export interface LayerStyleWorkerRenderRequest {
  type: 'render'
  id: number
  source: LayerStyleWorkerSource
  sourceWidth: number
  sourceHeight: number
  styles: LayerStyleConfig
  globalLight: LayerStyleGlobalLight
  resolutionScale: number
  quality: LayerStyleRenderQuality
  patterns: Record<string, Blob>
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

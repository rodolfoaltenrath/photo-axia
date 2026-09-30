import type { LayerStyleConfig, LayerStyleGlobalLight, TextLayerContent } from '../types/editor.ts'
import { LayerStyleUnsupportedEffectError, type LayerStyleRenderQuality } from './layerStyleCompositor.ts'
import { LayerStylePatternMissingError } from './layerStyleRaster.ts'

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

export type LayerStyleWorkerError =
  | { code: 'LAYER_STYLE_UNSUPPORTED_EFFECT', message: string, effectTypes: string[] }
  | { code: 'LAYER_STYLE_PATTERN_MISSING', message: string, effectType: string }
  | { code: 'LAYER_STYLE_RENDER_FAILED', message: string }

export function serializeLayerStyleWorkerError(error: unknown): LayerStyleWorkerError {
  if (error instanceof LayerStyleUnsupportedEffectError) {
    return { code: error.code, message: error.message, effectTypes: [...error.effectTypes] }
  }
  if (error instanceof LayerStylePatternMissingError) {
    return { code: error.code, message: error.message, effectType: error.effectType }
  }
  return {
    code: 'LAYER_STYLE_RENDER_FAILED',
    message: error instanceof Error ? error.message : 'Falha ao compor estilo de camada.'
  }
}

export function deserializeLayerStyleWorkerError(error: LayerStyleWorkerError | string): Error {
  if (typeof error === 'string') return new Error(error)
  if (error.code === 'LAYER_STYLE_UNSUPPORTED_EFFECT' &&
    Array.isArray(error.effectTypes) && error.effectTypes.every((type) => typeof type === 'string')) {
    return new LayerStyleUnsupportedEffectError(error.effectTypes)
  }
  if (error.code === 'LAYER_STYLE_PATTERN_MISSING' && typeof error.effectType === 'string') {
    return new LayerStylePatternMissingError(error.effectType)
  }
  return new Error(typeof error.message === 'string' ? error.message : 'Falha ao compor estilo de camada.')
}

export interface LayerStyleWorkerResult {
  id: number
  result?: {
    blob: Blob
    width: number
    height: number
    offsetX: number
    offsetY: number
  }
  error?: LayerStyleWorkerError | string
}

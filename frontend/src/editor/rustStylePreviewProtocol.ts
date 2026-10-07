import type { LayerStyleRenderRequest, LayerStyleRenderResult } from '../services/layerStyleCompositor.ts'
import type { RustStylePriority } from './rustStyleScheduling.ts'

export interface LayerStylePreviewRequest extends LayerStyleRenderRequest { sourceUrl?: string; priority?: RustStylePriority }
export interface LayerStylePreviewResult extends LayerStyleRenderResult { release(): void }

export class RustStylePreviewCancelledError extends Error {
  constructor() { super('preview-request-obsolete'); this.name = 'RustStylePreviewCancelledError' }
}

export function rustStylePreviewEnabled(search: string) {
  return new URLSearchParams(search).get('axiaRustStyles') === '1'
}

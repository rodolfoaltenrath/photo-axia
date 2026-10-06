import type { LayerStyleRenderRequest, LayerStyleRenderResult } from '../services/layerStyleCompositor.ts'

export interface LayerStylePreviewRequest extends LayerStyleRenderRequest { sourceUrl?: string }
export interface LayerStylePreviewResult extends LayerStyleRenderResult { release(): void }

export class RustStylePreviewCancelledError extends Error {
  constructor() { super('preview-request-obsolete'); this.name = 'RustStylePreviewCancelledError' }
}

export function rustStylePreviewEnabled(search: string) {
  return new URLSearchParams(search).get('axiaRustStyles') === '1'
}

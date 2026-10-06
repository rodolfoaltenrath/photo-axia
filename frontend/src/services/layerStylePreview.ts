import { rustStylePreviewEnabled, RustStylePreviewCancelledError,
  type LayerStylePreviewRequest, type LayerStylePreviewResult } from '../editor/rustStylePreviewProtocol.ts'
import type { RustStylePreview } from '../editor/rustStylePreview.ts'
import { invalidateLayerStyleRender, releaseLayerStyleRenderConsumer, renderLayerStyle } from './layerStyleCompositor.ts'

let experiment: RustStylePreview | undefined
let loading: Promise<RustStylePreview> | undefined
const revisions = new Map<string, symbol>()

export async function renderPreviewLayerStyle(request: LayerStylePreviewRequest): Promise<LayerStylePreviewResult> {
  if (!request.consumerId.startsWith('canvas:') || !rustStylePreviewEnabled(window.location.search)) {
    return { ...await renderLayerStyle(request), release() {} }
  }
  const revision = Symbol()
  revisions.set(request.consumerId, revision)
  loading ??= import('./rustLayerStylePreview.ts').then(module => experiment = module.createRustLayerStylePreview())
  const load = loading
  let preview: RustStylePreview
  try { preview = await load }
  catch {
    if (loading === load) loading = undefined
    if (revisions.get(request.consumerId) !== revision) throw new RustStylePreviewCancelledError()
    return { ...await renderLayerStyle(request), release() {} }
  }
  if (revisions.get(request.consumerId) !== revision) throw new RustStylePreviewCancelledError()
  return preview.render(request)
}

export function invalidatePreviewLayerStyle(consumerId: string) {
  revisions.delete(consumerId)
  experiment?.cancel(consumerId)
  invalidateLayerStyleRender(consumerId)
}

export function releasePreviewLayerStyleConsumer(consumerId: string) {
  revisions.delete(consumerId)
  void experiment?.releaseConsumer(consumerId)
  releaseLayerStyleRenderConsumer(consumerId)
}

export function resetLayerStylePreview() {
  revisions.clear()
  void experiment?.dispose()
}

import { rustStylePreviewEnabled, RustStylePreviewCancelledError,
  type LayerStylePreviewRequest, type LayerStylePreviewResult } from '../editor/rustStylePreviewProtocol.ts'
import type { RustStylePreview } from '../editor/rustStylePreview.ts'
import type { RustStylePriority } from '../editor/rustStyleScheduling.ts'
import { invalidateLayerStyleRender, releaseLayerStyleRenderConsumer, renderLayerStyle } from './layerStyleCompositor.ts'

let experiment: RustStylePreview | undefined
let loading: Promise<RustStylePreview> | undefined
const revisions = new Map<string, { priority: RustStylePriority }>()

export async function renderPreviewLayerStyle(request: LayerStylePreviewRequest): Promise<LayerStylePreviewResult> {
  if (!request.consumerId.startsWith('canvas:') || !rustStylePreviewEnabled(window.location.search)) {
    return { ...await renderLayerStyle(request), release() {} }
  }
  const entry = { priority: request.priority ?? 'visible' }
  revisions.set(request.consumerId, entry)
  loading ??= import('./rustLayerStylePreview.ts').then(module => experiment = module.createRustLayerStylePreview())
  const load = loading
  let preview: RustStylePreview
  try { preview = await load }
  catch {
    if (loading === load) loading = undefined
    if (revisions.get(request.consumerId) !== entry) throw new RustStylePreviewCancelledError()
    return { ...await renderLayerStyle(request), release() {} }
  }
  if (revisions.get(request.consumerId) !== entry) throw new RustStylePreviewCancelledError()
  return preview.render({ ...request, priority: entry.priority })
}

export function updatePreviewLayerStylePriority(consumerId: string, priority: RustStylePriority) {
  const entry = revisions.get(consumerId)
  if (entry) entry.priority = priority
  experiment?.setPriority(consumerId, priority)
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

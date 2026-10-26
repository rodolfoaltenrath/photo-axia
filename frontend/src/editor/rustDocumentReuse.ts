import type { RustEditorialPlan } from './rustDocumentEditorial.ts'
import { rustStylePreviewPatternAssets } from './rustStylePreview.ts'

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false
  if (![a, b].every(value => Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return false
  const keys = Object.keys(a), other = Object.keys(b)
  return keys.length === other.length && keys.every(key => Object.hasOwn(b, key) &&
    sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

export function rustDocumentReusable(plan: RustEditorialPlan) {
  const immutable = (url: string) => url.startsWith('blob:') || url.startsWith('data:')
  return plan.layers.every(layer => (layer.source.type !== 'raster' || immutable(layer.source.url)) &&
    rustStylePreviewPatternAssets(layer.input).every(asset => immutable(asset.sourceUrl)))
}

export function sameRustDocumentPreparation(a: RustEditorialPlan, b: RustEditorialPlan) {
  // Output region/grid do not change prepared sources; layer culling is already part of the snapshot.
  return a.documentWidth === b.documentWidth && a.documentHeight === b.documentHeight && sameValue(a.layers, b.layers)
}

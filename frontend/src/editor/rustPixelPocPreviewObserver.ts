import type { DocumentSpec, LayerItem, LayerTransform } from '../types/editor.ts'
import { layerStyleHash } from './layerStyleCompositor.ts'
import { RustPixelPocTileGate } from './rustPixelPocTileGate.ts'

export interface RustPixelPocViewportState {
  /** The animated visual scale, not only the final toolbar zoom value. */
  scale: number
  devicePixelRatio: number
  scrollLeft: number
  scrollTop: number
  width: number
  height: number
  /** Changes when another layer or the document stack changes appearance. */
  stackKey: string
}

export interface RustPixelPocPreviewSnapshot {
  documentId: string
  layerId: string
  sourceKey: string | null
  appearanceKey: string
  viewportKey: string
}

/** A conservative one-layer observation; no real preview subscribes to it yet. */
export function rasterPreviewSnapshot(
  document: Pick<DocumentSpec, 'id' | 'width' | 'height' | 'background' | 'colorSpace' |
    'resolutionDpi' | 'layerStyleGlobalLight'>,
  layer: Pick<LayerItem, 'id' | 'kind' | 'image' | 'styles' | 'visible' | 'opacity' | 'blendMode'>,
  transform: LayerTransform | undefined,
  viewport: RustPixelPocViewportState,
  /** Pass a memoized value when observing every pan/zoom frame. */
  cachedStyleHash?: string
): RustPixelPocPreviewSnapshot {
  const image = layer.image
  const preview = Boolean(image?.previewUrl)
  const sourceKey = image ? JSON.stringify([
    document.id, layer.id, image.previewUrl ?? image.sourceUrl, image.editToken ?? null,
    preview ? image.previewWidth ?? image.width : image.width,
    preview ? image.previewHeight ?? image.height : image.height
  ]) : null
  return {
    documentId: document.id,
    layerId: layer.id,
    sourceKey,
    appearanceKey: JSON.stringify([
      document.width, document.height, document.background, document.colorSpace,
      document.resolutionDpi, layer.kind, layer.visible, layer.opacity, layer.blendMode,
      cachedStyleHash ?? layerStyleHash(layer.styles, document.layerStyleGlobalLight),
      transform?.x, transform?.y, transform?.width, transform?.height, transform?.rotation ?? 0,
      viewport.stackKey
    ]),
    viewportKey: JSON.stringify([
      viewport.scale, viewport.devicePixelRatio, viewport.scrollLeft, viewport.scrollTop,
      viewport.width, viewport.height
    ])
  }
}

export type RustPixelPocInvalidation =
  | { kind: 'source'; generation: number }
  | { kind: 'view' }
  | { kind: 'none' }

/** Turns editor state changes into the POC's source/view invalidation barriers. */
export class RustPixelPocPreviewObserver {
  private previous: RustPixelPocPreviewSnapshot | undefined
  private readonly gate: RustPixelPocTileGate

  constructor(gate: RustPixelPocTileGate) {
    this.gate = gate
  }

  observe(next: RustPixelPocPreviewSnapshot): RustPixelPocInvalidation {
    const previous = this.previous
    if (!previous || next.documentId !== previous.documentId ||
        next.layerId !== previous.layerId || next.sourceKey !== previous.sourceKey) {
      const generation = this.gate.beginSourceChange()
      this.previous = { ...next }
      return { kind: 'source', generation }
    }
    if (next.appearanceKey !== previous.appearanceKey || next.viewportKey !== previous.viewportKey) {
      this.gate.beginViewChange()
      this.previous = { ...next }
      return { kind: 'view' }
    }
    return { kind: 'none' }
  }
}

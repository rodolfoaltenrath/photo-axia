import { createLayerStyleConfig } from '../src/editor/layerStyles.ts'
import type {
  ImageAsset,
  LayerItem,
  LayerStyleConfig,
  LayerTransform,
  TextLayerContent
} from '../src/types/editor.ts'

export function layer(overrides: Partial<LayerItem> = {}): LayerItem {
  const { styles: layerStyles, ...layerOverrides } = overrides
  return {
    id: 'layer',
    name: 'Camada',
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind: 'pixel',
    styles: layerStyles ?? createLayerStyleConfig(),
    ...layerOverrides
  }
}

export function image(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    width: 10,
    height: 10,
    mimeType: 'image/png',
    sourceUrl: 'blob:test-image',
    ...overrides
  }
}

export function transform(overrides: Partial<LayerTransform> = {}): LayerTransform {
  return {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    ...overrides
  }
}

export function text(overrides: Partial<TextLayerContent> = {}): TextLayerContent {
  return {
    content: 'Axia',
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400,
    color: '#000000',
    alignment: 'left',
    lineHeight: 1.2,
    baseWidth: 100,
    baseHeight: 20,
    ...overrides
  }
}

export function styles(overrides: Partial<LayerStyleConfig> = {}): LayerStyleConfig {
  return {
    ...createLayerStyleConfig(),
    ...overrides
  }
}

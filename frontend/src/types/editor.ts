export type EditorTool = 'move' | 'brush' | 'eraser' | 'gradient' | 'eyedropper' | 'crop' | 'text' | 'hand' | 'zoom'

export type LayerKind = 'pixel' | 'image' | 'text' | 'smart' | 'adjustment' | 'background'
export type LayerBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
export type DocumentUnit = 'px' | 'cm' | 'mm' | 'in'
export type DocumentBackground = 'transparent' | 'white' | 'black'
export type TextAlignment = 'left' | 'center' | 'right'

export interface LayerStyleGlobalLight {
  angle: number
  altitude: number
}

export interface LayerStyleContourPoint {
  x: number
  y: number
}

export interface LayerStyleContour {
  preset: 'linear' | 'cone' | 'inverted-cone' | 'gaussian' | 'ring' | 'custom'
  points: LayerStyleContourPoint[]
}

export interface LayerStyleGradientColorStop {
  position: number
  color: string
}

export interface LayerStyleGradientOpacityStop {
  position: number
  opacity: number
}

export interface LayerStyleGradient {
  type: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond'
  colorStops: LayerStyleGradientColorStop[]
  opacityStops: LayerStyleGradientOpacityStop[]
  interpolation: 'srgb'
}

export interface LayerStylePatternAsset {
  id: string
  name: string
  width: number
  height: number
  mimeType: string
  sourceUrl: string
  byteSize?: number
}

export type LayerStylePaint =
  | { type: 'color'; color: string }
  | { type: 'gradient'; gradient: LayerStyleGradient; angle: number; scale: number; reverse: boolean; alignWithLayer: boolean }
  | { type: 'pattern'; pattern?: LayerStylePatternAsset; angle: number; scale: number; linkWithLayer: boolean }

export interface LayerEffectBase {
  id: string
  enabled: boolean
  opacity: number
  blendMode: LayerBlendMode
}

export interface DropShadowEffect extends LayerEffectBase {
  type: 'drop-shadow'
  color: string
  angle: number
  useGlobalLight: boolean
  distance: number
  spread: number
  size: number
  noise: number
  contour: LayerStyleContour
  layerKnocksOutShadow: boolean
}

export interface InnerShadowEffect extends LayerEffectBase {
  type: 'inner-shadow'
  color: string
  angle: number
  useGlobalLight: boolean
  distance: number
  choke: number
  size: number
  noise: number
  contour: LayerStyleContour
}

export interface OuterGlowEffect extends LayerEffectBase {
  type: 'outer-glow'
  paint: Extract<LayerStylePaint, { type: 'color' | 'gradient' }>
  technique: 'softer' | 'precise'
  spread: number
  size: number
  noise: number
  contour: LayerStyleContour
  range: number
  jitter: number
}

export interface InnerGlowEffect extends LayerEffectBase {
  type: 'inner-glow'
  paint: Extract<LayerStylePaint, { type: 'color' | 'gradient' }>
  technique: 'softer' | 'precise'
  source: 'edge' | 'center'
  choke: number
  size: number
  noise: number
  contour: LayerStyleContour
  range: number
  jitter: number
}

export interface StrokeEffect extends LayerEffectBase {
  type: 'stroke'
  size: number
  position: 'inside' | 'center' | 'outside'
  paint: LayerStylePaint
}

export interface ColorOverlayEffect extends LayerEffectBase {
  type: 'color-overlay'
  color: string
}

export interface GradientOverlayEffect extends LayerEffectBase {
  type: 'gradient-overlay'
  gradient: LayerStyleGradient
  angle: number
  scale: number
  reverse: boolean
  alignWithLayer: boolean
}

export interface PatternOverlayEffect extends LayerEffectBase {
  type: 'pattern-overlay'
  pattern?: LayerStylePatternAsset
  angle: number
  scale: number
  linkWithLayer: boolean
}

export interface SatinEffect extends LayerEffectBase {
  type: 'satin'
  color: string
  angle: number
  distance: number
  size: number
  invert: boolean
  contour: LayerStyleContour
}

export interface BevelEmbossEffect extends LayerEffectBase {
  type: 'bevel-emboss'
  style: 'inner-bevel' | 'outer-bevel' | 'emboss' | 'pillow-emboss'
  technique: 'smooth' | 'chisel-hard' | 'chisel-soft'
  depth: number
  direction: 'up' | 'down'
  size: number
  soften: number
  angle: number
  altitude: number
  useGlobalLight: boolean
  glossContour: LayerStyleContour
  highlightMode: LayerBlendMode
  highlightColor: string
  highlightOpacity: number
  shadowMode: LayerBlendMode
  shadowColor: string
  shadowOpacity: number
  contourEnabled: boolean
  contour: LayerStyleContour
  contourRange: number
  textureEnabled: boolean
  texture?: LayerStylePatternAsset
  textureScale: number
  textureDepth: number
  textureInvert: boolean
  textureLinkWithLayer: boolean
}

export type LayerEffect =
  | DropShadowEffect
  | InnerShadowEffect
  | OuterGlowEffect
  | InnerGlowEffect
  | StrokeEffect
  | ColorOverlayEffect
  | GradientOverlayEffect
  | PatternOverlayEffect
  | SatinEffect
  | BevelEmbossEffect

export type LayerEffectType = LayerEffect['type']

export interface LayerStyleConfig {
  enabled: boolean
  fillOpacity: number
  effects: LayerEffect[]
}

export interface DocumentSpec {
  id: string
  name: string
  width: number
  height: number
  unit: DocumentUnit
  physicalWidth: number
  physicalHeight: number
  resolutionDpi: number
  colorSpace: string
  background: DocumentBackground
  createdAt: string
  layerStyleGlobalLight: LayerStyleGlobalLight
}

export interface LayerItem {
  id: string
  name: string
  visible: boolean
  opacity: number
  blendMode: LayerBlendMode
  kind: LayerKind
  styles: LayerStyleConfig
  image?: ImageAsset
  smart?: SmartLayerContent
  text?: TextLayerContent
  transform?: LayerTransform
}

export interface SmartLayerContent {
  id: string
  width: number
  height: number
  resolutionDpi: number
  colorSpace: string
  background: DocumentBackground
  layerStyleGlobalLight: LayerStyleGlobalLight
  layers: LayerItem[]
  revision: number
}

export interface TextLayerContent {
  content: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  alignment: TextAlignment
  lineHeight: number
  baseWidth: number
  baseHeight: number
}

export interface ImageAsset {
  width: number
  height: number
  mimeType: string
  sourceUrl: string
  byteSize?: number
  resolutionDpiX?: number
  resolutionDpiY?: number
  resolutionSource?: 'png-phys' | 'jpeg-jfif' | 'jpeg-exif'
  previewUrl?: string
  previewWidth?: number
  previewHeight?: number
  /** Token privado que permite ao worker reutilizar o raster da última pincelada. */
  editToken?: string
}

export interface LayerTransform {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export interface ImportedImage {
  id: string
  name: string
  width: number
  height: number
  mimeType: string
  sourceUrl: string
  byteSize?: number
  resolutionDpiX?: number
  resolutionDpiY?: number
  resolutionSource?: 'png-phys' | 'jpeg-jfif' | 'jpeg-exif'
}

export interface NewDocumentSettings {
  name: string
  unit: DocumentUnit
  width: number
  height: number
  resolutionDpi: number
  background: DocumentBackground
}

export interface RecentProject {
  id: string
  path: string
  name: string
  width: number
  height: number
  modifiedAt: string
  lastOpenedAt: string
  thumbnailUrl: string
  thumbnailVersion: number
  available: boolean
}

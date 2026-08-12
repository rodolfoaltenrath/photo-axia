export type EditorTool = 'move' | 'brush' | 'eraser' | 'crop' | 'text' | 'hand' | 'zoom'

export type LayerKind = 'pixel' | 'image' | 'text' | 'adjustment' | 'background'
export type LayerBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
export type DocumentUnit = 'px' | 'cm' | 'mm' | 'in'
export type DocumentBackground = 'transparent' | 'white' | 'black'
export type TextAlignment = 'left' | 'center' | 'right'

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
}

export interface LayerItem {
  id: string
  name: string
  visible: boolean
  opacity: number
  blendMode: LayerBlendMode
  kind: LayerKind
  image?: ImageAsset
  text?: TextLayerContent
  transform?: LayerTransform
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

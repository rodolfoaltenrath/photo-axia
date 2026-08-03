export type EditorTool = 'move' | 'select' | 'brush' | 'eraser' | 'crop' | 'text' | 'hand' | 'zoom'

export type LayerKind = 'pixel' | 'image' | 'adjustment' | 'background'
export type DocumentUnit = 'px' | 'cm'
export type DocumentBackground = 'transparent' | 'white' | 'black'

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
  kind: LayerKind
  image?: ImageAsset
  transform?: LayerTransform
}

export interface ImageAsset {
  width: number
  height: number
  mimeType: string
  sourceUrl: string
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

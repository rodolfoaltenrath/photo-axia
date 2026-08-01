import {
  ApplyPreviewFilter,
  CreateDocument,
  GetEditorStatus,
  SaveExportedPNG,
  SelectImageFiles
} from '../../wailsjs/go/main/App'
import type { DocumentSpec, ImportedImage, NewDocumentSettings } from '../types/editor'

interface EditorStatus {
  appName: string
  engine: string
  documentOpen: boolean
}

export function hasDesktopBackend() {
  return Boolean((window as typeof window & { go?: unknown }).go)
}

export async function getEditorStatus(): Promise<EditorStatus> {
  if (!hasDesktopBackend()) {
    return { appName: 'Axia', engine: 'web-preview', documentOpen: true }
  }

  return GetEditorStatus()
}

export async function createEditorDocument(
  settings: NewDocumentSettings,
  width: number,
  height: number
): Promise<DocumentSpec> {
  if (!hasDesktopBackend()) {
    return {
      id: crypto.randomUUID(),
      name: settings.name || 'Sem título',
      width,
      height,
      unit: settings.unit,
      physicalWidth: settings.width,
      physicalHeight: settings.height,
      resolutionDpi: settings.resolutionDpi,
      colorSpace: 'sRGB',
      background: settings.background,
      createdAt: new Date().toISOString()
    }
  }

  const document = await CreateDocument(
    settings.name,
    width,
    height,
    settings.unit,
    settings.width,
    settings.height,
    settings.resolutionDpi,
    settings.background
  )

  return document as DocumentSpec
}

export async function selectDesktopImages(): Promise<ImportedImage[]> {
  if (!hasDesktopBackend()) return []
  return (await SelectImageFiles()) as ImportedImage[]
}

export async function applyPreviewFilter(filterName: string) {
  if (!hasDesktopBackend()) return `Prévia do filtro: ${filterName}`
  return ApplyPreviewFilter(filterName)
}

export async function saveExportedPNG(name: string, dataURL: string) {
  const filename = name.toLowerCase().endsWith('.png') ? name : `${name}.png`

  if (hasDesktopBackend()) {
    return SaveExportedPNG(filename, dataURL)
  }

  const link = window.document.createElement('a')
  link.download = filename
  link.href = dataURL
  link.click()
  return filename
}

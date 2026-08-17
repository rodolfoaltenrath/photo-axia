import {
  ApplyPreviewFilter,
  ClearRecentProjects,
  CreateDocument,
  FinalizeAxiaProjectOpen,
  GetEditorStatus,
  ListRecentProjects,
  OpenAxiaProject,
  OpenRecentProject,
  PrepareAxiaProjectSave,
  PrepareRecentThumbnail,
  RecordRecentProject,
  ReleaseAxiaProjectAssets,
  SaveExportedPNG,
  RemoveRecentProject,
  SetDocumentDirty,
  SelectImageFiles
} from '../../wailsjs/go/main/App'
import type { DocumentSpec, ImportedImage, NewDocumentSettings, RecentProject } from '../types/editor'
import { DEFAULT_LAYER_STYLE_GLOBAL_LIGHT, normalizeLayerStyleGlobalLight } from '../editor/layerStyles'

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
      createdAt: new Date().toISOString(),
      layerStyleGlobalLight: { ...DEFAULT_LAYER_STYLE_GLOBAL_LIGHT }
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

  return {
    ...(document as Omit<DocumentSpec, 'layerStyleGlobalLight'> & Partial<Pick<DocumentSpec, 'layerStyleGlobalLight'>>),
    layerStyleGlobalLight: normalizeLayerStyleGlobalLight((document as Partial<DocumentSpec>).layerStyleGlobalLight)
  }
}

export async function selectDesktopImages(): Promise<ImportedImage[]> {
  if (!hasDesktopBackend()) return []
  return (await SelectImageFiles()) as ImportedImage[]
}

export async function applyPreviewFilter(filterName: string) {
  if (!hasDesktopBackend()) return `Prévia do filtro: ${filterName}`
  return ApplyPreviewFilter(filterName)
}

export async function prepareAxiaProjectSave(suggestedName: string, currentPath: string, saveAs: boolean) {
  if (!hasDesktopBackend()) throw new Error('Projetos .axia precisam ser salvos pelo aplicativo nativo.')
  return PrepareAxiaProjectSave(suggestedName, currentPath, saveAs)
}

export async function openAxiaProject() {
  if (!hasDesktopBackend()) throw new Error('Projetos .axia precisam ser abertos pelo aplicativo nativo.')
  return OpenAxiaProject()
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  if (!hasDesktopBackend()) return []
  return (await ListRecentProjects()) as RecentProject[]
}

export async function openRecentProject(path: string) {
  if (!hasDesktopBackend()) throw new Error('Projetos recentes precisam do aplicativo nativo.')
  return OpenRecentProject(path)
}

export async function recordRecentProject(path: string, name: string, width: number, height: number) {
  if (!hasDesktopBackend()) return undefined
  return (await RecordRecentProject(path, name, width, height)) as RecentProject
}

export async function removeRecentProject(path: string) {
  if (!hasDesktopBackend()) return
  await RemoveRecentProject(path)
}

export async function clearRecentProjects() {
  if (!hasDesktopBackend()) return
  await ClearRecentProjects()
}

export async function uploadRecentThumbnail(path: string, thumbnail: Blob) {
  if (!hasDesktopBackend()) return
  const token = await PrepareRecentThumbnail(path)
  const response = await fetch(`/__axia_recent/thumbnail/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': thumbnail.type || 'image/png' },
    body: thumbnail
  })
  if (!response.ok) throw new Error((await response.text()).trim() || 'Não foi possível salvar a miniatura.')
}

export async function finalizeAxiaProjectOpen(sessionId: string, accepted: boolean) {
  if (!hasDesktopBackend() || !sessionId) return
  await FinalizeAxiaProjectOpen(sessionId, accepted)
}

export async function releaseAxiaProjectAssets() {
  if (!hasDesktopBackend()) return
  await ReleaseAxiaProjectAssets()
}

export async function setNativeDocumentDirty(dirty: boolean) {
  if (!hasDesktopBackend()) return
  await SetDocumentDirty(dirty)
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
